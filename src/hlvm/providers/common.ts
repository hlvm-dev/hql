/**
 * Shared Provider Utilities
 *
 * Common functions used across multiple provider implementations.
 * SSOT: All provider-level shared logic lives here.
 */

import { RuntimeError } from "../../common/error.ts";
import type { ProviderToolCall } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

export const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

// =============================================================================
// API Key Validation
// =============================================================================

/**
 * Throw immediately if API key is empty.
 * Avoids a network round-trip that will definitely fail with a cryptic error.
 */
export function requireApiKey(apiKey: string, providerName: string): void {
  if (!apiKey) {
    throw new RuntimeError(
      `${providerName}: API key not configured. Set ${providerName.toUpperCase().replace(/\s+/g, "_")}_API_KEY environment variable.`,
    );
  }
}

// =============================================================================
// JSON Parsing
// =============================================================================

/**
 * Safely parse a JSON string argument to an object.
 * Returns empty object on parse failure (malformed LLM output).
 */
export function parseJsonArgs(args: string | unknown): unknown {
  if (typeof args !== "string") return args ?? {};
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}

// =============================================================================
// HTTP Helpers
// =============================================================================

/**
 * Extract human-readable error message from provider API error responses.
 *
 * All 3 providers nest the message at `error.message`:
 *   OpenAI:    { error: { message, type, code, param } }
 *   Anthropic: { type: "error", error: { type, message } }
 *   Google:    { error: { code, message, status, details? } }
 */
function extractErrorMessage(text: string): string | null {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const err = json.error as Record<string, unknown> | undefined;
    if (typeof err?.message === "string") return err.message;
  } catch { /* not JSON or unexpected shape */ }
  return null;
}

/**
 * Throw a RuntimeError for a failed HTTP response.
 * Parses the response body to extract the provider's human-readable error message.
 * Shared across all provider API modules.
 */
export async function throwOnHttpError(
  response: Response,
  providerName: string,
): Promise<never> {
  const text = await response.text().catch(() => "");
  const message = extractErrorMessage(text) ?? `HTTP ${response.status}`;
  throw new RuntimeError(`${providerName}: ${message}`);
}

// =============================================================================
// SSE Stream Reader
// =============================================================================

/**
 * Read an SSE (Server-Sent Events) stream line by line.
 * Handles buffering, decoding, and "data: " prefix stripping.
 * Used by OpenAI, Anthropic, and Google streaming implementations.
 *
 * Yields parsed JSON objects from "data: ..." lines.
 * Skips "[DONE]" markers and malformed lines.
 */
export async function* readSSEStream<T>(
  response: Response,
): AsyncGenerator<T, void, unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new RuntimeError("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let lineEnd = buffer.indexOf("\n");
      while (lineEnd !== -1) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);

        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            lineEnd = buffer.indexOf("\n");
            continue;
          }
          try {
            yield JSON.parse(data) as T;
          } catch { /* skip malformed chunks */ }
        }
        lineEnd = buffer.indexOf("\n");
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// =============================================================================
// Tool Call Builders
// =============================================================================

/**
 * Build a ProviderToolCall from raw id/name/arguments.
 * Normalizes arguments through parseJsonArgs.
 */
export function buildToolCall(
  id: string,
  name: string,
  args: string | unknown,
): ProviderToolCall {
  return {
    id,
    type: "function",
    function: { name, arguments: parseJsonArgs(args) },
  };
}
