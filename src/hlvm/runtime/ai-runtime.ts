/**
 * AI Runtime Manager for HLVM
 *
 * Handles extraction and lifecycle of the embedded AI engine (Ollama).
 * Exports an AIEngineLifecycle interface so consumers depend on abstraction,
 * not the concrete embedded-vs-system implementation details.
 *
 * SSOT: Uses ai.status() from the API module directly - no fallback fetch.
 */

import { delay } from "@std/async";
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

const SYSTEM_AI_ENGINE = "ollama";
const AI_STARTUP_MAX_POLLS = 30;
const AI_STARTUP_POLL_INTERVAL_MS = 300;

let initPromise: Promise<void> | null = null;

function isMissingEmbeddedEngineError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("No such file");
}

function getEmbeddedEnginePath(): string {
  return `${getRuntimeDir()}/engine`;
}

async function isAIRunning(): Promise<boolean> {
  try {
    // AI runtime lifecycle here means the local Ollama daemon, not whichever
    // provider is currently configured as default (which may be cloud-only).
    const status = await ai.status("ollama");
    return status.available;
  } catch {
    return false;
  }
}

/**
 * Check if a candidate engine binary has the same size as the HLVM CLI itself.
 * Same size means the binary was likely overwritten by the CLI → running it
 * would cause recursive spawning.
 */
async function matchesSelfBinarySize(
  candidatePath: string,
  platform = getPlatform(),
): Promise<boolean> {
  const execPath = platform.process.execPath?.();
  if (!execPath) return false;
  const [candidateInfo, selfInfo] = await Promise.all([
    platform.fs.stat(candidatePath).catch(() => null),
    platform.fs.stat(execPath).catch(() => null),
  ]);
  return !!(candidateInfo && selfInfo && candidateInfo.size === selfInfo.size);
}

async function extractAIEngine(platform = getPlatform()): Promise<void> {
  const embeddedEnginePath = getEmbeddedEnginePath();
  if (await platform.fs.exists(embeddedEnginePath)) {
    return;
  }

  try {
    const legacyEnginePath = await findLegacyRuntimeEngine();
    if (legacyEnginePath) {
      if (await matchesSelfBinarySize(legacyEnginePath, platform)) {
        log.warn?.("Legacy engine binary matches HLVM CLI size — skipping copy");
        // Fall through to embedded resource extraction below
      } else {
        await ensureRuntimeDir();
        await platform.fs.copyFile(legacyEnginePath, embeddedEnginePath);
        await platform.fs.chmod(embeddedEnginePath, 0o755);
        return;
      }
    }

    const engineBytes = await platform.fs.readFile(
      platform.path.fromFileUrl(new URL("../../resources/ai-engine", import.meta.url))
    );
    await ensureRuntimeDir();
    await platform.fs.writeFile(embeddedEnginePath, engineBytes);
    await platform.fs.chmod(embeddedEnginePath, 0o755);
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
    await delay(AI_STARTUP_POLL_INTERVAL_MS);
  }
  return false;
}

async function startAIEngine(platform = getPlatform()): Promise<void> {
  const embeddedEnginePath = getEmbeddedEnginePath();
  const enginePath = await platform.fs.exists(embeddedEnginePath)
    ? embeddedEnginePath
    : SYSTEM_AI_ENGINE;

  // Guard against recursive self-execution
  if (enginePath !== SYSTEM_AI_ENGINE) {
    try {
      if (await matchesSelfBinarySize(enginePath, platform)) {
        log.warn?.(
          "AI engine binary appears to be the HLVM CLI itself — skipping to avoid recursive spawn",
        );
        return;
      }
    } catch {
      // Best-effort guard only
    }
  }

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
    throw error;
  }
}

async function resolveEnginePath(): Promise<string> {
  const platform = getPlatform();
  const embeddedEnginePath = getEmbeddedEnginePath();
  if (await platform.fs.exists(embeddedEnginePath)) {
    return embeddedEnginePath;
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
export function initAIRuntime(): Promise<void> {
  if (!initPromise) {
    initPromise = doInitAIRuntime().catch((e) => {
      initPromise = null; // Allow retry on failure
      throw e;
    });
  }
  return initPromise;
}

async function doInitAIRuntime(): Promise<void> {
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
