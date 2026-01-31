/**
 * Web Tools - Internet search and fetch utilities (policy-gated)
 *
 * Provides minimal web capabilities:
 * - search_web: query a public search endpoint (DuckDuckGo Instant Answer)
 * - fetch_url: fetch a URL with byte limits and policy checks
 *
 * SSOT: Uses common/http-client.ts for HTTP.
 */

import { http } from "../../../common/http-client.ts";
import { ValidationError } from "../../../common/error.ts";
import { isNetworkAllowed, getNetworkPolicyDeniedUrl } from "../policy.ts";
import type { ToolExecutionOptions, ToolMetadata } from "../registry.ts";
import { RESOURCE_LIMITS } from "../constants.ts";
import { getErrorMessage } from "../../../common/utils.ts";

// ============================================================
// Types
// ============================================================

interface FetchUrlArgs {
  url: string;
  maxBytes?: number;
  timeoutMs?: number;
}

interface SearchWebArgs {
  query: string;
  maxResults?: number;
  timeoutMs?: number;
}

interface SearchResult {
  title: string;
  url?: string;
  snippet?: string;
}

// ============================================================
// Internal Helpers
// ============================================================

const DEFAULT_WEB_MAX_BYTES = RESOURCE_LIMITS.maxTotalToolResultBytes;
const DEFAULT_WEB_RESULTS = 10;

function assertUrlAllowed(
  url: string,
  options?: ToolExecutionOptions,
): void {
  const policy = options?.policy ?? null;
  if (!isNetworkAllowed(policy, url)) {
    const denied = getNetworkPolicyDeniedUrl(policy, [url]) ?? url;
    throw new ValidationError(`URL denied by policy: ${denied}`, "network_policy");
  }
}

async function readResponseBody(
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
    text: new TextDecoder().decode(buffer),
    bytes: total,
    truncated,
  };
}

// ============================================================
// Tool Implementations
// ============================================================

async function fetchUrl(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  if (!args || typeof args !== "object") {
    throw new ValidationError("args must be an object", "fetch_url");
  }

  const { url, maxBytes, timeoutMs } = args as FetchUrlArgs;
  if (!url || typeof url !== "string") {
    throw new ValidationError("url is required", "fetch_url");
  }

  assertUrlAllowed(url, options);

  const response = await http.fetchRaw(url, {
    timeout: timeoutMs,
  });

  const limit = typeof maxBytes === "number" && maxBytes > 0
    ? maxBytes
    : DEFAULT_WEB_MAX_BYTES;
  const body = await readResponseBody(response, limit);

  return {
    url,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get("content-type") ?? "",
    bytes: body.bytes,
    truncated: body.truncated,
    text: body.text,
  };
}

async function searchWeb(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  if (!args || typeof args !== "object") {
    throw new ValidationError("args must be an object", "search_web");
  }

  const { query, maxResults, timeoutMs } = args as SearchWebArgs;
  if (!query || typeof query !== "string") {
    throw new ValidationError("query is required", "search_web");
  }

  const limit = typeof maxResults === "number" && maxResults > 0
    ? maxResults
    : DEFAULT_WEB_RESULTS;

  const endpoint = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  assertUrlAllowed(endpoint, options);

  interface DuckDuckGoResponse {
    AbstractText?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
  }

  let data: DuckDuckGoResponse;
  try {
    data = await http.get<DuckDuckGoResponse>(endpoint, { timeout: timeoutMs });
  } catch (error) {
    throw new ValidationError(`search_web failed: ${getErrorMessage(error)}`, "search_web");
  }

  const results: SearchResult[] = [];
  if (data.AbstractText) {
    results.push({
      title: data.Heading ?? "Summary",
      snippet: data.AbstractText,
    });
  }

  const pushTopic = (topic?: { Text?: string; FirstURL?: string }) => {
    if (!topic?.Text) return;
    const [title, snippet] = topic.Text.split(" - ");
    results.push({
      title: title ?? topic.Text,
      url: topic.FirstURL,
      snippet: snippet ?? "",
    });
  };

  for (const topic of data.RelatedTopics ?? []) {
    if (topic.Topics && Array.isArray(topic.Topics)) {
      for (const sub of topic.Topics) {
        pushTopic(sub);
        if (results.length >= limit) break;
      }
    } else {
      pushTopic(topic);
    }
    if (results.length >= limit) break;
  }

  return {
    query,
    source: "duckduckgo",
    results: results.slice(0, limit),
    count: results.slice(0, limit).length,
  };
}

// ============================================================
// Tool Registry
// ============================================================

export const WEB_TOOLS: Record<string, ToolMetadata> = {
  search_web: {
    fn: searchWeb,
    description:
      "Search the web for a query (DuckDuckGo). Returns snippets and URLs.",
    args: {
      query: "string - Search query",
      maxResults: "number (optional) - Max results (default: 10)",
      timeoutMs: "number (optional) - Request timeout in ms",
    },
    returns: {
      results: "Array<{title, url?, snippet?}>",
      count: "number",
      source: "string",
    },
    safetyLevel: "L1",
    safety: "External network access (policy-gated).",
  },
  fetch_url: {
    fn: fetchUrl,
    description:
      "Fetch a URL and return text content with size limits.",
    args: {
      url: "string - URL to fetch",
      maxBytes: `number (optional) - Max bytes to read (default: ${DEFAULT_WEB_MAX_BYTES})`,
      timeoutMs: "number (optional) - Request timeout in ms",
    },
    returns: {
      status: "number",
      ok: "boolean",
      contentType: "string",
      bytes: "number",
      truncated: "boolean",
      text: "string",
    },
    safetyLevel: "L1",
    safety: "External network access (policy-gated).",
  },
};
