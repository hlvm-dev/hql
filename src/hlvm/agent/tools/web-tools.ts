/**
 * Web Tools - Internet search and fetch utilities (policy-gated)
 *
 * Provides minimal web capabilities:
 * - search_web: query public DuckDuckGo search endpoint
 * - fetch_url: fetch a URL with byte limits and policy checks
 * - web_fetch: readability-enriched fetch
 *
 * SSOT: Uses common/http-client.ts for HTTP.
 *
 * Split into modular files:
 * - web/duckduckgo.ts: DuckDuckGo search, result parsing, scoring
 * - web/html-parser.ts: HTML content extraction, boilerplate stripping
 * - web/fetch-core.ts: URL fetching, redirects, byte limits
 */

import { pooledMap } from "@std/async";
import { ValidationError } from "../../../common/error.ts";
import type { ToolExecutionOptions, ToolMetadata } from "../registry.ts";
import { loadWebConfig } from "../web-config.ts";
import { getWebCacheValue, setWebCacheValue } from "../web-cache.ts";
import { generateQueryVariants } from "./web/duckduckgo.ts";

import {
  normalizeDomain,
  SEARCH_DEPTH_DEFAULTS,
  SEARCH_DEPTH_PROFILES,
  resolveSearchProvider,
  type SearchDepthProfile,
  SEARCH_TIME_RANGES,
  type SearchTimeRange,
  type Citation,
  type SearchResult,
} from "./web/search-provider.ts";
import { initSearchProviders } from "./web/search-provider-bootstrap.ts";
import {
  MAIN_CONTENT_MIN_CHARS,
  parseHtml,
  isHtmlLikeResponse,
  extractReadableContent,
  extractPublicationDate,
} from "./web/html-parser.ts";
import {
  DEFAULT_WEB_MAX_BYTES,
  assertUrlAllowed,
  toMillis,
  makeCacheKey,
  truncateText,
  readResponseBody,
  fetchWithRedirects,
  fetchUrlInternal,
} from "./web/fetch-core.ts";
import { renderWithChrome } from "./web/headless-chrome.ts";
import {
  assessSearchConfidence,
  dedupeSearchResults,
  deduplicateSnippetPassages,
  extractRelevantPassages,
  rankSearchResults,
  sourceQualityPenalty,
} from "./web/search-ranking.ts";

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
  locale?: string;
  searchDepth?: SearchDepthProfile;
  prefetch?: boolean;       // Auto-fetch top results and extract relevant passages (default: true)
  reformulate?: boolean;    // Enable query reformulation for wider recall (default: true)
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
const MAX_WEB_CHARS = 200_000;
const LOW_CONFIDENCE_SCORE_THRESHOLD = 4;
const LOW_CONFIDENCE_DIVERSITY_THRESHOLD = 0.4;
const LOW_CONFIDENCE_COVERAGE_THRESHOLD = 0.55;
const DEFAULT_SEARCH_DEPTH: SearchDepthProfile = "medium";
const DEFAULT_PREFETCH_TARGETS = 2;
const LOW_CONFIDENCE_PREFETCH_TARGETS = 3;
const MAX_PREFETCH_TARGETS = 4;
const LOW_CONFIDENCE_RELATED_LINKS_LIMIT = 4;
const AUTO_DEEP_MAX_ROUNDS = 1;
const AUTO_DEEP_EXTRA_RESULTS = 3;
const AUTO_DEEP_MAX_RESULTS = 12;

// ============================================================
// Structured Error Codes
// ============================================================

export type WebToolErrorCode = "max_uses_exceeded" | "invalid_input" | "disabled";

function webToolError(msg: string, context: string, errorCode: WebToolErrorCode): ValidationError {
  const err = new ValidationError(msg, context);
  err.metadata.errorCode = errorCode;
  return err;
}

// ============================================================
// Per-Run Tool Budget
// ============================================================

const WEB_TOOL_MAX_USES: Record<string, number> = { search_web: 15, web_fetch: 25, fetch_url: 25 };
const webToolUseCounts = new Map<string, number>();

export function resetWebToolBudget(): void { webToolUseCounts.clear(); }

function checkWebToolBudget(toolName: string): void {
  const count = (webToolUseCounts.get(toolName) ?? 0) + 1;
  webToolUseCounts.set(toolName, count);
  const max = WEB_TOOL_MAX_USES[toolName];
  if (max !== undefined && count > max) {
    throw webToolError(
      `Tool budget exceeded: ${toolName} used ${count}/${max} times`,
      toolName,
      "max_uses_exceeded",
    );
  }
}

// ============================================================
// Locale Validation
// ============================================================

async function checkCacheHit(
  key: string,
  ttlMinutes: number,
): Promise<Record<string, unknown> | null> {
  if (ttlMinutes <= 0) return null;
  const cached = await getWebCacheValue<Record<string, unknown>>(key);
  if (!cached) return null;
  const { retrievedAt: _cachedRetrievedAt, ...rest } =
    cached as Record<string, unknown> & { retrievedAt?: unknown };
  return { ...rest, cached: true, retrievedAt: new Date().toISOString() };
}

function resolveLocale(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[a-z]{2}-[a-z]{2}$/i.test(value.trim())) {
    throw webToolError("locale must be format 'xx-xx' (e.g., 'us-en')", "search_web", "invalid_input");
  }
  return value.trim().toLowerCase();
}

function normalizeDomainList(domains?: string[]): string {
  if (!domains?.length) return "";
  return [...domains]
    .map(normalizeDomain)
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
  locale?: string,
  searchDepth: SearchDepthProfile = DEFAULT_SEARCH_DEPTH,
  prefetch?: boolean,
  reformulate?: boolean,
): string {
  return makeCacheKey(`search_web:${provider}`, [
    query,
    limit,
    normalizeDomainList(allowedDomains),
    normalizeDomainList(blockedDomains),
    timeRange,
    locale ?? "",
    searchDepth,
    prefetch === false ? "nopf" : "pf",
    reformulate === false ? "norf" : "rf",
  ]);
}

function averageResultScore(results: SearchResult[]): number | undefined {
  const scored = results.filter((r) => typeof r.score === "number" && Number.isFinite(r.score));
  if (scored.length === 0) return undefined;
  return scored.reduce((sum, r) => sum + (r.score ?? 0), 0) / scored.length;
}

function assessToolSearchConfidence(query: string, results: SearchResult[]) {
  return assessSearchConfidence(query, results, {
    scoreThreshold: LOW_CONFIDENCE_SCORE_THRESHOLD,
    diversityThreshold: LOW_CONFIDENCE_DIVERSITY_THRESHOLD,
    coverageThreshold: LOW_CONFIDENCE_COVERAGE_THRESHOLD,
  });
}

function selectDiversePrefetchTargets(results: SearchResult[], maxTargets: number): SearchResult[] {
  const targetLimit = Math.max(0, maxTargets);
  if (targetLimit === 0) return [];
  const prefetchCandidates = results.filter((r) => r.url);
  const prefetchTargets: SearchResult[] = [];
  const prefetchHosts = new Set<string>();

  // Pass 1: pick unique hosts.
  for (const r of prefetchCandidates) {
    if (prefetchTargets.length >= targetLimit) break;
    try {
      const host = new URL(r.url!).hostname.toLowerCase();
      if (prefetchHosts.has(host)) continue;
      prefetchHosts.add(host);
      prefetchTargets.push(r);
    } catch {
      prefetchTargets.push(r);
    }
  }

  // Pass 2: backfill from remaining (allows same-host fallback).
  if (prefetchTargets.length < targetLimit) {
    const seen = new Set(prefetchTargets);
    for (const r of prefetchCandidates) {
      if (prefetchTargets.length >= targetLimit) break;
      if (!seen.has(r)) {
        seen.add(r);
        prefetchTargets.push(r);
      }
    }
  }
  return prefetchTargets;
}

function collectLowConfidenceRelatedLinks(
  results: SearchResult[],
  maxLinks = LOW_CONFIDENCE_RELATED_LINKS_LIMIT,
): string[] {
  const unique = new Set<string>();
  for (const r of results) {
    for (const link of r.relatedLinks ?? []) {
      if (unique.has(link)) continue;
      unique.add(link);
      if (unique.size >= maxLinks) return [...unique];
    }
  }
  return [...unique];
}

function resolveSearchDepth(value: unknown): SearchDepthProfile {
  if (value === undefined) return DEFAULT_SEARCH_DEPTH;
  if (typeof value !== "string") {
    throw new ValidationError(
      `searchDepth must be one of: ${SEARCH_DEPTH_PROFILES.join(", ")}`,
      "search_web",
    );
  }
  const normalized = value.trim().toLowerCase();
  if (SEARCH_DEPTH_PROFILES.includes(normalized as SearchDepthProfile)) {
    return normalized as SearchDepthProfile;
  }
  throw new ValidationError(
    `searchDepth must be one of: ${SEARCH_DEPTH_PROFILES.join(", ")}`,
    "search_web",
  );
}

function resolvePrefetchTargetCount(baseTargetCount: number, lowConfidence: boolean): number {
  const boundedBase = Math.max(0, baseTargetCount);
  if (!lowConfidence) return boundedBase;
  return Math.min(MAX_PREFETCH_TARGETS, Math.max(boundedBase, LOW_CONFIDENCE_PREFETCH_TARGETS));
}

function buildAutoDeepFollowupQuery(
  query: string,
  confidenceReason: string,
): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;

  const [variant] = generateQueryVariants(trimmed, 1);
  if (variant && variant !== trimmed) return variant;

  const lower = trimmed.toLowerCase();
  if (confidenceReason === "low_coverage" && !/\b(docs|documentation|reference)\b/.test(lower)) {
    return `${trimmed} official documentation reference`;
  }
  if (confidenceReason === "low_diversity" && !/\b(alternative|independent|comparison)\b/.test(lower)) {
    return `${trimmed} independent sources`;
  }
  if (!/\b(official|reference|guide)\b/.test(lower)) {
    return `${trimmed} official reference guide`;
  }
  return trimmed;
}

export const __testOnlyBuildSearchWebCacheKey = buildSearchWebCacheKey;
export const __testOnlyFormatSearchWebResult = formatSearchWebResult;
export const __testOnlySelectDiversePrefetchTargets = selectDiversePrefetchTargets;
export const __testOnlyAverageResultScore = averageResultScore;

function formatFetchUrlResult(
  raw: unknown,
): { summaryDisplay: string; returnDisplay: string; llmContent?: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const url = typeof data.url === "string" ? data.url : "";
  const text = typeof data.text === "string" ? data.text : "";
  if (!url || !text) return null;
  const status = typeof data.status === "number" ? data.status : undefined;
  const contentType = typeof data.contentType === "string" ? data.contentType : "";
  const detailLines = [`URL: ${url}`];
  if (status !== undefined) detailLines.push(`Status: ${status}`);
  if (contentType) detailLines.push(`Type: ${contentType}`);
  detailLines.push("");
  detailLines.push(text);
  const detailText = detailLines.join("\n").trimEnd();
  return {
    summaryDisplay: `Fetched ${url}`,
    returnDisplay: detailText,
    llmContent: detailText,
  };
}

function formatWebFetchResult(
  raw: unknown,
): { summaryDisplay: string; returnDisplay: string; llmContent?: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;

  if (data.batch === true && Array.isArray(data.results)) {
    const count = typeof data.count === "number" ? data.count : data.results.length;
    const errors = typeof data.errors === "number" ? data.errors : 0;
    const detailLines = [`Fetched ${count} URL${count === 1 ? "" : "s"}`];
    for (let i = 0; i < data.results.length; i++) {
      const entry = data.results[i];
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const url = typeof record.url === "string" ? record.url : `URL ${i + 1}`;
      const title = typeof record.title === "string" ? record.title : "";
      const error = typeof record.error === "string" ? record.error : "";
      detailLines.push(
        `[${i + 1}] ${url}${title ? ` — ${title}` : ""}${error ? ` (error: ${error})` : ""}`,
      );
    }
    return {
      summaryDisplay: errors > 0
        ? `Fetched ${count - errors} of ${count} URLs`
        : `Fetched ${count} URL${count === 1 ? "" : "s"}`,
      returnDisplay: detailLines.join("\n").trimEnd(),
      llmContent: JSON.stringify(data, null, 2),
    };
  }

  const url = typeof data.url === "string" ? data.url : "";
  const text = typeof data.text === "string" ? data.text : "";
  if (!url || !text) return null;
  const title = typeof data.title === "string" ? data.title : "";
  const description = typeof data.description === "string" ? data.description : "";
  const detailLines = [`URL: ${url}`];
  if (title) detailLines.push(`Title: ${title}`);
  if (description) detailLines.push(`Description: ${description}`);
  detailLines.push("");
  detailLines.push(text);
  const detailText = detailLines.join("\n").trimEnd();
  return {
    summaryDisplay: title ? `Fetched ${url}\nTitle: ${title}` : `Fetched ${url}`,
    returnDisplay: detailText,
    llmContent: detailText,
  };
}

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
    throw webToolError("args must be an object", "fetch_url", "invalid_input");
  }

  const { url, maxBytes, timeoutMs } = args as FetchUrlArgs;
  if (!url || typeof url !== "string") {
    throw webToolError("url is required", "fetch_url", "invalid_input");
  }

  checkWebToolBudget("fetch_url");
  return await fetchUrlInternal(url, maxBytes, timeoutMs, options);
}

async function webFetch(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  if (!args || typeof args !== "object") {
    throw webToolError("args must be an object", "web_fetch", "invalid_input");
  }

  const { url, urls, maxChars, timeoutSeconds } = args as WebFetchArgs;
  if (urls?.length) return await batchWebFetch(urls, maxChars, timeoutSeconds, options);
  if (!url || typeof url !== "string") {
    throw webToolError("url or urls required", "web_fetch", "invalid_input");
  }

  return await webFetchSingle(url, maxChars, timeoutSeconds, options);
}

async function webFetchSingle(
  url: string,
  maxChars?: number,
  timeoutSeconds?: number,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  checkWebToolBudget("web_fetch");
  const webConfig = await loadWebConfig();
  if (!webConfig.fetch.enabled) {
    throw webToolError("web fetch is disabled", "web_fetch", "disabled");
  }

  assertUrlAllowed(url, options);

  const resolvedMaxChars = Math.min(
    typeof maxChars === "number" && maxChars > 0 ? maxChars : webConfig.fetch.maxChars,
    MAX_WEB_CHARS,
  );
  const timeoutMs = toMillis(timeoutSeconds ?? webConfig.fetch.timeoutSeconds);

  const cacheKey = makeCacheKey("web_fetch", [url, resolvedMaxChars]);
  const cachedFetch = await checkCacheHit(cacheKey, webConfig.fetch.cacheTtlMinutes);
  if (cachedFetch) return cachedFetch;

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

  // Headless Chrome fallback for SPAs/JS-rendered pages
  let chromeAttempted = false;
  let chromeRenderChars = 0;
  let chromeAccepted = false;
  if (isHtmlLike && (text?.trim().length ?? 0) < MAIN_CONTENT_MIN_CHARS) {
    const chromeHtml = await renderWithChrome(finalUrl, 15_000);
    if (chromeHtml) {
      chromeAttempted = true;
      const reparsed = parseHtml(chromeHtml, resolvedMaxChars, DEFAULT_HTML_LINKS);
      chromeRenderChars = reparsed.text.trim().length;
      if (chromeRenderChars >= MAIN_CONTENT_MIN_CHARS) {
        chromeAccepted = true;
        text = reparsed.text;
        textTruncated = reparsed.textTruncated;
        parsed.title = reparsed.title || parsed.title;
        parsed.description = reparsed.description || parsed.description;
        parsed.links = reparsed.links;
        parsed.linkCount = reparsed.linkCount;

        if (webConfig.fetch.readability) {
          const readable = await extractReadableContent(chromeHtml, finalUrl);
          if (readable?.text) {
            usedReadability = true;
            text = readable.text;
            content = readable.content ?? content;
            if (readable.title) parsed.title = readable.title;
            const truncated = truncateText(text, resolvedMaxChars);
            text = truncated.text;
            textTruncated = textTruncated || truncated.truncated;
          }
        }
      }
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
    headlessChrome: chromeAccepted,
    chromeAttempted,
    chromeRenderChars: chromeAttempted ? chromeRenderChars : undefined,
    redirects,
    citations: [{ url: finalUrl, title: parsed.title || "", excerpt: (text || "").slice(0, 150), provider: "fetch" }] as Citation[],
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
    throw webToolError(`Too many URLs (max ${MAX_BATCH_URLS})`, "web_fetch", "invalid_input");
  }

  const results: Record<string, unknown>[] = [];
  const fetcher = pooledMap(BATCH_CONCURRENCY, urls, async (u) => {
    try {
      return await webFetchSingle(u, maxChars, timeoutSeconds, options);
    } catch (err) {
      return { url: u, error: String(err), ok: false } as Record<string, unknown>;
    }
  });
  for await (const result of fetcher) {
    results.push(result);
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
    throw webToolError("args must be an object", "search_web", "invalid_input");
  }

  const typed = args as SearchWebArgs;
  const { query, maxResults, timeoutMs, timeoutSeconds } = typed;
  if (!query || typeof query !== "string") {
    throw webToolError("query is required", "search_web", "invalid_input");
  }

  checkWebToolBudget("search_web");

  const webConfig = await loadWebConfig();
  if (!webConfig.search.enabled) {
    throw webToolError("web search is disabled", "search_web", "disabled");
  }

  const searchDepth = resolveSearchDepth(typed.searchDepth);
  const depthDefaults = SEARCH_DEPTH_DEFAULTS[searchDepth];
  const limit = typeof maxResults === "number" && maxResults > 0
    ? maxResults
    : typed.searchDepth !== undefined
      ? depthDefaults.maxResults
      : webConfig.search.maxResults ?? DEFAULT_WEB_RESULTS;
  const timeout = typeof timeoutMs === "number" && timeoutMs > 0
    ? timeoutMs
    : toMillis(timeoutSeconds ?? webConfig.search.timeoutSeconds);
  const resolvedPrefetch = typed.prefetch ?? depthDefaults.prefetch;
  const resolvedReformulate = typed.reformulate ?? depthDefaults.reformulate;
  const profilePrefetchTargets = depthDefaults.prefetchTargets;

  const timeRange = resolveSearchTimeRange(typed.timeRange);
  const locale = resolveLocale(typed.locale);

  const cacheKey = buildSearchWebCacheKey(
    webConfig.search.provider,
    query,
    limit,
    typed.allowedDomains,
    typed.blockedDomains,
    timeRange,
    locale,
    searchDepth,
    resolvedPrefetch,
    resolvedReformulate,
  );
  const cachedSearch = await checkCacheHit(cacheKey, webConfig.search.cacheTtlMinutes);
  if (cachedSearch) return cachedSearch;

  initSearchProviders();
  const provider = resolveSearchProvider(webConfig.search.provider, false);
  const result = await provider.search(query, {
    limit,
    timeoutMs: timeout,
    allowedDomains: typed.allowedDomains,
    blockedDomains: typed.blockedDomains,
    timeRange,
    locale,
    toolOptions: options,
    reformulate: resolvedReformulate,
    searchDepth,
  });

  // --- Auto deep round: one bounded extra search when confidence is low ---
  const deepDiagnostics: {
    autoTriggered: boolean;
    rounds: number;
    triggerReason: string;
    queryTrail: string[];
    recovered: boolean;
  } = {
    autoTriggered: false,
    rounds: 1,
    triggerReason: "none",
    queryTrail: [query],
    recovered: false,
  };

  let confidenceBeforeDeep = assessToolSearchConfidence(query, result.results);
  if (confidenceBeforeDeep.lowConfidence && AUTO_DEEP_MAX_ROUNDS > 0) {
    const followupQuery = buildAutoDeepFollowupQuery(query, confidenceBeforeDeep.reason);
    if (followupQuery && followupQuery !== query) {
      deepDiagnostics.autoTriggered = true;
      deepDiagnostics.rounds = 2;
      deepDiagnostics.triggerReason = confidenceBeforeDeep.reason;
      deepDiagnostics.queryTrail.push(followupQuery);

      const deepLimit = Math.min(
        AUTO_DEEP_MAX_RESULTS,
        Math.max(limit, limit + AUTO_DEEP_EXTRA_RESULTS),
      );

      const deepResult = await provider.search(followupQuery, {
        limit: deepLimit,
        timeoutMs: timeout,
        allowedDomains: typed.allowedDomains,
        blockedDomains: typed.blockedDomains,
        timeRange,
        locale,
        toolOptions: options,
        reformulate: true,
        searchDepth: "high",
      });

      const merged = dedupeSearchResults([...result.results, ...deepResult.results]);
      result.results = rankSearchResults(query, merged, timeRange).slice(0, limit);
      result.count = result.results.length;
      result.diagnostics = {
        ...(result.diagnostics as Record<string, unknown> ?? {}),
        deepRound: {
          query: followupQuery,
          mergedCount: merged.length,
          providerDiagnostics: deepResult.diagnostics ?? undefined,
        },
      };

      confidenceBeforeDeep = assessToolSearchConfidence(query, result.results);
      deepDiagnostics.recovered = !confidenceBeforeDeep.lowConfidence;
    }
  }

  // --- Lightweight prefetch: fetch top results pages, extract passages + metadata ---
  const shouldPrefetch = resolvedPrefetch;
  const confidenceBeforePrefetch = confidenceBeforeDeep;
  const lowConfidenceBeforePrefetch = confidenceBeforePrefetch.lowConfidence;
  let prefetchCandidateCount = 0;
  let prefetchTargets: SearchResult[] = [];
  let anyDateEnriched = false;
  if (shouldPrefetch) {
    prefetchCandidateCount = result.results.filter((r) => r.url).length;
    const defaultPrefetchTargetCount = profilePrefetchTargets > 0
      ? profilePrefetchTargets
      : DEFAULT_PREFETCH_TARGETS;
    const prefetchTargetCount = resolvePrefetchTargetCount(
      defaultPrefetchTargetCount,
      lowConfidenceBeforePrefetch,
    );
    prefetchTargets = selectDiversePrefetchTargets(result.results, prefetchTargetCount);

    const PREFETCH_TIMEOUT = Math.min(timeout ?? 5000, 5000);  // capped at 5s
    const PREFETCH_MAX_BYTES = 32_000;  // ~32KB raw HTML per page
    const PREFETCH_MAX_TEXT = 8_000;    // 8K chars for passage extraction

    const settled = await Promise.allSettled(
      prefetchTargets.map(async (r) => {
        const { response } = await fetchWithRedirects(
          r.url!,
          PREFETCH_TIMEOUT,
          { "User-Agent": webConfig.fetch.userAgent },
          2,  // max 2 redirects
          options,
        );
        const body = await readResponseBody(response, PREFETCH_MAX_BYTES);
        const rawHtml = body.text;
        const contentType = response.headers.get("content-type") ?? "";
        if (!isHtmlLikeResponse(contentType, rawHtml)) {
          return { url: r.url!, passages: [] as string[] };
        }
        const parsed = parseHtml(rawHtml, PREFETCH_MAX_TEXT, 3);
        let passages = extractRelevantPassages(query, parsed.text);
        // Snippet-passage dedup
        if (r.snippet) {
          passages = deduplicateSnippetPassages(r.snippet, passages);
        }
        // Extract publication date from HTML metadata
        const pubDate = extractPublicationDate(rawHtml);
        // Cross-domain links only
        let relatedLinks: string[] | undefined;
        if (parsed.links.length > 0) {
          try {
            const sourceHost = new URL(r.url!).hostname.toLowerCase();
            relatedLinks = parsed.links.filter((link) => {
              try { return new URL(link).hostname.toLowerCase() !== sourceHost; }
              catch { return false; }
            });
            if (relatedLinks.length === 0) relatedLinks = undefined;
          } catch { /* skip */ }
        }
        return {
          url: r.url!,
          passages,
          description: parsed.description,
          title: parsed.title,
          publishedDate: pubDate,
          relatedLinks,
        };
      }),
    );

    // Attach enrichment to matching results (best-effort)
    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") continue;
      const v = outcome.value;
      const target = result.results.find((r) => r.url === v.url);
      if (!target) continue;
      if (v.passages.length > 0) target.passages = v.passages;
      if (v.description && (!target.snippet || v.description.length > target.snippet.length)) {
        target.pageDescription = v.description;
      }
      const isGenericTitle = !target.title || target.title.length < 5 ||
        /^(untitled|home|index|page)$/i.test(target.title.trim());
      if (v.title && isGenericTitle) target.title = v.title;
      if (v.relatedLinks) target.relatedLinks = v.relatedLinks;
      if (v.publishedDate && !target.publishedDate) {
        target.publishedDate = v.publishedDate;
        anyDateEnriched = true;
      }
    }
  }

  // Re-rank after date enrichment (recency boosts now apply)
  if (anyDateEnriched) {
    result.results = rankSearchResults(query, result.results, timeRange).slice(0, limit);
  }

  const now = new Date().toISOString();
  const citations: Citation[] = result.results
    .filter((r) => r.url)
    .map((r) => ({
      url: r.url!,
      title: r.title,
      excerpt: r.snippet,
      provider: result.provider,
    }));
  const confidenceFinal = assessToolSearchConfidence(query, result.results);
  const qualityPenaltiesApplied = result.results
    .filter((r) => sourceQualityPenalty(r) > 0)
    .length;
  const providerDiagnostics = result.diagnostics as Record<string, unknown> | undefined;
  const recoveryTriggered = providerDiagnostics?.lowConfidenceRetryTriggered === true;
  const diagnostics = {
    profile: {
      selectedDepth: searchDepth,
      resolvedOptions: {
        maxResults: limit,
        prefetch: shouldPrefetch,
        reformulate: resolvedReformulate,
      },
    },
    score: {
      avgScore: confidenceFinal.avgScore,
      lowConfidence: confidenceFinal.lowConfidence,
      threshold: LOW_CONFIDENCE_SCORE_THRESHOLD,
      confidenceReason: confidenceFinal.reason,
      confidenceReasons: confidenceFinal.reasons,
      hostDiversity: confidenceFinal.hostDiversity,
      queryCoverage: confidenceFinal.queryCoverage,
    },
    prefetch: {
      enabled: shouldPrefetch,
      candidateCount: prefetchCandidateCount,
      targetCount: prefetchTargets.length,
      targetUrls: prefetchTargets.map((r) => r.url).filter((u): u is string => Boolean(u)),
      adaptiveDepth: lowConfidenceBeforePrefetch,
    },
    deep: deepDiagnostics,
    recoveryTriggered,
    qualityPenaltiesApplied,
    provider: providerDiagnostics ?? undefined,
  };
  const enriched = { ...result, citations, diagnostics };

  if (webConfig.search.cacheTtlMinutes > 0) {
    await setWebCacheValue(cacheKey, enriched, webConfig.search.cacheTtlMinutes);
  }

  return { ...enriched, retrievedAt: now };
}

// ============================================================
// Result Formatting
// ============================================================

function formatSearchWebResult(
  raw: unknown,
): { summaryDisplay: string; returnDisplay: string; llmContent: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const results = data.results as SearchResult[] | undefined;
  if (!Array.isArray(results)) return null;

  const queryStr = typeof data.query === "string" ? data.query : "";
  const provider = typeof data.provider === "string" ? data.provider : "search";
  const confidence = assessToolSearchConfidence(queryStr, results);
  const lowConfidence = confidence.lowConfidence;
  const topResults = results.slice(0, 4);
  const detailLines: string[] = [`Search: "${queryStr}" (${results.length} results, ${provider})\n`];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const header = `[${i + 1}] ${r.title}${r.url ? ` \u2014 ${r.url}` : ""}`;
    detailLines.push(header);
    if (r.publishedDate) detailLines.push(`    Published: ${r.publishedDate}`);
    if (r.snippet) detailLines.push(`    > ${r.snippet}`);
    if (r.pageDescription && r.pageDescription !== r.snippet) {
      detailLines.push(`    > ${r.pageDescription}`);
    }
    if (r.passages?.length) {
      for (const p of r.passages) {
        detailLines.push(`    > ${p}`);
      }
    }
    detailLines.push("");
  }

  const displayLines: string[] = [
    `Top sources for "${queryStr}" (${results.length} results, ${provider})`,
  ];
  if (topResults.length > 0) {
    displayLines.push("");
    for (let i = 0; i < topResults.length; i++) {
      const r = topResults[i];
      displayLines.push(`[${i + 1}] ${r.title}${r.url ? ` — ${r.url}` : ""}`);
      if (r.publishedDate) displayLines.push(`    Published: ${r.publishedDate}`);
      const summary = r.passages?.[0] ?? r.pageDescription ?? r.snippet;
      if (summary) displayLines.push(`    ${summary}`);
    }
    if (results.length > topResults.length) {
      displayLines.push(`+${results.length - topResults.length} more results`);
    }
  }
  if (lowConfidence) {
    displayLines.push("");
    displayLines.push("Evidence is weak. Results may be noisy or incomplete.");
  }

  const summaryText = displayLines.join("\n").trimEnd();
  const llmSupplements: string[] = [];
  if (lowConfidence) {
    llmSupplements.push(
      "Tip: Results have low relevance scores. Consider refining your search with more specific terms.",
    );
    llmSupplements.push(`Confidence reason: ${confidence.reason}`);
    const relatedLinks = collectLowConfidenceRelatedLinks(results);
    if (relatedLinks.length > 0) {
      llmSupplements.push(
        `Related links to check:\n${relatedLinks.map((u) => `- ${u}`).join("\n")}`,
      );
    }
    llmSupplements.push(
      "If evidence remains weak, explicitly say confidence is low and ask for a narrower query or more context.",
    );
  }
  const detailText = detailLines.join("\n").trimEnd();
  const llmText = llmSupplements.length > 0
    ? `${detailText}\n\n${llmSupplements.join("\n\n")}`
    : detailText;
  return { summaryDisplay: summaryText, returnDisplay: detailText, llmContent: llmText };
}

// ============================================================
// Tool Registry
// ============================================================

export const WEB_TOOLS: Record<string, ToolMetadata> = {
  search_web: {
    fn: searchWeb,
    description:
      "Search the web using DuckDuckGo. Returns snippets, URLs, and auto-prefetched relevant passages from top results.",
    category: "web",
    formatResult: formatSearchWebResult,
    args: {
      query: "string - Search query",
      maxResults: "number (optional) - Max results (default: 5)",
      timeoutMs: "number (optional) - Request timeout in ms",
      timeoutSeconds: "number (optional) - Request timeout in seconds",
      allowedDomains: "string[] (optional) - Only include results from these domains",
      blockedDomains: "string[] (optional) - Exclude results from these domains",
      timeRange: "string (optional) - Recency window: day|week|month|year|all (default: all)",
      locale: "string (optional) - DDG locale hint in 'xx-xx' format (e.g., 'us-en', 'kr-ko')",
      searchDepth: "string (optional) - Search profile: low|medium|high (default: medium)",
      prefetch: "boolean (optional) - Auto-fetch top results and extract relevant passages (default: true)",
      reformulate: "boolean (optional) - Generate query variants for wider recall (default: true)",
    },
    returns: {
      results: "Array<{title, url?, snippet?, passages?, pageDescription?, relatedLinks?}>",
      "results[].passages": "string[] (optional) - Relevant passages extracted from prefetched page content (max 3, max 280 chars each)",
      count: "number",
      provider: "string",
      citations: "Citation[] - Structured provenance for each result",
      diagnostics: "object (optional) - Verbose ranking/prefetch diagnostics",
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
    formatResult: formatFetchUrlResult,
  },
  web_fetch: {
    fn: webFetch,
    description:
      "Fetch URL(s) with readability + headless Chrome fallback. Returns main content.",
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
      headlessChrome: "boolean - Chrome rendered content was accepted and used",
      chromeAttempted: "boolean - Chrome rendering was attempted (thin static content detected)",
      chromeRenderChars: "number (optional) - chars extracted from Chrome render (only if attempted)",
      redirects: "string[]",
      citations: "Citation[] - Source provenance",
      retrievedAt: "string (optional) - ISO 8601 timestamp",
    },
    safetyLevel: "L0",
    safety: "Read-only web fetch (auto-approved).",
    formatResult: formatWebFetchResult,
  },
};
