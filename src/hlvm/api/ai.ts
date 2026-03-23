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

type AiChatOptions = ChatOptions & { signal?: AbortSignal };

/** Options for ai() callable */
export interface AiCallableOptions {
  data?: unknown;
  schema?: Record<string, unknown>;
  model?: string;
  system?: string;
  temperature?: number;
  signal?: AbortSignal;
}

/** Options for ai.agent() */
export interface AiAgentOptions {
  data?: unknown;
  model?: string;
  tools?: string[];
  signal?: AbortSignal;
}

/** The callable ai function type */
export type AiApi = {
  (prompt: string, options?: AiCallableOptions): Promise<string | unknown>;
  chat: (messages: Message[], options?: AiChatOptions) => AsyncGenerator<string, void, unknown>;
  chatStructured: (messages: Message[], options?: AiChatOptions) => Promise<ChatStructuredResponse>;
  agent: (prompt: string, options?: AiAgentOptions) => Promise<string>;
  models: {
    list: (providerName?: string) => Promise<ModelInfo[]>;
    listAll: (options?: ModelListAllOptions) => Promise<ModelInfo[]>;
    get: (name: string, providerName?: string) => Promise<ModelInfo | null>;
    catalog: (providerName?: string) => Promise<ModelInfo[]>;
    pull: (name: string, providerName?: string, signal?: AbortSignal) => AsyncGenerator<PullProgress, void, unknown>;
    remove: (name: string, providerName?: string) => Promise<boolean>;
  };
  status: (providerName?: string) => Promise<ProviderStatus>;
};

// ============================================================================
// Helpers
// ============================================================================

/** Resolve "provider/model" → provider instance, or throw */
function resolveProvider(modelString?: string): AIProvider {
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

/** Extract provider-local model name: "ollama/llama3.2" → "llama3.2" */
function localModelName(model?: string): string | undefined {
  return model ? (parseModelString(model)[1] || undefined) : undefined;
}

/** Build prompt with optional data injection (shared by callable + agent) */
function buildPrompt(prompt: string, data?: unknown): string {
  return data != null
    ? prompt + "\n\nData:\n" + JSON.stringify(data, null, 2)
    : prompt;
}

/** Strip markdown code fences that LLMs commonly wrap JSON in */
function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

// ============================================================================
// Factory
// ============================================================================

function createAiApi(): AiApi {
  // ── The callable ───────────────────────────────────────────────────
  const callable = async function ai(
    prompt: string,
    options?: AiCallableOptions,
  ): Promise<string | unknown> {
    const provider = resolveProvider(options?.model);

    let content = buildPrompt(prompt, options?.data);
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
      provider.chat(messages, {
        model: localModelName(options?.model),
        signal: options?.signal,
        ...(options?.temperature != null && { raw: { temperature: options.temperature } }),
      }),
      options?.signal,
    );

    if (options?.schema != null) {
      const cleaned = stripCodeFences(result);
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
    const provider = resolveProvider(options?.model);
    yield* provider.chat(messages, { ...options, model: localModelName(options?.model) });
  };

  // ── chatStructured ────────────────────────────────────────────────
  callable.chatStructured = async function (
    messages: Message[],
    options?: AiChatOptions,
  ): Promise<ChatStructuredResponse> {
    const provider = resolveProvider(options?.model);
    if (!provider.chatStructured) {
      throw new ValidationError(
        `Provider "${provider.name}" does not support native tool calling.`,
        "ai_chat_structured",
      );
    }
    return await provider.chatStructured(messages, { ...options, model: localModelName(options?.model) });
  };

  // ── agent (ReAct loop) ────────────────────────────────────────────
  callable.agent = async function (
    prompt: string,
    options?: AiAgentOptions,
  ): Promise<string> {
    const { runAgentQuery } = await import("../agent/agent-runner.ts");
    const result = await runAgentQuery({
      query: buildPrompt(prompt, options?.data),
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
    list(providerName?: string): Promise<ModelInfo[]> {
      const p = providerName ? getProvider(providerName) : getDefaultProvider();
      return p?.models?.list ? p.models.list() : Promise.resolve([]);
    },

    async listAll(options?: ModelListAllOptions): Promise<ModelInfo[]> {
      return await listAllProviderModels(options);
    },

    get(name: string, providerName?: string): Promise<ModelInfo | null> {
      const [parsed, model] = parseModelString(name);
      const p = (providerName ? getProvider(providerName) : getDefaultProvider()) ??
        (parsed ? getProvider(parsed) : null);
      return p?.models?.get ? p.models.get(providerName ? name : model) : Promise.resolve(null);
    },

    async catalog(providerName?: string): Promise<ModelInfo[]> {
      const resolved = providerName ?? getDefaultProvider()?.name;
      const snapshot = await readStaleWhileRevalidateModelDiscoverySnapshot();
      if (!resolved || resolved === "ollama") return snapshot.remoteModels;
      return snapshot.cloudModels.filter((m) => m.metadata?.provider === resolved);
    },

    async *pull(name: string, providerName?: string, signal?: AbortSignal): AsyncGenerator<PullProgress, void, unknown> {
      const p = providerName ? getProvider(providerName) : getDefaultProvider();
      if (!p?.models?.pull) {
        throw new ValidationError("Provider does not support model pulling", "ai.models.pull");
      }
      yield* p.models.pull(name, signal);
    },

    remove(name: string, providerName?: string): Promise<boolean> {
      const p = providerName ? getProvider(providerName) : getDefaultProvider();
      return p?.models?.remove ? p.models.remove(name) : Promise.resolve(false);
    },
  };

  // ── status ────────────────────────────────────────────────────────
  callable.status = (providerName?: string): Promise<ProviderStatus> => {
    const p = providerName ? getProvider(providerName) : getDefaultProvider();
    if (!p) {
      return Promise.resolve({
        available: false,
        error: providerName ? `Provider '${providerName}' not found` : "No default provider configured",
      });
    }
    return p.status();
  };

  return callable;
}

// ============================================================================
// Singleton
// ============================================================================

export const ai: AiApi = createAiApi();
export default ai;
