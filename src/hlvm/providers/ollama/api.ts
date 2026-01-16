/**
 * Ollama API Helpers
 *
 * Low-level API request/response handling for Ollama.
 * Handles streaming, error handling, and response parsing.
 */

import type {
  Message,
  GenerateOptions,
  ChatOptions,
  ModelInfo,
  PullProgress,
  ProviderStatus,
} from "../types.ts";

// ============================================================================
// Request Types
// ============================================================================

/** Ollama generate request body */
interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  images?: string[];
  system?: string;
  format?: string;
  options?: {
    temperature?: number;
    num_predict?: number;
    stop?: string[];
  };
}

/** Ollama chat request body */
interface OllamaChatRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string;
    images?: string[];
  }>;
  stream?: boolean;
  format?: string;
  options?: {
    temperature?: number;
    num_predict?: number;
    stop?: string[];
  };
}

/** Ollama embeddings request body */
interface OllamaEmbeddingsRequest {
  model: string;
  input: string | string[];
}

// ============================================================================
// Response Types
// ============================================================================

/** Ollama generate streaming response chunk */
interface OllamaGenerateChunk {
  model: string;
  response: string;
  done: boolean;
}

/** Ollama chat streaming response chunk */
interface OllamaChatChunk {
  model: string;
  message?: { role: string; content: string };
  done: boolean;
}

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

// ============================================================================
// API Helpers
// ============================================================================

/**
 * Make a streaming request to Ollama
 * @param endpoint Base Ollama endpoint
 * @param path API path (e.g., "/api/generate")
 * @param body Request body
 * @param signal Optional abort signal
 */
async function* streamRequest<T>(
  endpoint: string,
  path: string,
  body: unknown,
  signal?: AbortSignal
): AsyncGenerator<T, void, unknown> {
  const url = `${endpoint}${path}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Ollama request failed: ${response.status} ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          yield JSON.parse(line) as T;
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer) as T;
      } catch {
        // Skip malformed JSON
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * Make a non-streaming request to Ollama
 */
async function jsonRequest<T>(
  endpoint: string,
  path: string,
  body?: unknown,
  method: "GET" | "POST" | "DELETE" = "POST"
): Promise<T> {
  const url = `${endpoint}${path}`;

  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Ollama request failed: ${response.status} ${text}`);
  }

  return response.json();
}

// ============================================================================
// Public API Functions
// ============================================================================

/**
 * Generate text from a prompt (streaming)
 */
export async function* generate(
  endpoint: string,
  model: string,
  prompt: string,
  options?: GenerateOptions,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const body: OllamaGenerateRequest = {
    model,
    prompt,
    stream: options?.stream !== false,
    options: {
      temperature: options?.temperature,
      num_predict: options?.maxTokens,
      stop: options?.stop,
    },
  };

  if (options?.system) body.system = options.system;
  if (options?.format) body.format = options.format;
  if (options?.images?.length) body.images = options.images;

  // Non-streaming mode
  if (!body.stream) {
    const result = await jsonRequest<{ response: string }>(
      endpoint,
      "/api/generate",
      body
    );
    yield (result.response || "").trim();
    return;
  }

  // Streaming mode
  for await (const chunk of streamRequest<OllamaGenerateChunk>(
    endpoint,
    "/api/generate",
    body,
    signal
  )) {
    if (chunk.response) {
      yield chunk.response;
    }
  }
}

/**
 * Chat completion (streaming)
 */
export async function* chat(
  endpoint: string,
  model: string,
  messages: Message[],
  options?: ChatOptions,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const ollamaMessages = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
    ...(msg.images?.length ? { images: msg.images } : {}),
  }));

  const body: OllamaChatRequest = {
    model,
    messages: ollamaMessages,
    stream: options?.stream !== false,
    options: {
      temperature: options?.temperature,
      num_predict: options?.maxTokens,
      stop: options?.stop,
    },
  };

  if (options?.format) body.format = options.format;

  // Non-streaming mode
  if (!body.stream) {
    const result = await jsonRequest<{ message: { content: string } }>(
      endpoint,
      "/api/chat",
      body
    );
    yield (result.message?.content || "").trim();
    return;
  }

  // Streaming mode
  for await (const chunk of streamRequest<OllamaChatChunk>(
    endpoint,
    "/api/chat",
    body,
    signal
  )) {
    if (chunk.message?.content) {
      yield chunk.message.content;
    }
  }
}

/**
 * Generate embeddings
 */
export async function embeddings(
  endpoint: string,
  model: string,
  text: string | string[]
): Promise<number[][]> {
  const input = Array.isArray(text) ? text : [text];

  const body: OllamaEmbeddingsRequest = {
    model,
    input,
  };

  const result = await jsonRequest<{ embeddings: number[][] }>(
    endpoint,
    "/api/embed",
    body
  );

  return result.embeddings || [];
}

/**
 * List available models
 */
export async function listModels(endpoint: string): Promise<ModelInfo[]> {
  const result = await jsonRequest<{ models: OllamaModel[] }>(
    endpoint,
    "/api/tags",
    undefined,
    "GET"
  );

  return (result.models || []).map((m) => ({
    name: m.name,
    displayName: m.name.split(":")[0],
    size: m.size,
    family: m.details?.family,
    parameterSize: m.details?.parameter_size,
    quantization: m.details?.quantization_level,
    modifiedAt: new Date(m.modified_at),
    metadata: { digest: m.digest, details: m.details },
  }));
}

/**
 * Get info about a specific model
 */
export async function getModel(
  endpoint: string,
  name: string
): Promise<ModelInfo | null> {
  try {
    const result = await jsonRequest<OllamaModel & { details: unknown }>(
      endpoint,
      "/api/show",
      { name }
    );

    return {
      name: result.name || name,
      displayName: (result.name || name).split(":")[0],
      family: (result.details as { family?: string })?.family,
      parameterSize: (result.details as { parameter_size?: string })?.parameter_size,
      quantization: (result.details as { quantization_level?: string })?.quantization_level,
      metadata: result.details,
    };
  } catch {
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
  signal?: AbortSignal
): AsyncGenerator<PullProgress, void, unknown> {
  for await (const chunk of streamRequest<OllamaPullChunk>(
    endpoint,
    "/api/pull",
    { name, stream: true },
    signal
  )) {
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
  name: string
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
    const response = await fetch(endpoint);
    if (response.ok) {
      // Try to get version
      try {
        const version = await jsonRequest<{ version: string }>(
          endpoint,
          "/api/version",
          undefined,
          "GET"
        );
        return {
          available: true,
          version: version.version,
          endpoint,
        };
      } catch {
        return { available: true, endpoint };
      }
    }
    return { available: false, error: `Status ${response.status}`, endpoint };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : "Connection failed",
      endpoint,
    };
  }
}
