/**
 * Ollama Model Catalog
 *
 * Self-growing catalog: fetches live data from GitHub at runtime.
 * Bundled JSON is offline fallback only.
 *
 * Live source: raw.githubusercontent.com/hlvm-dev/hql/main/src/data/ollama_models.json
 * Refresh:     deno task scrape-models  (updates the JSON, commit & push to publish)
 */

import ollamaModelsData from "../../../data/ollama_models.json" with {
  type: "json",
};
import type { ModelInfo, ProviderCapability } from "../types.ts";

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

const LIVE_CATALOG_URL =
  "https://raw.githubusercontent.com/hlvm-dev/hql/main/src/data/ollama_models.json";

/** Cache TTL: 1 hour (same as OpenRouter public catalog) */
const CACHE_TTL_MS = 60 * 60 * 1000;

const DEFAULT_MAX_VARIANTS = 3;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let liveCatalogData: ScrapedCatalog | null = null;
let liveFetchTimestamp = 0;
let cachedCatalog: ModelInfo[] | null = null;
let cachedFullCatalog: ModelInfo[] | null = null;

function isLiveCacheValid(): boolean {
  return liveCatalogData !== null && Date.now() - liveFetchTimestamp < CACHE_TTL_MS;
}

// ---------------------------------------------------------------------------
// Live fetch
// ---------------------------------------------------------------------------

/**
 * Fetch the latest catalog from GitHub.
 * Returns null on failure (caller falls back to bundled JSON).
 */
async function fetchLiveCatalog(): Promise<ScrapedCatalog | null> {
  if (isLiveCacheValid()) return liveCatalogData;

  try {
    const response = await fetch(LIVE_CATALOG_URL, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return liveCatalogData;

    const data = await response.json() as ScrapedCatalog;
    if (data?.models?.length > 0) {
      liveCatalogData = data;
      liveFetchTimestamp = Date.now();
      // Invalidate derived caches so they rebuild from fresh data
      cachedCatalog = null;
      cachedFullCatalog = null;
    }
    return liveCatalogData;
  } catch {
    return liveCatalogData;
  }
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
  const displayName = displayParts.join(" ");

  const cloud = Boolean(model.cloud) || variant?.size === "Cloud (API only)";

  return {
    name,
    displayName,
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
 * Get the Ollama catalog — self-growing via live GitHub fetch.
 * Falls back to bundled JSON on network failure.
 */
export async function getOllamaCatalogAsync(
  options: { maxVariants?: number } = {},
): Promise<ModelInfo[]> {
  // Try live data first
  const liveData = await fetchLiveCatalog();
  const data = liveData ?? (ollamaModelsData as ScrapedCatalog);
  const maxVariants = options.maxVariants ?? DEFAULT_MAX_VARIANTS;
  return buildCatalog(data, maxVariants);
}

/**
 * Synchronous version — uses cached live data if available, else bundled JSON.
 * Prefer getOllamaCatalogAsync() for guaranteed freshness.
 */
export function getOllamaCatalog(
  options: { maxVariants?: number } = {},
): ModelInfo[] {
  const maxVariants = options.maxVariants ?? DEFAULT_MAX_VARIANTS;
  const data = liveCatalogData ?? (ollamaModelsData as ScrapedCatalog);

  if (maxVariants === DEFAULT_MAX_VARIANTS) {
    if (!cachedCatalog) {
      cachedCatalog = buildCatalog(data, maxVariants);
    }
    return cachedCatalog;
  }

  if (maxVariants === Number.POSITIVE_INFINITY) {
    if (!cachedFullCatalog) {
      cachedFullCatalog = buildCatalog(data, maxVariants);
    }
    return cachedFullCatalog;
  }

  return buildCatalog(data, maxVariants);
}
