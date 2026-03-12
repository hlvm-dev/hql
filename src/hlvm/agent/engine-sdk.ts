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

import { generateText, streamText } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import type { AgentEngine, AgentLLMConfig, ToolFilterState } from "./engine.ts";
import type { LLMFunction } from "./orchestrator.ts";
import type { Message as AgentMessage } from "./context.ts";
import type { LLMResponse, ToolCall } from "./tool-call.ts";
import { buildToolDefinitions } from "./llm-integration.ts";
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

    // Tool cache: rebuilt only when registry generation changes
    let cachedSdkTools: ToolSet = {};
    let lastToolGeneration = -1;
    let lastToolFilterSignature = "";

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
        lastToolGeneration = generation;
        lastToolFilterSignature = toolFilterSignature;
      }

      const commonOpts = {
        model,
        messages: sdkMessages,
        tools: cachedSdkTools,
        temperature: config.options?.temperature ?? 0.0,
        maxTokens: config.options?.maxTokens,
        abortSignal: signal,
        ...(providerOptions ? { providerOptions } : {}),
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
          const [toolCalls, usage, text, sources, providerMetadata, reasoning] =
            await Promise.all([
              result.toolCalls,
              result.usage,
              result.text,
              result.sources,
              result.providerMetadata,
              result.reasoning,
            ]);

          return {
            content: chunks.join("") || text || "",
            toolCalls: mapSdkToolCalls(toolCalls),
            usage: mapSdkUsage(usage),
            sources: mapSdkSources(sources),
            providerMetadata: normalizeProviderMetadata(providerMetadata),
            reasoning: extractReasoningText(reasoning),
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
