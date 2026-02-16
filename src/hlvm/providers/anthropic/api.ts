/**
 * Anthropic Messages API
 *
 * Low-level HTTP calls to the Anthropic API.
 * Auth: x-api-key header. Shared logic in ./shared.ts.
 */

import {
  JSON_HEADERS,
  requireApiKey,
  throwOnHttpError,
} from "../common.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import type {
  ChatOptions,
  ChatStructuredResponse,
  Message,
  ProviderStatus,
} from "../types.ts";
import {
  type AnthropicResponse,
  buildRequestBody,
  buildResponse,
  streamChat,
  parseOverflowError as _parseOverflowError,
} from "./shared.ts";

const ANTHROPIC_VERSION = "2023-06-01";

function authHeaders(apiKey: string): Record<string, string> {
  return {
    ...JSON_HEADERS,
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
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
  const { body, useStreaming } = buildRequestBody(model, messages, options);

  if (useStreaming) {
    return streamChat(endpoint, body, authHeaders(apiKey), options!.onToken!, "Anthropic", signal);
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
  return buildResponse(result);
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
    const response = await fetch(url, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ model: "claude-sonnet-4-5-20250929", max_tokens: 1, messages: [] }),
    });
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

export { _parseOverflowError as parseOverflowError };
