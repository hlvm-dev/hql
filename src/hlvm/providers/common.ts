/**
 * Shared Provider Utilities
 *
 * Common functions used across multiple provider implementations.
 * SSOT: All provider-level shared logic lives here.
 */

import { RuntimeError } from "../../common/error.ts";
import { tryParseJson } from "../../common/utils.ts";
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
 * Returns empty object on parse failure — downstream validation will
 * catch missing required fields with actionable error messages.
 * SSOT: delegates to tryParseJson from common/utils.ts.
 */
export function parseJsonArgs(args: string | unknown): unknown {
  if (typeof args !== "string") return args ?? {};
  const trimmed = args.trim();
  if (trimmed.length === 0) return {};
  return tryParseJson(trimmed, {});
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
 * Fix 10: Always includes HTTP status code for error taxonomy classification.
 * Fix 12: Includes Retry-After header when present (for rate limit handling).
 * Shared across all provider API modules.
 */
export async function throwOnHttpError(
  response: Response,
  providerName: string,
): Promise<never> {
  const text = await response.text().catch(() => "(unreadable body)");
  const extracted = extractErrorMessage(text);
  const retryAfter = response.headers.get("retry-after");
  const retryHint = retryAfter ? ` (retry-after: ${retryAfter}s)` : "";
  const body = extracted ?? text.slice(0, 500);
  throw new RuntimeError(
    `${providerName} HTTP ${response.status}${retryHint}: ${body}`,
  );
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
  let searchFrom = 0;
  // Fix 8: Track valid vs malformed chunks
  let anyValidChunk = false;
  let malformedCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let lineEnd = buffer.indexOf("\n", searchFrom);
      while (lineEnd !== -1) {
        const line = buffer.slice(searchFrom, lineEnd).trim();
        searchFrom = lineEnd + 1;

        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data !== "[DONE]") {
            try {
              yield JSON.parse(data) as T;
              anyValidChunk = true;
            } catch {
              malformedCount++;
            }
          }
        }
        lineEnd = buffer.indexOf("\n", searchFrom);
      }
      // Discard processed portion to bound memory
      if (searchFrom > 0) {
        buffer = buffer.slice(searchFrom);
        searchFrom = 0;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  // If we got data lines but ALL were malformed, the stream was corrupted
  if (!anyValidChunk && malformedCount > 0) {
    throw new RuntimeError(`SSE stream corrupted: ${malformedCount} malformed chunks, 0 valid`);
  }
}

// =============================================================================
// Signal Extraction
// =============================================================================

/**
 * Extract AbortSignal from provider options.
 * Checks `options.signal` first (typed field), then `options.raw.signal` (legacy).
 * SSOT: All providers use this instead of inline cast patterns.
 */
export function extractSignal(options?: { signal?: AbortSignal; raw?: Record<string, unknown> }): AbortSignal | undefined {
  return options?.signal ?? (options?.raw?.signal as AbortSignal | undefined);
}

// =============================================================================
// Tool Call ID Generation
// =============================================================================

/**
 * Generate a unique tool call ID.
 * Uses random base-36 string for collision resistance across turns.
 * SSOT: All providers must use this instead of index-based IDs.
 */
export function generateToolCallId(): string {
  return `call_${Math.random().toString(36).slice(2, 11)}`;
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
