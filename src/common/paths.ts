/**
 * Single Source of Truth for HLVM Directory Paths
 *
 * All path operations for ~/.hlvm should go through this module.
 * This eliminates duplication and ensures consistent path handling.
 */

import { join, resolve } from "jsr:@std/path@1";
import { getPlatform } from "../platform/platform.ts";

// Cached HLVM directory path
let _hlvmDir: string | null = null;

function getEnvVar(key: string): string | undefined {
  try {
    return getPlatform().env.get(key);
  } catch {
    return undefined;
  }
}

function resolveHlvmDir(): string {
  const override = getEnvVar("HLVM_DIR") || getEnvVar("HLVM_HOME");
  if (override) {
    return resolve(override);
  }
  const home = getEnvVar("HOME") || getEnvVar("USERPROFILE") || ".";
  return join(home, ".hlvm");
}


function ensureWritableDir(path: string): boolean {
  const platform = getPlatform();
  const probeId = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : String(Date.now());
  const probePath = join(path, `.hlvm-write-test-${probeId}`);
  try {
    // Create directory synchronously
    try {
      const stat = platform.fs.statSync(path);
      if (!stat.isDirectory) {
        return false;
      }
    } catch {
      // Directory doesn't exist, try to create it
      platform.fs.mkdirSync(path, { recursive: true });
    }
    // Write probe file
    platform.fs.writeTextFileSync(probePath, "");
    platform.fs.removeSync(probePath);
    return true;
  } catch {
    try {
      // Best-effort cleanup if the probe was partially created.
      platform.fs.removeSync(probePath);
    } catch {
      // Ignore cleanup errors.
    }
    return false;
  }
}

/**
 * Get the root HLVM directory (~/.hlvm)
 * Cached after first call for performance.
 */
export function getHlvmDir(): string {
  if (!_hlvmDir) {
    let candidate = resolveHlvmDir();
    if (!ensureWritableDir(candidate)) {
      const fallback = join(getPlatform().process.cwd(), ".hlvm");
      ensureWritableDir(fallback);
      candidate = fallback;
    }
    _hlvmDir = candidate;
  }
  return _hlvmDir;
}

/**
 * Get the config file path (~/.hlvm/config.json)
 */
export function getConfigPath(): string {
  return join(getHlvmDir(), "config.json");
}

/**
 * Get the memory file path (~/.hlvm/memory.hql)
 */
export function getMemoryPath(): string {
  return join(getHlvmDir(), "memory.hql");
}

/**
 * Get the sessions directory (~/.hlvm/sessions)
 */
export function getSessionsDir(): string {
  return join(getHlvmDir(), "sessions");
}

/**
 * Get the debug log path (~/.hlvm/debug.log)
 */
export function getDebugLogPath(): string {
  return join(getHlvmDir(), "debug.log");
}

/**
 * Get the runtime directory (~/.hlvm/.runtime)
 * Used for embedded binaries and runtime state.
 */
export function getRuntimeDir(): string {
  return join(getHlvmDir(), ".runtime");
}

/**
 * Get the Ollama binary path (~/.hlvm/.runtime/ollama)
 */
export function getOllamaBinaryPath(): string {
  return join(getRuntimeDir(), "ollama");
}

/**
 * Get the history file path (~/.hlvm/history.jsonl)
 * JSONL format: one JSON entry per line for append-only operations
 */
export function getHistoryPath(): string {
  return join(getHlvmDir(), "history.jsonl");
}


/**
 * Ensure the HLVM directory exists
 */
export async function ensureHlvmDir(): Promise<void> {
  try {
    await getPlatform().fs.mkdir(getHlvmDir(), { recursive: true });
  } catch {
    // Ignore errors to keep callers resilient in restricted environments.
  }
}

/**
 * Ensure the HLVM directory exists (sync).
 */
export function ensureHlvmDirSync(): void {
  try {
    getPlatform().fs.mkdirSync(getHlvmDir(), { recursive: true });
  } catch {
    // Ignore errors to keep callers resilient in restricted environments.
  }
}

/**
 * Ensure the sessions directory exists
 */
export async function ensureSessionsDir(): Promise<void> {
  await getPlatform().fs.mkdir(getSessionsDir(), { recursive: true });
}

/**
 * Ensure the runtime directory exists
 */
export async function ensureRuntimeDir(): Promise<void> {
  await getPlatform().fs.mkdir(getRuntimeDir(), { recursive: true });
}

/**
 * Reset cached paths (useful for testing)
 */
export function resetPathCache(): void {
  _hlvmDir = null;
}
