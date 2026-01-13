/**
 * Single Source of Truth for HQL Directory Paths
 *
 * All path operations for ~/.hql should go through this module.
 * This eliminates duplication and ensures consistent path handling.
 */

import { join } from "jsr:@std/path@1";

// Cached HQL directory path
let _hqlDir: string | null = null;

/**
 * Get the root HQL directory (~/.hql)
 * Cached after first call for performance.
 */
export function getHqlDir(): string {
  if (!_hqlDir) {
    const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || ".";
    _hqlDir = join(home, ".hql");
  }
  return _hqlDir;
}

/**
 * Get the config file path (~/.hql/config.json)
 */
export function getConfigPath(): string {
  return join(getHqlDir(), "config.json");
}

/**
 * Get the memory file path (~/.hql/memory.hql)
 */
export function getMemoryPath(): string {
  return join(getHqlDir(), "memory.hql");
}

/**
 * Get the sessions directory (~/.hql/sessions)
 */
export function getSessionsDir(): string {
  return join(getHqlDir(), "sessions");
}

/**
 * Get the debug log path (~/.hql/debug.log)
 */
export function getDebugLogPath(): string {
  return join(getHqlDir(), "debug.log");
}

/**
 * Get the runtime directory (~/.hql/.runtime)
 * Used for embedded binaries and runtime state.
 */
export function getRuntimeDir(): string {
  return join(getHqlDir(), ".runtime");
}

/**
 * Get the Ollama binary path (~/.hql/.runtime/ollama)
 */
export function getOllamaBinaryPath(): string {
  return join(getRuntimeDir(), "ollama");
}

/**
 * Get the history file path (~/.hql/history.jsonl)
 * JSONL format: one JSON entry per line for append-only operations
 */
export function getHistoryPath(): string {
  return join(getHqlDir(), "history.jsonl");
}

/**
 * Ensure the HQL directory exists
 */
export async function ensureHqlDir(): Promise<void> {
  await Deno.mkdir(getHqlDir(), { recursive: true });
}

/**
 * Ensure the sessions directory exists
 */
export async function ensureSessionsDir(): Promise<void> {
  await Deno.mkdir(getSessionsDir(), { recursive: true });
}

/**
 * Ensure the runtime directory exists
 */
export async function ensureRuntimeDir(): Promise<void> {
  await Deno.mkdir(getRuntimeDir(), { recursive: true });
}

/**
 * Reset cached paths (useful for testing)
 */
export function resetPathCache(): void {
  _hqlDir = null;
}
