/**
 * Public Model Catalog
 *
 * Fetches available models from OpenRouter's public API (no auth required).
 * This is the fallback for model discovery when provider-specific API keys
 * are not configured. Ensures model lists are self-growing without requiring
 * developer patches or user credentials.
 *
 * Source: https://openrouter.ai/api/v1/models (public, free, no auth)
 */

import type { ModelInfo, ProviderCapability } from "./types.ts";
import { CATALOG_CACHE_TTL_MS } from "./common.ts";
import { http } from "../../common/http-client.ts";
import { getCloudModelCatalogCachePath } from "../../common/paths.ts";
import { createCachedCatalog } from "./cached-catalog.ts";
import { DEFAULT_OPENROUTER_CATALOG_URL } from "../../common/config/types.ts";

const OPENROUTER_MODELS_URL = DEFAULT_OPENROUTER_CATALOG_URL;

/** Provider prefixes in OpenRouter model IDs */
const PROVIDER_PREFIXES: Record<string, string> = {
  anthropic: "anthropic/",
  openai: "openai/",
  google: "google/",
};

// ---------------------------------------------------------------------------
// OpenRouter response types
// ---------------------------------------------------------------------------

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
}

// ---------------------------------------------------------------------------
// Cached catalog instance
// ---------------------------------------------------------------------------

interface CatalogCacheRecord {
  timestamp: number;
  models: ModelInfo[];
}

const catalog = createCachedCatalog<ModelInfo[], ModelInfo[]>({
  cachePath: getCloudModelCatalogCachePath,
  ttlMs: CATALOG_CACHE_TTL_MS,
  async fetchData(): Promise<ModelInfo[] | null> {
    const response = await http.fetchRaw(OPENROUTER_MODELS_URL, {
      timeout: 10_000,
    });
    if (!response.ok) return null;
    const result = await response.json() as { data: OpenRouterModel[] };
    const models = (result.data ?? []).map(toModelInfo);
    return models.length > 0 ? models : null;
  },
  transform: (raw) => raw,
  serializeCache: (models) =>
    JSON.stringify({ timestamp: Date.now(), models } satisfies CatalogCacheRecord),
  deserializeCache(json: unknown) {
    const parsed = json as Partial<CatalogCacheRecord>;
    if (typeof parsed?.timestamp !== "number" || !Array.isArray(parsed?.models)) {
      return null;
    }
    return { timestamp: parsed.timestamp, data: parsed.models as ModelInfo[] };
  },
  fallback: [],
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function resetPublicCatalogCacheForTests(): void {
  catalog.resetForTests();
}

/**
 * Fetch models for a specific provider from the public catalog.
 * Filters by provider prefix (e.g., "anthropic/" for Anthropic models).
 * Strips the provider prefix from model IDs to match provider-native format.
 */
export async function fetchPublicModelsForProvider(
  providerName: string,
): Promise<ModelInfo[]> {
  const prefix = PROVIDER_PREFIXES[providerName];
  if (!prefix) return [];

  const all = await catalog.fetch();
  return all.filter((m) =>
    (m.metadata?.openRouterId as string | undefined)?.startsWith(prefix)
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toModelInfo(m: OpenRouterModel): ModelInfo {
  const capabilities: ProviderCapability[] = ["chat"];
  if (m.supported_parameters?.includes("tools")) capabilities.push("tools");
  if (m.architecture?.input_modalities?.includes("image")) {
    capabilities.push("vision");
  }

  // Extract provider-native model ID from OpenRouter ID
  // e.g., "anthropic/claude-sonnet-4.6" → "claude-sonnet-4.6"
  const slashIdx = m.id.indexOf("/");
  const nativeId = slashIdx >= 0 ? m.id.slice(slashIdx + 1) : m.id;
  const providerPrefix = slashIdx >= 0 ? m.id.slice(0, slashIdx) : undefined;

  // Extract family from model name pattern
  const family = providerPrefix ?? "unknown";

  return {
    name: nativeId,
    displayName: m.name.includes(":")
      ? m.name.split(": ")[1] ?? m.name
      : m.name,
    family,
    capabilities,
    contextWindow: m.context_length,
    metadata: {
      openRouterId: m.id,
    },
  };
}
