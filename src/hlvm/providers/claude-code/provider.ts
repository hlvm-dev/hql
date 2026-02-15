/**
 * Claude Code Subscription Provider
 *
 * Uses your Claude Max subscription (via Claude Code OAuth token)
 * instead of a separate API key. Same Anthropic API, different auth.
 *
 * Usage: hlvm ask --model claude-code/claude-opus-4-6 "your query"
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
import { extractSignal } from "../common.ts";
import * as api from "./api.ts";

const DEFAULT_ENDPOINT = "https://api.anthropic.com";
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

/** Same models as Anthropic — it's the same API, just different auth */
const KNOWN_MODELS: ModelInfo[] = [
  { name: "claude-opus-4-6", displayName: "Claude Opus 4.6", family: "claude", capabilities: ["chat", "tools", "vision"], contextWindow: 200_000 },
  { name: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5", family: "claude", capabilities: ["chat", "tools", "vision"], contextWindow: 200_000 },
  { name: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", family: "claude", capabilities: ["chat", "tools", "vision"], contextWindow: 200_000 },
];

export class ClaudeCodeProvider implements AIProvider {
  readonly name = "claude-code";
  readonly displayName = "Claude Code (Max Subscription)";
  readonly apiKeyConfigured = true; // Auth is via OAuth, always "configured" if claude login was done
  readonly capabilities: ProviderCapability[] = [
    "chat",
    "tools",
    "vision",
    "models.list",
  ];

  private endpoint: string;
  private defaultModel: string;

  constructor(config?: ProviderConfig) {
    this.endpoint = config?.endpoint ?? DEFAULT_ENDPOINT;
    this.defaultModel = config?.defaultModel ?? DEFAULT_MODEL;
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
      options,
      extractSignal(options),
    );
  }

  models = {
    list: (): Promise<ModelInfo[]> => Promise.resolve(KNOWN_MODELS),
    get: (name: string): Promise<ModelInfo | null> =>
      Promise.resolve(KNOWN_MODELS.find((m) => m.name === name) ?? null),
  };

  status(): Promise<ProviderStatus> {
    return api.checkStatus(this.endpoint);
  }
}

export function createClaudeCodeProvider(
  config?: ProviderConfig,
): AIProvider {
  return new ClaudeCodeProvider(config);
}
