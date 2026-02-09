/**
 * OpenAI Chat Completions API
 *
 * Low-level HTTP calls to the OpenAI API.
 * Handles message format conversion and tool call extraction.
 */

import {
  buildToolCall,
  JSON_HEADERS,
  readSSEStream,
  requireApiKey,
  throwOnHttpError,
} from "../common.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import type {
  ChatOptions,
  ChatStructuredResponse,
  Message,
  ModelInfo,
  ProviderStatus,
  ProviderToolCall,
} from "../types.ts";

function authHeaders(apiKey: string): Record<string, string> {
  return {
    ...JSON_HEADERS,
    "Authorization": `Bearer ${apiKey}`,
  };
}

// =============================================================================
// Message Conversion
// =============================================================================

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

/**
 * Convert provider messages to OpenAI format.
 * Key differences from our internal format:
 * - tool_calls[].function.arguments must be a JSON string (not object)
 * - tool results need tool_call_id (we use tool_name as fallback)
 */
function toOpenAIMessages(messages: Message[]): OpenAIMessage[] {
  return messages.map((msg) => {
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      return {
        role: "assistant" as const,
        content: msg.content || null,
        tool_calls: msg.tool_calls.map((tc, i) => ({
          id: tc.id ?? `call_${i}`,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: typeof tc.function.arguments === "string"
              ? tc.function.arguments
              : JSON.stringify(tc.function.arguments ?? {}),
          },
        })),
      };
    }

    if (msg.role === "tool") {
      return {
        role: "tool" as const,
        content: msg.content,
        tool_call_id: msg.tool_call_id ?? msg.tool_name ?? "call_0",
      };
    }

    return {
      role: msg.role as "system" | "user" | "assistant",
      content: msg.content,
    };
  });
}

// =============================================================================
// Tool Call Extraction
// =============================================================================

interface OpenAIChoice {
  message: {
    role: string;
    content: string | null;
    tool_calls?: {
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }[];
  };
  finish_reason: string;
}

function extractToolCalls(choice: OpenAIChoice): ProviderToolCall[] {
  if (!choice.message.tool_calls?.length) return [];
  return choice.message.tool_calls.map((tc) =>
    buildToolCall(tc.id, tc.function.name, tc.function.arguments)
  );
}

// =============================================================================
// API Functions
// =============================================================================

export async function chatStructured(
  endpoint: string,
  model: string,
  messages: Message[],
  apiKey: string,
  options?: ChatOptions,
  signal?: AbortSignal,
): Promise<ChatStructuredResponse> {
  requireApiKey(apiKey, "OpenAI");
  const onToken = options?.onToken;
  const useStreaming = typeof onToken === "function";

  const body: Record<string, unknown> = {
    model,
    messages: toOpenAIMessages(messages),
    stream: useStreaming,
  };

  if (options?.temperature !== undefined) body.temperature = options.temperature;
  if (options?.maxTokens) body.max_tokens = options.maxTokens;
  if (options?.stop?.length) body.stop = options.stop;

  if (options?.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

  if (useStreaming) {
    return streamChat(endpoint, body, apiKey, onToken!, signal);
  }

  const url = `${endpoint}/v1/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    await throwOnHttpError(response, "OpenAI");
  }

  const result = await response.json() as { choices: OpenAIChoice[] };
  const choice = result.choices?.[0];
  if (!choice) return { content: "" };

  return {
    content: choice.message.content ?? "",
    toolCalls: extractToolCalls(choice),
  };
}

interface OpenAIStreamDelta {
  choices: {
    delta: {
      content?: string;
      tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
}

async function streamChat(
  endpoint: string,
  body: Record<string, unknown>,
  apiKey: string,
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<ChatStructuredResponse> {
  body.stream_options = { include_usage: false };

  const url = `${endpoint}/v1/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    await throwOnHttpError(response, "OpenAI");
  }

  const contentChunks: string[] = [];
  const toolCallParts: Map<number, { id: string; name: string; args: string }> = new Map();

  for await (const chunk of readSSEStream<OpenAIStreamDelta>(response)) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) {
      contentChunks.push(delta.content);
      onToken(delta.content);
    }
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const existing = toolCallParts.get(tc.index) ?? { id: "", name: "", args: "" };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name += tc.function.name;
        if (tc.function?.arguments) existing.args += tc.function.arguments;
        toolCallParts.set(tc.index, existing);
      }
    }
  }

  const toolCalls: ProviderToolCall[] = [...toolCallParts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, part]) => buildToolCall(part.id, part.name, part.args));

  return { content: contentChunks.join(""), toolCalls };
}

// =============================================================================
// Models & Status
// =============================================================================

/** Non-chat model prefixes to exclude from listing */
const NON_CHAT_PREFIXES = [
  "dall-e", "whisper", "tts", "text-embedding", "davinci", "babbage", "ft:",
];

function isChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  return !NON_CHAT_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export async function listModels(
  endpoint: string,
  apiKey: string,
): Promise<ModelInfo[]> {
  const url = `${endpoint}/v1/models`;
  const response = await fetch(url, {
    headers: authHeaders(apiKey),
  });
  if (!response.ok) return [];

  const result = await response.json() as { data: { id: string; created: number; owned_by: string }[] };
  return (result.data ?? [])
    .filter((m) => isChatModel(m.id))
    .map((m) => ({
      name: m.id,
      displayName: m.id,
      family: m.owned_by,
      capabilities: ["chat" as const, "tools" as const, "vision" as const],
    }));
}

export async function checkStatus(
  endpoint: string,
  apiKey: string,
): Promise<ProviderStatus> {
  try {
    const url = `${endpoint}/v1/models`;
    const response = await fetch(url, {
      headers: authHeaders(apiKey),
    });
    return {
      available: response.ok,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      available: false,
      error: getErrorMessage(error),
    };
  }
}
