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

import {
  resolveSearchProvider,
  type SearchTimeRange,
  type Citation,
} from "./web/search-provider.ts";
import { initSearchProviders } from "./web/search-provider-bootstrap.ts";
import {
  MAIN_CONTENT_MIN_CHARS,
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
  allowedDomains?: string[];
  blockedDomains?: string[];
  timeRange?: SearchTimeRange;
}

interface WebFetchArgs {
  url?: string;
  urls?: string[];
  maxChars?: number;
  timeoutSeconds?: number;
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_WEB_RESULTS = 5;
const DEFAULT_HTML_LINKS = 20;
const SEARCH_TIME_RANGES: SearchTimeRange[] = ["day", "week", "month", "year", "all"];

function normalizeDomainList(domains?: string[]): string {
  if (!domains?.length) return "";
  return [...domains]
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0)
    .sort()
    .join(",");
}

function buildSearchWebCacheKey(
  provider: string,
  query: string,
  limit: number,
  allowedDomains?: string[],
  blockedDomains?: string[],
  timeRange: SearchTimeRange = "all",
): string {
  return makeCacheKey(`search_web:${provider}`, [
    query,
    limit,
    normalizeDomainList(allowedDomains),
    normalizeDomainList(blockedDomains),
    timeRange,
  ]);
}

export const __testOnlyBuildSearchWebCacheKey = buildSearchWebCacheKey;

function resolveSearchTimeRange(value: unknown): SearchTimeRange {
  if (value === undefined) return "all";
  if (typeof value !== "string") {
    throw new ValidationError(
      `timeRange must be one of: ${SEARCH_TIME_RANGES.join(", ")}`,
      "search_web",
    );
  }
  const normalized = value.trim().toLowerCase();
  if (SEARCH_TIME_RANGES.includes(normalized as SearchTimeRange)) {
    return normalized as SearchTimeRange;
  }
  throw new ValidationError(
    `timeRange must be one of: ${SEARCH_TIME_RANGES.join(", ")}`,
    "search_web",
  );
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

  const { url, urls, maxChars, timeoutSeconds } = args as WebFetchArgs;
  if (urls?.length) return batchWebFetch(urls, maxChars, timeoutSeconds, options);
  if (!url || typeof url !== "string") {
    throw new ValidationError("url or urls required", "web_fetch");
  }

  return webFetchSingle(url, maxChars, timeoutSeconds, options);
}

async function webFetchSingle(
  url: string,
  maxChars?: number,
  timeoutSeconds?: number,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
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
      const { retrievedAt: _cachedRetrievedAt, ...rest } =
        cached as Record<string, unknown> & { retrievedAt?: unknown };
      return { ...rest, cached: true, retrievedAt: new Date().toISOString() };
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
    citation: { url: finalUrl, title: parsed.title || "", provider: "fetch" } as Citation,
  };

  if (webConfig.fetch.cacheTtlMinutes > 0) {
    await setWebCacheValue(cacheKey, result, webConfig.fetch.cacheTtlMinutes);
  }

  return { ...result, retrievedAt: new Date().toISOString() };
}

const MAX_BATCH_URLS = 5;
const BATCH_CONCURRENCY = 3;

async function batchWebFetch(
  urls: string[],
  maxChars?: number,
  timeoutSeconds?: number,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  if (urls.length > MAX_BATCH_URLS) {
    throw new ValidationError(`Too many URLs (max ${MAX_BATCH_URLS})`, "web_fetch");
  }

  const results: Record<string, unknown>[] = [];
  for (let i = 0; i < urls.length; i += BATCH_CONCURRENCY) {
    const batch = urls.slice(i, i + BATCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((u) => webFetchSingle(u, maxChars, timeoutSeconds, options)),
    );
    for (const [idx, r] of settled.entries()) {
      results.push(
        r.status === "fulfilled"
          ? r.value
          : { url: batch[idx], error: String(r.reason), ok: false },
      );
    }
  }

  return {
    batch: true,
    urls,
    results,
    count: results.length,
    errors: results.filter((r) => r.error).length,
    retrievedAt: new Date().toISOString(),
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

  const typed = args as SearchWebArgs;
  const { query, maxResults, timeoutMs, timeoutSeconds } = typed;
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

  const timeRange = resolveSearchTimeRange(typed.timeRange);

  const cacheKey = buildSearchWebCacheKey(
    webConfig.search.provider,
    query,
    limit,
    typed.allowedDomains,
    typed.blockedDomains,
    timeRange,
  );
  if (webConfig.search.cacheTtlMinutes > 0) {
    const cached = await getWebCacheValue<Record<string, unknown>>(cacheKey);
    if (cached) {
      const { retrievedAt: _cachedRetrievedAt, ...rest } =
        cached as Record<string, unknown> & { retrievedAt?: unknown };
      return { ...rest, cached: true, retrievedAt: new Date().toISOString() };
    }
  }

  initSearchProviders();
  const provider = resolveSearchProvider(webConfig.search.provider, false);
  const result = await provider.search(query, {
    limit,
    timeoutMs: timeout,
    allowedDomains: typed.allowedDomains,
    blockedDomains: typed.blockedDomains,
    timeRange,
    toolOptions: options,
  });

  const now = new Date().toISOString();
  const citations: Citation[] = result.results
    .filter((r) => r.url)
    .map((r) => ({
      url: r.url!,
      title: r.title,
      excerpt: r.snippet,
      provider: result.provider,
    }));
  const enriched = { ...result, citations };

  if (webConfig.search.cacheTtlMinutes > 0) {
    await setWebCacheValue(cacheKey, enriched, webConfig.search.cacheTtlMinutes);
  }

  return { ...enriched, retrievedAt: now };
}

// ============================================================
// Tool Registry
// ============================================================

export const WEB_TOOLS: Record<string, ToolMetadata> = {
  search_web: {
    fn: searchWeb,
    description:
      "Search the web for a query using DuckDuckGo. Returns snippets and URLs.",
    category: "web",
    args: {
      query: "string - Search query",
      maxResults: "number (optional) - Max results (default: 5)",
      timeoutMs: "number (optional) - Request timeout in ms",
      timeoutSeconds: "number (optional) - Request timeout in seconds",
      allowedDomains: "string[] (optional) - Only include results from these domains",
      blockedDomains: "string[] (optional) - Exclude results from these domains",
      timeRange: "string (optional) - Recency window: day|week|month|year|all (default: all)",
    },
    returns: {
      results: "Array<{title, url?, snippet?}>",
      count: "number",
      provider: "string",
      citations: "Citation[] - Structured provenance for each result",
      retrievedAt: "string - ISO 8601 timestamp of retrieval",
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
      "Fetch URL(s) with readability + Firecrawl fallback. Returns main content.",
    category: "web",
    args: {
      url: "string (optional if urls given) - Single URL to fetch",
      urls: "string[] (optional) - Multiple URLs to fetch (max 5, concurrent)",
      maxChars:
        "number (optional) - Max extracted text length per URL (default: 50000)",
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
      citation: "Citation (optional) - Source provenance",
      retrievedAt: "string (optional) - ISO 8601 timestamp",
    },
    safetyLevel: "L0",
    safety: "Read-only web fetch (auto-approved).",
  },
};
