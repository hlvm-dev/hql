/**
 * Anthropic Provider
 *
 * Implements AIProvider for the Anthropic Messages API.
 * Supports Claude Opus, Sonnet, Haiku model families.
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

const DEFAULT_ENDPOINT = "https://api.anthropic.com";
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

/** Known Anthropic models (no list-models API) */
const KNOWN_MODELS: ModelInfo[] = [
  { name: "claude-opus-4-6", displayName: "Claude Opus 4.6", family: "claude", capabilities: ["chat", "tools", "vision"] },
  { name: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5", family: "claude", capabilities: ["chat", "tools", "vision"] },
  { name: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", family: "claude", capabilities: ["chat", "tools", "vision"] },
];

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  readonly displayName = "Anthropic";
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
    this.apiKey = config?.apiKey ?? getPlatform().env.get("ANTHROPIC_API_KEY") ?? "";
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

  async chatStructured(
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
    list: (): Promise<ModelInfo[]> => Promise.resolve(KNOWN_MODELS),
    get: (name: string): Promise<ModelInfo | null> =>
      Promise.resolve(KNOWN_MODELS.find((m) => m.name === name) ?? null),
  };

  status(): Promise<ProviderStatus> {
    return api.checkStatus(this.endpoint, this.apiKey);
  }
}

export function createAnthropicProvider(
  config?: ProviderConfig,
): AIProvider {
  return new AnthropicProvider(config);
}
