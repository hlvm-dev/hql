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
  type ModelMessage,
  NoSuchToolError,
  streamText,
  type SystemModelMessage,
  type ToolCallRepairFunction,
  type ToolSet,
} from "ai";
import { fnv1aHex } from "../../common/hash.ts";
import type { LanguageModel } from "ai";
import type { AgentEngine, AgentLLMConfig, ToolFilterState } from "./engine.ts";
import type { LLMFunction } from "./orchestrator.ts";
import type { Message as AgentMessage } from "./context.ts";
import type {
  LLMCompletionState,
  LLMPerformance,
  LLMResponse,
  ToolCall,
} from "./tool-call.ts";
import { buildToolDefinitions } from "./llm-integration.ts";
import { canonicalizeForSignature } from "./orchestrator-tool-formatting.ts";
import { getToolRegistryGeneration } from "./registry.ts";
import { normalizeToolArgs } from "./validation.ts";
import { RuntimeError, ValidationError } from "../../common/error.ts";
import { getErrorMessage } from "../../common/utils.ts";
import { AI_NO_OUTPUT_FALLBACK_TEXT } from "../../common/ai-messages.ts";
import { ProviderErrorCode } from "../../common/error-codes.ts";
import { buildCompactionPrompt } from "./compaction-template.ts";
import { isMainThreadQuerySource } from "./query-tool-routing.ts";
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
  createSdkProviderBundle,
  mapSdkSources,
  mapSdkUsage,
  maybeHandleSdkAuthError,
  normalizeProviderCacheMetrics,
  normalizeProviderMetadata,
  resolveSdkStreamFailure,
  type SdkModelSpec as SdkRuntimeModelSpec,
  type SdkProviderBundle,
} from "../providers/sdk-runtime.ts";
import {
  resolveThinkingProfile,
  supportsNativeThinking,
} from "./thinking-profile.ts";
export { resolveThinkingProfile } from "./thinking-profile.ts";

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
export interface ResolvedModelSpec {
  providerName: SdkRuntimeModelSpec["providerName"];
  modelId: string;
  providerConfig: ProviderConfig | null;
}

export function resolveSdkModelSpec(modelString?: string): ResolvedModelSpec {
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

export function toSdkRuntimeModelSpec(
  spec: ResolvedModelSpec,
): SdkRuntimeModelSpec {
  return {
    providerName: spec.providerName,
    modelId: spec.modelId,
    endpoint: spec.providerConfig?.endpoint,
    apiKey: spec.providerConfig?.apiKey,
  };
}

export async function getSdkModel(
  modelString?: string,
): Promise<LanguageModel> {
  return await getSdkModelFromSpec(resolveSdkModelSpec(modelString));
}

function getSdkModelFromSpec(spec: ResolvedModelSpec): Promise<LanguageModel> {
  return createSdkLanguageModel(toSdkRuntimeModelSpec(spec));
}

async function getSdkProviderBundleFromSpec(
  spec: ResolvedModelSpec,
): Promise<SdkProviderBundle> {
  return await createSdkProviderBundle(toSdkRuntimeModelSpec(spec));
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
type SystemPromptValue = string | SystemModelMessage[];

function buildAnthropicEphemeralCache(
  querySource?: string,
): ProviderOptionsMap {
  return {
    anthropic: {
      cacheControl: isMainThreadQuerySource(querySource)
        ? { type: "ephemeral", ttl: "1h" }
        : { type: "ephemeral" },
    },
  };
}

// ----------- Google explicit caching -----------
// Google uses a fundamentally different caching model than Anthropic/OpenAI:
//   Anthropic: hint-based ephemeral breakpoints on messages (synchronous decoration)
//   OpenAI:    stable cache key as provider option (synchronous)
//   Google:    explicit server-side cache object with TTL (async API call)
// The cache is created lazily at session level and reused while the stable
// prompt signature is unchanged.

/** Minimum system prompt length (chars) to attempt Google explicit caching.
 *  Google requires substantial content (~32K tokens) for caching to be accepted. */
const GOOGLE_CACHE_MIN_CHARS = 32_000;

/** Default TTL for Google cached content (1 hour). */
const GOOGLE_CACHE_TTL = "3600s";

/** Session-scoped Google cache registry. Maps modelId → cache name + signature. */
const googleCacheRegistry = new Map<
  string,
  { name: string; signatureHash: string }
>();

/**
 * Lazily creates or reuses a Google explicit cache for the stable system prompt.
 * Returns the cache name to pass via `providerOptions.google.cachedContent`,
 * or undefined if caching is not applicable or creation failed.
 */
export async function resolveGoogleCachedContent(
  spec: ResolvedModelSpec,
  system: SystemPromptValue | undefined,
  cacheProfile: ResolvedPromptCacheProfile,
): Promise<string | undefined> {
  if (spec.providerName !== "google") return undefined;

  // Reuse existing cache if stable signature hasn't changed
  const existing = googleCacheRegistry.get(spec.modelId);
  if (existing?.signatureHash === cacheProfile.stableCacheSignatureHash) {
    return existing.name;
  }

  // Google explicit caching only makes sense for large prompts
  const systemText = flattenSystemPrompt(system);
  if (!systemText || systemText.length < GOOGLE_CACHE_MIN_CHARS) {
    return undefined;
  }

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const apiKey = spec.providerConfig?.apiKey ?? "";
    const ai = new GoogleGenAI({ apiKey });

    const cache = await ai.caches.create({
      model: spec.modelId,
      config: {
        contents: [{ role: "user", parts: [{ text: systemText }] }],
        ttl: GOOGLE_CACHE_TTL,
      },
    });

    if (cache.name) {
      googleCacheRegistry.set(spec.modelId, {
        name: cache.name,
        signatureHash: cacheProfile.stableCacheSignatureHash,
      });
      return cache.name;
    }
  } catch {
    // Cache creation is best-effort — don't block LLM calls on failure
  }
  return undefined;
}

/** Clear Google cache registry (for testing). */
export function clearGoogleCacheRegistry(): void {
  googleCacheRegistry.clear();
}

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

function withAnthropicCacheBreakpoint(
  message: ModelMessage,
  querySource?: string,
): ModelMessage {
  const anthropicCache = buildAnthropicEphemeralCache(querySource);
  if (message.role === "system") {
    return withProviderOptions(message, anthropicCache);
  }

  if (typeof message.content === "string") {
    return {
      ...message,
      content: [{
        type: "text",
        text: message.content,
        providerOptions: anthropicCache,
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
          anthropicCache,
        ),
      };
      return {
        ...message,
        content: content as ModelMessage["content"],
      } as ModelMessage;
    }
  }

  return withProviderOptions(message, anthropicCache);
}

function buildStableSignature(value: unknown): string {
  return fnv1aHex(JSON.stringify(canonicalizeForSignature(value)) ?? "null");
}

interface ResolvedPromptCacheProfile {
  stableSegmentCount: number;
  stablePromptSignature: readonly string[];
  stableCacheSignatureHash: string;
}

function buildOpenAIPromptCacheKey(
  spec: ResolvedModelSpec,
  stablePromptSignature: readonly string[],
  toolSchemaSignature: string,
  toolFilterSignature: string,
): string {
  return buildStableSignature([
    spec.providerName,
    spec.modelId,
    stablePromptSignature,
    toolSchemaSignature,
    toolFilterSignature,
  ]);
}

function flattenSystemPrompt(system: SystemPromptValue | undefined): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system.map((message) => message.content).join("\n\n");
}

function resolvePromptCacheProfile(
  compiledPrompt: AgentLLMConfig["compiledPrompt"],
  system: SystemPromptValue | undefined,
): ResolvedPromptCacheProfile {
  const stableSegmentCount = compiledPrompt?.stableCacheProfile.stableSegmentCount ??
    0;
  const stablePromptSignature =
    compiledPrompt?.stableCacheProfile.stableSegmentHashes?.length
      ? compiledPrompt.stableCacheProfile.stableSegmentHashes
      : [flattenSystemPrompt(system)];

  return {
    stableSegmentCount,
    stablePromptSignature,
    stableCacheSignatureHash: compiledPrompt?.stableCacheProfile
        .stableSignatureHash ??
      buildStableSignature(stablePromptSignature),
  };
}

function buildSystemPromptValue(
  messages: AgentMessage[],
  compiledPrompt: AgentLLMConfig["compiledPrompt"],
): {
  system?: SystemPromptValue;
  messages: ModelMessage[];
} {
  const systemMessages = messages.filter((message) => message.role === "system")
    .filter((message) => message.content.length > 0);
  const nonSystemMessages = messages.filter((message) => message.role !== "system");
  const sdkMessages = convertToSdkMessages(nonSystemMessages);

  if (systemMessages.length === 0) {
    return { messages: sdkMessages };
  }

  const system: SystemModelMessage[] = [];
  let expandedCompiledPrompt = false;

  for (const message of systemMessages) {
    if (
      !expandedCompiledPrompt &&
      compiledPrompt &&
      message.content === compiledPrompt.text &&
      compiledPrompt.cacheSegments.length > 0
    ) {
      for (const segment of compiledPrompt.cacheSegments) {
        system.push({
          role: "system",
          content: segment.text,
        });
      }
      expandedCompiledPrompt = true;
      continue;
    }
    system.push({ role: "system", content: message.content });
  }

  if (!expandedCompiledPrompt && system.length === 1) {
    return { system: system[0].content, messages: sdkMessages };
  }

  return { system, messages: sdkMessages };
}

function withAnthropicSystemCacheBreakpoints(
  system: SystemPromptValue | undefined,
  stableSegmentCount: number,
  querySource?: string,
): SystemPromptValue | undefined {
  if (!system) return undefined;
  const anthropicCache = buildAnthropicEphemeralCache(querySource);

  const systemMessages = typeof system === "string"
    ? [{ role: "system", content: system } satisfies SystemModelMessage]
    : system.slice();
  const decorateCount = stableSegmentCount > 0 ? stableSegmentCount : 1;

  return systemMessages.map((message, index) =>
    index < decorateCount
      ? withProviderOptions(message, anthropicCache)
      : message
  );
}

function googleThinkingBudgetForLevel(
  level: "low" | "medium" | "high",
): number {
  switch (level) {
    case "high":
      return 8192;
    case "medium":
      return 4096;
    case "low":
    default:
      return 1024;
  }
}

export function applyPromptCaching(
  spec: ResolvedModelSpec,
  system: SystemPromptValue | undefined,
  messages: ModelMessage[],
  tools: ToolSet,
  providerOptions: ProviderOptionsMap | undefined,
  compiledPrompt: AgentLLMConfig["compiledPrompt"],
  toolSchemaSignature: string,
  toolFilterSignature: string,
  querySource?: string,
): {
  system?: SystemPromptValue;
  messages: ModelMessage[];
  tools: ToolSet;
  providerOptions?: ProviderOptionsMap;
  cacheProfile: ResolvedPromptCacheProfile;
} {
  let decoratedSystem = system;
  let decoratedMessages = messages;
  let decoratedTools = tools;
  let decoratedProviderOptions = providerOptions;
  const cacheProfile = resolvePromptCacheProfile(compiledPrompt, system);

  if (
    spec.providerName === "anthropic" || spec.providerName === "claude-code"
  ) {
    decoratedSystem = withAnthropicSystemCacheBreakpoints(
      system,
      cacheProfile.stableSegmentCount,
      querySource,
    );
    decoratedMessages = messages.slice();
    if (decoratedMessages.length > 0) {
      const lastIndex = decoratedMessages.length - 1;
      decoratedMessages[lastIndex] = withAnthropicCacheBreakpoint(
        decoratedMessages[lastIndex],
        querySource,
      );
    }

    const toolNames = Object.keys(tools);
    if (toolNames.length > 0) {
      const lastToolName = toolNames[toolNames.length - 1];
      decoratedTools = {
        ...tools,
        [lastToolName]: withProviderOptions(
          tools[lastToolName],
          buildAnthropicEphemeralCache(querySource),
        ),
      };
    }
  }

  if (spec.providerName === "openai") {
    decoratedProviderOptions = mergeProviderOptions(decoratedProviderOptions, {
      openai: {
        promptCacheKey: buildOpenAIPromptCacheKey(
          spec,
          cacheProfile.stablePromptSignature,
          toolSchemaSignature,
          toolFilterSignature,
        ),
      },
    });
  }

  if (spec.providerName === "google") {
    // Google explicit caching is resolved at session level via
    // resolveGoogleCachedContent() and injected into providerOptions by the
    // caller. Preserve it through decoration so it reaches the SDK call.
    const incomingGoogle = (providerOptions?.google ?? {}) as Record<
      string,
      unknown
    >;
    if (incomingGoogle.cachedContent) {
      decoratedProviderOptions = mergeProviderOptions(decoratedProviderOptions, {
        google: { cachedContent: incomingGoogle.cachedContent as string },
      });
    }
  }

  return {
    system: decoratedSystem,
    messages: decoratedMessages,
    tools: decoratedTools,
    providerOptions: decoratedProviderOptions,
    cacheProfile,
  };
}

export function buildLlmPerformanceSnapshot(options: {
  spec: ResolvedModelSpec;
  compiledPrompt: AgentLLMConfig["compiledPrompt"];
  cacheProfile: ResolvedPromptCacheProfile;
  latencyMs: number;
  firstTokenLatencyMs?: number;
  usage?: unknown;
  providerMetadata?: unknown;
  querySource?: string;
  toolSchemaSignature?: string;
  eagerToolCount?: number;
  discoveredDeferredToolCount?: number;
}): LLMPerformance {
  const normalizedUsage = isRecord(options.usage)
    ? mapSdkUsage({
      inputTokens: typeof options.usage.inputTokens === "number"
        ? options.usage.inputTokens
        : undefined,
      outputTokens: typeof options.usage.outputTokens === "number"
        ? options.usage.outputTokens
        : undefined,
    })
    : undefined;
  const cacheMetrics = normalizeProviderCacheMetrics({
    usage: options.usage,
    providerMetadata: options.providerMetadata,
  });

  return {
    providerName: options.spec.providerName,
    modelId: options.spec.modelId,
    latencyMs: options.latencyMs,
    ...(options.firstTokenLatencyMs !== undefined
      ? { firstTokenLatencyMs: options.firstTokenLatencyMs }
      : {}),
    ...(options.compiledPrompt?.signatureHash
      ? { promptSignatureHash: options.compiledPrompt.signatureHash }
      : {}),
    ...(options.querySource ? { querySource: options.querySource } : {}),
    stableCacheSignatureHash: options.cacheProfile.stableCacheSignatureHash,
    stableSegmentCount: options.cacheProfile.stableSegmentCount,
    ...(options.toolSchemaSignature
      ? { toolSchemaSignature: options.toolSchemaSignature }
      : {}),
    ...(options.eagerToolCount !== undefined
      ? { eagerToolCount: options.eagerToolCount }
      : {}),
    ...(options.discoveredDeferredToolCount !== undefined
      ? { discoveredDeferredToolCount: options.discoveredDeferredToolCount }
      : {}),
    ...(normalizedUsage
      ? {
        inputTokens: normalizedUsage.inputTokens,
        outputTokens: normalizedUsage.outputTokens,
      }
      : {}),
    ...(cacheMetrics ?? {}),
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
  if (
    supportsNativeThinking({
      contextBudget: config.contextBudget,
      modelId: spec.modelId,
      providerName: spec.providerName,
      thinkingCapable: config.thinkingCapable,
      thinkingState: config.thinkingState,
    })
  ) {
    const thinkingProfile = resolveThinkingProfile(config);
    switch (spec.providerName) {
      case "anthropic":
      case "claude-code":
        opts.anthropic = {
          thinking: {
            type: "enabled",
            budgetTokens: thinkingProfile.anthropicBudgetTokens,
          },
        };
        break;
      case "openai":
        opts.openai = {
          reasoningEffort: thinkingProfile.openaiReasoningEffort,
        };
        break;
      case "google":
        opts.google = spec.modelId.startsWith("gemini-2.5")
          ? {
            thinkingConfig: {
              thinkingBudget: googleThinkingBudgetForLevel(
                thinkingProfile.googleThinkingLevel,
              ),
            },
          }
          : {
            thinkingConfig: {
              includeThoughts: true,
              thinkingLevel: thinkingProfile.googleThinkingLevel,
            },
          };
        break;
    }
  }

  return Object.keys(opts).length > 0 ? opts : undefined;
}

/**
 * Minimum output tokens reserved beyond the thinking budget so Anthropic
 * doesn't reject the request with `max_tokens < budget_tokens`.
 */
const OUTPUT_RESERVE_TOKENS = 4096;

/** Extract Anthropic thinking budgetTokens from resolved provider options, or 0. */
function extractAnthropicThinkingBudget(
  opts: Record<string, ProviderOptionValue> | undefined,
): number {
  const thinking = (opts?.anthropic as Record<string, unknown>)?.thinking as
    | Record<string, unknown>
    | undefined;
  return typeof thinking?.budgetTokens === "number" ? thinking.budgetTokens : 0;
}

/** Ensure maxTokens >= thinkingBudget when thinking is enabled. */
function guardMaxTokens(
  maxTokens: number | undefined,
  thinkingBudget: number,
): number | undefined {
  if (maxTokens == null || thinkingBudget <= 0) return maxTokens;
  // Anthropic requires max_tokens > budget_tokens. Add output reserve.
  const minRequired = thinkingBudget + OUTPUT_RESERVE_TOKENS;
  return Math.max(maxTokens, minRequired);
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

function mapFinishReasonToCompletionState(
  finishReason: unknown,
  toolCalls: readonly ToolCall[],
): LLMCompletionState {
  if (toolCalls.length > 0) return "tool_calls";
  switch (finishReason) {
    case "length":
      return "truncated_max_tokens";
    case "tool-calls":
      return "tool_calls";
    case "error":
      return "error";
    default:
      return "complete";
  }
}

export class SdkAgentEngine implements AgentEngine {
  createLLM(config: AgentLLMConfig): LLMFunction {
    // Hoisted: resolved once per createLLM() call (same config → same spec)
    const spec = resolveSdkModelSpec(config.model);
    let cachedModel: LanguageModel | null = null;
    const shouldCacheModel = spec.providerName !== "claude-code";

    const repairToolCall = buildToolCallRepairFunction();

    // Custom tool cache: rebuilt only when registry generation changes
    let cachedCustomSdkTools: ToolSet = {};
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
      callOptions?: import("./orchestrator-llm.ts").LLMCallOptions,
    ): Promise<LLMResponse> => {
      if (shouldCacheModel && !cachedModel) {
        const bundle = await getSdkProviderBundleFromSpec(spec);
        cachedModel = bundle.model;
      }
      let model = shouldCacheModel && cachedModel
        ? cachedModel
        : (await getSdkProviderBundleFromSpec(spec)).model;
      const generation = getToolRegistryGeneration();
      const toolFilters = resolveToolFilters();
      const disableTools = callOptions?.disableTools === true;
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
        cachedCustomSdkTools = convertToolDefinitionsToSdk(toolDefs) ?? {};
        lastToolSchemaSignature = buildStableSignature(toolDefs.map((def) => ({
          name: def.function.name,
          description: def.function.description ?? "",
          parameters: def.function.parameters,
        })));
        lastToolGeneration = generation;
        lastToolFilterSignature = toolFilterSignature;
      }

      for (let attempt = 0; attempt < 2; attempt++) {
        const promptPayload = buildSystemPromptValue(
          messages,
          config.compiledPrompt,
        );
        const sdkTools = disableTools ? {} : cachedCustomSdkTools;

        // Resolve Google explicit cache (async, best-effort) and merge into
        // provider options so applyPromptCaching() can preserve it.
        let baseProviderOptions = buildProviderOptions(spec, config);
        const thinkingBudget = extractAnthropicThinkingBudget(baseProviderOptions);
        if (spec.providerName === "google") {
          const cacheProfile = resolvePromptCacheProfile(
            config.compiledPrompt,
            promptPayload.system,
          );
          const googleCacheName = await resolveGoogleCachedContent(
            spec,
            promptPayload.system,
            cacheProfile,
          );
          if (googleCacheName) {
            baseProviderOptions = mergeProviderOptions(baseProviderOptions, {
              google: { cachedContent: googleCacheName },
            }) ?? baseProviderOptions;
          }
        }

        const effectiveToolSchemaSignature = buildStableSignature({
          tools: lastToolSchemaSignature,
          activeTools: Object.keys(sdkTools).sort(),
        });
        const cacheDecorated = applyPromptCaching(
          spec,
          promptPayload.system,
          promptPayload.messages,
          sdkTools,
          baseProviderOptions,
          config.compiledPrompt,
          effectiveToolSchemaSignature,
          toolFilterSignature,
          config.querySource,
        );
        const requestStartedAt = Date.now();
        const commonOpts = {
          model,
          ...(cacheDecorated.system ? { system: cacheDecorated.system } : {}),
          messages: cacheDecorated.messages,
          ...(disableTools ? {} : { tools: cacheDecorated.tools }),
          ...(config.options?.temperature != null &&
            { temperature: Math.max(0, Math.min(config.options.temperature, 2.0)) }),
          maxTokens: guardMaxTokens(config.options?.maxTokens, thinkingBudget),
          abortSignal: signal,
          experimental_repairToolCall: repairToolCall,
          ...(cacheDecorated.providerOptions
            ? { providerOptions: cacheDecorated.providerOptions }
            : {}),
        };
        let streamError: unknown = null;

        try {
          const tokenSink = callOptions?.onToken ?? config.onToken;
          if (tokenSink) {
            // Streaming path
            let firstTokenLatencyMs: number | undefined;
            const result = streamText({
              ...commonOpts,
              onError: ({ error }) => {
                streamError = error;
              },
            });

            // Feed tokens to callback as they arrive
            const chunks: string[] = [];
            for await (const chunk of result.textStream) {
              if (
                firstTokenLatencyMs === undefined &&
                typeof chunk === "string" &&
                chunk.length > 0
              ) {
                firstTokenLatencyMs = Date.now() - requestStartedAt;
              }
              chunks.push(chunk);
              tokenSink(chunk);
            }

            // streamText properties are PromiseLike — await them
            const [
              toolCalls,
              usage,
              text,
              sources,
              providerMetadata,
              reasoning,
              response,
              finishReason,
            ] = await Promise.all([
              result.toolCalls,
              result.usage,
              result.text,
              result.sources,
              result.providerMetadata,
              result.reasoning,
              result.response,
              result.finishReason,
            ]);
            const mappedToolCalls = mapSdkToolCalls(toolCalls);
            const normalizedProviderMetadata = normalizeProviderMetadata(
              providerMetadata,
            );

            return {
              content: chunks.join("") || text || "",
              toolCalls: mappedToolCalls,
              completionState: mapFinishReasonToCompletionState(
                finishReason,
                mappedToolCalls,
              ),
              usage: mapSdkUsage(usage),
              sources: mapSdkSources(sources),
              providerMetadata: normalizedProviderMetadata,
              performance: buildLlmPerformanceSnapshot({
                spec,
                compiledPrompt: config.compiledPrompt,
                cacheProfile: cacheDecorated.cacheProfile,
                latencyMs: Date.now() - requestStartedAt,
                firstTokenLatencyMs,
                usage,
                providerMetadata: normalizedProviderMetadata,
                querySource: config.querySource,
                toolSchemaSignature: effectiveToolSchemaSignature,
                eagerToolCount: config.eagerToolCount,
                discoveredDeferredToolCount: config.discoveredDeferredToolCount,
              }),
              reasoning: extractReasoningText(reasoning),
              sdkResponseMessages: response?.messages,
            };
          }

          // Non-streaming path — generateText returns resolved values directly
          const result = await generateText(commonOpts);
          const mappedToolCalls = mapSdkToolCalls(result.toolCalls);
          const normalizedProviderMetadata = normalizeProviderMetadata(
            result.providerMetadata,
          );
          return {
            content: result.text || "",
            toolCalls: mappedToolCalls,
            completionState: mapFinishReasonToCompletionState(
              result.finishReason,
              mappedToolCalls,
            ),
            usage: mapSdkUsage(result.usage),
            sources: mapSdkSources(result.sources),
            providerMetadata: normalizedProviderMetadata,
            performance: buildLlmPerformanceSnapshot({
              spec,
              compiledPrompt: config.compiledPrompt,
              cacheProfile: cacheDecorated.cacheProfile,
              latencyMs: Date.now() - requestStartedAt,
              usage: result.usage,
              providerMetadata: normalizedProviderMetadata,
              querySource: config.querySource,
              toolSchemaSignature: effectiveToolSchemaSignature,
              eagerToolCount: config.eagerToolCount,
              discoveredDeferredToolCount: config.discoveredDeferredToolCount,
            }),
            reasoning: extractReasoningText(result.reasoning),
            sdkResponseMessages: result.response?.messages,
          };
        } catch (error) {
          const executionError = resolveSdkStreamFailure(error, streamError);
          const shouldRetry = attempt === 0 &&
            await maybeHandleSdkAuthError(spec.providerName, executionError);
          if (shouldRetry) {
            model = await createSdkLanguageModel(spec);
            if (shouldCacheModel) {
              cachedModel = model;
            }
            continue;
          }

          const message = getErrorMessage(executionError);
          if (message.includes("No output generated")) {
            let fallbackText = "";
            let fallbackCalls: ToolCall[] = [];
            let fallbackUsage:
              | { inputTokens: number; outputTokens: number }
              | undefined;
            let fallbackSources;
            let fallbackProviderMetadata;
            let fallbackRawUsage: unknown;

            try {
              const fallback = await generateText(commonOpts);
              fallbackText = (fallback.text || "").trim();
              fallbackCalls = mapSdkToolCalls(fallback.toolCalls);
              fallbackUsage = mapSdkUsage(fallback.usage);
              fallbackRawUsage = fallback.usage;
              fallbackSources = mapSdkSources(fallback.sources);
              fallbackProviderMetadata = normalizeProviderMetadata(
                fallback.providerMetadata,
              );
            } catch (fallbackError) {
              const retryFallback = attempt === 0 &&
                await maybeHandleSdkAuthError(spec.providerName, fallbackError);
              if (retryFallback) {
                model = await createSdkLanguageModel(spec);
                if (shouldCacheModel) {
                  cachedModel = model;
                }
                continue;
              }
            }

            if (fallbackText.length === 0 && fallbackCalls.length === 0) {
              fallbackText = AI_NO_OUTPUT_FALLBACK_TEXT;
            }
            const tokenSink = callOptions?.onToken ?? config.onToken;
            if (tokenSink && fallbackText.length > 0) {
              tokenSink(fallbackText);
            }

            return {
              content: fallbackText,
              toolCalls: fallbackCalls,
              completionState: mapFinishReasonToCompletionState(
                "complete",
                fallbackCalls,
              ),
              usage: fallbackUsage,
              sources: fallbackSources,
              providerMetadata: fallbackProviderMetadata,
              performance: buildLlmPerformanceSnapshot({
                spec,
                compiledPrompt: config.compiledPrompt,
                cacheProfile: cacheDecorated.cacheProfile,
                latencyMs: Date.now() - requestStartedAt,
                usage: fallbackRawUsage,
                providerMetadata: fallbackProviderMetadata,
                querySource: config.querySource,
                toolSchemaSignature: effectiveToolSchemaSignature,
                eagerToolCount: config.eagerToolCount,
                discoveredDeferredToolCount: config.discoveredDeferredToolCount,
              }),
            };
          }
          throw executionError;
        }
      }

      throw new RuntimeError(
        "Agent SDK request retry exhausted unexpectedly.",
        { code: ProviderErrorCode.REQUEST_FAILED },
      );
    };
  }

  createSummarizer(model?: string) {
    return async (messages: AgentMessage[]): Promise<string> => {
      const sdkModel = await getSdkModel(model);
      const prompt = buildCompactionPrompt(messages);

      const result = await generateText({
        model: sdkModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.0,
      });

      return result.text.trim();
    };
  }
}
