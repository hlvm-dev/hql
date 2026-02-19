/**
 * OpenAI Provider
 *
 * Implements AIProvider for the OpenAI Chat Completions API.
 * Supports GPT-4o, GPT-4, GPT-3.5, and all models via the OpenAI API.
 */

import type {
  AIProvider,
  ChatOptions,
  ChatStructuredResponse,
  GenerateOptions,
  Message,
  ModelInfo,
  ProviderCapability,
  ProviderConfig,
  ProviderStatus,
} from "../types.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { extractSignal, generateFromChat, chatFromStructured } from "../common.ts";
import { fetchPublicModelsForProvider } from "../public-catalog.ts";
import * as api from "./api.ts";

const DEFAULT_ENDPOINT = "https://api.openai.com";

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly displayName = "OpenAI";
  readonly apiKeyConfigured: boolean;
  readonly capabilities: ProviderCapability[] = [
    "chat",
    "tools",
    "vision",
    "models.list",
  ];

  private endpoint: string;
  private configuredModel: string | undefined;
  private resolvedDefault: string | undefined;
  private apiKey: string;

  constructor(config?: ProviderConfig) {
    this.endpoint = config?.endpoint ?? DEFAULT_ENDPOINT;
    this.configuredModel = config?.defaultModel;
    this.apiKey = config?.apiKey ?? getPlatform().env.get("OPENAI_API_KEY") ?? "";
    this.apiKeyConfigured = this.apiKey.length > 0;
  }

  /** Resolve default model dynamically — no hardcoded model IDs. */
  private async getModel(options?: GenerateOptions): Promise<string> {
    if (options?.model) return options.model;
    if (this.configuredModel) return this.configuredModel;
    if (this.resolvedDefault) return this.resolvedDefault;
    // Dynamically pick the first available model (self-growing)
    const models = await this.models.list();
    if (models.length > 0) {
      this.resolvedDefault = models[0].name;
      return this.resolvedDefault;
    }
    throw new Error("No OpenAI models available. Check your API key or network.");
  }

  async *generate(
    prompt: string,
    options?: GenerateOptions,
  ): AsyncGenerator<string, void, unknown> {
    const model = await this.getModel(options);
    yield* generateFromChat(
      (msgs, opts, signal) => api.chatStructured(this.endpoint, model, msgs, this.apiKey, opts, signal),
      prompt, options,
    );
  }

  async *chat(
    messages: Message[],
    options?: ChatOptions,
  ): AsyncGenerator<string, void, unknown> {
    const model = await this.getModel(options);
    yield* chatFromStructured(
      (msgs, opts, signal) => api.chatStructured(this.endpoint, model, msgs, this.apiKey, opts, signal),
      messages, options,
    );
  }

  async chatStructured(
    messages: Message[],
    options?: ChatOptions,
  ): Promise<ChatStructuredResponse> {
    const model = await this.getModel(options);
    return api.chatStructured(
      this.endpoint,
      model,
      messages,
      this.apiKey,
      options,
      extractSignal(options),
    );
  }

  models = {
    list: async (): Promise<ModelInfo[]> => {
      if (this.apiKeyConfigured) {
        const live = await api.listModels(this.endpoint, this.apiKey);
        if (live.length > 0) return live;
      }
      return fetchPublicModelsForProvider("openai");
    },
    get: async (name: string): Promise<ModelInfo | null> => {
      const models = await this.models.list();
      return models.find((m) => m.name === name) ?? null;
    },
  };

  status(): Promise<ProviderStatus> {
    return api.checkStatus(this.endpoint, this.apiKey);
  }
}

export function createOpenAIProvider(
  config?: ProviderConfig,
): AIProvider {
  return new OpenAIProvider(config);
}
