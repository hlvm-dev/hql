/**
 * Shared Provider Utilities
 *
 * Common functions used across multiple provider implementations.
 * SSOT: All provider-level shared logic lives here.
 */

import { RuntimeError } from "../../common/error.ts";

// =============================================================================
// Constants
// =============================================================================

export const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

/** Standard timeout for provider API requests (model listing, status checks). */
export const API_TIMEOUT_MS = 8_000;

/** Cache TTL for model catalogs (1 hour). */
export const CATALOG_CACHE_TTL_MS = 60 * 60 * 1000;

/** Anthropic API version header value. Used by Anthropic and Claude Code providers. */
export const ANTHROPIC_VERSION = "2023-06-01";

/** Build Bearer auth headers with JSON content type. Used by OpenAI and Claude Code. */
export function bearerAuthHeaders(token: string): Record<string, string> {
  return {
    ...JSON_HEADERS,
    "Authorization": `Bearer ${token}`,
  };
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
    if (typeof err?.message === "string") {
      const suffixes: string[] = [];
      if (typeof err.type === "string") suffixes.push(`type: ${err.type}`);
      if (err.code !== undefined) suffixes.push(`code: ${err.code}`);
      return suffixes.length > 0
        ? `${err.message} [${suffixes.join(", ")}]`
        : err.message;
    }
  } catch { /* not JSON or unexpected shape */ }
  return null;
}

/**
 * Throw a RuntimeError for a failed HTTP response.
 * Parses the response body to extract the provider's human-readable error message.
 * Always includes HTTP status code (for error taxonomy classification) and
 * Retry-After header when present (for rate limit handling).
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
// Signal Extraction
// =============================================================================

/**
 * Extract AbortSignal from provider options.
 * SSOT: All providers use the typed `options.signal` field.
 */
export function extractSignal(
  options?: { signal?: AbortSignal },
): AbortSignal | undefined {
  return options?.signal;
}
