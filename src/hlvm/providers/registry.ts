/**
 * AI Provider Registry
 *
 * Central registry for AI providers. Supports:
 * - Provider registration and retrieval
 * - Model name parsing (provider/model format)
 * - Default provider management
 */

import type {
  AIProvider,
  ProviderConfig,
  ProviderFactory,
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

function normalizeProviderName(name: string): string {
  return name.toLowerCase();
}

function resolveProviderKey(name?: string | null): string | null {
  const providerName = name ?? defaultProviderName;
  if (!providerName) return null;
  return normalizeProviderName(providerName);
}

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
  config?: ProviderConfig & { isDefault?: boolean },
): void {
  const key = normalizeProviderName(name);
  const entry: RegisteredProvider = {
    factory,
    defaultConfig: config,
  };

  providers.set(key, entry);

  // Set as default if specified or if it's the first provider
  if (config?.isDefault || defaultProviderName === null) {
    defaultProviderName = key;
  }

  // Clear cached instance if re-registering
  instances.delete(key);
}

// ============================================================================
// Provider Retrieval
// ============================================================================

/**
 * Get a provider instance by name
 * @param name Provider name (defaults to default provider)
 * @param config Optional config override
 */
export function getProvider(
  name?: string,
  config?: ProviderConfig,
): AIProvider | null {
  const key = resolveProviderKey(name);
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
 * Get the default config for a provider (or default provider when omitted).
 * Returns a shallow copy to avoid external mutation of registry state.
 */
export function getProviderDefaultConfig(
  name?: string,
): ProviderConfig | null {
  const key = resolveProviderKey(name);
  if (!key) return null;
  const entry = providers.get(key);
  if (!entry?.defaultConfig) return null;
  const {
    // registerProvider accepts isDefault as an extension; strip it here.
    isDefault: _isDefault,
    ...config
  } = entry.defaultConfig as ProviderConfig & { isDefault?: boolean };
  return { ...config };
}

/**
 * Set the default provider by name
 * @param name Provider name
 */
export function setDefaultProvider(name: string): boolean {
  const key = normalizeProviderName(name);
  if (providers.has(key)) {
    defaultProviderName = key;
    return true;
  }
  return false;
}

/**
 * Check if a provider is registered
 */
export function hasProvider(name: string): boolean {
  return providers.has(normalizeProviderName(name));
}

// ============================================================================
// Model Name Parsing
// ============================================================================

/**
 * Parse a model string into provider and model name
 * Supports formats:
 * - "model" -> uses default provider
 * - "provider/model" -> uses specified provider
 *
 * @param modelString The model string to parse
 * @returns Tuple of [providerName, modelName]
 */
export function parseModelString(modelString: string): [string | null, string] {
  // Canonical provider prefix form: "provider/model".
  // Model names themselves may contain colons (e.g., "llama3.2:3b"), so
  // slash-based parsing is the only accepted prefixed syntax.
  const slashIndex = modelString.indexOf("/");
  if (slashIndex > 0) {
    const provider = normalizeProviderName(modelString.slice(0, slashIndex));
    const model = modelString.slice(slashIndex + 1);
    return [provider, model];
  }

  // No provider prefix, use default
  return [null, modelString];
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

/**
 * List all registered provider names
 */
export function listRegisteredProviders(): string[] {
  return [...providers.keys()];
}
