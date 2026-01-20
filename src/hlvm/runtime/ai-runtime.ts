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
import { getPlatform, type PlatformCommandProcess } from "../../platform/platform.ts";

const RUNTIME_DIR = getRuntimeDir();
const AI_ENGINE_PATH = `${RUNTIME_DIR}/engine`;

let aiProcess: PlatformCommandProcess | null = null;
let initialized = false;

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
async function extractAIEngine(): Promise<void> {
  const platform = getPlatform();
  try {
    await platform.fs.stat(AI_ENGINE_PATH);
    return; // Already extracted
  } catch {
    // Need to extract
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
    if ((error as Error).message.includes("No such file")) {
      return; // Skip extraction in dev mode
    }
    throw error;
  }
}

/**
 * Start the AI engine
 */
async function startAIEngine(): Promise<void> {
  const platform = getPlatform();
  // Try embedded engine first
  let enginePath = AI_ENGINE_PATH;

  try {
    await platform.fs.stat(enginePath);
  } catch {
    // Try system ollama
    enginePath = "ollama";
  }

  try {
    aiProcess = platform.command.run({
      cmd: [enginePath, "serve"],
      stdout: "null",
      stderr: "null",
    });

    // Unref the process so Node/Deno can exit without waiting for it
    // This prevents the CLI from hanging after AI operations complete
    aiProcess.unref?.();

    // Wait for AI engine to be ready
    for (let i = 0; i < 30; i++) {
      if (await isAIRunning()) {
        return;
      }
      await new Promise(r => setTimeout(r, 300));
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

  // Check for disable flag (e.g. during tests)
  if (getPlatform().env.get("HLVM_DISABLE_AI_AUTOSTART")) {
    return;
  }

  // Check if already running
  if (await isAIRunning()) {
    return;
  }

  // Extract if needed
  await extractAIEngine();

  // Start AI engine
  await startAIEngine();
}
