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
  listRegisteredProviders,
  type Message,
  type ModelInfo,
  parseModelString,
  type ProviderStatus,
  type PullProgress,
} from "../providers/index.ts";
import { RuntimeError, ValidationError } from "../../common/error.ts";

/** Provider-level metadata exposed to GUI thin clients (SSOT). */
const PROVIDER_META: Record<string, { subtitle?: string; docsUrl?: string }> = {
  ollama: { subtitle: "Local models", docsUrl: "https://ollama.com/library" },
  anthropic: { subtitle: "Claude AI models", docsUrl: "https://docs.anthropic.com/en/docs/about-claude/models" },
  openai: { subtitle: "GPT models", docsUrl: "https://platform.openai.com/docs/models" },
  google: { subtitle: "Gemini models", docsUrl: "https://ai.google.dev/gemini-api/docs/models" },
  "claude-code": { subtitle: "Claude AI models (Max)", docsUrl: "https://docs.anthropic.com/en/docs/about-claude/models" },
};

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
    if (!model) {
      return undefined;
    }
    const [, modelName] = parseModelString(model);
    return modelName || undefined;
  }

  /**
   * Normalize API options into provider-ready options.
   * Keeps top-level `signal` passthrough for compatibility while
   * also mapping it to provider `raw.signal`.
   */
  function toProviderOptions<T extends ProviderRequestOptions>(options?: T): T {
    return {
      ...options,
      model: resolveModelName(options?.model),
      raw: { ...(options?.raw ?? {}), ...(options?.signal ? { signal: options.signal } : {}) },
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
      listAll: async (): Promise<ModelInfo[]> => {
        const providerNames = listRegisteredProviders();
        const results = await Promise.all(
          providerNames.map(async (name) => {
            try {
              const provider = getProvider(name);
              if (!provider?.models?.list) return [];
              let models: ModelInfo[] = [];
              try {
                models = await provider.models.list();
              } catch {
                // Continue to provider-specific fallbacks below.
              }

              // Local Ollama may be unavailable; fall back to the public gist-backed catalog.
              if (name === "ollama" && models.length === 0 && provider.models.catalog) {
                try {
                  models = await provider.models.catalog();
                } catch {
                  // Keep empty; listAll should still return whatever other providers have.
                }
              }

              if (models.length === 0) return [];
              const isCloud = name !== "ollama";
              const meta = PROVIDER_META[name];
              return models.map((m) => ({
                ...m,
                metadata: {
                  ...m.metadata,
                  provider: name,
                  providerDisplayName: provider.displayName ?? name,
                  apiKeyConfigured: provider.apiKeyConfigured,
                  ...(isCloud ? { cloud: true } : {}),
                  ...(meta?.subtitle ? { providerSubtitle: meta.subtitle } : {}),
                  ...(meta?.docsUrl ? { providerDocsUrl: meta.docsUrl } : {}),
                },
              }));
            } catch {
              return [];
            }
          }),
        );
        const allModels = results.flat();

        // Deduplicate: when the same model appears from multiple providers,
        // prefer the provider where apiKeyConfigured is true over false.
        const byName = new Map<string, ModelInfo[]>();
        for (const m of allModels) {
          const existing = byName.get(m.name);
          if (existing) existing.push(m);
          else byName.set(m.name, [m]);
        }

        const deduped: ModelInfo[] = [];
        for (const models of byName.values()) {
          if (models.length <= 1) {
            deduped.push(...models);
            continue;
          }
          const hasConfigured = models.some((m) =>
            m.metadata?.apiKeyConfigured === true
          );
          if (hasConfigured) {
            for (const m of models) {
              if (m.metadata?.apiKeyConfigured !== false) deduped.push(m);
            }
          } else {
            deduped.push(...models);
          }
        }
        return deduped;
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
      catalog: (providerName?: string): Promise<ModelInfo[]> => {
        const provider = getProviderByNameOrDefault(providerName);

        return provider?.models?.catalog
          ? provider.models.catalog()
          : Promise.resolve([]);
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
