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
} from "../common.ts";
import { http } from "../../../common/http-client.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import type { ModelInfo, ProviderStatus } from "../types.ts";
import { getClaudeCodeToken } from "./auth.ts";

function oauthHeaders(token: string): Record<string, string> {
  return {
    ...bearerAuthHeaders(token),
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-beta": "oauth-2025-04-20",
  };
}

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
    const response = await http.fetchRaw(url, {
      headers: oauthHeaders(token),
      timeout: API_TIMEOUT_MS,
    });

    // Auth failure → clear token cache and return empty
    if (response.status === 401 || response.status === 403) {
      const { clearTokenCache } = await import("./auth.ts");
      clearTokenCache();
      return [];
    }

    if (!response.ok) {
      // Log non-auth failures for debugging
      const { log } = await import("../../api/log.ts");
      log.warn(
        `Claude Code model list fetch failed: ${response.status} ${response.statusText}`,
      );
      return [];
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
  } catch (error) {
    // Log unexpected errors for debugging
    const { log } = await import("../../api/log.ts");
    const { getErrorMessage } = await import("../../../common/utils.ts");
    log.warn(
      `Claude Code model list fetch error: ${getErrorMessage(error)}`,
    );
    return [];
  }
}

export async function checkStatus(
  endpoint: string,
): Promise<ProviderStatus> {
  try {
    const token = await getClaudeCodeToken();
    // Use model-agnostic endpoint — no hardcoded model IDs
    const url = `${endpoint}/v1/models?limit=1`;
    const response = await http.fetchRaw(url, {
      headers: oauthHeaders(token),
      timeout: API_TIMEOUT_MS,
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
