/**
 * AI API Object
 *
 * Programmable access to AI capabilities through provider abstraction.
 * Usage in REPL:
 *   (ai.generate "prompt")       ; Generate text
 *   (ai.chat messages)           ; Chat completion
 *   (ai.models.list)             ; List available models
 *   (ai.models.catalog)          ; List catalog models
 *   (ai.models.pull "model")     ; Download a model
 *   (ai.status)                  ; Check provider status
 */

import {
  getProvider,
  getDefaultProvider,
  getProviderForModel,
  parseModelString,
  type AIProvider,
  type Message,
  type GenerateOptions,
  type ChatOptions,
  type ModelInfo,
  type PullProgress,
  type ProviderStatus,
} from "../providers/index.ts";
import { RuntimeError, ValidationError } from "../../common/error.ts";

// ============================================================================
// Helper Types
// ============================================================================

/** Options with model override */
interface AiOptions extends GenerateOptions {
  /** Signal for abort/cancellation */
  signal?: AbortSignal;
}

// ============================================================================
// AI API Object
// ============================================================================

/**
 * Create the AI API object
 * Designed to be registered on globalThis for REPL access
 */
function createAiApi() {
  /**
   * Get the provider for a given model string
   */
  function getProviderOrThrow(modelString?: string): AIProvider {
    const provider = modelString
      ? getProviderForModel(modelString)
      : getDefaultProvider();

    if (!provider) {
      throw new RuntimeError(
        modelString
          ? `No provider found for model: ${modelString}`
          : "No default AI provider configured"
      );
    }
    return provider;
  }

  return {
    /**
     * Generate text from a prompt (streaming)
     * Returns an async generator for token-by-token streaming
     * @example (ai.generate "Write a haiku")
     * @example (ai.generate "Write code" {model: "ollama/codellama"})
     */
    generate: async function* (
      prompt: string,
      options?: AiOptions
    ): AsyncGenerator<string, void, unknown> {
      const provider = getProviderOrThrow(options?.model);

      // Extract model name from provider:model format
      const [, modelName] = parseModelString(options?.model || "");
      const opts: GenerateOptions = {
        ...options,
        model: modelName || undefined,
        raw: options?.signal ? { signal: options.signal } : undefined,
      };

      yield* provider.generate(prompt, opts);
    },

    /**
     * Chat completion with message history (streaming)
     * @example (ai.chat [{role: "user" content: "Hello"}])
     */
    chat: async function* (
      messages: Message[],
      options?: ChatOptions & { signal?: AbortSignal }
    ): AsyncGenerator<string, void, unknown> {
      const provider = getProviderOrThrow(options?.model);

      const [, modelName] = parseModelString(options?.model || "");
      const opts: ChatOptions = {
        ...options,
        model: modelName || undefined,
        raw: options?.signal ? { signal: options.signal } : undefined,
      };

      yield* provider.chat(messages, opts);
    },

    /**
     * Model management operations
     */
    models: {
      /**
       * List available models
       * @example (ai.models.list)
       */
      list: async (providerName?: string): Promise<ModelInfo[]> => {
        const provider = providerName
          ? getProvider(providerName)
          : getDefaultProvider();

        if (!provider?.models?.list) {
          return [];
        }
        return provider.models.list();
      },

      /**
       * Get info about a specific model
       * @example (ai.models.get "llama3.2")
       */
      get: async (
        name: string,
        providerName?: string
      ): Promise<ModelInfo | null> => {
        const provider = providerName
          ? getProvider(providerName)
          : getDefaultProvider();

        if (!provider?.models?.get) {
          return null;
        }
        return provider.models.get(name);
      },

      /**
       * List catalog models (remote/curated)
       * @example (ai.models.catalog)
       */
      catalog: async (providerName?: string): Promise<ModelInfo[]> => {
        const provider = providerName
          ? getProvider(providerName)
          : getDefaultProvider();

        if (!provider?.models?.catalog) {
          return [];
        }
        return provider.models.catalog();
      },

      /**
       * Pull/download a model (streaming progress)
       * @example (ai.models.pull "llama3.2")
       * @param name Model name to pull
       * @param providerName Optional provider name (defaults to current)
       * @param signal Optional abort signal for cancellation
       */
      pull: async function* (
        name: string,
        providerName?: string,
        signal?: AbortSignal
      ): AsyncGenerator<PullProgress, void, unknown> {
        const provider = providerName
          ? getProvider(providerName)
          : getDefaultProvider();

        if (!provider?.models?.pull) {
          throw new ValidationError("Provider does not support model pulling", "ai.models.pull");
        }
        yield* provider.models.pull(name, signal);
      },

      /**
       * Remove/delete a model
       * @example (ai.models.remove "llama3.2")
       */
      remove: async (name: string, providerName?: string): Promise<boolean> => {
        const provider = providerName
          ? getProvider(providerName)
          : getDefaultProvider();

        if (!provider?.models?.remove) {
          return false;
        }
        return provider.models.remove(name);
      },
    },

    /**
     * Check provider status
     * @example (ai.status)
     */
    status: async (providerName?: string): Promise<ProviderStatus> => {
      const provider = providerName
        ? getProvider(providerName)
        : getDefaultProvider();

      if (!provider) {
        return {
          available: false,
          error: providerName
            ? `Provider '${providerName}' not found`
            : "No default provider configured",
        };
      }
      return provider.status();
    },
  };
}

/**
 * Default AI API instance
 */
export const ai = createAiApi();
