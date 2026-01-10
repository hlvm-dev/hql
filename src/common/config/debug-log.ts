/**
 * Debug Logger for Config System
 * Writes to ~/.hql/debug.log for real-time monitoring
 *
 * Usage: tail -f ~/.hql/debug.log
 */

import { join } from "jsr:@std/path@1";
import { ensureDir } from "jsr:@std/fs@1";

const HQL_DIR = join(Deno.env.get("HOME") || "~", ".hql");
const LOG_FILE = join(HQL_DIR, "debug.log");

let initialized = false;

async function ensureLogFile(): Promise<void> {
  if (initialized) return;
  await ensureDir(HQL_DIR);
  initialized = true;
}

/**
 * Log a debug message to ~/.hql/debug.log
 */
export async function debugLog(category: string, message: string, data?: unknown): Promise<void> {
  await ensureLogFile();

  const timestamp = new Date().toISOString();
  const dataStr = data !== undefined ? ` | ${JSON.stringify(data)}` : "";
  const line = `[${timestamp}] [${category}] ${message}${dataStr}\n`;

  await Deno.writeTextFile(LOG_FILE, line, { append: true });
}

/**
 * Clear the debug log
 */
export async function clearDebugLog(): Promise<void> {
  await ensureLogFile();
  await Deno.writeTextFile(LOG_FILE, `--- Debug Log Started: ${new Date().toISOString()} ---\n`);
}

/**
 * Sync version for use in non-async contexts
 */
export function debugLogSync(category: string, message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const dataStr = data !== undefined ? ` | ${JSON.stringify(data)}` : "";
  const line = `[${timestamp}] [${category}] ${message}${dataStr}\n`;

  try {
    Deno.writeTextFileSync(LOG_FILE, line, { append: true });
  } catch {
    // Ignore errors in sync logging
  }
}
