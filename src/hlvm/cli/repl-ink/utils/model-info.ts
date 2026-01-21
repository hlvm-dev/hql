/**
 * Model Info Utilities
 *
 * Fetches and caches model capabilities from Ollama API.
 * Uses canonical ModelInfo from providers/types.ts as single source of truth.
 *
 * @see https://docs.ollama.com/modelfile
 * @see https://ollama.com/library
 */

import type { ModelInfo, ProviderCapability } from "../../../providers/types.ts";

// Re-export for backwards compatibility
export type { ModelInfo, ProviderCapability };
export {
  capabilitiesToFlags,
  formatCapabilityTags,
  type ModelCapabilityFlags,
} from "../../../providers/types.ts";

// ============================================================
// Cache
// ============================================================

const modelInfoCache = new Map<string, ModelInfo>();

// ============================================================
// Helpers
// ============================================================

/**
 * Extract model name without provider prefix
 * "ollama/qwen2.5-coder:1.5b" -> "qwen2.5-coder:1.5b"
 */
export function extractModelName(fullName: string): string {
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
  const displayName = extractModelName(modelName);

  // Check cache first
  const cached = modelInfoCache.get(displayName);
  if (cached) return cached;

  // Default info (fallback)
  const defaultInfo: ModelInfo = {
    name: modelName,
    displayName,
    capabilities: ["generate", "chat"] as ProviderCapability[],
  };

  try {
    // Use ai.models API for single source of truth
    const aiApi = (globalThis as Record<string, unknown>).ai as {
      models: {
        get: (name: string) => Promise<{
          capabilities?: ProviderCapability[];
          family?: string;
          parameterSize?: string;
          quantization?: string;
        } | null>;
      };
    } | undefined;

    // 100% SSOT: Use ai.models API only - no direct fetch fallback
    if (aiApi?.models?.get) {
      const result = await aiApi.models.get(displayName);
      if (result) {
        const info: ModelInfo = {
          name: modelName,
          displayName,
          family: result.family,
          parameterSize: result.parameterSize,
          quantization: result.quantization,
          capabilities: result.capabilities,
        };

        modelInfoCache.set(displayName, info);
        return info;
      }
    }
    // No fallback - if API not ready, return default info

    modelInfoCache.set(displayName, defaultInfo);
    return defaultInfo;
  } catch {
    // Network error - use default
    modelInfoCache.set(displayName, defaultInfo);
    return defaultInfo;
  }
}
