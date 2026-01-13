/**
 * AI Provider Registry
 *
 * Central registry for AI providers. Supports:
 * - Provider registration and retrieval
 * - Model name parsing (provider:model format)
 * - Default provider management
 */

import type {
  AIProvider,
  ProviderFactory,
  ProviderConfig,
  RegisteredProvider,
} from "./types.ts";

// ============================================================================
// Registry State
// ============================================================================

/** Map of provider name -> registered provider */
const providers = new Map<string, RegisteredProvider>();

/** Cached provider instances */
const instances = new Map<string, AIProvider>();

/** Name of the default provider */
let defaultProviderName: string | null = null;

// ============================================================================
// Provider Registration
// ============================================================================

/**
 * Register an AI provider
 * @param name Provider identifier (e.g., "ollama", "openai")
 * @param factory Factory function to create provider instances
 * @param config Default configuration for this provider
 */
export function registerProvider(
  name: string,
  factory: ProviderFactory,
  config?: ProviderConfig & { isDefault?: boolean }
): void {
  const entry: RegisteredProvider = {
    factory,
    defaultConfig: config,
    isDefault: config?.isDefault,
  };

  providers.set(name.toLowerCase(), entry);

  // Set as default if specified or if it's the first provider
  if (config?.isDefault || defaultProviderName === null) {
    defaultProviderName = name.toLowerCase();
  }

  // Clear cached instance if re-registering
  instances.delete(name.toLowerCase());
}

/**
 * Unregister a provider
 * @param name Provider name to remove
 */
export function unregisterProvider(name: string): boolean {
  const key = name.toLowerCase();
  instances.delete(key);

  if (providers.delete(key)) {
    // If we removed the default, pick a new one
    if (defaultProviderName === key) {
      defaultProviderName = providers.size > 0
        ? providers.keys().next().value ?? null
        : null;
    }
    return true;
  }
  return false;
}

// ============================================================================
// Provider Retrieval
// ============================================================================

/**
 * Get a provider instance by name
 * @param name Provider name (defaults to default provider)
 * @param config Optional config override
 */
export function getProvider(name?: string, config?: ProviderConfig): AIProvider | null {
  const key = (name || defaultProviderName)?.toLowerCase();
  if (!key) return null;

  const entry = providers.get(key);
  if (!entry) return null;

  // Return cached instance if no custom config
  if (!config) {
    let instance = instances.get(key);
    if (!instance) {
      instance = entry.factory(entry.defaultConfig);
      instances.set(key, instance);
    }
    return instance;
  }

  // Create new instance with merged config
  const mergedConfig = { ...entry.defaultConfig, ...config };
  return entry.factory(mergedConfig);
}

/**
 * Get the default provider
 */
export function getDefaultProvider(): AIProvider | null {
  return getProvider();
}

/**
 * Set the default provider by name
 * @param name Provider name
 */
export function setDefaultProvider(name: string): boolean {
  const key = name.toLowerCase();
  if (providers.has(key)) {
    defaultProviderName = key;
    return true;
  }
  return false;
}

/**
 * Get list of registered provider names
 */
export function listProviders(): string[] {
  return [...providers.keys()];
}

/**
 * Check if a provider is registered
 */
export function hasProvider(name: string): boolean {
  return providers.has(name.toLowerCase());
}

// ============================================================================
// Model Name Parsing
// ============================================================================

/**
 * Parse a model string into provider and model name
 * Supports formats:
 * - "model" -> uses default provider
 * - "provider:model" -> uses specified provider
 * - "provider/model" -> uses specified provider (alternative syntax)
 *
 * @param modelString The model string to parse
 * @returns Tuple of [providerName, modelName]
 */
export function parseModelString(modelString: string): [string | null, string] {
  // Check for provider/model format FIRST (e.g., "ollama/llama3.2:3b")
  // This takes priority because model names can contain colons (e.g., "llama3.2:3b")
  const slashIndex = modelString.indexOf("/");
  if (slashIndex > 0) {
    const provider = modelString.slice(0, slashIndex).toLowerCase();
    const model = modelString.slice(slashIndex + 1);
    return [provider, model];
  }

  // Check for provider:model format (legacy, e.g., "ollama:llama3.2")
  // Only use this if the colon appears before any version tag pattern
  const colonIndex = modelString.indexOf(":");
  if (colonIndex > 0) {
    // Check if this looks like a version tag (model:tag) rather than provider:model
    // Version tags typically come after a model name without slashes
    const beforeColon = modelString.slice(0, colonIndex);
    // If it looks like a simple provider name (no dots), treat as provider:model
    if (!beforeColon.includes(".")) {
      const provider = beforeColon.toLowerCase();
      const model = modelString.slice(colonIndex + 1);
      return [provider, model];
    }
  }

  // No provider prefix, use default
  return [null, modelString];
}

/**
 * Extract the model name without provider prefix
 * @param modelString Full model string
 * @returns Just the model name
 */
export function extractModelName(modelString: string): string {
  const [, modelName] = parseModelString(modelString);
  return modelName;
}

/**
 * Get provider for a model string
 * @param modelString Model string (optionally with provider prefix)
 * @returns The appropriate provider instance
 */
export function getProviderForModel(modelString: string): AIProvider | null {
  const [providerName] = parseModelString(modelString);
  return getProvider(providerName ?? undefined);
}

// ============================================================================
// Registry Info
// ============================================================================

/**
 * Get information about all registered providers
 */
export function getRegistryInfo(): {
  providers: string[];
  defaultProvider: string | null;
  instances: string[];
} {
  return {
    providers: [...providers.keys()],
    defaultProvider: defaultProviderName,
    instances: [...instances.keys()],
  };
}

/**
 * Clear all cached provider instances
 */
export function clearProviderCache(): void {
  instances.clear();
}

/**
 * Reset the registry (for testing)
 */
export function resetRegistry(): void {
  providers.clear();
  instances.clear();
  defaultProviderName = null;
}
