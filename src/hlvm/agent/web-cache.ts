/**
 * Web Cache - file-backed cache for search_web/web_fetch
 */

import { getPlatform } from "../../platform/platform.ts";
import { ensureHlvmDir, getWebCachePath } from "../../common/paths.ts";
import {
  getErrorMessage,
  isFileNotFoundError,
  isObjectValue,
} from "../../common/utils.ts";
import { ValidationError } from "../../common/error.ts";

interface WebCacheEntry {
  value: unknown;
  expiresAt: number;
}

interface WebCacheFile {
  version: number;
  entries: Record<string, WebCacheEntry>;
}

function createDefaultCache(): WebCacheFile {
  return { version: 1, entries: {} };
}

let memoryCache: WebCacheFile | null = null;
let inFlightLoad: Promise<WebCacheFile> | null = null;

async function readCacheFromDisk(): Promise<WebCacheFile> {
  const platform = getPlatform();
  const path = getWebCachePath();
  try {
    const raw = await platform.fs.readTextFile(path);
    const parsed = JSON.parse(raw) as unknown;
    if (!isObjectValue(parsed)) return createDefaultCache();
    const entries = isObjectValue(parsed.entries) ? parsed.entries : {};
    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      entries: entries as Record<string, WebCacheEntry>,
    };
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return createDefaultCache();
    }
    throw new ValidationError(
      `Failed to read web cache: ${getErrorMessage(error)}`,
      "web_cache",
    );
  }
}

async function loadCache(): Promise<WebCacheFile> {
  if (memoryCache) return memoryCache;
  if (inFlightLoad) return await inFlightLoad;

  inFlightLoad = readCacheFromDisk();
  try {
    memoryCache = await inFlightLoad;
    return memoryCache;
  } finally {
    inFlightLoad = null;
  }
}

async function writeCache(cache: WebCacheFile): Promise<void> {
  await ensureHlvmDir();
  const platform = getPlatform();
  const path = getWebCachePath();
  await platform.fs.writeTextFile(path, JSON.stringify(cache));
  memoryCache = cache;
}

function pruneExpired(cache: WebCacheFile): boolean {
  const now = Date.now();
  let changed = false;
  for (const [key, entry] of Object.entries(cache.entries)) {
    if (
      !entry || typeof entry.expiresAt !== "number" || entry.expiresAt <= now
    ) {
      delete cache.entries[key];
      changed = true;
    }
  }
  return changed;
}

export async function getWebCacheValue<T>(
  key: string,
): Promise<T | null> {
  const cache = await loadCache();
  const changed = pruneExpired(cache);
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
  const cache = await loadCache();
  cache.entries[key] = {
    value,
    expiresAt: Date.now() + ttlMinutes * 60 * 1000,
  };
  await writeCache(cache);
}
