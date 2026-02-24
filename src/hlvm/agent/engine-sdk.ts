/**
 * SdkAgentEngine — Vercel AI SDK-powered AgentEngine implementation.
 *
 * Replaces hand-rolled provider plumbing (SSE parsing, message conversion,
 * token heuristics) with the Vercel AI SDK's generateText/streamText.
 *
 * Reuses existing project functions:
 *   - buildToolDefinitions() from llm-integration.ts (tool schema building)
 *   - getClaudeCodeToken() from providers/claude-code/auth.ts (OAuth)
 */

import { generateText, streamText } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import type {
  AgentEngine,
  AgentLLMConfig,
  ToolFilterState,
} from "./engine.ts";
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
  convertToSdkMessages,
  convertToolDefinitionsToSdk,
  createSdkLanguageModel,
  mapSdkUsage,
  maybeHandleSdkAuthError,
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

export class SdkAgentEngine implements AgentEngine {
  createLLM(config: AgentLLMConfig): LLMFunction {
    // Hoisted: resolved once per createLLM() call (same config → same spec)
    const spec = resolveSdkModelSpec(config.model);
    let cachedModel: LanguageModel | null = null;
    const shouldCacheModel = spec.providerName !== "claude-code";

    // Ollama context budget hint (stable across calls)
    const numCtx = spec.providerName === "ollama" &&
        typeof config.contextBudget === "number" &&
        config.contextBudget > 0
      ? Math.floor(config.contextBudget)
      : undefined;

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
        ...(numCtx ? { providerOptions: { ollama: { num_ctx: numCtx } } } : {}),
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
          const [toolCalls, usage, text] = await Promise.all([
            result.toolCalls,
            result.usage,
            result.text,
          ]);

          return {
            content: chunks.join("") || text || "",
            toolCalls: mapSdkToolCalls(toolCalls),
            usage: mapSdkUsage(usage),
          };
        }

        // Non-streaming path — generateText returns resolved values directly
        const result = await generateText(commonOpts);
        return {
          content: result.text || "",
          toolCalls: mapSdkToolCalls(result.toolCalls),
          usage: mapSdkUsage(result.usage),
        };
      } catch (error) {
        await maybeHandleSdkAuthError(spec.providerName, error);
        const message = getErrorMessage(error);
        if (message.includes("No output generated")) {
          let fallbackText = "";
          let fallbackCalls: ToolCall[] = [];
          let fallbackUsage: { inputTokens: number; outputTokens: number } | undefined;

          try {
            const fallback = await generateText(commonOpts);
            fallbackText = (fallback.text || "").trim();
            fallbackCalls = mapSdkToolCalls(fallback.toolCalls);
            fallbackUsage = mapSdkUsage(fallback.usage);
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
