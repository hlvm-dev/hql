/**
 * Provider SDK Runtime
 *
 * Shared AI SDK-backed runtime for provider text generation/chat/tool-calling.
 * This replaces provider-specific wire-format/SSE plumbing while keeping the
 * existing AIProvider interface and globalThis.ai contract unchanged.
 */

import { generateText, jsonSchema, streamText, tool } from "ai";
import type { LanguageModel, ModelMessage, ToolCallPart } from "ai";
import type {
  ChatOptions,
  ChatStructuredResponse,
  GenerateOptions,
  Message,
  ProviderToolCall,
  ToolDefinition,
} from "./types.ts";
import { generateToolCallId } from "./common.ts";
import { normalizeToolArgs } from "../agent/validation.ts";
import { getPlatform } from "../../platform/platform.ts";
import { ValidationError } from "../../common/error.ts";

export type SdkProviderName =
  | "openai"
  | "anthropic"
  | "google"
  | "claude-code"
  | "ollama";

export interface SdkModelSpec {
  providerName: SdkProviderName;
  modelId: string;
  endpoint?: string;
  apiKey?: string;
}

const SUPPORTED_SDK_PROVIDERS = new Set<SdkProviderName>([
  "openai",
  "anthropic",
  "google",
  "claude-code",
  "ollama",
]);

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function withApiPathSuffix(
  endpoint: string | undefined,
  suffix: string,
): string | undefined {
  const base = toNonEmptyString(endpoint);
  if (!base) return undefined;
  const normalized = base.replace(/\/+$/, "");
  return normalized.endsWith(suffix) ? normalized : `${normalized}${suffix}`;
}

export function assertSupportedSdkProvider(
  providerName: string,
): SdkProviderName {
  const normalized = providerName.toLowerCase() as SdkProviderName;
  if (SUPPORTED_SDK_PROVIDERS.has(normalized)) {
    return normalized;
  }
  const supported = [...SUPPORTED_SDK_PROVIDERS].join(", ");
  throw new ValidationError(
    `Unsupported SDK provider '${providerName}'. Supported providers: ${supported}`,
    "provider_sdk_runtime",
  );
}

function extractStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const direct = record.statusCode ?? record.status ?? record.status_code;
  if (typeof direct === "number") return direct;
  const nestedResponse = record.response;
  if (nestedResponse && typeof nestedResponse === "object") {
    const nested = nestedResponse as Record<string, unknown>;
    if (typeof nested.status === "number") return nested.status;
    if (typeof nested.statusCode === "number") return nested.statusCode;
  }
  return null;
}

export async function maybeHandleSdkAuthError(
  providerName: SdkProviderName,
  error: unknown,
): Promise<void> {
  if (providerName !== "claude-code") return;
  const status = extractStatusCode(error);
  if (status !== 401 && status !== 403) return;
  const { clearTokenCache } = await import("./claude-code/auth.ts");
  clearTokenCache();
}

export async function createSdkLanguageModel(
  spec: SdkModelSpec,
): Promise<LanguageModel> {
  const providerName = assertSupportedSdkProvider(spec.providerName);
  const modelId = toNonEmptyString(spec.modelId);
  if (!modelId) {
    throw new ValidationError("Model id is required", "provider_sdk_runtime");
  }

  switch (providerName) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const apiKey = toNonEmptyString(spec.apiKey) ??
        getPlatform().env.get("OPENAI_API_KEY") ?? "";
      const baseURL = withApiPathSuffix(
        toNonEmptyString(spec.endpoint) ??
          getPlatform().env.get("OPENAI_BASE_URL"),
        "/v1",
      );
      const openai = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
      return openai(modelId);
    }

    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const apiKey = toNonEmptyString(spec.apiKey) ??
        getPlatform().env.get("ANTHROPIC_API_KEY") ?? "";
      const baseURL = withApiPathSuffix(
        toNonEmptyString(spec.endpoint) ??
          getPlatform().env.get("ANTHROPIC_BASE_URL"),
        "/v1",
      );
      const anthropic = createAnthropic({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      });
      return anthropic(modelId);
    }

    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      const apiKey = toNonEmptyString(spec.apiKey) ??
        getPlatform().env.get("GOOGLE_API_KEY") ?? "";
      const baseURL = withApiPathSuffix(
        toNonEmptyString(spec.endpoint) ??
          getPlatform().env.get("GOOGLE_BASE_URL"),
        "/v1beta",
      );
      const google = createGoogleGenerativeAI({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      });
      return google(modelId);
    }

    case "claude-code": {
      const { getClaudeCodeToken } = await import("./claude-code/auth.ts");
      const token = await getClaudeCodeToken();
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const baseURL = withApiPathSuffix(
        toNonEmptyString(spec.endpoint) ??
          getPlatform().env.get("ANTHROPIC_BASE_URL"),
        "/v1",
      );
      const anthropic = createAnthropic({
        authToken: token,
        ...(baseURL ? { baseURL } : {}),
        headers: {
          "anthropic-beta": "oauth-2025-04-20",
        },
        name: "claude-code.messages",
      });
      return anthropic(modelId);
    }

    case "ollama": {
      const { createOllama } = await import("ollama-ai-provider-v2");
      const baseURL = withApiPathSuffix(
        toNonEmptyString(spec.endpoint) ??
          getPlatform().env.get("OLLAMA_BASE_URL"),
        "/api",
      );
      const ollama = createOllama({ ...(baseURL ? { baseURL } : {}) });
      return ollama(modelId);
    }
  }
}

export function convertToolDefinitionsToSdk(
  defs?: ToolDefinition[],
): Record<string, ReturnType<typeof tool>> | undefined {
  if (!defs?.length) return undefined;
  const result: Record<string, ReturnType<typeof tool>> = {};
  for (const def of defs) {
    result[def.function.name] = tool({
      description: def.function.description ?? "",
      inputSchema: jsonSchema(def.function.parameters),
    });
  }
  return result;
}

type SdkTextPart = { type: "text"; text: string };
type SdkImagePart = { type: "image"; image: string };
type SdkFilePart = { type: "file"; data: string; mediaType: string };
type SdkAssistantPart = SdkTextPart | ToolCallPart;

/**
 * Message shape accepted by the universal SDK converter.
 * Both AgentMessage (camelCase) and ProviderMessage (snake_case) satisfy this.
 */
export interface SdkConvertibleMessage {
  role: string;
  content: string;
  /** Image/media attachments: structured {data, mimeType} or plain base64 strings */
  images?: Array<string | { data: string; mimeType: string }>;
  // AgentMessage convention (camelCase)
  toolCalls?: Array<{ id?: string; function: { name: string; arguments: unknown } }>;
  toolName?: string;
  toolCallId?: string;
  // ProviderMessage convention (snake_case)
  tool_calls?: Array<{ id?: string; function: { name: string; arguments: unknown } }>;
  tool_name?: string;
  tool_call_id?: string;
}

/**
 * Universal converter: internal messages → AI SDK ModelMessage[].
 * Handles both AgentMessage (camelCase) and ProviderMessage (snake_case) field names.
 * Single source of truth — used by both engine-sdk.ts and sdk-runtime.ts.
 */
export function convertToSdkMessages(
  messages: SdkConvertibleMessage[],
): ModelMessage[] {
  // Consolidate all system messages into a single message at position 0.
  // Providers reject interleaved system messages (e.g. system, user, system).
  const systemParts: string[] = [];
  const nonSystemMessages: SdkConvertibleMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      if (msg.content) systemParts.push(msg.content);
    } else {
      nonSystemMessages.push(msg);
    }
  }

  const result: ModelMessage[] = [];
  if (systemParts.length > 0) {
    result.push({ role: "system", content: systemParts.join("\n\n") });
  }

  for (const msg of nonSystemMessages) {
    if (msg.role === "user") {
      if (!msg.images?.length) {
        result.push({ role: "user", content: msg.content });
        continue;
      }
      const content: Array<SdkTextPart | SdkImagePart | SdkFilePart> = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      for (const img of msg.images) {
        if (typeof img === "string") {
          // Legacy: plain base64 string → image part
          content.push({ type: "image", image: img });
        } else if (img.mimeType.startsWith("image/")) {
          content.push({ type: "image", image: img.data });
        } else {
          // PDF, audio, video → file part
          content.push({ type: "file", data: img.data, mediaType: img.mimeType });
        }
      }
      result.push({ role: "user", content });
      continue;
    }

    if (msg.role === "assistant") {
      const toolCalls = msg.toolCalls ?? msg.tool_calls;
      if (toolCalls?.length) {
        const parts: SdkAssistantPart[] = [];
        if (msg.content) {
          parts.push({ type: "text", text: msg.content });
        }
        for (const tc of toolCalls) {
          parts.push({
            type: "tool-call",
            toolCallId: tc.id ?? generateToolCallId(),
            toolName: tc.function.name,
            input: normalizeToolArgs(tc.function.arguments),
          });
        }
        result.push({ role: "assistant", content: parts });
      } else {
        result.push({ role: "assistant", content: msg.content });
      }
      continue;
    }

    // role === "tool"
    result.push({
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: msg.toolCallId ?? msg.tool_call_id ?? generateToolCallId(),
        toolName: msg.toolName ?? msg.tool_name ?? "unknown",
        output: { type: "text", value: msg.content },
      }],
    });
  }

  return result;
}

export function mapSdkUsage(
  usage?: { inputTokens: number | undefined; outputTokens: number | undefined },
): { inputTokens: number; outputTokens: number } | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  };
}

function toProviderToolCalls(
  calls: Array<{ toolCallId: string; toolName: string; input: unknown }>,
): ProviderToolCall[] {
  return calls.map((call): ProviderToolCall => ({
    id: call.toolCallId,
    type: "function",
    function: {
      name: call.toolName,
      arguments: normalizeToolArgs(call.input),
    },
  }));
}

function resolveNumCtx(options?: GenerateOptions): number | undefined {
  const rawValue = options?.raw?.num_ctx;
  if (
    typeof rawValue === "number" &&
    Number.isFinite(rawValue) &&
    rawValue > 0
  ) {
    return Math.floor(rawValue);
  }
  return undefined;
}

function buildCommonSettings(
  spec: SdkModelSpec,
  model: LanguageModel,
  messages: ModelMessage[],
  options: ChatOptions | undefined,
  signal: AbortSignal | undefined,
) {
  const numCtx = spec.providerName === "ollama"
    ? resolveNumCtx(options)
    : undefined;
  const tools = convertToolDefinitionsToSdk(options?.tools);
  return {
    model,
    messages,
    ...(tools ? { tools } : {}),
    temperature: options?.temperature ?? 0.0,
    maxTokens: options?.maxTokens,
    stopSequences: options?.stop,
    abortSignal: signal,
    ...(numCtx ? { providerOptions: { ollama: { num_ctx: numCtx } } } : {}),
  };
}

export async function* generateWithSdk(
  spec: SdkModelSpec,
  prompt: string,
  options?: GenerateOptions,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const messages: Message[] = [];
  if (options?.system) {
    messages.push({ role: "system", content: options.system });
  }
  messages.push({
    role: "user",
    content: prompt,
    ...(options?.images?.length ? { images: options.images } : {}),
  });
  yield* chatWithSdk(
    spec,
    messages,
    options as ChatOptions | undefined,
    signal,
  );
}

export async function* chatWithSdk(
  spec: SdkModelSpec,
  messages: Message[],
  options?: ChatOptions,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const model = await createSdkLanguageModel(spec);
  const sdkMessages = convertToSdkMessages(messages);
  const settings = buildCommonSettings(
    spec,
    model,
    sdkMessages,
    options,
    signal,
  );

  try {
    const result = streamText(settings);
    for await (const chunk of result.textStream) {
      yield chunk;
    }
    await result.text;
  } catch (error) {
    await maybeHandleSdkAuthError(spec.providerName, error);
    // "No output generated" retry is handled by the agent engine layer
    // (engine-sdk.ts) which has richer recovery (tool calls, usage tracking).
    // Re-throwing here avoids a double retry that wastes latency.
    throw error;
  }
}

export async function chatStructuredWithSdk(
  spec: SdkModelSpec,
  messages: Message[],
  options?: ChatOptions,
  signal?: AbortSignal,
): Promise<ChatStructuredResponse> {
  const model = await createSdkLanguageModel(spec);
  const sdkMessages = convertToSdkMessages(messages);
  const settings = buildCommonSettings(
    spec,
    model,
    sdkMessages,
    options,
    signal,
  );
  const onToken = options?.onToken;

  try {
    if (typeof onToken === "function") {
      const result = streamText(settings);
      const contentChunks: string[] = [];
      for await (const chunk of result.textStream) {
        contentChunks.push(chunk);
        onToken(chunk);
      }

      const [text, toolCalls, usage] = await Promise.all([
        result.text,
        result.toolCalls,
        result.usage,
      ]);

      return {
        content: contentChunks.join("") || text || "",
        toolCalls: toProviderToolCalls(toolCalls),
        usage: mapSdkUsage(usage),
      };
    }

    const result = await generateText(settings);
    return {
      content: result.text || "",
      toolCalls: toProviderToolCalls(result.toolCalls),
      usage: mapSdkUsage(result.usage),
    };
  } catch (error) {
    await maybeHandleSdkAuthError(spec.providerName, error);
    throw error;
  }
}
