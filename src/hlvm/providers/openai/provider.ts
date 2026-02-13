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
import { extractSignal } from "../common.ts";
import * as api from "./api.ts";

const DEFAULT_ENDPOINT = "https://api.openai.com";
const DEFAULT_MODEL = "gpt-4o";

/** Known OpenAI models — returned when no API key is set */
const KNOWN_MODELS: ModelInfo[] = [
  { name: "gpt-4o", displayName: "GPT-4o", family: "gpt-4o", capabilities: ["chat", "tools", "vision"] },
  { name: "gpt-4o-mini", displayName: "GPT-4o Mini", family: "gpt-4o", capabilities: ["chat", "tools", "vision"] },
  { name: "gpt-4.1", displayName: "GPT-4.1", family: "gpt-4.1", capabilities: ["chat", "tools", "vision"] },
  { name: "gpt-4.1-mini", displayName: "GPT-4.1 Mini", family: "gpt-4.1", capabilities: ["chat", "tools", "vision"] },
  { name: "gpt-4.1-nano", displayName: "GPT-4.1 Nano", family: "gpt-4.1", capabilities: ["chat", "tools"] },
  { name: "o3-mini", displayName: "o3 Mini", family: "o3", capabilities: ["chat", "tools"] },
  { name: "o4-mini", displayName: "o4 Mini", family: "o4", capabilities: ["chat", "tools"] },
];

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
  private defaultModel: string;
  private apiKey: string;

  constructor(config?: ProviderConfig) {
    this.endpoint = config?.endpoint ?? DEFAULT_ENDPOINT;
    this.defaultModel = config?.defaultModel ?? DEFAULT_MODEL;
    this.apiKey = config?.apiKey ?? getPlatform().env.get("OPENAI_API_KEY") ?? "";
    this.apiKeyConfigured = this.apiKey.length > 0;
  }

  private getModel(options?: GenerateOptions): string {
    return options?.model ?? this.defaultModel;
  }

  async *generate(
    prompt: string,
    options?: GenerateOptions,
  ): AsyncGenerator<string, void, unknown> {
    // OpenAI has no raw generate endpoint — wrap as a single-message chat
    const messages: Message[] = [{ role: "user", content: prompt }];
    if (options?.system) {
      messages.unshift({ role: "system", content: options.system });
    }
    const result = await api.chatStructured(
      this.endpoint,
      this.getModel(options),
      messages,
      this.apiKey,
      options as ChatOptions,
      extractSignal(options),
    );
    if (result.content) yield result.content;
  }

  async *chat(
    messages: Message[],
    options?: ChatOptions,
  ): AsyncGenerator<string, void, unknown> {
    const result = await api.chatStructured(
      this.endpoint,
      this.getModel(options),
      messages,
      this.apiKey,
      options,
      extractSignal(options),
    );
    if (result.content) yield result.content;
  }

  chatStructured(
    messages: Message[],
    options?: ChatOptions,
  ): Promise<ChatStructuredResponse> {
    return api.chatStructured(
      this.endpoint,
      this.getModel(options),
      messages,
      this.apiKey,
      options,
      extractSignal(options),
    );
  }

  models = {
    list: async (): Promise<ModelInfo[]> => {
      if (!this.apiKeyConfigured) return KNOWN_MODELS;
      const live = await api.listModels(this.endpoint, this.apiKey);
      return live.length > 0 ? live : KNOWN_MODELS;
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
