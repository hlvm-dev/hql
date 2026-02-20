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
  ProviderCapability,
  ProviderConfig,
  ProviderFactory,
  ProviderStatus,
  RegisteredProvider,
  GenerateOptions,
  ChatOptions,
  ToolDefinition,
  ToolFunctionDefinition,
  ProviderToolCall,
  ChatStructuredResponse,
  Message,
  ProviderMessage,
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
  listRegisteredProviders,
} from "./registry.ts";

// Cloud provider factory
export { createCloudProvider } from "./cloud-provider.ts";
export type { CloudProviderSpec, CloudProviderApi } from "./cloud-provider.ts";

// Provider implementations
export { OllamaProvider, createOllamaProvider } from "./ollama/provider.ts";
export { createOpenAIProvider } from "./openai/provider.ts";
export { createAnthropicProvider } from "./anthropic/provider.ts";
export { createGoogleProvider } from "./google/provider.ts";
export { createClaudeCodeProvider } from "./claude-code/provider.ts";

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

// Ollama: always registered as default (local, no API key needed)
registerProvider("ollama", createOllamaProvider, { isDefault: true });

// API providers: always registered (providers return known models even without key)
const _env = getPlatform().env;
registerProvider("openai", createOpenAIProvider, {
  apiKey: _env.get("OPENAI_API_KEY"),
});
registerProvider("anthropic", createAnthropicProvider, {
  apiKey: _env.get("ANTHROPIC_API_KEY"),
});
registerProvider("google", createGoogleProvider, {
  apiKey: _env.get("GOOGLE_API_KEY"),
});

// Claude Code: uses Max subscription via OAuth token (no API key needed)
registerProvider("claude-code", createClaudeCodeProvider);

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
      endpoint: config.ollama.endpoint,
      defaultModel: config.ollama.defaultModel,
      isDefault: true,
    });
  }
  if (config?.openai) {
    registerProvider("openai", createOpenAIProvider, {
      endpoint: config.openai.endpoint,
      defaultModel: config.openai.defaultModel,
      apiKey: config.openai.apiKey,
    });
  }
  if (config?.anthropic) {
    registerProvider("anthropic", createAnthropicProvider, {
      endpoint: config.anthropic.endpoint,
      defaultModel: config.anthropic.defaultModel,
      apiKey: config.anthropic.apiKey,
    });
  }
  if (config?.google) {
    registerProvider("google", createGoogleProvider, {
      endpoint: config.google.endpoint,
      defaultModel: config.google.defaultModel,
      apiKey: config.google.apiKey,
    });
  }
  if (config?.claudeCode) {
    registerProvider("claude-code", createClaudeCodeProvider, {
      endpoint: config.claudeCode.endpoint,
      defaultModel: config.claudeCode.defaultModel,
    });
  }
}
