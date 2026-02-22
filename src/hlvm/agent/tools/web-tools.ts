/**
 * Web Tools - Internet search and fetch utilities (policy-gated)
 *
 * Provides minimal web capabilities:
 * - search_web: query public DuckDuckGo search endpoint
 * - fetch_url: fetch a URL with byte limits and policy checks
 * - web_fetch: readability + Firecrawl enriched fetch
 *
 * SSOT: Uses common/http-client.ts for HTTP.
 *
 * Split into modular files:
 * - web/duckduckgo.ts: DuckDuckGo search, result parsing, scoring
 * - web/html-parser.ts: HTML content extraction, boilerplate stripping
 * - web/fetch-core.ts: URL fetching, redirects, byte limits, Firecrawl
 */

import { ValidationError } from "../../../common/error.ts";
import type { ToolExecutionOptions, ToolMetadata } from "../registry.ts";
import { loadWebConfig } from "../web-config.ts";
import { getWebCacheValue, setWebCacheValue } from "../web-cache.ts";

// Re-exports from extracted modules (preserve external API)
export {
  scoreSearchResults,
  parseDuckDuckGoSearchResults,
} from "./web/duckduckgo.ts";

import { duckDuckGoSearch } from "./web/duckduckgo.ts";
import {
  parseHtml,
  isHtmlLikeResponse,
  extractReadableContent,
} from "./web/html-parser.ts";
import {
  DEFAULT_WEB_MAX_BYTES,
  assertUrlAllowed,
  toMillis,
  makeCacheKey,
  truncateText,
  readResponseBody,
  fetchWithRedirects,
  fetchWithFirecrawl,
  fetchUrlInternal,
} from "./web/fetch-core.ts";

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
  timeoutSeconds?: number;
}

interface WebFetchArgs {
  url: string;
  maxChars?: number;
  timeoutSeconds?: number;
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_WEB_RESULTS = 5;
const DEFAULT_HTML_LINKS = 20;
const MAIN_CONTENT_MIN_CHARS = 200;

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

  return await fetchUrlInternal(url, maxBytes, timeoutMs, options);
}

async function webFetch(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  if (!args || typeof args !== "object") {
    throw new ValidationError("args must be an object", "web_fetch");
  }

  const { url, maxChars, timeoutSeconds } = args as WebFetchArgs;
  if (!url || typeof url !== "string") {
    throw new ValidationError("url is required", "web_fetch");
  }

  const webConfig = await loadWebConfig();
  if (!webConfig.fetch.enabled) {
    throw new ValidationError("web fetch is disabled", "web_fetch");
  }

  const resolvedMaxChars = typeof maxChars === "number" && maxChars > 0
    ? maxChars
    : webConfig.fetch.maxChars;
  const timeoutMs = toMillis(timeoutSeconds ?? webConfig.fetch.timeoutSeconds);

  const cacheKey = makeCacheKey("web_fetch", [url, resolvedMaxChars]);
  if (webConfig.fetch.cacheTtlMinutes > 0) {
    const cached = await getWebCacheValue<Record<string, unknown>>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  const headers: Record<string, string> = {
    "User-Agent": webConfig.fetch.userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  const { finalUrl, response, redirects } = await fetchWithRedirects(
    url,
    timeoutMs,
    headers,
    webConfig.fetch.maxRedirects,
    options,
  );

  const maxBytes = Math.max(
    DEFAULT_WEB_MAX_BYTES,
    Math.max(1, resolvedMaxChars) * 4,
  );
  const body = await readResponseBody(response, maxBytes);
  const contentType = response.headers.get("content-type") ?? "";
  const html = body.text ?? "";
  const isHtmlLike = isHtmlLikeResponse(contentType, html);

  const fallback = truncateText(html, resolvedMaxChars);
  const parsed = isHtmlLike
    ? parseHtml(html, resolvedMaxChars, DEFAULT_HTML_LINKS)
    : {
      title: "",
      description: "",
      text: fallback.text,
      textTruncated: fallback.truncated,
      links: [] as string[],
      linkCount: 0,
    };

  let text = parsed.text;
  let textTruncated = parsed.textTruncated;
  let content: string | undefined;
  let usedReadability = false;
  let usedFirecrawl = false;

  if (isHtmlLike && webConfig.fetch.readability && html) {
    const readable = await extractReadableContent(html, finalUrl);
    if (readable?.text) {
      usedReadability = true;
      text = readable.text;
      content = readable.content ?? content;
      if (readable.title) {
        parsed.title = readable.title;
      }
      const truncated = truncateText(text, resolvedMaxChars);
      text = truncated.text;
      textTruncated = textTruncated || truncated.truncated;
    }
  }

  if (
    isHtmlLike &&
    (text?.trim().length ?? 0) < MAIN_CONTENT_MIN_CHARS &&
    webConfig.fetch.firecrawl.enabled
  ) {
    const firecrawl = await fetchWithFirecrawl(
      finalUrl,
      webConfig.fetch.firecrawl,
      options,
    );
    if (firecrawl?.content || firecrawl?.markdown) {
      usedFirecrawl = true;
      content = firecrawl.markdown ?? firecrawl.content ?? content;
      if (content) {
        const truncated = truncateText(content, resolvedMaxChars);
        text = truncated.text;
        textTruncated = truncated.truncated;
      }
      if (firecrawl.title) parsed.title = firecrawl.title;
      if (firecrawl.description) parsed.description = firecrawl.description;
    }
  }

  const result = {
    url: finalUrl,
    status: response.status,
    ok: response.ok,
    contentType,
    bytes: body.bytes,
    truncated: body.truncated,
    title: parsed.title,
    description: parsed.description,
    text,
    textTruncated,
    links: parsed.links,
    linkCount: parsed.linkCount,
    content,
    readability: usedReadability,
    firecrawl: usedFirecrawl,
    redirects,
  };

  if (webConfig.fetch.cacheTtlMinutes > 0) {
    await setWebCacheValue(cacheKey, result, webConfig.fetch.cacheTtlMinutes);
  }

  return result;
}

async function searchWeb(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  if (!args || typeof args !== "object") {
    throw new ValidationError("args must be an object", "search_web");
  }

  const { query, maxResults, timeoutMs, timeoutSeconds } =
    args as SearchWebArgs;
  if (!query || typeof query !== "string") {
    throw new ValidationError("query is required", "search_web");
  }

  const webConfig = await loadWebConfig();
  if (!webConfig.search.enabled) {
    throw new ValidationError("web search is disabled", "search_web");
  }

  const limit = typeof maxResults === "number" && maxResults > 0
    ? maxResults
    : webConfig.search.maxResults ?? DEFAULT_WEB_RESULTS;
  const timeout = typeof timeoutMs === "number" && timeoutMs > 0
    ? timeoutMs
    : toMillis(timeoutSeconds ?? webConfig.search.timeoutSeconds);

  const cacheKey = makeCacheKey(`search_web:${webConfig.search.provider}`, [
    query,
    limit,
  ]);
  if (webConfig.search.cacheTtlMinutes > 0) {
    const cached = await getWebCacheValue<Record<string, unknown>>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  const result = await duckDuckGoSearch(query, limit, timeout, options);

  if (webConfig.search.cacheTtlMinutes > 0) {
    await setWebCacheValue(cacheKey, result, webConfig.search.cacheTtlMinutes);
  }

  return result;
}

// ============================================================
// Tool Registry
// ============================================================

export const WEB_TOOLS: Record<string, ToolMetadata> = {
  search_web: {
    fn: searchWeb,
    description:
      "Search the web for a query (DuckDuckGo). Returns snippets and URLs.",
    category: "web",
    args: {
      query: "string - Search query",
      maxResults: "number (optional) - Max results (default: 5)",
      timeoutMs: "number (optional) - Request timeout in ms",
      timeoutSeconds: "number (optional) - Request timeout in seconds",
    },
    returns: {
      results: "Array<{title, url?, snippet?}>",
      count: "number",
      provider: "string",
    },
    safetyLevel: "L0",
    safety: "Read-only web search (auto-approved).",
  },
  fetch_url: {
    fn: fetchUrl,
    description: "Fetch a URL and return text content with size limits.",
    category: "web",
    args: {
      url: "string - URL to fetch",
      maxBytes:
        `number (optional) - Max bytes to read (default: ${DEFAULT_WEB_MAX_BYTES})`,
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
    safetyLevel: "L0",
    safety: "Read-only web fetch (auto-approved).",
  },
  web_fetch: {
    fn: webFetch,
    description:
      "OpenClaw-style fetch with readability + Firecrawl fallback. Returns main content.",
    category: "web",
    args: {
      url: "string - URL to fetch",
      maxChars:
        "number (optional) - Max extracted text length (default: 50000)",
      timeoutSeconds: "number (optional) - Request timeout in seconds",
    },
    returns: {
      url: "string",
      status: "number",
      ok: "boolean",
      contentType: "string",
      bytes: "number",
      truncated: "boolean",
      title: "string",
      description: "string",
      text: "string",
      textTruncated: "boolean",
      links: "string[]",
      linkCount: "number",
      content: "string (optional)",
      readability: "boolean",
      firecrawl: "boolean",
      redirects: "string[]",
    },
    safetyLevel: "L0",
    safety: "Read-only web fetch (auto-approved).",
  },
};
