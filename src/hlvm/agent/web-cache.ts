/**
 * Web Cache - file-backed cache for web_search/web_fetch
 */

import { getPlatform } from "../../platform/platform.ts";
import { ensureHlvmDir, getWebCachePath } from "../../common/paths.ts";
import { getErrorMessage, isObjectValue } from "../../common/utils.ts";
import { ValidationError } from "../../common/error.ts";

interface WebCacheEntry {
  value: unknown;
  expiresAt: number;
}

interface WebCacheFile {
  version: number;
  entries: Record<string, WebCacheEntry>;
}

const DEFAULT_CACHE: WebCacheFile = { version: 1, entries: {} };

async function readCache(): Promise<WebCacheFile> {
  const platform = getPlatform();
  const path = getWebCachePath();
  try {
    const raw = await platform.fs.readTextFile(path);
    const parsed = JSON.parse(raw) as unknown;
    if (!isObjectValue(parsed)) return { ...DEFAULT_CACHE };
    const entries = isObjectValue(parsed.entries) ? parsed.entries : {};
    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      entries: entries as Record<string, WebCacheEntry>,
    };
  } catch (error) {
    if (String(error).includes("No such file") || String(error).includes("not found")) {
      return { ...DEFAULT_CACHE };
    }
    throw new ValidationError(
      `Failed to read web cache: ${getErrorMessage(error)}`,
      "web_cache",
    );
  }
}

async function writeCache(cache: WebCacheFile): Promise<void> {
  await ensureHlvmDir();
  const platform = getPlatform();
  const path = getWebCachePath();
  await platform.fs.writeTextFile(path, JSON.stringify(cache, null, 2));
}

function pruneExpired(cache: WebCacheFile): boolean {
  const now = Date.now();
  let changed = false;
  for (const [key, entry] of Object.entries(cache.entries)) {
    if (!entry || typeof entry.expiresAt !== "number" || entry.expiresAt <= now) {
      delete cache.entries[key];
      changed = true;
    }
  }
  return changed;
}

export async function getWebCacheValue<T>(
  key: string,
): Promise<T | null> {
  const cache = await readCache();
  let changed = pruneExpired(cache);
  const entry = cache.entries[key];
  if (!entry || typeof entry.expiresAt !== "number") {
    if (changed) await writeCache(cache);
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    delete cache.entries[key];
    await writeCache(cache);
    return null;
  }
  if (changed) await writeCache(cache);
  return entry.value as T;
}

export async function setWebCacheValue(
  key: string,
  value: unknown,
  ttlMinutes: number,
): Promise<void> {
  if (!ttlMinutes || ttlMinutes <= 0) return;
  const cache = await readCache();
  cache.entries[key] = {
    value,
    expiresAt: Date.now() + ttlMinutes * 60 * 1000,
  };
  await writeCache(cache);
}
