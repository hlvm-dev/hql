/**
 * Anthropic Models/Status API
 *
 * Chat/generate runtime now routes through shared SDK runtime.
 * This module keeps only provider-specific model discovery and status checks.
 */

import {
  ANTHROPIC_VERSION,
  API_TIMEOUT_MS,
  checkApiStatus,
  JSON_HEADERS,
} from "../common.ts";
import { http } from "../../../common/http-client.ts";
import type { ModelInfo, ProviderStatus } from "../types.ts";

function authHeaders(apiKey: string): Record<string, string> {
  return {
    ...JSON_HEADERS,
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

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
  const response = await http.fetchRaw(url, {
    headers: authHeaders(apiKey),
    timeout: API_TIMEOUT_MS,
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

export function checkStatus(
  endpoint: string,
  apiKey: string,
): Promise<ProviderStatus> {
  return checkApiStatus(
    `${endpoint}/v1/models?limit=1`,
    { headers: authHeaders(apiKey), timeout: API_TIMEOUT_MS },
    (r) => r.status !== 401,
    (r) => r.status === 401 ? "Invalid API key" : undefined,
  );
}
