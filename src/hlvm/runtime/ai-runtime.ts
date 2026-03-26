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
import { HLVMErrorCode } from "../../common/error-codes.ts";
import { ai } from "../api/ai.ts";
import { log } from "../api/log.ts";
import { ensureRuntimeDir, getRuntimeDir } from "../../common/paths.ts";
import { findLegacyRuntimeEngine } from "../../common/legacy-migration.ts";
import { getPlatform, type PlatformCommandProcess } from "../../platform/platform.ts";
import { DEFAULT_OLLAMA_ENDPOINT } from "../../common/config/types.ts";
import { http } from "../../common/http-client.ts";

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
const OLLAMA_HELP_MARKERS = [
  "Large language model runner",
  "serve       Start Ollama",
] as const;
const HLVM_HELP_MARKERS = [
  "HLVM - AI-native runtime infrastructure",
  "HLVM Serve - HTTP REPL Server",
] as const;

const textDecoder = new TextDecoder();

let initPromise: Promise<void> | null = null;

function isMissingEmbeddedEngineError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("No such file");
}

function getEmbeddedEnginePath(): string {
  return `${getRuntimeDir()}/engine`;
}

function normalizeCommandOutput(output: {
  stdout: Uint8Array;
  stderr: Uint8Array;
}): string {
  const stdout = textDecoder.decode(output.stdout).trim();
  const stderr = textDecoder.decode(output.stderr).trim();
  return [stdout, stderr].filter(Boolean).join("\n");
}

function isLikelyOllamaBinary(output: string): boolean {
  return OLLAMA_HELP_MARKERS.every((marker) => output.includes(marker));
}

function isLikelyHlvmBinary(output: string): boolean {
  return HLVM_HELP_MARKERS.some((marker) => output.includes(marker));
}

async function describeInvalidEngine(
  candidatePath: string,
  platform = getPlatform(),
): Promise<string | null> {
  try {
    const helpOutput = await platform.command.output({
      cmd: [candidatePath, "--help"],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    const normalizedOutput = normalizeCommandOutput(helpOutput);

    if (isLikelyOllamaBinary(normalizedOutput)) {
      return null;
    }

    if (isLikelyHlvmBinary(normalizedOutput)) {
      return "binary resolves to HLVM instead of Ollama";
    }

    if (normalizedOutput.length > 0) {
      return `unexpected help output: ${normalizedOutput.split("\n")[0]}`;
    }

    return `engine help exited with code ${helpOutput.code}`;
  } catch (error) {
    return error instanceof Error ? error.message : "unknown validation error";
  }
}

async function removeEmbeddedEngine(
  reason: string,
  platform = getPlatform(),
): Promise<void> {
  const embeddedEnginePath = getEmbeddedEnginePath();
  if (!await platform.fs.exists(embeddedEnginePath)) {
    return;
  }

  try {
    await platform.fs.remove(embeddedEnginePath);
    log.debug?.(
      `Discarded cached AI engine at ${embeddedEnginePath}: ${reason}`,
    );
  } catch (error) {
    log.debug?.(
      `Failed to remove cached AI engine at ${embeddedEnginePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function resolveEmbeddedEnginePath(
  platform = getPlatform(),
): Promise<string | null> {
  const embeddedEnginePath = getEmbeddedEnginePath();
  if (!await platform.fs.exists(embeddedEnginePath)) {
    return null;
  }

  try {
    if (await matchesSelfBinarySize(embeddedEnginePath, platform)) {
      await removeEmbeddedEngine(
        "binary matches the current HLVM executable",
        platform,
      );
      return null;
    }
  } catch {
    // Best-effort guard only.
  }

  const invalidReason = await describeInvalidEngine(embeddedEnginePath, platform);
  if (invalidReason) {
    await removeEmbeddedEngine(invalidReason, platform);
    return null;
  }

  return embeddedEnginePath;
}

async function isAIRunning(): Promise<boolean> {
  try {
    // Direct HTTP check to avoid depending on provider registry initialization order
    // This is more robust than ai.status() which may fail if providers aren't loaded yet
    const response = await http.fetchRaw(DEFAULT_OLLAMA_ENDPOINT, {
      timeout: 2000,
    });
    return response.ok;
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
  if (await resolveEmbeddedEnginePath(platform)) {
    return;
  }

  try {
    const legacyEnginePath = await findLegacyRuntimeEngine();
    if (legacyEnginePath) {
      if (await matchesSelfBinarySize(legacyEnginePath, platform)) {
        log.debug?.("Legacy engine binary matches HLVM CLI size — skipping copy");
        // Fall through to embedded resource extraction below
      } else {
        const invalidLegacyReason = await describeInvalidEngine(
          legacyEnginePath,
          platform,
        );
        if (invalidLegacyReason) {
          log.debug?.(
            `Skipping legacy AI engine at ${legacyEnginePath}: ${invalidLegacyReason}`,
          );
        } else {
          const embeddedEnginePath = getEmbeddedEnginePath();
          await ensureRuntimeDir();
          await platform.fs.copyFile(legacyEnginePath, embeddedEnginePath);
          await platform.fs.chmod(embeddedEnginePath, 0o755);
          if (await resolveEmbeddedEnginePath(platform)) {
            return;
          }
        }
      }
    }

    const embeddedEnginePath = getEmbeddedEnginePath();
    const engineBytes = await platform.fs.readFile(
      platform.path.fromFileUrl(new URL("../../resources/ai-engine", import.meta.url))
    );
    await ensureRuntimeDir();
    await platform.fs.writeFile(embeddedEnginePath, engineBytes);
    await platform.fs.chmod(embeddedEnginePath, 0o755);
    if (await resolveEmbeddedEnginePath(platform)) {
      return;
    }
    log.debug?.(
      "Embedded AI engine failed validation after extraction; falling back to system Ollama",
    );
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
  const embeddedEnginePath = await resolveEmbeddedEnginePath(platform);
  const enginePath = embeddedEnginePath
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

  let aiProcess: PlatformCommandProcess | null = null;
  try {
    aiProcess = platform.command.run({
      cmd: [enginePath, "serve"],
      stdout: "null",
      stderr: "null",
    });
    aiProcess.unref?.();

    if (await waitForAIEngineReady()) {
      log.debug?.(`AI engine started successfully (${enginePath})`);
      return;
    }
    try {
      aiProcess.kill?.("SIGTERM");
    } catch {
      // Best-effort cleanup only.
    }
    throw new RuntimeError("AI engine failed to start", {
      code: HLVMErrorCode.AI_ENGINE_STARTUP_FAILED,
    });
  } catch (error) {
    // If Ollama is already running (port conflict), that's fine - check if it's responsive
    if (await isAIRunning()) {
      log.debug?.("AI engine already running (port in use but responsive)");
      return;
    }
    try {
      aiProcess?.kill?.("SIGTERM");
    } catch {
      // Best-effort cleanup only.
    }
    log.warn(`AI features unavailable: ${(error as Error).message}`);
    throw error;
  }
}

async function resolveEnginePath(): Promise<string> {
  const platform = getPlatform();
  const embeddedEnginePath = await resolveEmbeddedEnginePath(platform);
  if (embeddedEnginePath) {
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
