/**
 * Model Info Utilities
 *
 * Fetches and caches model capabilities from Ollama API.
 * Follows Ollama convention for capability display.
 *
 * @see https://docs.ollama.com/modelfile
 * @see https://ollama.com/library
 */

// ============================================================
// Types
// ============================================================

export interface ModelCapabilities {
  completion: boolean;  // Text generation
  vision: boolean;      // Image understanding
  tools: boolean;       // Function calling
  embedding: boolean;   // Vector embeddings
  thinking: boolean;    // Reasoning/deliberation (e.g., deepseek-r1)
}

export interface ModelInfo {
  name: string;
  displayName: string;  // Without "ollama/" prefix
  capabilities: ModelCapabilities;
  details: {
    family?: string;
    parameterSize?: string;
    quantization?: string;
  };
  link: string;  // Link to ollama.com
}

// ============================================================
// Cache
// ============================================================

const modelInfoCache = new Map<string, ModelInfo>();

// ============================================================
// API
// ============================================================

/**
 * Extract model name without provider prefix
 * "ollama/qwen2.5-coder:1.5b" -> "qwen2.5-coder:1.5b"
 */
function extractModelName(fullName: string): string {
  return fullName.replace(/^ollama\//, "");
}

/**
 * Get base model name for Ollama library link
 * "qwen2.5-coder:1.5b" -> "qwen2.5-coder"
 */
function getBaseModelName(name: string): string {
  return name.split(":")[0];
}

/**
 * Fetch model info - use ai.models API for single source of truth
 */
export async function fetchModelInfo(modelName: string): Promise<ModelInfo> {
  const displayName = extractModelName(modelName);
  const baseName = getBaseModelName(displayName);

  // Check cache first
  const cached = modelInfoCache.get(displayName);
  if (cached) return cached;

  // Default info (fallback)
  const defaultInfo: ModelInfo = {
    name: modelName,
    displayName,
    capabilities: {
      completion: true,  // Assume text by default
      vision: false,
      tools: false,
      embedding: false,
      thinking: false,
    },
    details: {},
    link: `ollama.com/library/${baseName}`,
  };

  try {
    // Use ai.models API for single source of truth
    const aiApi = (globalThis as Record<string, unknown>).ai as {
      models: {
        get: (name: string) => Promise<{
          capabilities?: string[];
          family?: string;
          quantization?: string;
        } | null>;
      };
    } | undefined;

    let data: {
      capabilities?: string[];
      details?: { family?: string; parameter_size?: string; quantization_level?: string };
    } | null = null;

    // 100% SSOT: Use ai.models API only - no direct fetch fallback
    if (aiApi?.models?.get) {
      const result = await aiApi.models.get(displayName);
      if (result) {
        data = {
          capabilities: result.capabilities,
          details: {
            family: result.family,
            quantization_level: result.quantization,
          },
        };
      }
    }
    // No fallback - if API not ready, return default info

    if (!data) {
      modelInfoCache.set(displayName, defaultInfo);
      return defaultInfo;
    }

    // Parse capabilities from response
    const caps = data.capabilities || [];
    const capabilities: ModelCapabilities = {
      completion: caps.includes("completion") || caps.includes("text") || caps.length === 0,
      vision: caps.includes("vision"),
      tools: caps.includes("tools"),
      embedding: caps.includes("embedding") || caps.includes("embeddings"),
      thinking: caps.includes("thinking"),
    };

    // Parse details
    const details = data.details || {};

    const info: ModelInfo = {
      name: modelName,
      displayName,
      capabilities,
      details: {
        family: details.family,
        parameterSize: details.parameter_size,
        quantization: details.quantization_level,
      },
      link: `ollama.com/library/${baseName}`,
    };

    modelInfoCache.set(displayName, info);
    return info;
  } catch {
    // Network error - use default
    modelInfoCache.set(displayName, defaultInfo);
    return defaultInfo;
  }
}

/**
 * Format capabilities as display tags
 * Returns: "[text]", "[vision] [text]", "[text] [tools]", etc.
 * Follows Ollama library display order.
 */
export function formatCapabilityTags(caps: ModelCapabilities): string {
  const tags: string[] = [];

  // Order: vision, thinking, tools, text, embedding (following ollama.com/library)
  if (caps.vision) tags.push("[vision]");
  if (caps.thinking) tags.push("[thinking]");
  if (caps.tools) tags.push("[tools]");
  if (caps.completion) tags.push("[text]");
  if (caps.embedding) tags.push("[embed]");

  return tags.join(" ");
}

/**
 * Get cached model info synchronously (if available)
 */
export function getCachedModelInfo(modelName: string): ModelInfo | undefined {
  const displayName = extractModelName(modelName);
  return modelInfoCache.get(displayName);
}

/**
 * Clear model info cache
 */
export function clearModelInfoCache(): void {
  modelInfoCache.clear();
}
