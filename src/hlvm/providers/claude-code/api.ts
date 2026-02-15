/**
 * Claude Code Subscription API
 *
 * Same Anthropic Messages API, different auth: OAuth Bearer token
 * from your Claude Max subscription instead of x-api-key.
 *
 * Reuses all message conversion/extraction logic from the anthropic provider.
 * Only the auth headers differ.
 */

import {
  generateToolCallId,
  JSON_HEADERS,
  parseJsonArgs,
  readSSEStream,
  throwOnHttpError,
} from "../common.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import { RuntimeError } from "../../../common/error.ts";
import type {
  ChatOptions,
  ChatStructuredResponse,
  ContextOverflowInfo,
  Message,
  ProviderStatus,
  ProviderToolCall,
} from "../types.ts";
import { getClaudeCodeToken, clearTokenCache } from "./auth.ts";

const ANTHROPIC_VERSION = "2023-06-01";

function oauthHeaders(token: string): Record<string, string> {
  return {
    ...JSON_HEADERS,
    "Authorization": `Bearer ${token}`,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-beta": "oauth-2025-04-20",
  };
}

// =============================================================================
// Message Conversion (shared with anthropic provider — same API format)
// =============================================================================

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

function convertMessages(
  messages: Message[],
): { system: string; messages: AnthropicMessage[] } {
  let system = "";
  const result: AnthropicMessage[] = [];
  const consumedToolUseIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role === "system") {
      system += (system ? "\n" : "") + msg.content;
      continue;
    }

    if (msg.role === "assistant" && msg.tool_calls?.length) {
      const blocks: AnthropicContentBlock[] = [];
      if (msg.content) {
        blocks.push({ type: "text", text: msg.content });
      }
      for (const tc of msg.tool_calls) {
        blocks.push({
          type: "tool_use",
          id: tc.id ?? generateToolCallId(),
          name: tc.function.name,
          input: typeof tc.function.arguments === "string"
            ? parseJsonArgs(tc.function.arguments)
            : tc.function.arguments ?? {},
        });
      }
      pushMessage(result, { role: "assistant", content: blocks });
      continue;
    }

    if (msg.role === "tool") {
      const toolUseId = msg.tool_call_id ?? findToolUseId(result, msg.tool_name, consumedToolUseIds);
      pushMessage(result, {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: toolUseId,
          content: msg.content,
        }],
      });
      continue;
    }

    const role = msg.role === "user" ? "user" : "assistant";
    pushMessage(result, { role, content: msg.content });
  }

  return { system, messages: result };
}

function pushMessage(result: AnthropicMessage[], msg: AnthropicMessage): void {
  const last = result[result.length - 1];
  if (last && last.role === msg.role) {
    const lastContent = Array.isArray(last.content)
      ? last.content
      : [{ type: "text" as const, text: last.content }];
    const newContent = Array.isArray(msg.content)
      ? msg.content
      : [{ type: "text" as const, text: msg.content }];
    last.content = [...lastContent, ...newContent];
  } else {
    result.push(msg);
  }
}

function findToolUseId(
  messages: AnthropicMessage[],
  toolName: string | undefined,
  consumed: Set<string>,
): string {
  if (!toolName) return generateToolCallId();
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (
          block.type === "tool_use" &&
          block.name === toolName &&
          !consumed.has(block.id)
        ) {
          consumed.add(block.id);
          return block.id;
        }
      }
    }
  }
  return generateToolCallId();
}

// =============================================================================
// Response Extraction
// =============================================================================

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
}

function extractContent(response: AnthropicResponse): string {
  return response.content
    .filter((b): b is AnthropicTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function extractToolCalls(response: AnthropicResponse): ProviderToolCall[] {
  return response.content
    .filter((b): b is AnthropicToolUseBlock => b.type === "tool_use")
    .map((b) => ({
      id: b.id,
      type: "function",
      function: {
        name: b.name,
        arguments: b.input,
      },
    }));
}

// =============================================================================
// API Functions
// =============================================================================

export async function chatStructured(
  endpoint: string,
  model: string,
  messages: Message[],
  options?: ChatOptions,
  signal?: AbortSignal,
): Promise<ChatStructuredResponse> {
  const token = await getClaudeCodeToken();
  const onToken = options?.onToken;
  const useStreaming = typeof onToken === "function";
  const { system, messages: anthropicMessages } = convertMessages(messages);

  const body: Record<string, unknown> = {
    model,
    messages: anthropicMessages,
    max_tokens: options?.maxTokens ?? 8192,
    stream: useStreaming,
  };

  if (system) body.system = system;
  if (options?.temperature !== undefined) body.temperature = options.temperature;
  if (options?.stop?.length) body.stop_sequences = options.stop;

  if (options?.tools?.length) {
    body.tools = options.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description ?? "",
      input_schema: t.function.parameters,
    }));
  }

  if (useStreaming) {
    return streamChat(endpoint, body, token, onToken!, signal);
  }

  const url = `${endpoint}/v1/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: oauthHeaders(token),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      clearTokenCache(); // Token may have expired — clear so next call re-reads
    }
    await throwOnHttpError(response, "Claude Code");
  }

  const result = await response.json() as AnthropicResponse;
  const resp: ChatStructuredResponse = {
    content: extractContent(result),
    toolCalls: extractToolCalls(result),
  };
  if (result.usage) {
    resp.usage = { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens };
  }
  return resp;
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type: string; text?: string; partial_json?: string };
}

async function streamChat(
  endpoint: string,
  body: Record<string, unknown>,
  token: string,
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<ChatStructuredResponse> {
  const url = `${endpoint}/v1/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: oauthHeaders(token),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      clearTokenCache();
    }
    await throwOnHttpError(response, "Claude Code");
  }

  const contentChunks: string[] = [];
  const toolUseBlocks: { id: string; name: string; inputJson: string }[] = [];
  let currentToolIndex = -1;
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of readSSEStream<AnthropicStreamEvent>(response)) {
    const raw = event as unknown as Record<string, unknown>;
    if (event.type === "message_start") {
      const msg = raw.message as Record<string, unknown> | undefined;
      const u = msg?.usage as { input_tokens?: number } | undefined;
      if (u?.input_tokens) inputTokens = u.input_tokens;
    } else if (event.type === "message_delta") {
      const u = raw.usage as { output_tokens?: number } | undefined;
      if (u?.output_tokens) outputTokens = u.output_tokens;
    } else if (event.type === "content_block_start") {
      if (event.content_block?.type === "tool_use") {
        currentToolIndex = toolUseBlocks.length;
        toolUseBlocks.push({
          id: event.content_block.id ?? "",
          name: event.content_block.name ?? "",
          inputJson: "",
        });
      }
    } else if (event.type === "content_block_delta") {
      if (event.delta?.type === "text_delta" && event.delta.text) {
        contentChunks.push(event.delta.text);
        onToken(event.delta.text);
      } else if (
        event.delta?.type === "input_json_delta" &&
        event.delta.partial_json &&
        currentToolIndex >= 0
      ) {
        toolUseBlocks[currentToolIndex].inputJson += event.delta.partial_json;
      }
    } else if (event.type === "content_block_stop") {
      if (currentToolIndex >= 0) currentToolIndex = -1;
    } else if (event.type === "error") {
      throw new RuntimeError(`Claude Code stream error: ${JSON.stringify(raw.error ?? event)}`);
    }
  }

  const toolCalls: ProviderToolCall[] = toolUseBlocks.map((b) => ({
    id: b.id,
    type: "function",
    function: {
      name: b.name,
      arguments: parseJsonArgs(b.inputJson),
    },
  }));

  const resp: ChatStructuredResponse = { content: contentChunks.join(""), toolCalls };
  if (inputTokens > 0 || outputTokens > 0) {
    resp.usage = { inputTokens, outputTokens };
  }
  return resp;
}

// =============================================================================
// Status
// =============================================================================

export async function checkStatus(
  endpoint: string,
): Promise<ProviderStatus> {
  try {
    const token = await getClaudeCodeToken();
    const url = `${endpoint}/v1/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: oauthHeaders(token),
      body: JSON.stringify({ model: "claude-sonnet-4-5-20250929", max_tokens: 1, messages: [] }),
    });
    return {
      available: response.status !== 401 && response.status !== 403,
      error: (response.status === 401 || response.status === 403)
        ? "Claude Code OAuth token invalid or expired. Run `claude login` to re-authenticate."
        : undefined,
    };
  } catch (error) {
    return {
      available: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Parse context overflow info from Anthropic error messages.
 * Same format as anthropic provider — same API, same errors.
 */
export function parseOverflowError(err: unknown): ContextOverflowInfo {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes("prompt is too long") || msg.includes("token limit") || msg.includes("too many tokens")) {
    const match = msg.match(/(\d+)\s*tokens?\s*>\s*(\d+)/);
    if (match) {
      return { isOverflow: true, limitTokens: parseInt(match[2]), confidence: "high" };
    }
    return { isOverflow: true, confidence: "low" };
  }
  return { isOverflow: false, confidence: "low" };
}
