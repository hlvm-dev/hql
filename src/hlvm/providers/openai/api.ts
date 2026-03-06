/**
 * OpenAI Models/Status API
 *
 * Chat/generate runtime now routes through shared SDK runtime.
 * This module keeps only provider-specific model discovery and status checks.
 */

import { API_TIMEOUT_MS, bearerAuthHeaders } from "../common.ts";
import { http } from "../../../common/http-client.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import type { ModelInfo, ProviderStatus } from "../types.ts";

/** Non-chat model prefixes to exclude from listing */
const NON_CHAT_PREFIXES = [
  "dall-e",
  "whisper",
  "tts",
  "text-embedding",
  "davinci",
  "babbage",
  "ft:",
];

function isChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  return !NON_CHAT_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export async function listModels(
  endpoint: string,
  apiKey: string,
): Promise<ModelInfo[]> {
  const url = `${endpoint}/v1/models`;
  const response = await http.fetchRaw(url, {
    headers: bearerAuthHeaders(apiKey),
    timeout: API_TIMEOUT_MS,
  });
  if (!response.ok) return [];

  const result = await response.json() as {
    data: { id: string; created: number; owned_by: string }[];
  };
  return (result.data ?? [])
    .filter((m) => isChatModel(m.id))
    .map((m) => ({
      name: m.id,
      displayName: m.id,
      family: m.owned_by,
      capabilities: ["chat" as const, "tools" as const, "vision" as const],
    }));
}

export async function checkStatus(
  endpoint: string,
  apiKey: string,
): Promise<ProviderStatus> {
  try {
    const url = `${endpoint}/v1/models`;
    const response = await http.fetchRaw(url, {
      headers: bearerAuthHeaders(apiKey),
      timeout: API_TIMEOUT_MS,
    });
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
