/**
 * Ollama API Helpers
 *
 * Low-level API request/response handling for Ollama model management/status.
 * Chat/generate runtime now routes through shared SDK runtime.
 *
 * Note: Ollama uses NDJSON streaming for model pull progress.
 */

import { RuntimeError } from "../../../common/error.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import { http } from "../../../common/http-client.ts";
import { parseJsonLine } from "../../../common/jsonl.ts";
import { createAbortError } from "../../../common/timeout-utils.ts";
import { API_TIMEOUT_MS, JSON_HEADERS, throwOnHttpError } from "../common.ts";
import type {
  ModelInfo,
  ProviderCapability,
  ProviderStatus,
  PullProgress,
} from "../types.ts";

// ============================================================================
// Response Types
// ============================================================================

/** Ollama model info from /api/tags */
interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

/** Ollama pull progress response */
interface OllamaPullChunk {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

/** Running model entry from /api/ps */
interface OllamaRunningModel {
  name?: string;
  model?: string;
  context_length?: number;
}

interface OllamaShowResponse extends OllamaModel {
  details?: OllamaModel["details"];
  model_info?: Record<string, unknown>;
  capabilities?: string[];
}

function normalizeModelName(modelName: string): string {
  const normalized = modelName.trim().toLowerCase();
  const slashIdx = normalized.indexOf("/");
  return slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized;
}

function modelBaseName(modelName: string): string {
  const colonIdx = modelName.indexOf(":");
  return colonIdx >= 0 ? modelName.slice(0, colonIdx) : modelName;
}

function extractCapabilities(
  rawCapabilities: string[] | undefined,
  hasVision: boolean,
): ProviderCapability[] {
  const capabilities = new Set<ProviderCapability>();
  const raw = rawCapabilities ?? [];

  for (const capability of raw) {
    switch (capability) {
      case "completion":
        capabilities.add("generate");
        capabilities.add("chat");
        break;
      case "chat":
        capabilities.add("chat");
        break;
      case "tools":
        capabilities.add("tools");
        break;
      case "vision":
        capabilities.add("vision");
        break;
      case "thinking":
        capabilities.add("thinking");
        break;
      case "audio":
        capabilities.add("media.audioInput");
        break;
      default:
        break;
    }
  }

  if (!capabilities.has("chat")) {
    capabilities.add("chat");
  }
  if (hasVision) {
    capabilities.add("vision");
  }

  return [...capabilities];
}

// ============================================================================
// API Helpers
// ============================================================================

/**
 * Make a streaming NDJSON request to Ollama.
 * Ollama uses newline-delimited JSON, NOT Server-Sent Events.
 */
async function* streamRequest<T>(
  endpoint: string,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<T, void, unknown> {
  const url = `${endpoint}${path}`;

  // Streaming NDJSON pull still uses the SSOT HTTP client, while retaining
  // direct access to the raw Response body reader.
  const response = await http.fetchRaw(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    signal,
    timeout: 60_000,
  });

  if (!response.ok) {
    await throwOnHttpError(response, "Ollama");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new RuntimeError("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let searchFrom = 0;

  const handleAbort = () => {
    reader.cancel().catch(() => {});
  };

  if (signal?.aborted) {
    throw createAbortError();
  }

  signal?.addEventListener("abort", handleAbort, { once: true });

  try {
    while (true) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const { done, value } = await reader.read();
      if (done) break;

      if (signal?.aborted) {
        throw createAbortError();
      }

      buffer += decoder.decode(value, { stream: true });
      let lineEndIndex = buffer.indexOf("\n", searchFrom);
      while (lineEndIndex !== -1) {
        const line = buffer.slice(searchFrom, lineEndIndex);
        searchFrom = lineEndIndex + 1;
        const parsed = parseJsonLine<T>(line);
        if (parsed !== undefined) {
          yield parsed;
        }
        lineEndIndex = buffer.indexOf("\n", searchFrom);
      }
      // Discard processed portion to bound memory
      if (searchFrom > 0) {
        buffer = buffer.slice(searchFrom);
        searchFrom = 0;
      }
    }

    if (signal?.aborted) {
      throw createAbortError();
    }

    // Process remaining buffer
    const parsed = parseJsonLine<T>(buffer);
    if (parsed !== undefined) {
      yield parsed;
    }
  } finally {
    signal?.removeEventListener("abort", handleAbort);
    reader.cancel().catch(() => {});
  }
}

/**
 * Make a non-streaming request to Ollama.
 * Accepts optional AbortSignal for cancellation.
 */
async function jsonRequest<T>(
  endpoint: string,
  path: string,
  body?: unknown,
  method: "GET" | "POST" | "DELETE" = "POST",
  signal?: AbortSignal,
): Promise<T> {
  const url = `${endpoint}${path}`;
  const response = await http.fetchRaw(url, {
    method,
    headers: JSON_HEADERS,
    signal,
    timeout: API_TIMEOUT_MS,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    await throwOnHttpError(response, "Ollama");
  }

  return response.json();
}

// ============================================================================
// Public API Functions
// ============================================================================

/**
 * List available models
 */
export async function listModels(endpoint: string): Promise<ModelInfo[]> {
  const result = await jsonRequest<{ models: OllamaModel[] }>(
    endpoint,
    "/api/tags",
    undefined,
    "GET",
  );

  return (result.models || []).map((m) => {
    const families = m.details?.families ?? [];
    const hasVision = families.some((f) => f === "clip" || f === "mllama");
    const capabilities: import("../types.ts").ProviderCapability[] = ["chat"];
    if (hasVision) capabilities.push("vision");

    return {
      name: m.name,
      displayName: m.name.split(":")[0],
      size: m.size,
      family: m.details?.family,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level,
      modifiedAt: new Date(m.modified_at),
      capabilities,
      metadata: { digest: m.digest, details: m.details },
    };
  });
}

/**
 * Get the currently loaded runtime context length for a model from /api/ps.
 * Returns null when the model is not loaded or the server does not expose it.
 */
async function getLoadedModelContext(
  endpoint: string,
  modelName: string,
): Promise<number | null> {
  try {
    const result = await jsonRequest<{ models?: OllamaRunningModel[] }>(
      endpoint,
      "/api/ps",
      undefined,
      "GET",
    );
    const models = result.models ?? [];
    const target = normalizeModelName(modelName);

    const candidateNames = (m: OllamaRunningModel) =>
      [m.model, m.name].filter((v): v is string => typeof v === "string");

    const match = models.find((m) =>
      candidateNames(m).some((c) => normalizeModelName(c) === target)
    ) ?? models.find((m) =>
      candidateNames(m).some((c) =>
        modelBaseName(normalizeModelName(c)) === modelBaseName(target)
      )
    );

    const contextLength = match?.context_length;
    return typeof contextLength === "number" && contextLength > 0
      ? contextLength
      : null;
  } catch {
    return null;
  }
}

/**
 * Get info about a specific model
 */
export async function getModel(
  endpoint: string,
  name: string,
): Promise<ModelInfo | null> {
  const loadedContext = await getLoadedModelContext(endpoint, name);

  try {
    const result = await jsonRequest<OllamaShowResponse>(
      endpoint,
      "/api/show",
      { name },
    );

    const families = (result.details as { families?: string[] })?.families ?? [];
    const hasVision = families.some((f) => f === "clip" || f === "mllama");

    // Extract context_length from model_info (key varies by architecture, e.g. "llama.context_length")
    let contextWindow: number | undefined;
    if (result.model_info) {
      const ctxKey = Object.keys(result.model_info).find((k) =>
        k.endsWith(".context_length")
      );
      if (ctxKey && typeof result.model_info[ctxKey] === "number") {
        contextWindow = result.model_info[ctxKey] as number;
      }
    }
    contextWindow = loadedContext ?? contextWindow;

    return {
      name: result.name || name,
      displayName: (result.name || name).split(":")[0],
      family: (result.details as { family?: string })?.family,
      parameterSize: (result.details as { parameter_size?: string })
        ?.parameter_size,
      quantization: (result.details as { quantization_level?: string })
        ?.quantization_level,
      capabilities: extractCapabilities(result.capabilities, hasVision),
      metadata: {
        details: result.details,
        capabilities: result.capabilities,
      },
      contextWindow,
    };
  } catch {
    if (loadedContext) {
      return {
        name,
        displayName: name.split(":")[0],
        contextWindow: loadedContext,
      };
    }
    return null;
  }
}

/**
 * Pull/download a model (streaming progress)
 * @param endpoint Ollama endpoint URL
 * @param name Model name to pull
 * @param signal Optional abort signal for cancellation
 */
export async function* pullModel(
  endpoint: string,
  name: string,
  signal?: AbortSignal,
): AsyncGenerator<PullProgress, void, unknown> {
  for await (
    const chunk of streamRequest<OllamaPullChunk>(
      endpoint,
      "/api/pull",
      { name, stream: true },
      signal,
    )
  ) {
    const progress: PullProgress = {
      status: chunk.status,
      digest: chunk.digest,
      total: chunk.total,
      completed: chunk.completed,
    };

    if (chunk.total && chunk.completed) {
      progress.percent = Math.round((chunk.completed / chunk.total) * 100);
    }

    yield progress;
  }
}

/**
 * Remove/delete a model
 */
export async function removeModel(
  endpoint: string,
  name: string,
): Promise<boolean> {
  try {
    await jsonRequest(endpoint, "/api/delete", { name }, "DELETE");
    return true;
  } catch {
    return false;
  }
}

/**
 * Check Ollama status
 */
export async function checkStatus(endpoint: string): Promise<ProviderStatus> {
  try {
    // Ollama returns empty response on /
    const response = await http.fetchRaw(endpoint, { timeout: API_TIMEOUT_MS });
    if (response.ok) {
      // Try to get version
      try {
        const version = await jsonRequest<{ version: string }>(
          endpoint,
          "/api/version",
          undefined,
          "GET",
        );
        return {
          available: true,
          version: version.version,
        };
      } catch {
        return { available: true };
      }
    }
    return { available: false, error: `Status ${response.status}` };
  } catch (err) {
    return {
      available: false,
      error: getErrorMessage(err),
    };
  }
}
