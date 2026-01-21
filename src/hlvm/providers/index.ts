/**
 * AI Providers Module
 *
 * Central export for all provider-related functionality.
 * Automatically registers built-in providers (Ollama) on import.
 */

// ============================================================================
// Re-exports
// ============================================================================

// Types
export type {
  AIProvider,
  ProviderCapability,
  ProviderConfig,
  ProviderFactory,
  ProviderStatus,
  RegisteredProvider,
  GenerateOptions,
  ChatOptions,
  Message,
  MessageRole,
  ModelInfo,
  ModelCapabilityFlags,
  PullProgress,
} from "./types.ts";

// Capability helpers
export {
  capabilitiesToFlags,
  capabilitiesToDisplayTags,
  formatCapabilityTags,
} from "./types.ts";

// Registry
export {
  registerProvider,
  getProvider,
  getDefaultProvider,
  setDefaultProvider,
  hasProvider,
  parseModelString,
  getProviderForModel,
} from "./registry.ts";

// Ollama provider
export { OllamaProvider, createOllamaProvider } from "./ollama/provider.ts";

// ============================================================================
// Auto-registration
// ============================================================================

import { registerProvider } from "./registry.ts";
import { createOllamaProvider } from "./ollama/provider.ts";

// Register Ollama as the default provider
registerProvider("ollama", createOllamaProvider, { isDefault: true });

/**
 * Initialize providers with custom configuration
 * Call this to override default provider settings
 */
export function initializeProviders(config?: {
  ollama?: {
    endpoint?: string;
    defaultModel?: string;
  };
}): void {
  if (config?.ollama) {
    registerProvider("ollama", createOllamaProvider, {
      endpoint: config.ollama.endpoint,
      defaultModel: config.ollama.defaultModel,
      isDefault: true,
    });
  }
}
