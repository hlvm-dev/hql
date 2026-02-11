/**
 * Google Generative AI API
 *
 * Low-level HTTP calls to the Google Gemini API.
 * Handles the unique message format (contents/parts, functionDeclarations, etc.)
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
import type {
  ChatOptions,
  ChatStructuredResponse,
  Message,
  ModelInfo,
  ProviderStatus,
  ProviderToolCall,
} from "../types.ts";

// =============================================================================
// Message Conversion
// =============================================================================

interface GooglePart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: { content: string } };
}

interface GoogleContent {
  role: "user" | "model";
  parts: GooglePart[];
}

/**
 * Convert provider messages to Google format.
 * Key differences:
 * - System messages become `systemInstruction` (returned separately)
 * - Assistant = "model" role
 * - Tool calls = functionCall parts, tool results = functionResponse parts
 * - No "tool" role -- tool results are user messages with functionResponse parts
 */
function convertMessages(
  messages: Message[],
): { systemInstruction: string; contents: GoogleContent[] } {
  let systemInstruction = "";
  const contents: GoogleContent[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction += (systemInstruction ? "\n" : "") + msg.content;
      continue;
    }

    if (msg.role === "assistant" && msg.tool_calls?.length) {
      const parts: GooglePart[] = [];
      if (msg.content) parts.push({ text: msg.content });
      for (const tc of msg.tool_calls) {
        const args = typeof tc.function.arguments === "string"
          ? parseJsonArgs(tc.function.arguments)
          : tc.function.arguments ?? {};
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: args as Record<string, unknown>,
          },
        });
      }
      pushContent(contents, { role: "model", parts });
      continue;
    }

    if (msg.role === "tool") {
      pushContent(contents, {
        role: "user",
        parts: [{
          functionResponse: {
            name: msg.tool_name ?? "unknown",
            response: { content: msg.content },
          },
        }],
      });
      continue;
    }

    if (msg.role === "assistant") {
      pushContent(contents, { role: "model", parts: [{ text: msg.content }] });
    } else {
      pushContent(contents, { role: "user", parts: [{ text: msg.content }] });
    }
  }

  return { systemInstruction, contents };
}

/** Merge consecutive same-role messages */
function pushContent(result: GoogleContent[], content: GoogleContent): void {
  const last = result[result.length - 1];
  if (last && last.role === content.role) {
    last.parts.push(...content.parts);
  } else {
    result.push(content);
  }
}

// =============================================================================
// Response Extraction
// =============================================================================

interface GoogleResponse {
  candidates: {
    content: { role: string; parts: GooglePart[] };
    finishReason: string;
  }[];
}

function extractContent(response: GoogleResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => p.text !== undefined)
    .map((p) => p.text!)
    .join("");
}

function extractToolCalls(response: GoogleResponse): ProviderToolCall[] {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => p.functionCall !== undefined)
    .map((p) => ({
      id: generateToolCallId(),
      type: "function",
      function: {
        name: p.functionCall!.name,
        arguments: p.functionCall!.args,
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
  requireApiKey(apiKey, "Google");
  const onToken = options?.onToken;
  const useStreaming = typeof onToken === "function";
  const { systemInstruction, contents } = convertMessages(messages);

  const body: Record<string, unknown> = { contents };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const genConfig: Record<string, unknown> = {};
  if (options?.temperature !== undefined) genConfig.temperature = options.temperature;
  if (options?.maxTokens) genConfig.maxOutputTokens = options.maxTokens;
  if (options?.stop?.length) genConfig.stopSequences = options.stop;
  if (Object.keys(genConfig).length > 0) body.generationConfig = genConfig;

  if (options?.tools?.length) {
    body.tools = [{
      functionDeclarations: options.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description ?? "",
        parameters: t.function.parameters,
      })),
    }];
  }

  if (useStreaming) {
    return streamChat(endpoint, model, body, apiKey, onToken!, signal);
  }

  const url = `${endpoint}/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    await throwOnHttpError(response, "Google AI");
  }

  const result = await response.json() as GoogleResponse;
  return {
    content: extractContent(result),
    toolCalls: extractToolCalls(result),
  };
}

async function streamChat(
  endpoint: string,
  model: string,
  body: Record<string, unknown>,
  apiKey: string,
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<ChatStructuredResponse> {
  const url = `${endpoint}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    await throwOnHttpError(response, "Google AI");
  }

  const contentChunks: string[] = [];
  // Fix 6: Track tool calls by index to avoid duplicates across chunks
  const toolCallMap = new Map<number, { name: string; args: Record<string, unknown> }>();

  for await (const chunk of readSSEStream<GoogleResponse>(response)) {
    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j];
      if (part.text) {
        contentChunks.push(part.text);
        onToken(part.text);
      }
      if (part.functionCall) {
        const existing = toolCallMap.get(j);
        if (existing) {
          // Merge args from subsequent chunks
          if (part.functionCall.args) {
            Object.assign(existing.args, part.functionCall.args);
          }
        } else {
          toolCallMap.set(j, {
            name: part.functionCall.name,
            args: part.functionCall.args ?? {},
          });
        }
      }
    }
  }

  const toolCalls: ProviderToolCall[] = [...toolCallMap.values()].map((tc) => ({
    id: generateToolCallId(),
    type: "function",
    function: { name: tc.name, arguments: tc.args },
  }));

  return { content: contentChunks.join(""), toolCalls };
}

// =============================================================================
// Models & Status
// =============================================================================

export async function listModels(
  endpoint: string,
  apiKey: string,
): Promise<ModelInfo[]> {
  const url = `${endpoint}/v1beta/models?key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) return [];

  const result = await response.json() as {
    models: { name: string; displayName: string; description: string }[];
  };
  return (result.models ?? [])
    .filter((m) => m.name.includes("gemini"))
    .map((m) => ({
      name: m.name.replace("models/", ""),
      displayName: m.displayName,
      family: "gemini",
    }));
}

export async function checkStatus(
  endpoint: string,
  apiKey: string,
): Promise<ProviderStatus> {
  try {
    const url = `${endpoint}/v1beta/models?key=${apiKey}`;
    const response = await fetch(url);
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
