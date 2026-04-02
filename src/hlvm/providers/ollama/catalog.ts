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
import { isObjectValue } from "../../../common/utils.ts";
import { createCachedCatalog } from "../cached-catalog.ts";

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
// Cached catalog instance
// ---------------------------------------------------------------------------

const catalog = createCachedCatalog<ScrapedCatalog, ScrapedCatalog | null>({
  cachePath: getOllamaCatalogCachePath,
  ttlMs: CATALOG_CACHE_TTL_MS,
  async fetchData(): Promise<ScrapedCatalog | null> {
    await ensureHlvmDir();
    const response = await http.fetchRaw(LIVE_CATALOG_URL, {
      timeout: API_TIMEOUT_MS,
    });
    if (!response.ok) return null;
    const data = await response.json() as ScrapedCatalog;
    return data?.models?.length > 0 ? data : null;
  },
  transform: (raw) => raw,
  serializeCache: (data) =>
    JSON.stringify({ timestamp: Date.now(), data }),
  deserializeCache(json: unknown) {
    if (!isObjectValue(json)) return null;
    const data = isObjectValue(json.data) ? json.data : null;
    const models = Array.isArray(data?.models) ? data.models : null;
    if (typeof json.timestamp !== "number" || !models) return null;
    return {
      timestamp: json.timestamp,
      data: { models: models as ScrapedModel[] },
    };
  },
  fallback: null,
});

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
  const liveData = await catalog.fetch();
  if (!liveData) return [];
  return buildCatalog(liveData, options.maxVariants ?? DEFAULT_MAX_VARIANTS);
}

export function resetOllamaCatalogCacheForTests(): void {
  catalog.resetForTests();
}
