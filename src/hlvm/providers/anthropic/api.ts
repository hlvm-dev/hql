/**
 * Anthropic Messages API
 *
 * Low-level HTTP calls to the Anthropic API.
 * Handles the unique message format (system as top-level param,
 * tool_use/tool_result content blocks, etc.)
 */

import {
  generateToolCallId,
  JSON_HEADERS,
  parseJsonArgs,
  readSSEStream,
  requireApiKey,
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

const ANTHROPIC_VERSION = "2023-06-01";

function authHeaders(apiKey: string): Record<string, string> {
  return {
    ...JSON_HEADERS,
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

// =============================================================================
// Message Conversion
// =============================================================================

/**
 * Anthropic content block types.
 * Tool calls come as tool_use blocks, tool results as tool_result blocks.
 */
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

/**
 * Convert provider messages to Anthropic format.
 * Key differences:
 * - System messages extracted as top-level param (returned separately)
 * - Tool results become user messages with tool_result content blocks
 * - Assistant tool_calls become assistant messages with tool_use content blocks
 * - Consecutive same-role messages must be merged
 */
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
      // Anthropic: tool results are user messages with tool_result content blocks
      // Prefer explicit tool_call_id, fall back to searching assistant messages
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

    // Regular user/assistant message
    const role = msg.role === "user" ? "user" : "assistant";
    pushMessage(result, { role, content: msg.content });
  }

  return { system, messages: result };
}

/** Merge consecutive same-role messages (Anthropic requires alternating roles) */
function pushMessage(result: AnthropicMessage[], msg: AnthropicMessage): void {
  const last = result[result.length - 1];
  if (last && last.role === msg.role) {
    // Merge content
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

/** Find an unconsumed tool_use id from assistant messages for a given tool name */
function findToolUseId(
  messages: AnthropicMessage[],
  toolName: string | undefined,
  consumed: Set<string>,
): string {
  // Fix 7: Don't guess when toolName is unknown — generate new ID to avoid wrong matches
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
  apiKey: string,
  options?: ChatOptions,
  signal?: AbortSignal,
): Promise<ChatStructuredResponse> {
  requireApiKey(apiKey, "Anthropic");
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
    // Convert OpenAI-format tool defs to Anthropic format
    body.tools = options.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description ?? "",
      input_schema: t.function.parameters,
    }));
  }

  if (useStreaming) {
    return streamChat(endpoint, body, apiKey, onToken!, signal);
  }

  const url = `${endpoint}/v1/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    await throwOnHttpError(response, "Anthropic");
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
  apiKey: string,
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<ChatStructuredResponse> {
  const url = `${endpoint}/v1/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    await throwOnHttpError(response, "Anthropic");
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
      throw new RuntimeError(`Anthropic stream error: ${JSON.stringify(raw.error ?? event)}`);
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
  apiKey: string,
): Promise<ProviderStatus> {
  try {
    const url = `${endpoint}/v1/messages`;
    // Anthropic has no health endpoint; a minimal request with bad input returns 400 (not 401)
    const response = await fetch(url, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ model: "claude-sonnet-4-5-20250929", max_tokens: 1, messages: [] }),
    });
    // 400 = API reachable + key valid; 401 = bad key; 200 = ok
    return {
      available: response.status !== 401,
      error: response.status === 401 ? "Invalid API key" : undefined,
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
 * Anthropic format: "prompt is too long: N tokens > M token limit"
 */
export function parseOverflowError(err: unknown): ContextOverflowInfo {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes("prompt is too long") || msg.includes("token limit") || msg.includes("too many tokens")) {
    // "prompt is too long: 123456 tokens > 200000 token limit"
    const match = msg.match(/(\d+)\s*tokens?\s*>\s*(\d+)/);
    if (match) {
      return { isOverflow: true, limitTokens: parseInt(match[2]), confidence: "high" };
    }
    return { isOverflow: true, confidence: "low" };
  }
  return { isOverflow: false, confidence: "low" };
}
