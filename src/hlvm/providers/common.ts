/**
 * Shared Provider Utilities
 *
 * Common functions used across multiple provider implementations.
 * SSOT: All provider-level shared logic lives here.
 */

import { RuntimeError } from "../../common/error.ts";
import { ProviderErrorCode, getErrorFixes } from "../../common/error-codes.ts";
import { http } from "../../common/http-client.ts";
import { escapeRegExp, getErrorMessage, truncate } from "../../common/utils.ts";
import type { ProviderStatus } from "./types.ts";

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
function pickProviderErrorText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = pickProviderErrorText(item);
      if (text) return text;
    }
    return null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (
    const key of [
      "error",
      "message",
      "detail",
      "description",
      "error_description",
      "details",
      "errors",
    ]
  ) {
    const text = pickProviderErrorText(record[key]);
    if (text) return text;
  }

  return null;
}

export function extractProviderErrorMessage(text: string): string | null {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    return pickProviderErrorText(json);
  } catch { /* not JSON or unexpected shape */ }
  return null;
}

function providerDisplayName(providerName: string): string {
  switch (providerName) {
    case "claude-code":
      return "Claude Code";
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "google":
      return "Google";
    case "ollama":
      return "Ollama";
    default:
      return providerName;
  }
}

function normalizeFailureDetail(
  detail: string,
  providerName: string,
): string {
  const displayName = providerDisplayName(providerName);
  return detail
    .replace(/^\[[A-Z]+\d+\]\s*/, "")
    .replace(
      new RegExp(
        `^${escapeRegExp(displayName)}\\s+request\\s+failed:\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `^${escapeRegExp(providerName)}\\s+request\\s+failed:\\s*`,
        "i",
      ),
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericFailureDetail(
  detail: string,
  status?: number | null,
): boolean {
  const lower = detail.trim().toLowerCase();
  if (lower.length === 0) return true;
  if (
    lower === "error" ||
    lower === "bad request" ||
    lower === "request failed" ||
    lower === "unauthorized" ||
    lower === "forbidden"
  ) {
    return true;
  }
  if (status != null && lower === `http ${status}`) return true;
  return /^(http( error)?|status):?\s*\d{3}\b/.test(lower);
}

function bodySnippet(responseBody: string | undefined): string | null {
  if (!responseBody) return null;
  const trimmed = responseBody.trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("<")
  ) {
    return null;
  }
  return truncate(trimmed.replace(/\s+/g, " "), 240);
}

function providerFailureSummary(
  providerName: string,
  code: ProviderErrorCode,
  status?: number | null,
): string {
  const displayName = providerDisplayName(providerName);
  const suffix = typeof status === "number" && status > 0
    ? ` (HTTP ${status})`
    : "";

  switch (code) {
    case ProviderErrorCode.AUTH_FAILED:
      return `${displayName} authentication failed${suffix}`;
    case ProviderErrorCode.RATE_LIMITED:
      return `${displayName} rate limit reached${suffix}`;
    case ProviderErrorCode.REQUEST_TOO_LARGE:
      return `${displayName} rejected the request size${suffix}`;
    case ProviderErrorCode.REQUEST_TIMEOUT:
      return `${displayName} request timed out${suffix}`;
    case ProviderErrorCode.SERVICE_UNAVAILABLE:
      return `${displayName} is temporarily unavailable${suffix}`;
    case ProviderErrorCode.NETWORK_ERROR:
      return `${displayName} request could not reach the provider${suffix}`;
    case ProviderErrorCode.STREAM_ERROR:
      return `${displayName} returned an unreadable stream${suffix}`;
    case ProviderErrorCode.REQUEST_REJECTED:
      return `${displayName} rejected the request${suffix}`;
    case ProviderErrorCode.REQUEST_FAILED:
    default:
      return `${displayName} request failed${suffix}`;
  }
}

export function formatProviderFailureMessage(options: {
  providerName: string;
  code: ProviderErrorCode;
  status?: number | null;
  responseBody?: string;
  fallbackMessage?: string;
}): string {
  const {
    providerName,
    code,
    status,
    responseBody,
    fallbackMessage,
  } = options;
  const summary = providerFailureSummary(providerName, code, status);
  const detailCandidates = [
    responseBody ? extractProviderErrorMessage(responseBody) : null,
    fallbackMessage ? normalizeFailureDetail(fallbackMessage, providerName) : null,
    bodySnippet(responseBody),
  ].filter((value): value is string => Boolean(value));

  const detail = detailCandidates.find((candidate) =>
    !isGenericFailureDetail(candidate, status)
  );

  if (detail) {
    return `${summary}: ${detail}`;
  }

  const fix = getErrorFixes(code)[0];
  return fix ? `${summary}. ${fix}` : summary;
}

export function classifyProviderErrorCode(
  status: number,
  message: string,
): ProviderErrorCode {
  const lower = message.toLowerCase();
  if (status === 401 || status === 403) {
    return ProviderErrorCode.AUTH_FAILED;
  }
  if (lower.includes("rate limit")) {
    return ProviderErrorCode.RATE_LIMITED;
  }
  if (lower.includes("payload too large") || lower.includes("request too large")) {
    return ProviderErrorCode.REQUEST_TOO_LARGE;
  }
  if (status === 413) {
    return ProviderErrorCode.REQUEST_TOO_LARGE;
  }
  if (status === 408 || lower.includes("timeout")) {
    return ProviderErrorCode.REQUEST_TIMEOUT;
  }
  if (status === 429) {
    return ProviderErrorCode.RATE_LIMITED;
  }
  if (status >= 500) {
    return ProviderErrorCode.SERVICE_UNAVAILABLE;
  }
  if (status >= 400) {
    return ProviderErrorCode.REQUEST_REJECTED;
  }
  return ProviderErrorCode.REQUEST_FAILED;
}

/**
 * Throw a RuntimeError for a failed HTTP response.
 * Parses the response body to extract the provider's human-readable error message.
 * Always includes HTTP status code (for error taxonomy classification) and
 * Retry-After header when present (for rate limit handling).
 * Shared across all provider API modules.
 */
/**
 * Common status check for providers that use simple HTTP ping.
 * Consolidates the identical pattern used by OpenAI and Google APIs.
 * For providers with custom logic (Anthropic, Claude Code), use a direct implementation.
 */
export async function checkApiStatus(
  url: string,
  options: { headers?: Record<string, string>; timeout?: number },
  isAvailable: (response: Response) => boolean = (r) => r.ok,
  formatError: (response: Response) => string | undefined = (r) =>
    r.ok ? undefined : `HTTP ${r.status}`,
): Promise<ProviderStatus> {
  try {
    const response = await http.fetchRaw(url, options);
    return {
      available: isAvailable(response),
      error: formatError(response),
    };
  } catch (error) {
    return {
      available: false,
      error: getErrorMessage(error),
    };
  }
}

export async function throwOnHttpError(
  response: Response,
  providerName: string,
): Promise<never> {
  const text = await response.text().catch(() => "(unreadable body)");
  const extracted = extractProviderErrorMessage(text);
  const retryAfter = response.headers.get("retry-after");
  const retryHint = retryAfter ? ` (retry-after: ${retryAfter}s)` : "";
  const body = extracted ?? text.slice(0, 500);
  const code = classifyProviderErrorCode(
    response.status,
    body,
  );
  throw new RuntimeError(
    `${providerName} HTTP ${response.status}${retryHint}: ${body}`,
    { code },
  );
}
