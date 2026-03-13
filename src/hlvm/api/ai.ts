/**
 * AI API Object
 *
 * Programmable access to AI capabilities through provider abstraction.
 * Usage in REPL:
 *   (ai.generate "prompt")       // Generate text
 *   (ai.chat messages)           // Chat completion
 *   (ai.models.list)             // List available models
 *   (ai.models.catalog)          // List catalog models
 *   (ai.models.pull "model")     // Download a model
 *   (ai.status)                  // Check provider status
 */

import {
  type AIProvider,
  type ChatOptions,
  type ChatStructuredResponse,
  type GenerateOptions,
  getDefaultProvider,
  getProvider,
  getProviderForModel,
  type Message,
  type ModelInfo,
  parseModelString,
  type ProviderStatus,
  type PullProgress,
} from "../providers/index.ts";
import {
  listAllProviderModels,
  type ModelListAllOptions,
} from "../providers/model-list.ts";
import {
  readStaleWhileRevalidateModelDiscoverySnapshot,
} from "../providers/model-discovery-store.ts";
import { RuntimeError, ValidationError } from "../../common/error.ts";

// ============================================================================
// Helper Types
// ============================================================================

/** Options with model override */
interface AiOptions extends GenerateOptions {
  /** Signal for abort/cancellation */
  signal?: AbortSignal;
}

/** Chat options with optional cancellation signal */
type AiChatOptions = ChatOptions & { signal?: AbortSignal };

/** Shared shape for provider option normalization */
interface ProviderRequestOptions {
  model?: string;
  signal?: AbortSignal;
  raw?: Record<string, unknown>;
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
          : "No default AI provider configured",
      );
    }
    return provider;
  }

  /**
   * Get provider by explicit name or use default provider.
   */
  function getProviderByNameOrDefault(
    providerName?: string,
  ): AIProvider | null {
    return providerName ? getProvider(providerName) : getDefaultProvider();
  }

  /**
   * Extract provider-local model name.
   * Examples:
   * - "ollama/llama3.2" => "llama3.2"
   * - "llama3.2" => "llama3.2"
   * - undefined => undefined
   */
  function resolveModelName(model?: string): string | undefined {
    if (!model) return undefined;
    return parseModelString(model)[1] || undefined;
  }

  /**
   * Normalize API options into provider-ready options.
   * Keeps top-level `signal` passthrough and preserves raw provider options.
   */
  function toProviderOptions<T extends ProviderRequestOptions>(options?: T): T {
    return {
      ...options,
      model: resolveModelName(options?.model),
    } as T;
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
      options?: AiOptions,
    ): AsyncGenerator<string, void, unknown> {
      const provider = getProviderOrThrow(options?.model);
      const opts = toProviderOptions(options);
      yield* provider.generate(prompt, opts);
    },

    /**
     * Chat completion with message history (streaming)
     * @example (ai.chat [{role: "user" content: "Hello"}])
     */
    chat: async function* (
      messages: Message[],
      options?: AiChatOptions,
    ): AsyncGenerator<string, void, unknown> {
      const provider = getProviderOrThrow(options?.model);
      const opts = toProviderOptions(options);
      yield* provider.chat(messages, opts);
    },

    /**
     * Chat completion returning structured response (non-streaming).
     * Uses native tool calling when available.
     */
    chatStructured: async function (
      messages: Message[],
      options?: AiChatOptions,
    ): Promise<ChatStructuredResponse> {
      const provider = getProviderOrThrow(options?.model);
      const opts = toProviderOptions(options);

      if (!provider.chatStructured) {
        throw new ValidationError(
          `Provider "${provider.name}" does not support native tool calling.`,
          "ai_chat_structured",
        );
      }

      return await provider.chatStructured(messages, opts);
    },

    /**
     * Model management operations
     */
    models: {
      /**
       * List available models
       * @example (ai.models.list)
       */
      list: (providerName?: string): Promise<ModelInfo[]> => {
        const provider = getProviderByNameOrDefault(providerName);

        return provider?.models?.list
          ? provider.models.list()
          : Promise.resolve([]);
      },

      /**
       * List models from ALL registered providers
       * Tags each model with metadata.provider and metadata.providerDisplayName
       * @example (ai.models.listAll)
       */
      listAll: async (options?: ModelListAllOptions): Promise<ModelInfo[]> => {
        return await listAllProviderModels(options);
      },

      /**
       * Get info about a specific model
       * @example (ai.models.get "llama3.2")
       */
      get: (
        name: string,
        providerName?: string,
      ): Promise<ModelInfo | null> => {
        // Accept both "model" and "provider/model" inputs.
        const [parsedProvider, parsedModel] = parseModelString(name);
        const resolvedProvider = providerName ?? parsedProvider ?? undefined;
        const resolvedName = providerName ? name : parsedModel;
        const provider = getProviderByNameOrDefault(resolvedProvider);

        return provider?.models?.get
          ? provider.models.get(resolvedName)
          : Promise.resolve(null);
      },

      /**
       * List catalog models (remote/curated)
       * @example (ai.models.catalog)
       */
      catalog: async (providerName?: string): Promise<ModelInfo[]> => {
        const resolvedProvider = providerName ?? getDefaultProvider()?.name;
        const snapshot = await readStaleWhileRevalidateModelDiscoverySnapshot();

        if (!resolvedProvider || resolvedProvider === "ollama") {
          return snapshot.remoteModels;
        }

        return snapshot.cloudModels.filter((model) =>
          model.metadata?.provider === resolvedProvider
        );
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
        signal?: AbortSignal,
      ): AsyncGenerator<PullProgress, void, unknown> {
        const provider = getProviderByNameOrDefault(providerName);

        if (!provider?.models?.pull) {
          throw new ValidationError(
            "Provider does not support model pulling",
            "ai.models.pull",
          );
        }
        yield* provider.models.pull(name, signal);
      },

      /**
       * Remove/delete a model
       * @example (ai.models.remove "llama3.2")
       */
      remove: (name: string, providerName?: string): Promise<boolean> => {
        const provider = getProviderByNameOrDefault(providerName);

        return provider?.models?.remove
          ? provider.models.remove(name)
          : Promise.resolve(false);
      },
    },

    /**
     * Check provider status
     * @example (ai.status)
     */
    status: (providerName?: string): Promise<ProviderStatus> => {
      const provider = getProviderByNameOrDefault(providerName);

      if (!provider) {
        return Promise.resolve({
          available: false,
          error: providerName
            ? `Provider '${providerName}' not found`
            : "No default provider configured",
        });
      }
      return provider.status();
    },
  };
}

/**
 * Default AI API instance
 */
export const ai = createAiApi();
