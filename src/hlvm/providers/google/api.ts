/**
 * Google Gemini Models/Status API
 *
 * Chat/generate runtime now routes through shared SDK runtime.
 * This module keeps only provider-specific model discovery and status checks.
 */

import { API_TIMEOUT_MS } from "../common.ts";
import { http } from "../../../common/http-client.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import type { ModelInfo, ProviderStatus } from "../types.ts";

export async function listModels(
  endpoint: string,
  apiKey: string,
): Promise<ModelInfo[]> {
  const url = `${endpoint}/v1beta/models?key=${apiKey}`;
  const response = await http.fetchRaw(url, {
    timeout: API_TIMEOUT_MS,
  });
  if (!response.ok) return [];

  const result = await response.json() as {
    models: {
      name: string;
      displayName: string;
      description: string;
      inputTokenLimit?: number;
    }[];
  };
  return (result.models ?? [])
    .filter((m) => m.name.includes("gemini"))
    .map((m) => ({
      name: m.name.replace("models/", ""),
      displayName: m.displayName,
      family: "gemini",
      contextWindow: m.inputTokenLimit,
    }));
}

export async function checkStatus(
  endpoint: string,
  apiKey: string,
): Promise<ProviderStatus> {
  try {
    const url = `${endpoint}/v1beta/models?key=${apiKey}`;
    const response = await http.fetchRaw(url, { timeout: API_TIMEOUT_MS });
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
