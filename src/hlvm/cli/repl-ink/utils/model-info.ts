/**
 * Model Info Utilities
 *
 * Fetches and caches model capabilities from Ollama API.
 * Uses canonical ModelInfo from providers/types.ts as single source of truth.
 *
 * @see https://docs.ollama.com/modelfile
 * @see https://ollama.com/library
 */

import { parseModelString } from "../../../providers/index.ts";
import type {
  ModelInfo,
  ProviderCapability,
} from "../../../providers/types.ts";
import { getRuntimeModel } from "../../../runtime/host-client.ts";
import { LRUCache } from "../../../../common/lru-cache.ts";

// Re-export for backwards compatibility
export type { ModelInfo, ProviderCapability };
export { formatCapabilityTags } from "../../../providers/types.ts";

// ============================================================
// Cache
// ============================================================

const modelInfoCache = new LRUCache<string, ModelInfo>(128);

// ============================================================
// Helpers
// ============================================================

/**
 * Extract model name without provider prefix
 * "ollama/qwen2.5-coder:1.5b" -> "qwen2.5-coder:1.5b"
 */
function extractModelName(fullName: string): string {
  return fullName.replace(/^ollama\//, "");
}

// ============================================================
// API
// ============================================================

/**
 * Fetch model info - use ai.models API for single source of truth
 * Returns canonical ModelInfo type from providers/types.ts
 */
export async function fetchModelInfo(modelName: string): Promise<ModelInfo> {
  const [providerName, parsedModelName] = parseModelString(modelName);
  const displayName = extractModelName(modelName);

  // Check cache first
  const cacheKey = providerName
    ? `${providerName}/${parsedModelName}`
    : displayName;
  const cached = modelInfoCache.get(cacheKey);
  if (cached) return cached;

  // Default info (fallback)
  const defaultInfo: ModelInfo = {
    name: modelName,
    displayName,
    capabilities: ["generate", "chat"] as ProviderCapability[],
  };

  try {
    const result = await getRuntimeModel(
      parsedModelName,
      providerName ?? "ollama",
    );
    if (result) {
      const info: ModelInfo = {
        name: modelName,
        displayName,
        family: result.family,
        parameterSize: result.parameterSize,
        quantization: result.quantization,
        capabilities: result.capabilities,
      };

      modelInfoCache.set(cacheKey, info);
      return info;
    }

    modelInfoCache.set(cacheKey, defaultInfo);
    return defaultInfo;
  } catch {
    modelInfoCache.set(cacheKey, defaultInfo);
    return defaultInfo;
  }
}

export function __testOnlyResetModelInfoCache(): void {
  modelInfoCache.clear();
}
