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
  chat: (messages: Message[], options?: ChatOptions) => AsyncGenerator<string, void, unknown>;
  chatStructured: (messages: Message[], options?: ChatOptions) => Promise<ChatStructuredResponse>;
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

/** Default max output tokens for the simple `ai()` callable (Anthropic requires max_tokens). */
const DEFAULT_AI_MAX_TOKENS = 4096;

type StructuredGenerationDeps = {
  generateStructuredWithSdk: (
    spec: import("../providers/sdk-runtime.ts").SdkModelSpec,
    messages: Message[],
    schema: Record<string, unknown>,
    options?: { signal?: AbortSignal; temperature?: number },
  ) => Promise<unknown>;
  generateStructuredWithPromptFallback: (
    spec: import("../providers/sdk-runtime.ts").SdkModelSpec,
    messages: Message[],
    schema: Record<string, unknown>,
    options?: { signal?: AbortSignal; temperature?: number; maxRetries?: number },
  ) => Promise<unknown>;
};

let structuredGenerationDepsForTesting: Partial<StructuredGenerationDeps> | null =
  null;

async function getStructuredGenerationDeps(): Promise<StructuredGenerationDeps> {
  const sdkRuntime = await import("../providers/sdk-runtime.ts");
  const promptFallback = await import(
    "../providers/structured-output-fallback.ts"
  );
  return {
    generateStructuredWithSdk: structuredGenerationDepsForTesting
        ?.generateStructuredWithSdk ??
      sdkRuntime.generateStructuredWithSdk,
    generateStructuredWithPromptFallback: structuredGenerationDepsForTesting
        ?.generateStructuredWithPromptFallback ??
      promptFallback.generateStructuredWithPromptFallback,
  };
}

export function __setStructuredGenerationDepsForTesting(
  overrides: Partial<StructuredGenerationDeps> | null,
): void {
  structuredGenerationDepsForTesting = overrides;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * SSOT model resolution — shared by ALL ai() code paths.
 * Priority: explicit model arg → persisted config → undefined (use default provider).
 */
async function resolveModelString(explicitModel?: string): Promise<string | undefined> {
  if (explicitModel) return explicitModel;
  try {
    const { loadConfig } = await import("../../common/config/storage.ts");
    const { getConfiguredModel } = await import(
      "../../common/config/selectors.ts"
    );
    const model = getConfiguredModel(await loadConfig());
    // Only use config model if its provider is actually registered
    return getProviderForModel(model) ? model : undefined;
  } catch {
    // No config file (e.g., test environment) — fall through to default provider
    return undefined;
  }
}

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

/** Resolve provider by name (for models/status), falling back to default */
function providerByName(name?: string): AIProvider | undefined {
  return (name ? getProvider(name) : getDefaultProvider()) ?? undefined;
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

/** Build messages array from prompt + options (shared by schema + text paths) */
function buildMessages(
  prompt: string,
  options?: { system?: string; data?: unknown },
): Message[] {
  const messages: Message[] = [];
  if (options?.system) {
    messages.push({ role: "system", content: options.system });
  }
  messages.push({ role: "user", content: buildPrompt(prompt, options?.data) });
  return messages;
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
    // Single SSOT model resolution for ALL paths
    const modelString = await resolveModelString(options?.model);

    // Structured output path: provider-native constrained decoding → prompt-based fallback
    if (options?.schema != null) {
      const { descriptorToJsonSchema } = await import(
        "./schema-to-json-schema.ts"
      );
      const { resolveSdkModelSpec, toSdkRuntimeModelSpec } = await import(
        "../agent/engine-sdk.ts"
      );
      const deps = await getStructuredGenerationDeps();
      const spec = toSdkRuntimeModelSpec(resolveSdkModelSpec(modelString));
      const jsonSchema = descriptorToJsonSchema(options.schema) as Record<string, unknown>;
      const sdkOpts = { signal: options.signal, temperature: options.temperature };

      // Tier 1: provider-native constrained decoding
      try {
        return await deps.generateStructuredWithSdk(
          spec,
          buildMessages(prompt, options),
          jsonSchema,
          sdkOpts,
        );
      } catch {
        // Tier 3: hlvm-local prompt-based fallback
        return await deps.generateStructuredWithPromptFallback(
          spec,
          buildMessages(prompt, options),
          jsonSchema,
          sdkOpts,
        );
      }
    }

    // Plain text path: use provider.chat() with the same SSOT model
    const provider = resolveProvider(modelString);
    return await collectAsyncGenerator(
      provider.chat(buildMessages(prompt, options), {
        model: localModelName(modelString),
        maxTokens: DEFAULT_AI_MAX_TOKENS,
        signal: options?.signal,
        ...(options?.temperature != null && { raw: { temperature: options.temperature } }),
      }),
      options?.signal,
    );
  } as AiApi;

  // ── chat (streaming) ──────────────────────────────────────────────
  callable.chat = async function* (
    messages: Message[],
    options?: ChatOptions,
  ): AsyncGenerator<string, void, unknown> {
    const provider = resolveProvider(options?.model);
    yield* provider.chat(messages, { ...options, model: localModelName(options?.model) });
  };

  // ── chatStructured ────────────────────────────────────────────────
  callable.chatStructured = async function (
    messages: Message[],
    options?: ChatOptions,
  ): Promise<ChatStructuredResponse> {
    const provider = resolveProvider(options?.model);
    if (!provider.chatStructured) {
      throw new ValidationError(
        `Provider "${provider.name}" does not support native tool calling.`,
        "ai_chat_structured",
      );
    }
    return provider.chatStructured(messages, { ...options, model: localModelName(options?.model) });
  };

  // ── agent (ReAct loop) ────────────────────────────────────────────
  callable.agent = async function (
    prompt: string,
    options?: AiAgentOptions,
  ): Promise<string> {
    const { runAgentQuery } = await import("../agent/agent-runner.ts");
    const resolvedModel = await resolveModelString(options?.model);
    const result = await runAgentQuery({
      query: buildPrompt(prompt, options?.data),
      model: resolvedModel,
      callbacks: {},
      toolAllowlist: options?.tools,
      signal: options?.signal,
      noInput: true,
    });
    return result.text;
  };

  // ── models ────────────────────────────────────────────────────────
  callable.models = {
    list: (providerName?: string) =>
      providerByName(providerName)?.models?.list?.() ?? Promise.resolve([]),

    listAll: (options?: ModelListAllOptions) => listAllProviderModels(options),

    get(name: string, providerName?: string): Promise<ModelInfo | null> {
      const [parsed, model] = parseModelString(name);
      const p = providerByName(providerName) ?? (parsed ? getProvider(parsed) ?? undefined : undefined);
      return p?.models?.get?.(providerName ? name : model) ?? Promise.resolve(null);
    },

    async catalog(providerName?: string): Promise<ModelInfo[]> {
      const resolved = providerName ?? providerByName()?.name;
      const snapshot = await readStaleWhileRevalidateModelDiscoverySnapshot();
      if (!resolved || resolved === "ollama") return snapshot.remoteModels;
      return snapshot.cloudModels.filter((m) => m.metadata?.provider === resolved);
    },

    async *pull(name: string, providerName?: string, signal?: AbortSignal): AsyncGenerator<PullProgress, void, unknown> {
      const p = providerByName(providerName);
      if (!p?.models?.pull) {
        throw new ValidationError("Provider does not support model pulling", "ai.models.pull");
      }
      yield* p.models.pull(name, signal);
    },

    remove: (name: string, providerName?: string) =>
      providerByName(providerName)?.models?.remove?.(name) ?? Promise.resolve(false),
  };

  // ── status ────────────────────────────────────────────────────────
  callable.status = (providerName?: string): Promise<ProviderStatus> => {
    const p = providerByName(providerName);
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
