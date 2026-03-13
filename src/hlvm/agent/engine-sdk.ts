/**
 * SdkAgentEngine — Vercel AI SDK-powered AgentEngine implementation.
 *
 * Replaces hand-rolled provider plumbing (SSE parsing, message conversion,
 * token heuristics) with the Vercel AI SDK's generateText/streamText.
 *
 * Reuses existing HLVM functions:
 *   - buildToolDefinitions() from llm-integration.ts (tool schema building)
 *   - getClaudeCodeToken() from providers/claude-code/auth.ts (OAuth)
 */

import {
  generateText,
  InvalidToolInputError,
  NoSuchToolError,
  streamText,
  type ModelMessage,
  type ToolCallRepairFunction,
  type ToolSet,
} from "ai";
import type { LanguageModel } from "ai";
import type { AgentEngine, AgentLLMConfig, ToolFilterState } from "./engine.ts";
import type { LLMFunction } from "./orchestrator.ts";
import type { Message as AgentMessage } from "./context.ts";
import type { LLMResponse, ToolCall } from "./tool-call.ts";
import { buildToolDefinitions } from "./llm-integration.ts";
import { canonicalizeForSignature } from "./orchestrator-tool-formatting.ts";
import { getToolRegistryGeneration } from "./registry.ts";
import { normalizeToolArgs } from "./validation.ts";
import { ValidationError } from "../../common/error.ts";
import { getErrorMessage } from "../../common/utils.ts";
import { AI_NO_OUTPUT_FALLBACK_TEXT } from "../../common/ai-messages.ts";
import {
  getDefaultProvider,
  getProviderDefaultConfig,
  parseModelString,
} from "../providers/index.ts";
import type { ProviderConfig } from "../providers/types.ts";
import {
  assertSupportedSdkProvider,
  convertToolDefinitionsToSdk,
  convertToSdkMessages,
  createSdkLanguageModel,
  mapSdkSources,
  mapSdkUsage,
  maybeHandleSdkAuthError,
  normalizeProviderMetadata,
  type SdkModelSpec as SdkRuntimeModelSpec,
} from "../providers/sdk-runtime.ts";

// ============================================================
// Provider Model Factory
// ============================================================

/**
 * Map a "provider/model" string to an AI SDK LanguageModel instance.
 *
 * Examples:
 *   "ollama/llama3.1:8b"        → ollama("llama3.1:8b")
 *   "openai/gpt-4o"             → openai("gpt-4o")
 *   "anthropic/claude-sonnet-4-20250514" → anthropic("claude-sonnet-4-20250514")
 *   "google/gemini-2.5-flash"   → google("gemini-2.5-flash")
 *   "claude-code/claude-sonnet-4-20250514" → anthropic with OAuth token
 *   "llama3.1:8b" (no prefix)   → ollama("llama3.1:8b")
 */
interface ResolvedModelSpec {
  providerName: SdkRuntimeModelSpec["providerName"];
  modelId: string;
  providerConfig: ProviderConfig | null;
}

function resolveSdkModelSpec(modelString?: string): ResolvedModelSpec {
  if (!modelString) {
    throw new ValidationError(
      "Model string is required for SdkAgentEngine",
      "engine_sdk",
    );
  }
  const [parsedProvider, modelId] = parseModelString(modelString);
  const defaultProvider = getDefaultProvider()?.name ?? "ollama";
  const providerName = assertSupportedSdkProvider(
    (parsedProvider ?? defaultProvider).toLowerCase(),
  );
  return {
    providerName,
    modelId,
    providerConfig: getProviderDefaultConfig(providerName),
  };
}

export async function getSdkModel(
  modelString?: string,
): Promise<LanguageModel> {
  return await getSdkModelFromSpec(resolveSdkModelSpec(modelString));
}

function getSdkModelFromSpec(spec: ResolvedModelSpec): Promise<LanguageModel> {
  const runtimeSpec: SdkRuntimeModelSpec = {
    providerName: spec.providerName,
    modelId: spec.modelId,
    endpoint: spec.providerConfig?.endpoint,
    apiKey: spec.providerConfig?.apiKey,
  };
  return createSdkLanguageModel(runtimeSpec);
}

// ============================================================
// Response Mapping
// ============================================================

/** Map AI SDK tool call results → our ToolCall[] */
export function mapSdkToolCalls(
  calls: Array<{ toolCallId: string; toolName: string; input: unknown }>,
): ToolCall[] {
  return calls.map((call) => ({
    id: call.toolCallId,
    toolName: call.toolName,
    args: normalizeToolArgs(call.input),
  }));
}

// ============================================================
// SdkAgentEngine
// ============================================================

type ProviderOptionJson =
  | string
  | number
  | boolean
  | null
  | ProviderOptionJson[]
  | { [key: string]: ProviderOptionJson };

/** Provider options value type — must be JSON-serializable for the SDK. */
type ProviderOptionValue = { [key: string]: ProviderOptionJson };
type ProviderOptionsMap = Record<string, ProviderOptionValue>;

const ANTHROPIC_EPHEMERAL_CACHE: ProviderOptionsMap = {
  anthropic: { cacheControl: { type: "ephemeral" } },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeProviderOptions(
  base?: ProviderOptionsMap,
  extra?: ProviderOptionsMap,
): ProviderOptionsMap | undefined {
  if (!base && !extra) return undefined;
  const merged: ProviderOptionsMap = { ...(base ?? {}) };
  for (const [provider, options] of Object.entries(extra ?? {})) {
    const existing = isRecord(merged[provider]) ? merged[provider] : {};
    merged[provider] = {
      ...(existing as ProviderOptionValue),
      ...options,
    };
  }
  return merged;
}

function withProviderOptions<T extends object>(
  value: T,
  extra: ProviderOptionsMap,
): T {
  const record = value as Record<string, unknown>;
  const existing = isRecord(record.providerOptions)
    ? record.providerOptions as ProviderOptionsMap
    : undefined;
  return {
    ...value,
    providerOptions: mergeProviderOptions(existing, extra),
  } as T;
}

function withAnthropicCacheBreakpoint(message: ModelMessage): ModelMessage {
  if (message.role === "system") {
    return withProviderOptions(message, ANTHROPIC_EPHEMERAL_CACHE);
  }

  if (typeof message.content === "string") {
    return {
      ...message,
      content: [{
        type: "text",
        text: message.content,
        providerOptions: ANTHROPIC_EPHEMERAL_CACHE,
      }],
    } as ModelMessage;
  }

  if (Array.isArray(message.content) && message.content.length > 0) {
    const content = message.content.slice() as unknown[];
    const lastPart = content[content.length - 1];
    if (isRecord(lastPart)) {
      const existing = isRecord(lastPart.providerOptions)
        ? lastPart.providerOptions as ProviderOptionsMap
        : undefined;
      content[content.length - 1] = {
        ...lastPart,
        providerOptions: mergeProviderOptions(
          existing,
          ANTHROPIC_EPHEMERAL_CACHE,
        ),
      };
      return {
        ...message,
        content: content as ModelMessage["content"],
      } as ModelMessage;
    }
  }

  return withProviderOptions(message, ANTHROPIC_EPHEMERAL_CACHE);
}

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildStableSignature(value: unknown): string {
  return stableHash(JSON.stringify(canonicalizeForSignature(value)) ?? "null");
}

function buildOpenAIPromptCacheKey(
  spec: ResolvedModelSpec,
  systemPrompt: string,
  toolSchemaSignature: string,
  toolFilterSignature: string,
): string {
  return buildStableSignature([
    spec.providerName,
    spec.modelId,
    systemPrompt,
    toolSchemaSignature,
    toolFilterSignature,
  ]);
}

export function applyPromptCaching(
  spec: ResolvedModelSpec,
  messages: ModelMessage[],
  tools: ToolSet,
  providerOptions: ProviderOptionsMap | undefined,
  toolSchemaSignature: string,
  toolFilterSignature: string,
): {
  messages: ModelMessage[];
  tools: ToolSet;
  providerOptions?: ProviderOptionsMap;
} {
  let decoratedMessages = messages;
  let decoratedTools = tools;
  let decoratedProviderOptions = providerOptions;

  if (spec.providerName === "anthropic" || spec.providerName === "claude-code") {
    decoratedMessages = messages.slice();
    if (decoratedMessages[0]?.role === "system") {
      decoratedMessages[0] = withAnthropicCacheBreakpoint(decoratedMessages[0]);
    }
    if (decoratedMessages.length > 0) {
      const lastIndex = decoratedMessages.length - 1;
      decoratedMessages[lastIndex] = withAnthropicCacheBreakpoint(
        decoratedMessages[lastIndex],
      );
    }

    const toolNames = Object.keys(tools);
    if (toolNames.length > 0) {
      const lastToolName = toolNames[toolNames.length - 1];
      decoratedTools = {
        ...tools,
        [lastToolName]: withProviderOptions(
          tools[lastToolName],
          ANTHROPIC_EPHEMERAL_CACHE,
        ),
      };
    }
  }

  if (spec.providerName === "openai") {
    const systemPrompt = decoratedMessages[0]?.role === "system" &&
        typeof decoratedMessages[0].content === "string"
      ? decoratedMessages[0].content
      : "";
    decoratedProviderOptions = mergeProviderOptions(decoratedProviderOptions, {
      openai: {
        promptCacheKey: buildOpenAIPromptCacheKey(
          spec,
          systemPrompt,
          toolSchemaSignature,
          toolFilterSignature,
        ),
      },
    });
  }

  return {
    messages: decoratedMessages,
    tools: decoratedTools,
    providerOptions: decoratedProviderOptions,
  };
}

function tryParseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function repairMalformedToolCallInput(input: string): string | null {
  let candidate: unknown = input;
  for (let depth = 0; depth < 3 && typeof candidate === "string"; depth++) {
    const parsed = tryParseJsonObject(candidate.trim());
    if (parsed === candidate) break;
    candidate = parsed;
  }

  const normalized = normalizeToolArgs(candidate);
  return Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : null;
}

export function buildToolCallRepairFunction(): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, error }) => {
    if (NoSuchToolError.isInstance(error)) {
      return null;
    }
    if (!InvalidToolInputError.isInstance(error)) {
      return null;
    }
    const repairedInput = repairMalformedToolCallInput(toolCall.input);
    if (!repairedInput || repairedInput === toolCall.input) {
      return null;
    }
    return {
      ...toolCall,
      input: repairedInput,
    };
  };
}

/** Build provider-specific options (thinking, context budget, etc.) */
export function buildProviderOptions(
  spec: ResolvedModelSpec,
  config: AgentLLMConfig,
): Record<string, ProviderOptionValue> | undefined {
  const opts: Record<string, ProviderOptionValue> = {};

  // Ollama num_ctx
  if (
    spec.providerName === "ollama" &&
    typeof config.contextBudget === "number" &&
    config.contextBudget > 0
  ) {
    opts.ollama = { num_ctx: Math.floor(config.contextBudget) };
  }

  // Thinking — prefer explicit capability flags, then fall back to known
  // provider/model families until provider model catalogs expose this reliably.
  if (shouldEnableNativeThinking(spec, config)) {
    switch (spec.providerName) {
      case "anthropic":
      case "claude-code":
        opts.anthropic = { thinking: { type: "enabled", budgetTokens: 10000 } };
        break;
      case "openai":
        opts.openai = { reasoningEffort: "high" };
        break;
      case "google":
        opts.google = { thinkingConfig: { includeThoughts: true, thinkingLevel: "low" } };
        break;
    }
  }

  return Object.keys(opts).length > 0 ? opts : undefined;
}

function shouldEnableNativeThinking(
  spec: ResolvedModelSpec,
  config: AgentLLMConfig,
): boolean {
  if (config.thinkingCapable) return true;

  const modelId = spec.modelId.toLowerCase();
  switch (spec.providerName) {
    case "anthropic":
    case "claude-code":
      return modelId.startsWith("claude-");
    case "openai":
      return /^o[134]/.test(modelId) || modelId.startsWith("gpt-5");
    case "google":
      return modelId.startsWith("gemini-2.5");
    default:
      return false;
  }
}

export function extractReasoningText(reasoning: unknown): string | undefined {
  if (typeof reasoning === "string") {
    const trimmed = reasoning.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (!Array.isArray(reasoning)) return undefined;

  const parts: string[] = [];
  for (const item of reasoning) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.text === "string" && record.text.length > 0) {
      parts.push(record.text);
      continue;
    }
    if (typeof record.content === "string" && record.content.length > 0) {
      parts.push(record.content);
    }
  }

  const joined = parts.join("").trim();
  return joined.length > 0 ? joined : undefined;
}

export class SdkAgentEngine implements AgentEngine {
  createLLM(config: AgentLLMConfig): LLMFunction {
    // Hoisted: resolved once per createLLM() call (same config → same spec)
    const spec = resolveSdkModelSpec(config.model);
    let cachedModel: LanguageModel | null = null;
    const shouldCacheModel = spec.providerName !== "claude-code";

    // Provider options (thinking, context budget, etc.) — stable across calls
    const providerOptions = buildProviderOptions(spec, config);
    const repairToolCall = buildToolCallRepairFunction();

    // Tool cache: rebuilt only when registry generation changes
    let cachedSdkTools: ToolSet = {};
    let lastToolGeneration = -1;
    let lastToolFilterSignature = "";
    let lastToolSchemaSignature = "";

    const resolveToolFilters = (): ToolFilterState => {
      if (config.toolFilterState) return config.toolFilterState;
      return {
        allowlist: config.toolAllowlist,
        denylist: config.toolDenylist,
      };
    };

    const serializeToolFilters = (filters: ToolFilterState): string => {
      return JSON.stringify([
        filters.allowlist ?? null,
        filters.denylist ?? null,
      ]);
    };

    return async (
      messages: AgentMessage[],
      signal?: AbortSignal,
    ): Promise<LLMResponse> => {
      if (shouldCacheModel && !cachedModel) {
        cachedModel = await getSdkModelFromSpec(spec);
      }
      const model = shouldCacheModel && cachedModel
        ? cachedModel
        : await getSdkModelFromSpec(spec);
      const sdkMessages = convertToSdkMessages(messages);

      const generation = getToolRegistryGeneration();
      const toolFilters = resolveToolFilters();
      const toolFilterSignature = serializeToolFilters(toolFilters);
      if (
        generation !== lastToolGeneration ||
        toolFilterSignature !== lastToolFilterSignature
      ) {
        const toolDefs = buildToolDefinitions({
          allowlist: toolFilters.allowlist,
          denylist: toolFilters.denylist,
          ownerId: config.toolOwnerId,
        });
        cachedSdkTools = convertToolDefinitionsToSdk(toolDefs) ?? {};
        lastToolSchemaSignature = buildStableSignature(toolDefs.map((def) => ({
          name: def.function.name,
          description: def.function.description ?? "",
          parameters: def.function.parameters,
        })));
        lastToolGeneration = generation;
        lastToolFilterSignature = toolFilterSignature;
      }

      const cacheDecorated = applyPromptCaching(
        spec,
        sdkMessages,
        cachedSdkTools,
        providerOptions,
        lastToolSchemaSignature,
        toolFilterSignature,
      );

      const commonOpts = {
        model,
        messages: cacheDecorated.messages,
        tools: cacheDecorated.tools,
        temperature: config.options?.temperature ?? 0.0,
        maxTokens: config.options?.maxTokens,
        abortSignal: signal,
        experimental_repairToolCall: repairToolCall,
        ...(cacheDecorated.providerOptions
          ? { providerOptions: cacheDecorated.providerOptions }
          : {}),
      };

      try {
        if (config.onToken) {
          // Streaming path
          const result = streamText(commonOpts);

          // Feed tokens to callback as they arrive
          const chunks: string[] = [];
          for await (const chunk of result.textStream) {
            chunks.push(chunk);
            config.onToken(chunk);
          }

          // streamText properties are PromiseLike — await them
          const [
            toolCalls, usage, text, sources, providerMetadata, reasoning,
            response,
          ] = await Promise.all([
            result.toolCalls,
            result.usage,
            result.text,
            result.sources,
            result.providerMetadata,
            result.reasoning,
            result.response,
          ]);

          return {
            content: chunks.join("") || text || "",
            toolCalls: mapSdkToolCalls(toolCalls),
            usage: mapSdkUsage(usage),
            sources: mapSdkSources(sources),
            providerMetadata: normalizeProviderMetadata(providerMetadata),
            reasoning: extractReasoningText(reasoning),
            sdkResponseMessages: response?.messages,
          };
        }

        // Non-streaming path — generateText returns resolved values directly
        const result = await generateText(commonOpts);
        return {
          content: result.text || "",
          toolCalls: mapSdkToolCalls(result.toolCalls),
          usage: mapSdkUsage(result.usage),
          sources: mapSdkSources(result.sources),
          providerMetadata: normalizeProviderMetadata(result.providerMetadata),
          reasoning: extractReasoningText(result.reasoning),
          sdkResponseMessages: result.response?.messages,
        };
      } catch (error) {
        await maybeHandleSdkAuthError(spec.providerName, error);
        const message = getErrorMessage(error);
        if (message.includes("No output generated")) {
          let fallbackText = "";
          let fallbackCalls: ToolCall[] = [];
          let fallbackUsage:
            | { inputTokens: number; outputTokens: number }
            | undefined;
          let fallbackSources;
          let fallbackProviderMetadata;

          try {
            const fallback = await generateText(commonOpts);
            fallbackText = (fallback.text || "").trim();
            fallbackCalls = mapSdkToolCalls(fallback.toolCalls);
            fallbackUsage = mapSdkUsage(fallback.usage);
            fallbackSources = mapSdkSources(fallback.sources);
            fallbackProviderMetadata = normalizeProviderMetadata(
              fallback.providerMetadata,
            );
          } catch (fallbackError) {
            await maybeHandleSdkAuthError(spec.providerName, fallbackError);
          }

          if (fallbackText.length === 0 && fallbackCalls.length === 0) {
            fallbackText = AI_NO_OUTPUT_FALLBACK_TEXT;
          }
          if (config.onToken && fallbackText.length > 0) {
            config.onToken(fallbackText);
          }

          return {
            content: fallbackText,
            toolCalls: fallbackCalls,
            usage: fallbackUsage,
            sources: fallbackSources,
            providerMetadata: fallbackProviderMetadata,
          };
        }
        throw error;
      }
    };
  }

  createSummarizer(model?: string) {
    return async (messages: AgentMessage[]): Promise<string> => {
      const sdkModel = await getSdkModel(model);

      const formatted = messages
        .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
        .join("\n");

      const prompt =
        `Summarize this conversation in 2-3 sentences. Focus on: what was asked, what tools were used, what results were found. Be concise.\n\nConversation:\n${formatted}`;

      const result = await generateText({
        model: sdkModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.0,
      });

      return result.text.trim();
    };
  }
}
