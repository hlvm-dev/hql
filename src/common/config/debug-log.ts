/**
 * Debug Logger for Config System
 * Writes to ~/.hlvm/debug.log for real-time monitoring
 *
 * Usage: tail -f ~/.hlvm/debug.log
 */

import { ensureHlvmDir, ensureHlvmDirSync, getDebugLogPath } from "../paths.ts";
import { getPlatform } from "../../platform/platform.ts";

let initialized = false;

async function ensureLogFile(): Promise<void> {
  if (initialized) return;
  try {
    await ensureHlvmDir();
  } catch {
    // Ignore errors to avoid breaking runtime on logging failures.
  }
  initialized = true;
}

/**
 * Log a debug message to ~/.hlvm/debug.log
 */
export async function debugLog(category: string, message: string, data?: unknown): Promise<void> {
  try {
    await ensureLogFile();

    const timestamp = new Date().toISOString();
    const dataStr = data !== undefined ? ` | ${JSON.stringify(data)}` : "";
    const line = `[${timestamp}] [${category}] ${message}${dataStr}\n`;

    await getPlatform().fs.writeTextFile(getDebugLogPath(), line, { append: true });
  } catch {
    // Ignore logging errors.
  }
}

/**
 * Clear the debug log
 */
export async function clearDebugLog(): Promise<void> {
  try {
    await ensureLogFile();
    await getPlatform().fs.writeTextFile(
      getDebugLogPath(),
      `--- Debug Log Started: ${new Date().toISOString()} ---\n`,
    );
  } catch {
    // Ignore logging errors.
  }
}

/**
 * Sync version for use in non-async contexts
 */
export function debugLogSync(category: string, message: string, data?: unknown): void {
  try {
    ensureHlvmDirSync();
    const timestamp = new Date().toISOString();
    const dataStr = data !== undefined ? ` | ${JSON.stringify(data)}` : "";
    const line = `[${timestamp}] [${category}] ${message}${dataStr}\n`;
    getPlatform().fs.writeTextFileSync(getDebugLogPath(), line, { append: true });
  } catch {
    // Ignore errors in sync logging.
  }
}
