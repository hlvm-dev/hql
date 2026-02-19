/**
 * Shared Anthropic API Types & Helpers
 *
 * Used by both the Anthropic (x-api-key) and Claude Code (OAuth) providers.
 * Contains message conversion, response extraction, and streaming logic.
 */

import {
  generateToolCallId,
  parseJsonArgs,
  readSSEStream,
  throwOnHttpError,
} from "../common.ts";
import { RuntimeError } from "../../../common/error.ts";
import type {
  ChatStructuredResponse,
  ProviderToolCall,
  Message,
  ChatOptions,
} from "../types.ts";

// =============================================================================
// Types
// =============================================================================

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface AnthropicStreamEvent {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type: string; text?: string; partial_json?: string };
}

// =============================================================================
// Message Conversion
// =============================================================================

export function convertMessages(
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
      // Skip orphaned tool results that have no matching tool_use block —
      // Anthropic rejects these with HTTP 400.
      if (!toolUseId) continue;
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

/** Merge consecutive same-role messages (Anthropic requires alternating roles) */
export function pushMessage(result: AnthropicMessage[], msg: AnthropicMessage): void {
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

/** Find an unconsumed tool_use id from assistant messages for a given tool name.
 *  Returns null when no matching block exists (orphaned tool result). */
export function findToolUseId(
  messages: AnthropicMessage[],
  toolName: string | undefined,
  consumed: Set<string>,
): string | null {
  if (!toolName) return null;
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
  return null;
}

// =============================================================================
// Response Extraction
// =============================================================================

export function extractContent(response: AnthropicResponse): string {
  return response.content
    .filter((b): b is AnthropicTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export function extractToolCalls(response: AnthropicResponse): ProviderToolCall[] {
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
// Request Body Building
// =============================================================================

export function buildRequestBody(
  model: string,
  messages: Message[],
  options?: ChatOptions,
): { body: Record<string, unknown>; system: string; useStreaming: boolean } {
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

  return { body, system, useStreaming };
}

// =============================================================================
// Non-Streaming Response
// =============================================================================

export function buildResponse(result: AnthropicResponse): ChatStructuredResponse {
  const resp: ChatStructuredResponse = {
    content: extractContent(result),
    toolCalls: extractToolCalls(result),
  };
  if (result.usage) {
    resp.usage = { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens };
  }
  return resp;
}

// =============================================================================
// Streaming
// =============================================================================

export async function streamChat(
  endpoint: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  onToken: (text: string) => void,
  errorLabel: string,
  signal?: AbortSignal,
  onAuthError?: () => void,
): Promise<ChatStructuredResponse> {
  const url = `${endpoint}/v1/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    if (onAuthError && (response.status === 401 || response.status === 403)) {
      onAuthError();
    }
    await throwOnHttpError(response, errorLabel);
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
      // "thinking" and "text" block starts are intentionally ignored — content arrives via deltas
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
      // "thinking_delta" and "signature_delta" are intentionally skipped — not user-visible content
    } else if (event.type === "content_block_stop") {
      if (currentToolIndex >= 0) currentToolIndex = -1;
    } else if (event.type === "error") {
      throw new RuntimeError(`${errorLabel} stream error: ${JSON.stringify(raw.error ?? event)}`);
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

