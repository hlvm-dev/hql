/**
 * AI Providers Module
 *
 * Central export for all provider-related functionality.
 * Automatically registers built-in providers on import.
 * Ollama is always registered as default.
 * API providers (OpenAI, Anthropic, Google) are always registered (return known models even without keys).
 */

// ============================================================================
// Re-exports
// ============================================================================

// Types
export type {
  AIProvider,
  ChatOptions,
  ChatStructuredResponse,
  GenerateOptions,
  Message,
  MessageRole,
  ModelCapabilityFlags,
  ModelInfo,
  ProviderCapability,
  ProviderConfig,
  ProviderMessage,
  ProviderStatus,
  ProviderToolCall,
  PullProgress,
  ToolDefinition,
} from "./types.ts";

// Capability helpers
export {
  capabilitiesToDisplayTags,
  capabilitiesToFlags,
  formatCapabilityTags,
} from "./types.ts";

// Shared metadata
export {
  findProviderMetaKey,
  getProviderMeta,
  getProviderSearchTerms,
} from "./provider-meta.ts";

// Registry
export {
  getDefaultProvider,
  getProvider,
  getProviderDefaultConfig,
  getProviderForModel,
  hasProvider,
  listRegisteredProviders,
  parseModelString,
  registerProvider,
  setDefaultProvider,
} from "./registry.ts";

// ============================================================================
// Auto-registration
// ============================================================================

import { registerProvider } from "./registry.ts";
import { createOllamaProvider } from "./ollama/provider.ts";
import { createOpenAIProvider } from "./openai/provider.ts";
import { createAnthropicProvider } from "./anthropic/provider.ts";
import { createGoogleProvider } from "./google/provider.ts";
import { createClaudeCodeProvider } from "./claude-code/provider.ts";
import { getPlatform } from "../../platform/platform.ts";
import {
  DEFAULT_MODEL_NAME,
  DEFAULT_OLLAMA_ENDPOINT,
} from "../../common/config/types.ts";

const OLLAMA_PROVIDER_DEFAULTS = {
  endpoint: DEFAULT_OLLAMA_ENDPOINT,
  defaultModel: DEFAULT_MODEL_NAME,
} as const;

// Ollama: always registered as default (local, no API key needed)
registerProvider("ollama", createOllamaProvider, {
  ...OLLAMA_PROVIDER_DEFAULTS,
  isDefault: true,
});

// API providers: always registered (providers return known models even without key)
const _env = getPlatform().env;
registerProvider("openai", createOpenAIProvider, {
  apiKey: _env.get("OPENAI_API_KEY"),
  capabilities: createOpenAIProvider.specCapabilities,
});
registerProvider("anthropic", createAnthropicProvider, {
  apiKey: _env.get("ANTHROPIC_API_KEY"),
  capabilities: createAnthropicProvider.specCapabilities,
});
registerProvider("google", createGoogleProvider, {
  apiKey: _env.get("GOOGLE_API_KEY"),
  capabilities: createGoogleProvider.specCapabilities,
});

// Claude Code: uses Max subscription via OAuth token (no API key needed)
registerProvider("claude-code", createClaudeCodeProvider, {
  capabilities: createClaudeCodeProvider.specCapabilities,
});

/**
 * Initialize providers with custom configuration.
 * Call this to override default provider settings.
 */
export function initializeProviders(config?: {
  ollama?: { endpoint?: string; defaultModel?: string };
  openai?: { endpoint?: string; defaultModel?: string; apiKey?: string };
  anthropic?: { endpoint?: string; defaultModel?: string; apiKey?: string };
  google?: { endpoint?: string; defaultModel?: string; apiKey?: string };
  claudeCode?: { endpoint?: string; defaultModel?: string };
}): void {
  if (config?.ollama) {
    registerProvider("ollama", createOllamaProvider, {
      ...OLLAMA_PROVIDER_DEFAULTS,
      ...config.ollama,
      isDefault: true,
    });
  }
  if (config?.openai) {
    registerProvider("openai", createOpenAIProvider, {
      ...config.openai,
      capabilities: createOpenAIProvider.specCapabilities,
    });
  }
  if (config?.anthropic) {
    registerProvider("anthropic", createAnthropicProvider, {
      ...config.anthropic,
      capabilities: createAnthropicProvider.specCapabilities,
    });
  }
  if (config?.google) {
    registerProvider("google", createGoogleProvider, {
      ...config.google,
      capabilities: createGoogleProvider.specCapabilities,
    });
  }
  if (config?.claudeCode) {
    registerProvider("claude-code", createClaudeCodeProvider, {
      ...config.claudeCode,
      capabilities: createClaudeCodeProvider.specCapabilities,
    });
  }
}
