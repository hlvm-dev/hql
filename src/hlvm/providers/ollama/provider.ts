/**
 * Ollama Provider Implementation
 *
 * Implements the AIProvider interface for Ollama.
 * Supports local Ollama instances and remote endpoints.
 */

import type {
  AIProvider,
  ProviderCapability,
  ProviderConfig,
  ProviderStatus,
  GenerateOptions,
  ChatOptions,
  Message,
  ModelInfo,
  PullProgress,
} from "../types.ts";

import * as api from "./api.ts";
import { getOllamaCatalog } from "./catalog.ts";
import { DEFAULT_MODEL_NAME } from "../../../common/config/defaults.ts";

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_ENDPOINT = "http://localhost:11434";
const DEFAULT_MODEL = DEFAULT_MODEL_NAME;

// ============================================================================
// Provider Implementation
// ============================================================================

/**
 * Ollama AI Provider
 *
 * Provides AI capabilities through a local or remote Ollama instance.
 */
export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  readonly displayName = "Ollama";

  readonly capabilities: ProviderCapability[] = [
    "generate",
    "chat",
    "models.list",
    "models.catalog",
    "models.pull",
    "models.remove",
    "vision",
  ];

  private endpoint: string;
  private defaultModel: string;
  private defaults: Partial<GenerateOptions>;

  constructor(config?: ProviderConfig) {
    this.endpoint = config?.endpoint || DEFAULT_ENDPOINT;
    this.defaultModel = config?.defaultModel || DEFAULT_MODEL;
    this.defaults = config?.defaults || {};
  }

  /**
   * Get the effective model name
   */
  private getModel(options?: GenerateOptions): string {
    return options?.model || this.defaultModel;
  }

  /**
   * Merge default options with provided options
   */
  private mergeOptions<T extends GenerateOptions>(options?: T): T {
    return { ...this.defaults, ...options } as T;
  }

  /**
   * Generate text from a prompt
   */
  async *generate(
    prompt: string,
    options?: GenerateOptions
  ): AsyncGenerator<string, void, unknown> {
    const opts = this.mergeOptions(options);
    const model = this.getModel(opts);
    const signal = opts.raw?.signal as AbortSignal | undefined;

    yield* api.generate(this.endpoint, model, prompt, opts, signal);
  }

  /**
   * Chat completion with message history
   */
  async *chat(
    messages: Message[],
    options?: ChatOptions
  ): AsyncGenerator<string, void, unknown> {
    const opts = this.mergeOptions(options);
    const model = this.getModel(opts);
    const signal = opts.raw?.signal as AbortSignal | undefined;

    yield* api.chat(this.endpoint, model, messages, opts, signal);
  }

  /**
   * Model management operations
   */
  models = {
    /**
     * List available models
     */
    list: async (): Promise<ModelInfo[]> => {
      return api.listModels(this.endpoint);
    },

    /**
     * Get info about a specific model
     */
    get: async (name: string): Promise<ModelInfo | null> => {
      return api.getModel(this.endpoint, name);
    },

    /**
     * List catalog models (offline discovery)
     */
    catalog: async (): Promise<ModelInfo[]> => {
      return getOllamaCatalog();
    },

    /**
     * Pull/download a model
     * @param name Model name to pull
     * @param signal Optional abort signal for cancellation
     */
    pull: (name: string, signal?: AbortSignal): AsyncGenerator<PullProgress, void, unknown> => {
      return api.pullModel(this.endpoint, name, signal);
    },

    /**
     * Remove/delete a model
     */
    remove: async (name: string): Promise<boolean> => {
      return api.removeModel(this.endpoint, name);
    },
  };

  /**
   * Check provider status
   */
  async status(): Promise<ProviderStatus> {
    return api.checkStatus(this.endpoint);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an Ollama provider instance
 */
export function createOllamaProvider(config?: ProviderConfig): AIProvider {
  return new OllamaProvider(config);
}
