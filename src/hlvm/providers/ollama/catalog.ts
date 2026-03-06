/**
 * Ollama Model Catalog
 *
 * Self-growing catalog: fetches live data from public GitHub Gist at runtime.
 * Gist is the single source of truth (no bundled fallback).
 *
 * Live source: gist.githubusercontent.com/boraseoksoon/b8c5e2a44ec9cb01cbaa010a8953304c/raw
 * Refresh:     deno task publish-catalog  (scrape + push to gist)
 */
import type { ModelInfo, ProviderCapability } from "../types.ts";
import { API_TIMEOUT_MS, CATALOG_CACHE_TTL_MS } from "../common.ts";
import { http } from "../../../common/http-client.ts";
import {
  ensureHlvmDir,
  getOllamaCatalogCachePath,
} from "../../../common/paths.ts";
import { isFileNotFoundError, isObjectValue } from "../../../common/utils.ts";
import { getPlatform } from "../../../platform/platform.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScrapedModelVariant {
  id: string;
  parameters: string;
  size: string;
}

interface ScrapedModel {
  id: string;
  name: string;
  description: string;
  variants: ScrapedModelVariant[];
  vision: boolean;
  model_type?: string;
  tools?: boolean;
  thinking?: boolean;
  cloud?: boolean;
}

interface ScrapedCatalog {
  models: ScrapedModel[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Public gist — no auth required, repo can stay private. */
const LIVE_CATALOG_URL =
  "https://gist.githubusercontent.com/boraseoksoon/b8c5e2a44ec9cb01cbaa010a8953304c/raw/ollama_models.json";

const DEFAULT_MAX_VARIANTS = 3;

// ---------------------------------------------------------------------------
// Cache (network fetch only — buildCatalog is cheap)
// ---------------------------------------------------------------------------

let liveCatalogData: ScrapedCatalog | null = null;
let liveFetchTimestamp = 0;
let inFlightCatalogFetch: Promise<ScrapedCatalog | null> | null = null;

interface CatalogCacheRecord {
  timestamp: number;
  data: ScrapedCatalog;
}

function isLiveCacheValid(): boolean {
  return liveCatalogData !== null &&
    Date.now() - liveFetchTimestamp < CATALOG_CACHE_TTL_MS;
}

async function readDiskCatalogCache(): Promise<CatalogCacheRecord | null> {
  const platform = getPlatform();
  try {
    const raw = await platform.fs.readTextFile(getOllamaCatalogCachePath());
    const parsed = JSON.parse(raw) as unknown;
    if (!isObjectValue(parsed)) return null;
    const data = isObjectValue(parsed.data) ? parsed.data : null;
    const models = Array.isArray(data?.models) ? data.models : null;
    if (typeof parsed.timestamp !== "number" || !models) return null;
    return {
      timestamp: parsed.timestamp,
      data: { models: models as ScrapedModel[] },
    };
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    return null;
  }
}

async function writeDiskCatalogCache(data: ScrapedCatalog): Promise<void> {
  try {
    await ensureHlvmDir();
    await getPlatform().fs.writeTextFile(
      getOllamaCatalogCachePath(),
      JSON.stringify(
        {
          timestamp: Date.now(),
          data,
        } satisfies CatalogCacheRecord,
      ),
    );
  } catch {
    // Best-effort cache persistence only.
  }
}

// ---------------------------------------------------------------------------
// Live fetch
// ---------------------------------------------------------------------------

/**
 * Fetch the latest catalog from public gist.
 * Returns null on failure (caller may use cached in-memory data only).
 */
async function fetchLiveCatalog(): Promise<ScrapedCatalog | null> {
  if (isLiveCacheValid()) return liveCatalogData;
  if (inFlightCatalogFetch) return await inFlightCatalogFetch;

  inFlightCatalogFetch = (async (): Promise<ScrapedCatalog | null> => {
    const diskCache = await readDiskCatalogCache();
    if (diskCache?.data?.models?.length) {
      liveCatalogData = diskCache.data;
      liveFetchTimestamp = diskCache.timestamp;
      if (isLiveCacheValid()) {
        return liveCatalogData;
      }
    }

    try {
      const response = await http.fetchRaw(LIVE_CATALOG_URL, {
        timeout: API_TIMEOUT_MS,
      });
      if (!response.ok) return liveCatalogData;

      const data = await response.json() as ScrapedCatalog;
      if (data?.models?.length > 0) {
        liveCatalogData = data;
        liveFetchTimestamp = Date.now();
        await writeDiskCatalogCache(data);
      }
      return liveCatalogData;
    } catch {
      return liveCatalogData;
    } finally {
      inFlightCatalogFetch = null;
    }
  })();

  return await inFlightCatalogFetch;
}

// ---------------------------------------------------------------------------
// Model conversion
// ---------------------------------------------------------------------------

function buildCapabilities(model: ScrapedModel): ProviderCapability[] {
  const capabilities: ProviderCapability[] = [];
  if (model.model_type === "embedding") {
    capabilities.push("embeddings");
  } else {
    capabilities.push("generate", "chat");
  }

  if (model.vision) capabilities.push("vision");
  if (model.tools) capabilities.push("tools");
  if (model.thinking) capabilities.push("thinking");

  return capabilities;
}

function toModelInfo(
  model: ScrapedModel,
  variant?: ScrapedModelVariant,
): ModelInfo {
  const capabilities = buildCapabilities(model);
  const name = variant?.id ?? model.id;
  const displayParts = [model.name];
  if (variant?.parameters && variant.parameters !== "Unknown") {
    displayParts.push(variant.parameters);
  }

  const cloud = Boolean(model.cloud) || variant?.size === "Cloud (API only)";

  return {
    name,
    displayName: displayParts.join(" "),
    parameterSize: variant?.parameters !== "Unknown"
      ? variant?.parameters
      : undefined,
    capabilities,
    metadata: {
      description: model.description,
      sizes: variant?.size ? [variant.size] : undefined,
      ...(cloud ? { cloud: true } : {}),
    },
  };
}

function buildCatalog(data: ScrapedCatalog, maxVariants: number): ModelInfo[] {
  const result: ModelInfo[] = [];

  for (const model of data.models || []) {
    const variants = model.variants || [];
    const limit = Number.isFinite(maxVariants)
      ? Math.max(0, maxVariants)
      : variants.length;
    if (variants.length > 0) {
      for (const variant of variants.slice(0, limit)) {
        result.push(toModelInfo(model, variant));
      }
    } else {
      result.push(toModelInfo(model));
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the Ollama catalog — self-growing via live gist fetch.
 * Uses gist as the only source of truth.
 * If gist is unavailable and cache is empty, returns an empty list.
 */
export async function getOllamaCatalogAsync(
  options: { maxVariants?: number } = {},
): Promise<ModelInfo[]> {
  const liveData = await fetchLiveCatalog();
  if (!liveData) return [];
  return buildCatalog(liveData, options.maxVariants ?? DEFAULT_MAX_VARIANTS);
}

export function resetOllamaCatalogCacheForTests(): void {
  liveCatalogData = null;
  liveFetchTimestamp = 0;
  inFlightCatalogFetch = null;
}
