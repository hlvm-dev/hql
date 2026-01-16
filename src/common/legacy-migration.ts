/**
 * Legacy HQL Migration Helpers
 *
 * Best-effort migration from ~/.hql to ~/.hlvm.
 * Used to preserve user config/history/memory after rebranding.
 */

import { basename, dirname, join, resolve } from "jsr:@std/path@1";
import { ensureDir } from "jsr:@std/fs@1";

function getEnvVar(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}

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

export function getLegacyRuntimeDir(): string {
  return join(getLegacyHqlDir(), ".runtime");
}

export function getLegacyRuntimeEnginePath(): string {
  return join(getLegacyRuntimeDir(), "engine");
}

export function getLegacyRuntimeOllamaPath(): string {
  return join(getLegacyRuntimeDir(), "ollama");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    return false;
  }
}

export async function migrateLegacyFileIfMissing(
  legacyPath: string,
  targetPath: string
): Promise<boolean> {
  if (await pathExists(targetPath)) {
    return false;
  }
  if (!(await pathExists(legacyPath))) {
    return false;
  }
  await ensureDir(dirname(targetPath));
  await Deno.copyFile(legacyPath, targetPath);
  return true;
}

export async function listLegacySessionFiles(legacySessionsDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
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
