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
import { extractSignal, generateFromChat, chatFromStructured } from "../common.ts";
import { fetchPublicModelsForProvider } from "../public-catalog.ts";
import * as api from "./api.ts";

const DEFAULT_ENDPOINT = "https://api.anthropic.com";

/** Suffix appended to model IDs to indicate Claude Code full agent passthrough mode */
export const AGENT_MODEL_SUFFIX = ":agent";

/** Expand a flat list of Anthropic models into plain + :agent variants */
function expandWithAgentVariants(models: ModelInfo[]): ModelInfo[] {
  return models.flatMap((m) => [
    m,
    { ...m, name: `${m.name}${AGENT_MODEL_SUFFIX}`, displayName: `${m.displayName ?? m.name} (Agent)` },
  ]);
}

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
  private configuredModel: string | undefined;
  private resolvedDefault: string | undefined;

  constructor(config?: ProviderConfig) {
    this.endpoint = config?.endpoint ?? DEFAULT_ENDPOINT;
    this.configuredModel = config?.defaultModel;
  }

  /** Resolve default model dynamically — no hardcoded model IDs. */
  private async getModel(options?: GenerateOptions): Promise<string> {
    let model: string;
    if (options?.model) {
      model = options.model;
    } else if (this.configuredModel) {
      model = this.configuredModel;
    } else if (this.resolvedDefault) {
      model = this.resolvedDefault;
    } else {
      // Dynamically pick the first available model (self-growing)
      const models = await this.models.list();
      if (models.length > 0) {
        this.resolvedDefault = models[0].name;
        model = this.resolvedDefault;
      } else {
        throw new Error("No Claude Code models available. Run `claude login` to authenticate.");
      }
    }
    // Strip :agent suffix — it's a UI/routing concept, not an API parameter
    return model.endsWith(AGENT_MODEL_SUFFIX) ? model.slice(0, -AGENT_MODEL_SUFFIX.length) : model;
  }

  async *generate(
    prompt: string,
    options?: GenerateOptions,
  ): AsyncGenerator<string, void, unknown> {
    const model = await this.getModel(options);
    yield* generateFromChat(
      (msgs, opts, signal) => api.chatStructured(this.endpoint, model, msgs, opts, signal),
      prompt, options,
    );
  }

  async *chat(
    messages: Message[],
    options?: ChatOptions,
  ): AsyncGenerator<string, void, unknown> {
    const model = await this.getModel(options);
    yield* chatFromStructured(
      (msgs, opts, signal) => api.chatStructured(this.endpoint, model, msgs, opts, signal),
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
      options,
      extractSignal(options),
    );
  }

  models = {
    /** OAuth API (primary) → public catalog (fallback). Expanded to plain + :agent variants. */
    list: async (): Promise<ModelInfo[]> => {
      const live = await api.listModels(this.endpoint);
      if (live.length > 0) return expandWithAgentVariants(live);
      // Fallback: OpenRouter public catalog (no credentials needed)
      const publicModels = await fetchPublicModelsForProvider("anthropic");
      return expandWithAgentVariants(publicModels);
    },
    get: async (name: string): Promise<ModelInfo | null> => {
      const models = await this.models.list();
      return models.find((m) => m.name === name) ?? null;
    },
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
