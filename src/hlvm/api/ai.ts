/**
 * AI API — Callable Function with Methods
 *
 * `ai` is a callable function (axios/chalk pattern):
 *   (ai "prompt")                       → string (single LLM call)
 *   (ai "prompt" {schema: S})           → object (structured output)
 *   (ai.chat messages)                  → AsyncGenerator<string> (streaming)
 *   (ai.agent "do this task")           → string (ReAct agent loop)
 *   (ai.models.list)                    → ModelInfo[]
 *   (ai.status)                         → ProviderStatus
 */

import {
  type AIProvider,
  type ChatOptions,
  type ChatStructuredResponse,
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
import { collectAsyncGenerator } from "../../common/stream-utils.ts";

// ============================================================================
// Types
// ============================================================================

/** Chat options with optional cancellation signal */
type AiChatOptions = ChatOptions & { signal?: AbortSignal };

/** Shared shape for provider option normalization */
interface ProviderRequestOptions {
  model?: string;
  signal?: AbortSignal;
  raw?: Record<string, unknown>;
}

/** Options for the ai() callable */
export interface AiCallableOptions {
  /** Structured data to include in the prompt */
  data?: unknown;
  /** JSON schema — when provided, response is parsed as JSON */
  schema?: Record<string, unknown>;
  /** Model to use (e.g. "ollama/llama3.2", "anthropic/claude-3-haiku") */
  model?: string;
  /** System message prepended to the conversation */
  system?: string;
  /** Temperature for generation (0-1) */
  temperature?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/** Options for ai.agent() */
export interface AiAgentOptions {
  /** Structured data to include in the query */
  data?: unknown;
  /** Model to use */
  model?: string;
  /** Tool allowlist (only these tools available to agent) */
  tools?: string[];
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/** The callable ai function type — function + method properties */
export type AiApi = {
  (prompt: string, options?: AiCallableOptions): Promise<string | unknown>;
  chat: (
    messages: Message[],
    options?: AiChatOptions,
  ) => AsyncGenerator<string, void, unknown>;
  chatStructured: (
    messages: Message[],
    options?: AiChatOptions,
  ) => Promise<ChatStructuredResponse>;
  agent: (prompt: string, options?: AiAgentOptions) => Promise<string>;
  models: {
    list: (providerName?: string) => Promise<ModelInfo[]>;
    listAll: (options?: ModelListAllOptions) => Promise<ModelInfo[]>;
    get: (name: string, providerName?: string) => Promise<ModelInfo | null>;
    catalog: (providerName?: string) => Promise<ModelInfo[]>;
    pull: (
      name: string,
      providerName?: string,
      signal?: AbortSignal,
    ) => AsyncGenerator<PullProgress, void, unknown>;
    remove: (name: string, providerName?: string) => Promise<boolean>;
  };
  status: (providerName?: string) => Promise<ProviderStatus>;
};

// ============================================================================
// Internal Helpers
// ============================================================================

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

function getProviderByNameOrDefault(
  providerName?: string,
): AIProvider | null {
  return providerName ? getProvider(providerName) : getDefaultProvider();
}

function resolveModelName(model?: string): string | undefined {
  if (!model) return undefined;
  return parseModelString(model)[1] || undefined;
}

function toProviderOptions<T extends ProviderRequestOptions>(options?: T): T {
  return {
    ...options,
    model: resolveModelName(options?.model),
  } as T;
}

// ============================================================================
// Factory
// ============================================================================

function createAiApi(): AiApi {
  // ── The callable function ──────────────────────────────────────────
  const callable = async function ai(
    prompt: string,
    options?: AiCallableOptions,
  ): Promise<string | unknown> {
    const provider = getProviderOrThrow(options?.model);
    const opts = toProviderOptions({
      model: options?.model,
      signal: options?.signal,
      raw: options?.temperature != null
        ? { temperature: options.temperature }
        : undefined,
    });

    // Build user message content
    let content = prompt;
    if (options?.data != null) {
      content += "\n\nData:\n" + JSON.stringify(options.data, null, 2);
    }
    if (options?.schema != null) {
      content += "\n\nRespond with ONLY raw JSON (no markdown, no code fences, no explanation) matching this schema:\n" +
        JSON.stringify(options.schema);
    }

    const messages: Message[] = [];
    if (options?.system) {
      messages.push({ role: "system", content: options.system });
    }
    messages.push({ role: "user", content });

    const result = await collectAsyncGenerator(
      provider.chat(messages, opts),
      options?.signal,
    );

    // If schema was provided, parse as JSON
    if (options?.schema != null) {
      // Strip markdown code fences that models commonly wrap JSON in
      const cleaned = result.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
      try {
        return JSON.parse(cleaned);
      } catch {
        throw new ValidationError(
          `AI response is not valid JSON: ${result.slice(0, 200)}`,
          "ai_callable_schema",
        );
      }
    }

    return result;
  } as AiApi;

  // ── chat (streaming) ──────────────────────────────────────────────
  callable.chat = async function* (
    messages: Message[],
    options?: AiChatOptions,
  ): AsyncGenerator<string, void, unknown> {
    const provider = getProviderOrThrow(options?.model);
    const opts = toProviderOptions(options);
    yield* provider.chat(messages, opts);
  };

  // ── chatStructured ────────────────────────────────────────────────
  callable.chatStructured = async function (
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
  };

  // ── agent (ReAct loop) ────────────────────────────────────────────
  callable.agent = async function (
    prompt: string,
    options?: AiAgentOptions,
  ): Promise<string> {
    let query = prompt;
    if (options?.data != null) {
      query += "\n\nData:\n" + JSON.stringify(options.data, null, 2);
    }

    // Dynamic import to avoid circular deps (api/ → agent/ → ... → api/)
    const { runAgentQuery } = await import("../agent/agent-runner.ts");
    const result = await runAgentQuery({
      query,
      model: options?.model,
      callbacks: {},
      toolAllowlist: options?.tools,
      signal: options?.signal,
      noInput: true,
    });
    return result.text;
  };

  // ── models ────────────────────────────────────────────────────────
  callable.models = {
    list: (providerName?: string): Promise<ModelInfo[]> => {
      const provider = getProviderByNameOrDefault(providerName);
      return provider?.models?.list
        ? provider.models.list()
        : Promise.resolve([]);
    },

    listAll: async (options?: ModelListAllOptions): Promise<ModelInfo[]> => {
      return await listAllProviderModels(options);
    },

    get: (
      name: string,
      providerName?: string,
    ): Promise<ModelInfo | null> => {
      const [parsedProvider, parsedModel] = parseModelString(name);
      const resolvedProvider = providerName ?? parsedProvider ?? undefined;
      const resolvedName = providerName ? name : parsedModel;
      const provider = getProviderByNameOrDefault(resolvedProvider);
      return provider?.models?.get
        ? provider.models.get(resolvedName)
        : Promise.resolve(null);
    },

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

    remove: (name: string, providerName?: string): Promise<boolean> => {
      const provider = getProviderByNameOrDefault(providerName);
      return provider?.models?.remove
        ? provider.models.remove(name)
        : Promise.resolve(false);
    },
  };

  // ── status ────────────────────────────────────────────────────────
  callable.status = (providerName?: string): Promise<ProviderStatus> => {
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
  };

  return callable;
}

// ============================================================================
// Singleton Export
// ============================================================================

export const ai: AiApi = createAiApi();
export default ai;
