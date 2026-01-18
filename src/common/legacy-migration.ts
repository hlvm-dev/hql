/**
 * Legacy HQL Migration Helpers
 *
 * Best-effort migration from ~/.hql to ~/.hlvm.
 * Used to preserve user config/history/memory after rebranding.
 */

import { basename, join, resolve } from "jsr:@std/path@1";
import { getPlatform } from "../platform/platform.ts";
import { getEnvVar } from "./paths.ts";

export function getLegacyHqlDir(): string {
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

export function getLegacySessionsDir(): string {
  return join(getLegacyHqlDir(), "sessions");
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

export async function listLegacySessionFiles(legacySessionsDir: string): Promise<string[]> {
  const platform = getPlatform();
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    for await (const entry of platform.fs.readDir(dir)) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory) {
        await walk(entryPath);
        continue;
      }
      if (entry.isFile && entry.name.endsWith(".jsonl") && entry.name !== "index.jsonl") {
        results.push(entryPath);
      }
    }
  }

  try {
    await walk(legacySessionsDir);
  } catch {
    return [];
  }

  results.sort((a, b) => basename(a).localeCompare(basename(b)));
  return results;
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
