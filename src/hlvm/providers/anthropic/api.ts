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
  ModelInfo,
  ProviderStatus,
} from "../types.ts";
import {
  type AnthropicResponse,
  buildRequestBody,
  buildResponse,
  streamChat,
} from "./shared.ts";

export const ANTHROPIC_VERSION = "2023-06-01";

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
// Models
// =============================================================================

/** Anthropic model listing response */
interface AnthropicModelEntry {
  id: string;
  display_name: string;
  created_at: string;
  type: "model";
}

/**
 * Fetch available models from the Anthropic API.
 * Uses GET /v1/models — returns empty array on failure.
 */
export async function listModels(
  endpoint: string,
  apiKey: string,
): Promise<ModelInfo[]> {
  const url = `${endpoint}/v1/models?limit=100`;
  const response = await fetch(url, {
    headers: authHeaders(apiKey),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return [];

  const result = await response.json() as { data: AnthropicModelEntry[] };
  return (result.data ?? [])
    .filter((m) => m.id.startsWith("claude-"))
    .map((m) => ({
      name: m.id,
      displayName: m.display_name,
      family: "claude",
      capabilities: ["chat" as const, "tools" as const, "vision" as const],
    }));
}

// =============================================================================
// Status
// =============================================================================

export async function checkStatus(
  endpoint: string,
  apiKey: string,
): Promise<ProviderStatus> {
  try {
    // Use model-agnostic endpoint — no hardcoded model IDs
    const url = `${endpoint}/v1/models?limit=1`;
    const response = await fetch(url, { headers: authHeaders(apiKey) });
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

