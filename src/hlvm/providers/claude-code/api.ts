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
  ModelInfo,
  ProviderStatus,
} from "../types.ts";
import { getClaudeCodeToken, clearTokenCache } from "./auth.ts";
import {
  type AnthropicResponse,
  buildRequestBody,
  buildResponse,
  streamChat,
} from "../anthropic/shared.ts";
import { ANTHROPIC_VERSION } from "../anthropic/api.ts";

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
// Models
// =============================================================================

/**
 * Fetch available models via OAuth auth.
 * Same Anthropic /v1/models endpoint, different auth header.
 */
export async function listModels(
  endpoint: string,
): Promise<ModelInfo[]> {
  try {
    const token = await getClaudeCodeToken();
    const url = `${endpoint}/v1/models?limit=100`;
    const response = await fetch(url, {
      headers: oauthHeaders(token),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];

    const result = await response.json() as { data: { id: string; display_name: string }[] };
    return (result.data ?? [])
      .filter((m) => m.id.startsWith("claude-"))
      .map((m) => ({
        name: m.id,
        displayName: m.display_name,
        family: "claude",
        capabilities: ["chat" as const, "tools" as const, "vision" as const],
      }));
  } catch {
    return [];
  }
}

// =============================================================================
// Status
// =============================================================================

export async function checkStatus(
  endpoint: string,
): Promise<ProviderStatus> {
  try {
    const token = await getClaudeCodeToken();
    // Use model-agnostic endpoint — no hardcoded model IDs
    const url = `${endpoint}/v1/models?limit=1`;
    const response = await fetch(url, { headers: oauthHeaders(token) });
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

