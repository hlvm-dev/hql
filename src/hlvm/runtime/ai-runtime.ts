/**
 * AI Runtime Manager for HLVM
 *
 * Handles extraction and lifecycle of the embedded AI engine (Ollama).
 * This is internal - users never see or interact with this directly.
 *
 * SSOT: Uses ai.status() from the API module directly - no fallback fetch.
 */

import { RuntimeError } from "../../common/error.ts";
import { ai } from "../api/ai.ts";
import { log } from "../api/log.ts";
import { ensureRuntimeDir, getRuntimeDir } from "../../common/paths.ts";
import { findLegacyRuntimeEngine } from "../../common/legacy-migration.ts";
import { getPlatform } from "../../platform/platform.ts";

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

/**
 * Check if AI runtime (Ollama) is already running
 * 100% SSOT: Uses ai.status() from the API module - no direct fetch
 */
async function isAIRunning(): Promise<boolean> {
  try {
    // 100% SSOT: Use ai.status() only - no fallback bypass
    const status = await ai.status();
    return status.available;
  } catch {
    return false;
  }
}

/**
 * Extract embedded AI engine if needed
 */
async function extractAIEngine(platform = getPlatform()): Promise<void> {
  if (await platform.fs.exists(AI_ENGINE_PATH)) {
    return;
  }

  try {
    // Check for legacy runtime before extracting embedded engine
    const legacyEnginePath = await findLegacyRuntimeEngine();
    if (legacyEnginePath) {
      await ensureRuntimeDir();
      await platform.fs.copyFile(legacyEnginePath, AI_ENGINE_PATH);
      await platform.fs.chmod(AI_ENGINE_PATH, 0o755);
      return;
    }

    // Read embedded AI engine from compiled binary
    const engineBytes = await platform.fs.readFile(
      platform.path.fromFileUrl(new URL("../../resources/ai-engine", import.meta.url))
    );

    // Create runtime directory
    await ensureRuntimeDir();

    // Write AI engine
    await platform.fs.writeFile(AI_ENGINE_PATH, engineBytes);
    await platform.fs.chmod(AI_ENGINE_PATH, 0o755);
  } catch (error) {
    // In development mode, AI engine might not be embedded
    // This is OK - user might have Ollama installed separately
    if (isMissingEmbeddedEngineError(error)) {
      return; // Skip extraction in dev mode
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

/**
 * Start the AI engine
 */
async function startAIEngine(platform = getPlatform()): Promise<void> {
  // Try embedded engine first
  const enginePath = await platform.fs.exists(AI_ENGINE_PATH)
    ? AI_ENGINE_PATH
    : SYSTEM_AI_ENGINE;

  try {
    const aiProcess = platform.command.run({
      cmd: [enginePath, "serve"],
      stdout: "null",
      stderr: "null",
    });

    // Unref the process so Node/Deno can exit without waiting for it
    // This prevents the CLI from hanging after AI operations complete
    aiProcess.unref?.();

    // Wait for AI engine to be ready
    if (await waitForAIEngineReady()) {
      return;
    }
    throw new RuntimeError("AI engine failed to start");
  } catch (error) {
    // If embedded engine fails, AI features will just not work
    // but HLVM itself continues to function
    log.warn(`AI features unavailable: ${(error as Error).message}`);
  }
}

/**
 * Initialize AI runtime
 * Call this at CLI startup if AI features might be used
 */
export async function initAIRuntime(): Promise<void> {
  if (initialized) return;
  initialized = true;
  const platform = getPlatform();

  // Check for disable flag (e.g. during tests)
  if (platform.env.get("HLVM_DISABLE_AI_AUTOSTART")) {
    return;
  }

  // Check if already running
  if (await isAIRunning()) {
    return;
  }

  // Extract if needed
  await extractAIEngine(platform);

  // Start AI engine
  await startAIEngine(platform);
}
