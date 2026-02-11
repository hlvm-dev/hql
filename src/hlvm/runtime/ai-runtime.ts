/**
 * AI Runtime Manager for HLVM
 *
 * Handles extraction and lifecycle of the embedded AI engine (Ollama).
 * Exports an AIEngineLifecycle interface so consumers depend on abstraction,
 * not the concrete embedded-vs-system implementation details.
 *
 * SSOT: Uses ai.status() from the API module directly - no fallback fetch.
 */

import { RuntimeError } from "../../common/error.ts";
import { ai } from "../api/ai.ts";
import { log } from "../api/log.ts";
import { ensureRuntimeDir, getRuntimeDir } from "../../common/paths.ts";
import { findLegacyRuntimeEngine } from "../../common/legacy-migration.ts";
import { getPlatform } from "../../platform/platform.ts";

// ============================================================================
// Interface — consumers depend on this, not concrete internals
// ============================================================================

/** Abstraction for AI engine lifecycle operations. */
export interface AIEngineLifecycle {
  /** Check if the engine daemon is reachable. */
  isRunning(): Promise<boolean>;
  /** Ensure the engine is extracted (if embedded) and running. Returns success. */
  ensureRunning(): Promise<boolean>;
  /** Get the path to the engine binary (embedded or system). */
  getEnginePath(): Promise<string>;
}

// ============================================================================
// Private implementation
// ============================================================================

const RUNTIME_DIR = getRuntimeDir();
const AI_ENGINE_PATH = `${RUNTIME_DIR}/engine`;
const SYSTEM_AI_ENGINE = "ollama";
const AI_STARTUP_MAX_POLLS = 30;
const AI_STARTUP_POLL_INTERVAL_MS = 300;

let initialized = false;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isMissingEmbeddedEngineError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("No such file");
}

async function isAIRunning(): Promise<boolean> {
  try {
    const status = await ai.status();
    return status.available;
  } catch {
    return false;
  }
}

async function extractAIEngine(platform = getPlatform()): Promise<void> {
  if (await platform.fs.exists(AI_ENGINE_PATH)) {
    return;
  }

  try {
    const legacyEnginePath = await findLegacyRuntimeEngine();
    if (legacyEnginePath) {
      await ensureRuntimeDir();
      await platform.fs.copyFile(legacyEnginePath, AI_ENGINE_PATH);
      await platform.fs.chmod(AI_ENGINE_PATH, 0o755);
      return;
    }

    const engineBytes = await platform.fs.readFile(
      platform.path.fromFileUrl(new URL("../../resources/ai-engine", import.meta.url))
    );
    await ensureRuntimeDir();
    await platform.fs.writeFile(AI_ENGINE_PATH, engineBytes);
    await platform.fs.chmod(AI_ENGINE_PATH, 0o755);
  } catch (error) {
    // In development mode, AI engine might not be embedded — fall back to system
    if (isMissingEmbeddedEngineError(error)) {
      return;
    }
    throw error;
  }
}

async function waitForAIEngineReady(): Promise<boolean> {
  for (let i = 0; i < AI_STARTUP_MAX_POLLS; i++) {
    if (await isAIRunning()) {
      return true;
    }
    await sleep(AI_STARTUP_POLL_INTERVAL_MS);
  }
  return false;
}

async function startAIEngine(platform = getPlatform()): Promise<void> {
  const enginePath = await platform.fs.exists(AI_ENGINE_PATH)
    ? AI_ENGINE_PATH
    : SYSTEM_AI_ENGINE;

  try {
    const aiProcess = platform.command.run({
      cmd: [enginePath, "serve"],
      stdout: "null",
      stderr: "null",
    });
    aiProcess.unref?.();

    if (await waitForAIEngineReady()) {
      return;
    }
    throw new RuntimeError("AI engine failed to start");
  } catch (error) {
    log.warn(`AI features unavailable: ${(error as Error).message}`);
  }
}

async function resolveEnginePath(): Promise<string> {
  const platform = getPlatform();
  if (await platform.fs.exists(AI_ENGINE_PATH)) {
    return AI_ENGINE_PATH;
  }
  return SYSTEM_AI_ENGINE;
}

// ============================================================================
// Concrete singleton — the single AIEngineLifecycle implementation
// ============================================================================

/**
 * Concrete AI engine lifecycle — handles embedded extraction + system fallback.
 * Import this when you need engine operations.
 */
export const aiEngine: AIEngineLifecycle = {
  isRunning: isAIRunning,

  async ensureRunning(): Promise<boolean> {
    if (await isAIRunning()) return true;
    const platform = getPlatform();
    await extractAIEngine(platform);
    await startAIEngine(platform);
    return await isAIRunning();
  },

  getEnginePath: resolveEnginePath,
};

// ============================================================================
// CLI startup hook (uses the disable flag, unlike aiEngine.ensureRunning)
// ============================================================================

/**
 * Initialize AI runtime at CLI startup.
 * Respects HLVM_DISABLE_AI_AUTOSTART (for tests).
 * For explicit setup flows, use aiEngine.ensureRunning() instead.
 */
export async function initAIRuntime(): Promise<void> {
  if (initialized) return;
  initialized = true;
  const platform = getPlatform();

  if (platform.env.get("HLVM_DISABLE_AI_AUTOSTART")) {
    return;
  }

  if (await isAIRunning()) {
    return;
  }

  await extractAIEngine(platform);
  await startAIEngine(platform);
}
