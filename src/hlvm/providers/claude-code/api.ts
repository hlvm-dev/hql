/**
 * Claude Code Subscription Models/Status API
 *
 * Chat/generate runtime now routes through shared SDK runtime.
 * This module keeps only provider-specific model discovery and status checks.
 */

import { JSON_HEADERS } from "../common.ts";
import { http } from "../../../common/http-client.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import type { ModelInfo, ProviderStatus } from "../types.ts";
import { getClaudeCodeToken } from "./auth.ts";
import { ANTHROPIC_VERSION } from "../anthropic/api.ts";

function oauthHeaders(token: string): Record<string, string> {
  return {
    ...JSON_HEADERS,
    "Authorization": `Bearer ${token}`,
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
      timeout: 8_000,
    });
    if (!response.ok) return [];

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
  } catch {
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
      timeout: 8_000,
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
