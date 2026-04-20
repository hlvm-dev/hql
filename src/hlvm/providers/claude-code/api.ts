/**
 * Claude Code Subscription Models/Status API
 *
 * Chat/generate runtime now routes through shared SDK runtime.
 * This module keeps only provider-specific model discovery and status checks.
 */

import {
  ANTHROPIC_VERSION,
  API_TIMEOUT_MS,
  bearerAuthHeaders,
  classifyProviderErrorCode,
  extractProviderErrorMessage,
  formatProviderFailureMessage,
} from "../common.ts";
import { RuntimeError } from "../../../common/error.ts";
import { ProviderErrorCode } from "../../../common/error-codes.ts";
import { http } from "../../../common/http-client.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import type { ModelInfo, ProviderStatus } from "../types.ts";
import { clearTokenCache, getClaudeCodeToken } from "./auth.ts";
import {
  claudeCodeAuthError,
  forbidden403Message,
  tokenInvalid401Message,
} from "./errors.ts";

function oauthHeaders(token: string): Record<string, string> {
  return {
    ...bearerAuthHeaders(token),
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-beta": "oauth-2025-04-20",
  };
}

async function fetchWithOAuthRetry(
  url: string,
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getClaudeCodeToken();
    const response = await http.fetchRaw(url, {
      headers: oauthHeaders(token),
      timeout: API_TIMEOUT_MS,
    });
    if (response.status !== 401 || attempt > 0) {
      return response;
    }
    await response.body?.cancel().catch(() => {});
    clearTokenCache();
  }

  throw new RuntimeError(
    "Claude Code model discovery retry exhausted unexpectedly.",
    { code: ProviderErrorCode.REQUEST_FAILED },
  );
}

async function throwModelListFailure(response: Response): Promise<never> {
  const responseBody = await response.text().catch(() => "");
  const detail = extractProviderErrorMessage(responseBody) ??
    `${response.status} ${response.statusText}`.trim();

  if (response.status === 403) {
    throw claudeCodeAuthError(forbidden403Message(detail));
  }
  if (response.status === 401) {
    clearTokenCache();
    throw claudeCodeAuthError(tokenInvalid401Message(detail));
  }

  const code = classifyProviderErrorCode(response.status, detail);
  throw new RuntimeError(
    formatProviderFailureMessage({
      providerName: "claude-code",
      code,
      status: response.status,
      responseBody,
      fallbackMessage: detail,
    }),
    { code },
  );
}

/**
 * Fetch available models via OAuth auth.
 * Same Anthropic /v1/models endpoint, different auth header.
 */
export async function listModels(
  endpoint: string,
): Promise<ModelInfo[]> {
  const url = `${endpoint}/v1/models?limit=100`;
  const response = await fetchWithOAuthRetry(url);

  if (!response.ok) {
    await throwModelListFailure(response);
  }

  const result = await response.json() as {
    data: { id: string; display_name: string }[];
  };
  return (result.data ?? [])
    .filter((m) => m.id.startsWith("claude-"))
    .map((m) => ({
      name: m.id,
      displayName: m.display_name,
      family: "claude",
      capabilities: ["chat" as const, "tools" as const, "vision" as const],
    }));
}

export async function checkStatus(
  endpoint: string,
): Promise<ProviderStatus> {
  try {
    // Use model-agnostic endpoint — no hardcoded model IDs
    const url = `${endpoint}/v1/models?limit=1`;
    const response = await fetchWithOAuthRetry(url);
    if (response.status === 403) {
      return { available: false, error: forbidden403Message("") };
    }
    if (response.status === 401) {
      return { available: false, error: tokenInvalid401Message("") };
    }
    return { available: true };
  } catch (error) {
    return {
      available: false,
      error: getErrorMessage(error),
    };
  }
}
