/**
 * Generic cached catalog factory.
 *
 * Extracts the shared fetch-cache-persist pattern used by both
 * ollama/catalog.ts and public-catalog.ts into a single reusable factory.
 *
 * The pattern:
 *   1. Module-level in-memory cache + timestamp
 *   2. Disk cache read/write via getPlatform().fs
 *   3. In-flight dedup via shared promise
 *   4. TTL-based validity check
 *   5. resetForTests() to clear state
 */

import { getPlatform } from "../../platform/platform.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CachedCatalogOptions<TRaw, TResult> {
  /** Path to disk cache file. */
  cachePath: () => string;
  /** Time-to-live in milliseconds. */
  ttlMs: number;
  /** Network fetch — returns raw data or null on failure. */
  fetchData: () => Promise<TRaw | null>;
  /** Transform raw data into the public-facing result. */
  transform: (raw: TRaw) => TResult;
  /** Serialize raw data for disk persistence. */
  serializeCache: (data: TRaw) => string;
  /** Deserialize disk cache. Returns null if invalid. */
  deserializeCache: (json: unknown) => { timestamp: number; data: TRaw } | null;
  /** Fallback when both network and cache miss. */
  fallback: TResult;
}

export interface CachedCatalog<TResult> {
  fetch: () => Promise<TResult>;
  resetForTests: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCachedCatalog<TRaw, TResult>(
  opts: CachedCatalogOptions<TRaw, TResult>,
): CachedCatalog<TResult> {
  let cachedData: TRaw | null = null;
  let cacheTimestamp = 0;
  let inFlightFetch: Promise<TRaw | null> | null = null;

  function isCacheValid(): boolean {
    return cachedData !== null && Date.now() - cacheTimestamp < opts.ttlMs;
  }

  async function readDiskCache(): Promise<{ timestamp: number; data: TRaw } | null> {
    try {
      const raw = await getPlatform().fs.readTextFile(opts.cachePath());
      return opts.deserializeCache(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async function writeDiskCache(data: TRaw): Promise<void> {
    try {
      await getPlatform().fs.writeTextFile(
        opts.cachePath(),
        opts.serializeCache(data),
      );
    } catch {
      // Best-effort cache persistence only.
    }
  }

  async function fetchWithCache(): Promise<TRaw | null> {
    if (isCacheValid()) return cachedData;
    if (inFlightFetch) return await inFlightFetch;

    inFlightFetch = (async (): Promise<TRaw | null> => {
      // Try disk cache first
      const diskCache = await readDiskCache();
      if (diskCache?.data) {
        cachedData = diskCache.data;
        cacheTimestamp = diskCache.timestamp;
        if (isCacheValid()) return cachedData;
      }

      // Network fetch
      try {
        const freshData = await opts.fetchData();
        if (freshData) {
          cachedData = freshData;
          cacheTimestamp = Date.now();
          await writeDiskCache(freshData);
        }
        return cachedData;
      } catch {
        return cachedData;
      } finally {
        inFlightFetch = null;
      }
    })();

    return await inFlightFetch;
  }

  return {
    async fetch(): Promise<TResult> {
      const data = await fetchWithCache();
      if (!data) return opts.fallback;
      return opts.transform(data);
    },
    resetForTests(): void {
      cachedData = null;
      cacheTimestamp = 0;
      inFlightFetch = null;
    },
  };
}
