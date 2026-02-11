/**
 * Google Provider
 *
 * Implements AIProvider for the Google Generative AI (Gemini) API.
 * Supports Gemini 2.0 Flash, Gemini Pro, and other Gemini models.
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
import * as api from "./api.ts";

const DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com";
const DEFAULT_MODEL = "gemini-2.0-flash";

/** Known Google models — returned when no API key is set */
const KNOWN_MODELS: ModelInfo[] = [
  { name: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", family: "gemini", capabilities: ["chat", "tools", "vision"] },
  { name: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", family: "gemini", capabilities: ["chat", "tools", "vision"] },
  { name: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash", family: "gemini", capabilities: ["chat", "tools", "vision"] },
];

export class GoogleProvider implements AIProvider {
  readonly name = "google";
  readonly displayName = "Google";
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
    this.apiKey = config?.apiKey ?? getPlatform().env.get("GOOGLE_API_KEY") ?? "";
    this.apiKeyConfigured = this.apiKey.length > 0;
  }

  private getModel(options?: GenerateOptions): string {
    return options?.model ?? this.defaultModel;
  }

  async *generate(
    prompt: string,
    options?: GenerateOptions,
  ): AsyncGenerator<string, void, unknown> {
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
      options?.raw?.signal as AbortSignal | undefined,
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
      options?.raw?.signal as AbortSignal | undefined,
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
      options?.raw?.signal as AbortSignal | undefined,
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

export function createGoogleProvider(
  config?: ProviderConfig,
): AIProvider {
  return new GoogleProvider(config);
}
