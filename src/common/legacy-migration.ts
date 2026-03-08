/**
 * Legacy HQL Migration Helpers
 *
 * Best-effort migration from ~/.hql to ~/.hlvm.
 * Used to preserve user config/history/memory after rebranding.
 */

import { getPlatform } from "../platform/platform.ts";
import { getEnvVar } from "./paths.ts";

// SSOT: Use platform layer for all file/path operations
const path = () => getPlatform().path;
const join = (...paths: string[]) => path().join(...paths);
const resolve = (...paths: string[]) => path().resolve(...paths);

function getLegacyHqlDir(): string {
  const override = getEnvVar("HQL_DIR") || getEnvVar("HQL_HOME");
  if (override) {
    return resolve(override);
  }
  const home = getEnvVar("HOME") || getEnvVar("USERPROFILE") || ".";
  return join(home, ".hql");
}

export function getLegacyConfigPath(): string {
  return join(getLegacyHqlDir(), "config.json");
}

export function getLegacyMemoryPath(): string {
  return join(getLegacyHqlDir(), "memory.hql");
}

export function getLegacyHistoryPath(): string {
  return join(getLegacyHqlDir(), "history.jsonl");
}

// Internal helpers (not exported)
function pathExists(path: string): Promise<boolean> {
  return getPlatform().fs.exists(path);
}

function getLegacyRuntimeDir(): string {
  return join(getLegacyHqlDir(), ".runtime");
}

function getLegacyRuntimeEnginePath(): string {
  return join(getLegacyRuntimeDir(), "engine");
}

function getLegacyRuntimeOllamaPath(): string {
  return join(getLegacyRuntimeDir(), "ollama");
}

export async function findLegacyRuntimeEngine(): Promise<string | null> {
  const enginePath = getLegacyRuntimeEnginePath();
  if (await pathExists(enginePath)) {
    return enginePath;
  }
  const ollamaPath = getLegacyRuntimeOllamaPath();
  if (await pathExists(ollamaPath)) {
    return ollamaPath;
  }
  return null;
}
