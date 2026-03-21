/**
 * Google Gemini Models/Status API
 *
 * Chat/generate runtime now routes through shared SDK runtime.
 * This module keeps only provider-specific model discovery and status checks.
 */

import { API_TIMEOUT_MS, checkApiStatus } from "../common.ts";
import { http } from "../../../common/http-client.ts";
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

export function checkStatus(
  endpoint: string,
  apiKey: string,
): Promise<ProviderStatus> {
  return checkApiStatus(`${endpoint}/v1beta/models?key=${apiKey}`, {
    timeout: API_TIMEOUT_MS,
  });
}
