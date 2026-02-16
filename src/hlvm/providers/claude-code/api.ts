/**
 * Claude Code Subscription API
 *
 * Same Anthropic Messages API, different auth: OAuth Bearer token
 * from your Claude Max subscription instead of x-api-key.
 *
 * Shared message conversion/extraction logic in ../anthropic/shared.ts.
 * Only auth headers and token lifecycle differ.
 */

import {
  JSON_HEADERS,
  throwOnHttpError,
} from "../common.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import type {
  ChatOptions,
  ChatStructuredResponse,
  Message,
  ProviderStatus,
} from "../types.ts";
import { getClaudeCodeToken, clearTokenCache } from "./auth.ts";
import {
  type AnthropicResponse,
  buildRequestBody,
  buildResponse,
  streamChat,
} from "../anthropic/shared.ts";

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
  const { body, useStreaming } = buildRequestBody(model, messages, options);

  if (useStreaming) {
    return streamChat(
      endpoint, body, oauthHeaders(token), options!.onToken!,
      "Claude Code", signal, clearTokenCache,
    );
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
      clearTokenCache();
    }
    await throwOnHttpError(response, "Claude Code");
  }

  const result = await response.json() as AnthropicResponse;
  return buildResponse(result);
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

