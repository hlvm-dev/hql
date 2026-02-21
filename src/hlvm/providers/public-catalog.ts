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
import { http } from "../../common/http-client.ts";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** Cache TTL: 1 hour (models don't change every minute) */
const CACHE_TTL_MS = 60 * 60 * 1000;

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
// In-memory cache
// ---------------------------------------------------------------------------

let cachedModels: ModelInfo[] | null = null;
let cacheTimestamp = 0;

function isCacheValid(): boolean {
  return cachedModels !== null && Date.now() - cacheTimestamp < CACHE_TTL_MS;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch all models from the public OpenRouter catalog.
 * Results are cached in memory for 1 hour.
 * Returns empty array on network failure (never throws).
 */
async function fetchPublicCatalog(): Promise<ModelInfo[]> {
  if (isCacheValid()) return cachedModels!;

  try {
    const response = await http.fetchRaw(OPENROUTER_MODELS_URL, {
      timeout: 10_000,
    });
    if (!response.ok) return cachedModels ?? [];

    const result = await response.json() as { data: OpenRouterModel[] };
    cachedModels = (result.data ?? []).map(toModelInfo);
    cacheTimestamp = Date.now();
    return cachedModels;
  } catch {
    return cachedModels ?? [];
  }
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

  const all = await fetchPublicCatalog();
  return all
    .filter((m) =>
      (m.metadata?.openRouterId as string | undefined)?.startsWith(prefix)
    )
    .map((m) => ({
      ...m,
      // Strip provider prefix: "anthropic/claude-sonnet-4.6" → "claude-sonnet-4.6"
      // But keep the canonical model ID if available
      name: m.name,
    }));
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
