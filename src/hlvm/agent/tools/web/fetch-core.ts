/**
 * URL fetching: redirects, byte-limited reading, charset decoding.
 * Extracted from web-tools.ts for modularity.
 */

import { http } from "../../../../common/http-client.ts";
import { ValidationError } from "../../../../common/error.ts";
import { withRetry } from "../../../../common/retry.ts";
import { getNetworkPolicyDeniedUrl, isNetworkAllowed } from "../../policy.ts";
import type { ToolExecutionOptions } from "../../registry.ts";
import { RESOURCE_LIMITS } from "../../constants.ts";

// ============================================================
// Constants
// ============================================================

export const DEFAULT_WEB_MAX_BYTES = RESOURCE_LIMITS.maxTotalToolResultBytes;

// ============================================================
// URL Validation
// ============================================================

export function assertUrlAllowed(
  url: string,
  options?: ToolExecutionOptions,
): void {
  const policy = options?.policy ?? null;
  if (!isNetworkAllowed(policy, url)) {
    const denied = getNetworkPolicyDeniedUrl(policy, [url]) ?? url;
    throw new ValidationError(
      `URL denied by policy: ${denied}`,
      "network_policy",
    );
  }
}

// ============================================================
// Utility Helpers
// ============================================================

export function toMillis(seconds: number | undefined): number | undefined {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) return undefined;
  if (seconds <= 0) return 0;
  return Math.round(seconds * 1000);
}

export function makeCacheKey(
  prefix: string,
  parts: Array<string | number | undefined>,
): string {
  const safe = parts.map((part) => String(part ?? "").trim()).join("|");
  return `${prefix}:${safe}`;
}

// Re-export truncateText from SSOT (common/utils.ts)
export { truncateText } from "../../../../common/utils.ts";

// ============================================================
// Charset Decoding
// ============================================================

function extractCharsetFromContentType(contentType: string): string | null {
  if (!contentType) return null;
  const match = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i);
  if (!match?.[1]) return null;
  return match[1].trim().toLowerCase();
}

function decodeBufferWithCharset(
  buffer: Uint8Array,
  contentType: string,
): string {
  const headerCharset = extractCharsetFromContentType(contentType);
  const candidates = [
    ...(headerCharset ? [headerCharset] : []),
    "utf-8",
  ];

  for (const charset of candidates) {
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch {
      // Try next codec candidate.
    }
  }

  return new TextDecoder().decode(buffer);
}

// ============================================================
// Response Reading
// ============================================================

export async function readResponseBody(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!response.body) {
    return { text: "", bytes: 0, truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const remaining = maxBytes - total;
      if (remaining <= 0) {
        truncated = true;
        break;
      }

      if (value.length > remaining) {
        chunks.push(value.slice(0, remaining));
        total += remaining;
        truncated = true;
        break;
      }

      chunks.push(value);
      total += value.length;
    }
  } finally {
    if (truncated) {
      try {
        await reader.cancel();
      } catch {
        // Best-effort cancellation
      }
    }
    reader.releaseLock();
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  return {
    text: decodeBufferWithCharset(
      buffer,
      response.headers.get("content-type") ?? "",
    ),
    bytes: total,
    truncated,
  };
}

// ============================================================
// Transient Error Detection
// ============================================================

/** Returns true for HTTP status codes or network errors that are worth retrying. */
export function isTransientHttpError(error: unknown): boolean {
  if (error instanceof Response) {
    const s = error.status;
    return s === 429 || s === 502 || s === 503 || s === 504;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("timeout") || msg.includes("econnreset") ||
      msg.includes("fetch failed") || msg.includes("network");
  }
  return false;
}

// ============================================================
// Redirect Following
// ============================================================

export async function fetchWithRedirects(
  url: string,
  timeoutMs: number | undefined,
  headers: Record<string, string>,
  maxRedirects: number,
  options?: ToolExecutionOptions,
): Promise<{ finalUrl: string; response: Response; redirects: string[] }> {
  let current = url;
  const redirects: string[] = [];
  const visited = new Set<string>();
  const redirectLimit = Math.max(0, maxRedirects);

  for (let attempt = 0; attempt <= redirectLimit; attempt++) {
    assertUrlAllowed(current, options);
    const response = await withRetry(
      () => http.fetchRaw(current, {
        timeout: timeoutMs,
        headers,
        redirect: "manual",
      }),
      { maxAttempts: 2, initialDelayMs: 500, shouldRetry: isTransientHttpError },
    );
    const status = response.status;
    const isRedirect = status === 301 || status === 302 || status === 303 ||
      status === 307 || status === 308;
    if (!isRedirect) {
      return { finalUrl: current, response, redirects };
    }
    const location = response.headers.get("location");
    if (!location) {
      return { finalUrl: current, response, redirects };
    }
    const nextUrl = new URL(location, current).toString();
    if (visited.has(nextUrl)) {
      throw new ValidationError(
        `Redirect loop detected for ${url}`,
        "web_fetch",
      );
    }
    visited.add(nextUrl);
    redirects.push(nextUrl);
    current = nextUrl;
  }

  throw new ValidationError(`Too many redirects for ${url}`, "web_fetch");
}

// ============================================================
// Simple URL Fetch
// ============================================================

const DEFAULT_FETCH_URL_MAX_REDIRECTS = 3;

export async function fetchUrlInternal(
  url: string,
  maxBytes: number | undefined,
  timeoutMs: number | undefined,
  options?: ToolExecutionOptions,
): Promise<{
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  bytes: number;
  truncated: boolean;
  text: string;
}> {
  const { finalUrl, response } = await fetchWithRedirects(
    url,
    timeoutMs,
    {},
    DEFAULT_FETCH_URL_MAX_REDIRECTS,
    options,
  );

  const limit = typeof maxBytes === "number" && maxBytes > 0
    ? maxBytes
    : DEFAULT_WEB_MAX_BYTES;
  const body = await readResponseBody(response, limit);

  return {
    url: finalUrl,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get("content-type") ?? "",
    bytes: body.bytes,
    truncated: body.truncated,
    text: body.text,
  };
}
