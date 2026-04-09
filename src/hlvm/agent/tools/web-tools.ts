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
import type {
  ToolExecutionOptions,
  ToolMetadata,
  ToolProgressTone,
  ToolTranscriptAdapter,
  ToolTranscriptCallSummary,
} from "../registry.ts";
import { loadWebConfig } from "../web-config.ts";
import { getWebCacheValue, setWebCacheValue } from "../web-cache.ts";

import {
  type Citation,
  normalizeDomain,
  resolveSearchProvider,
  SEARCH_DEPTH_DEFAULTS,
  SEARCH_DEPTH_PROFILES,
  SEARCH_TIME_RANGES,
  type SearchDepthProfile,
  type SearchResult,
  type SearchTimeRange,
} from "./web/search-provider.ts";
import { initSearchProviders } from "./web/search-provider-bootstrap.ts";
import {
  extractReadableContent,
  isHtmlLikeResponse,
  MAIN_CONTENT_MIN_CHARS,
  parseHtml,
} from "./web/html-parser.ts";
import {
  assertUrlAllowed,
  DEFAULT_WEB_MAX_BYTES,
  fetchUrlInternal,
  fetchWithRedirects,
  makeCacheKey,
  readResponseBody,
  toMillis,
  truncateText,
} from "./web/fetch-core.ts";
import { renderWithChrome } from "./web/headless-chrome.ts";
import { detectSearchQueryIntent } from "./web/query-strategy.ts";
import { DdgSearchBackend } from "./web/ddg-search-backend.ts";
import { assessToolSearchConfidence } from "./web/search-backend.ts";
import { hasStructuredEvidence } from "./web/web-utils.ts";

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
  prefetch?: boolean; // Auto-fetch top results and extract relevant passages (default: true)
  reformulate?: boolean; // Enable query reformulation for wider recall (default: true)
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
const DEFAULT_SEARCH_DEPTH: SearchDepthProfile = "medium";
const LOW_CONFIDENCE_RELATED_LINKS_LIMIT = 4;
const MAX_LLM_EVIDENCE_CHARS = 512;
const MAX_LLM_SUPPORTING_RESULTS = 2;

function formatTranscriptDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "0s";
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  const seconds = durationMs / 1_000;
  if (seconds < 10) {
    return `${Number(seconds.toFixed(1)).toString()}s`;
  }
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return remainingSeconds > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${minutes}m`;
}

function formatTranscriptBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${Number(size.toFixed(digits)).toString()} ${units[unitIndex]}`;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : undefined;
}

function readWebSearchResultCount(call: ToolTranscriptCallSummary): number {
  const meta = toRecord(call.resultMeta);
  const webSearch = toRecord(meta?.webSearch);
  const sourceGuard = toRecord(webSearch?.sourceGuard);
  const resultCount = typeof sourceGuard?.resultCount === "number"
    ? sourceGuard.resultCount
    : typeof webSearch?.resultCount === "number"
    ? webSearch.resultCount
    : undefined;
  return typeof resultCount === "number" && Number.isFinite(resultCount)
    ? resultCount
    : 0;
}

function buildFetchTranscriptSummary(
  event: {
    name: string;
    summary?: string;
    content: string;
    meta?: unknown;
  },
): string {
  const meta = toRecord(event.meta);
  const webFetch = toRecord(meta?.webFetch);
  if (webFetch?.batch === true) {
    const count = typeof webFetch.count === "number"
      ? webFetch.count
      : undefined;
    const errors = typeof webFetch.errors === "number" ? webFetch.errors : 0;
    if (typeof count === "number" && count > 0) {
      const succeeded = Math.max(0, count - errors);
      return errors > 0
        ? `Received ${succeeded}/${count} URLs`
        : `Received ${count} URL${count === 1 ? "" : "s"}`;
    }
  }

  const status = typeof webFetch?.status === "number"
    ? webFetch.status
    : undefined;
  const bytes = typeof webFetch?.bytes === "number"
    ? webFetch.bytes
    : undefined;
  if (bytes !== undefined && status !== undefined) {
    return `Received ${formatTranscriptBytes(bytes)} (${status})`;
  }
  if (status !== undefined) return `Received response (${status})`;
  if (bytes !== undefined) return `Received ${formatTranscriptBytes(bytes)}`;
  return event.name === "fetch_url" ? "Fetched URL" : "Fetched page";
}

function emitToolProgress(
  options: ToolExecutionOptions | undefined,
  toolName: string,
  message: string,
  phase: string,
  tone: ToolProgressTone = "running",
): void {
  const trimmed = message.trim();
  if (!trimmed) return;
  options?.onAgentEvent?.({
    type: "tool_progress",
    name: options?.toolName ?? toolName,
    toolCallId: options?.toolCallId,
    argsSummary: options?.argsSummary ?? "",
    message: trimmed,
    tone,
    phase,
  });
}

function emitSearchResponseProgress(
  response: unknown,
  query: string,
  options?: ToolExecutionOptions,
): void {
  const responseRecord = toRecord(response);
  const rawResults = responseRecord?.results;
  const responseResults = Array.isArray(rawResults)
    ? rawResults.map((result) => toRecord(result)).filter((
      result,
    ): result is Record<string, unknown> => Boolean(result))
    : [];
  const responseCount = typeof responseRecord?.count === "number"
    ? responseRecord.count
    : responseResults.length;
  emitToolProgress(
    options,
    "search_web",
    `Found ${responseCount} results for "${query}"`,
    "results",
  );
  if (
    responseResults.some((result) => result?.selectedForFetch === true)
  ) {
    emitToolProgress(
      options,
      "search_web",
      "Reading top sources",
      "read_sources",
    );
  }
}

export const WEB_SEARCH_TRANSCRIPT_ADAPTER: ToolTranscriptAdapter = {
  displayName: "Web Search",
  formatProgress: (event) => {
    const message = event.message.trim();
    if (message) return { message, tone: event.tone };
    const query = event.argsSummary.trim();
    if (event.phase === "start") {
      return {
        message: query ? `Searching: ${query}` : "Searching the web",
        tone: "running",
      };
    }
    return null;
  },
  formatResult: (event) => ({
    summaryText: `Did 1 search in ${
      formatTranscriptDuration(event.durationMs)
    }`,
    detailText: event.content,
  }),
  formatGroupSummary: (calls) => {
    const count = calls.length;
    const totalResults = calls.reduce(
      (sum, call) => sum + readWebSearchResultCount(call),
      0,
    );
    const base = `Searched the web for ${count} quer${
      count === 1 ? "y" : "ies"
    }`;
    return totalResults > 0 ? `${base} · ${totalResults} results` : base;
  },
};

export const WEB_FETCH_TRANSCRIPT_ADAPTER: ToolTranscriptAdapter = {
  displayName: "Web Fetch",
  formatProgress: (event) => {
    const message = event.message.trim();
    if (message) return { message, tone: event.tone };
    if (event.phase === "start") {
      return { message: "Fetching…", tone: "running" };
    }
    return null;
  },
  formatResult: (event) => ({
    summaryText: buildFetchTranscriptSummary(event),
    detailText: event.content,
  }),
  formatGroupSummary: (calls) => {
    const count = calls.length;
    return `Fetched ${count} page${count === 1 ? "" : "s"}`;
  },
};

export const FETCH_URL_TRANSCRIPT_ADAPTER: ToolTranscriptAdapter = {
  displayName: "Fetch URL",
  formatProgress: WEB_FETCH_TRANSCRIPT_ADAPTER.formatProgress,
  formatResult: (event) => ({
    summaryText: buildFetchTranscriptSummary(event),
    detailText: event.content,
  }),
  formatGroupSummary: (calls) => {
    const count = calls.length;
    return `Fetched ${count} URL${count === 1 ? "" : "s"}`;
  },
};

// ============================================================
// Structured Error Codes
// ============================================================

type WebToolErrorCode =
  | "max_uses_exceeded"
  | "invalid_input"
  | "disabled";

function webToolError(
  msg: string,
  context: string,
  errorCode: WebToolErrorCode,
): ValidationError {
  const err = new ValidationError(msg, context);
  err.metadata.errorCode = errorCode;
  return err;
}

// ============================================================
// Per-Run Tool Budget
// ============================================================

const WEB_TOOL_MAX_USES: Record<string, number> = {
  search_web: 15,
  web_fetch: 25,
  fetch_url: 25,
};
const webToolUseCounts = new Map<string, number>();

export function resetWebToolBudget(): void {
  webToolUseCounts.clear();
}

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
  const { retrievedAt: _cachedRetrievedAt, ...rest } = cached as
    & Record<string, unknown>
    & { retrievedAt?: unknown };
  return { ...rest, cached: true, retrievedAt: new Date().toISOString() };
}

function resolveLocale(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[a-z]{2}-[a-z]{2}$/i.test(value.trim())) {
    throw webToolError(
      "locale must be format 'xx-xx' (e.g., 'us-en')",
      "search_web",
      "invalid_input",
    );
  }
  return value.trim().toLowerCase();
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeEmbeddedSearchWebArgs(value: SearchWebArgs): SearchWebArgs {
  if (typeof value.query !== "string") return value;
  const trimmed = value.query.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return value;

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return value;
    const candidate = parsed as Record<string, unknown>;
    const recoveredQuery =
      typeof candidate.query === "string" && candidate.query.trim().length > 0
        ? candidate.query.trim()
        : undefined;
    if (!recoveredQuery) return value;

    return {
      ...value,
      query: recoveredQuery,
      maxResults:
        typeof candidate.maxResults === "number" && candidate.maxResults > 0
          ? candidate.maxResults
          : value.maxResults,
      timeoutMs:
        typeof candidate.timeoutMs === "number" && candidate.timeoutMs > 0
          ? candidate.timeoutMs
          : value.timeoutMs,
      timeoutSeconds: typeof candidate.timeoutSeconds === "number" &&
          candidate.timeoutSeconds > 0
        ? candidate.timeoutSeconds
        : value.timeoutSeconds,
      allowedDomains: normalizeStringArray(candidate.allowedDomains) ??
        value.allowedDomains,
      blockedDomains: normalizeStringArray(candidate.blockedDomains) ??
        value.blockedDomains,
      timeRange: typeof candidate.timeRange === "string"
        ? candidate.timeRange as SearchTimeRange
        : value.timeRange,
      locale: typeof candidate.locale === "string"
        ? candidate.locale
        : value.locale,
      searchDepth: typeof candidate.searchDepth === "string"
        ? candidate.searchDepth as SearchDepthProfile
        : value.searchDepth,
      prefetch: typeof candidate.prefetch === "boolean"
        ? candidate.prefetch
        : value.prefetch,
      reformulate: typeof candidate.reformulate === "boolean"
        ? candidate.reformulate
        : value.reformulate,
    };
  } catch {
    return value;
  }
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

function resultEvidenceSummary(
  result: SearchResult,
  maxPassages = 1,
  includeSnippetFallback = true,
): string[] {
  const passages = (result.passages ?? [])
    .map((passage) => passage.trim())
    .filter((passage) => passage.length > 0)
    .slice(0, maxPassages);
  if (passages.length > 0) return passages;
  if (result.pageDescription?.trim()) return [result.pageDescription.trim()];
  if (includeSnippetFallback && result.snippet?.trim()) {
    return [result.snippet.trim()];
  }
  return [];
}

function compactEvidenceText(text: string): string {
  const trimmed = text.trim();
  const preservesStructure = trimmed.startsWith("```") ||
    /\|[^\n]+\|\n\|(?:\s*:?-+:?\s*\|)+/.test(trimmed);
  return truncateText(
    preservesStructure ? trimmed : text.replace(/\s+/g, " ").trim(),
    MAX_LLM_EVIDENCE_CHARS,
  ).text;
}

function buildEvidencePackLines(
  results: SearchResult[],
  evidenceExcerptCount: number,
): string[] {
  const lines = ["Fetched sources:"];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    lines.push(
      `[${i + 1}] ${result.title}${result.url ? ` — ${result.url}` : ""}`,
    );
    if (result.publishedDate) {
      lines.push(`    Published: ${result.publishedDate}`);
    }
    if (result.evidenceStrength) {
      const evidenceLabel = result.evidenceStrength.toUpperCase();
      const evidenceReason = result.evidenceReason?.trim()
        ? ` — ${result.evidenceReason.trim()}`
        : "";
      lines.push(`    Evidence: ${evidenceLabel}${evidenceReason}`);
    }

    const evidence = resultEvidenceSummary(result, evidenceExcerptCount, false)
      .map(compactEvidenceText)
      .filter((excerpt) => excerpt.length > 0);
    if (evidence.length === 0) {
      lines.push("    No extracted evidence was available from this fetch.");
      continue;
    }
    for (const excerpt of evidence) {
      lines.push(`    > ${excerpt}`);
    }
  }
  return lines;
}

function buildSupportingLines(results: SearchResult[]): string[] {
  const lines = ["Supporting results:"];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    lines.push(
      `[${i + 1}] ${result.title}${result.url ? ` — ${result.url}` : ""}`,
    );
    for (
      const excerpt of resultEvidenceSummary(result, 1).map(compactEvidenceText)
    ) {
      lines.push(`    > ${excerpt}`);
    }
  }
  return lines;
}

function resolveSearchDepth(value: unknown): SearchDepthProfile {
  if (value === undefined) return DEFAULT_SEARCH_DEPTH;
  const normalized = typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
  if (SEARCH_DEPTH_PROFILES.includes(normalized as SearchDepthProfile)) {
    return normalized as SearchDepthProfile;
  }
  throw new ValidationError(
    `searchDepth must be one of: ${SEARCH_DEPTH_PROFILES.join(", ")}`,
    "search_web",
  );
}

export const __testOnlyBuildSearchWebCacheKey = buildSearchWebCacheKey;
export const __testOnlyFormatSearchWebResult = formatSearchWebResult;

function formatFetchUrlResult(
  raw: unknown,
):
  | { summaryDisplay: string; returnDisplay: string; llmContent?: string }
  | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const url = typeof data.url === "string" ? data.url : "";
  const text = typeof data.text === "string" ? data.text : "";
  if (!url || !text) return null;
  const status = typeof data.status === "number" ? data.status : undefined;
  const contentType = typeof data.contentType === "string"
    ? data.contentType
    : "";
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
):
  | { summaryDisplay: string; returnDisplay: string; llmContent?: string }
  | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;

  if (data.batch === true && Array.isArray(data.results)) {
    const count = typeof data.count === "number"
      ? data.count
      : data.results.length;
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
        `[${i + 1}] ${url}${title ? ` — ${title}` : ""}${
          error ? ` (error: ${error})` : ""
        }`,
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
  const description = typeof data.description === "string"
    ? data.description
    : "";
  const detailLines = [`URL: ${url}`];
  if (title) detailLines.push(`Title: ${title}`);
  if (description) detailLines.push(`Description: ${description}`);
  detailLines.push("");
  detailLines.push(text);
  const detailText = detailLines.join("\n").trimEnd();
  return {
    summaryDisplay: title
      ? `Fetched ${url}\nTitle: ${title}`
      : `Fetched ${url}`,
    returnDisplay: detailText,
    llmContent: detailText,
  };
}

function resolveSearchTimeRange(value: unknown): SearchTimeRange {
  if (value === undefined) return "all";
  const normalized = typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
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
  if (urls?.length) {
    return await batchWebFetch(urls, maxChars, timeoutSeconds, options);
  }
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
    typeof maxChars === "number" && maxChars > 0
      ? maxChars
      : webConfig.fetch.maxChars,
    MAX_WEB_CHARS,
  );
  const timeoutMs = toMillis(timeoutSeconds ?? webConfig.fetch.timeoutSeconds);

  const cacheKey = makeCacheKey("web_fetch", [url, resolvedMaxChars]);
  const cachedFetch = await checkCacheHit(
    cacheKey,
    webConfig.fetch.cacheTtlMinutes,
  );
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
      const reparsed = parseHtml(
        chromeHtml,
        resolvedMaxChars,
        DEFAULT_HTML_LINKS,
      );
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
    citations: [{
      url: finalUrl,
      title: parsed.title || "",
      excerpt: (text || "").slice(0, 150),
      provider: "fetch",
    }] as Citation[],
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
    throw webToolError(
      `Too many URLs (max ${MAX_BATCH_URLS})`,
      "web_fetch",
      "invalid_input",
    );
  }

  const results: Record<string, unknown>[] = [];
  const fetcher = pooledMap(BATCH_CONCURRENCY, urls, async (u) => {
    try {
      return await webFetchSingle(u, maxChars, timeoutSeconds, options);
    } catch (err) {
      return { url: u, error: String(err), ok: false } as Record<
        string,
        unknown
      >;
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

  const typed = normalizeEmbeddedSearchWebArgs(args as SearchWebArgs);
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
  const cachedSearch = await checkCacheHit(
    cacheKey,
    webConfig.search.cacheTtlMinutes,
  );
  if (cachedSearch) {
    emitSearchResponseProgress(cachedSearch, query, options);
    return cachedSearch;
  }

  initSearchProviders();
  const provider = resolveSearchProvider(webConfig.search.provider, false);

  const backend = new DdgSearchBackend();
  const response = await backend.search({
    query,
    limit,
    timeoutMs: timeout,
    allowedDomains: typed.allowedDomains,
    blockedDomains: typed.blockedDomains,
    timeRange,
    locale,
    searchDepth,
    prefetch: resolvedPrefetch,
    reformulate: resolvedReformulate,
    profilePrefetchTargets,
    provider,
    fetchUserAgent: webConfig.fetch.userAgent,
    toolOptions: options,
  });

  emitSearchResponseProgress(response, query, options);

  if (webConfig.search.cacheTtlMinutes > 0) {
    await setWebCacheValue(
      cacheKey,
      response,
      webConfig.search.cacheTtlMinutes,
    );
  }

  return { ...response, retrievedAt: new Date().toISOString() };
}

// ============================================================
// Result Formatting
// ============================================================

function formatSearchWebResult(
  raw: unknown,
):
  | { summaryDisplay: string; returnDisplay: string; llmContent: string }
  | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const results = data.results as SearchResult[] | undefined;
  if (!Array.isArray(results)) return null;

  const queryStr = typeof data.query === "string" ? data.query : "";
  const provider = typeof data.provider === "string" ? data.provider : "search";
  const queryIntent = detectSearchQueryIntent(queryStr);
  const confidence = assessToolSearchConfidence(queryStr, results);
  const lowConfidence = confidence.lowConfidence;
  const fetchedResults = results.filter((result) =>
    result.selectedForFetch === true
  );
  const supportingResults = results.filter((result) =>
    result.selectedForFetch !== true
  ).slice(0, 4);
  const topResults = (fetchedResults.length > 0 ? fetchedResults : results)
    .slice(0, 4);
  const evidenceExcerptCount = queryIntent.wantsComparison ? 2 : 1;
  const detailLines: string[] = [
    `Search: "${queryStr}" (${results.length} results, ${provider})\n`,
  ];

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
      if (r.publishedDate) {
        displayLines.push(`    Published: ${r.publishedDate}`);
      }
      const summary = resultEvidenceSummary(r, 1)[0];
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
  const fetchedEvidenceAvailable = fetchedResults.some((result) =>
    hasStructuredEvidence(result)
  );
  const llmSections: string[] = [
    `Web search evidence\nQuery: "${queryStr}"\nProvider: ${provider}\nResults: ${results.length}`,
    fetchedEvidenceAvailable
      ? "Use fetched sources as primary evidence. Use supporting search results only to fill small gaps or corroborate."
      : "Fetched evidence is limited. Prefer the strongest fetched source if present, and treat snippet-only results cautiously.",
  ].filter((value): value is string => Boolean(value));
  if (fetchedResults.length > 0) {
    llmSections.push(
      buildEvidencePackLines(fetchedResults, evidenceExcerptCount).join("\n"),
    );
  }
  if (!fetchedEvidenceAvailable) {
    llmSections.push(
      "No fetched-page evidence was available; rely on snippets and metadata cautiously.",
    );
  }
  const shouldIncludeSupporting = supportingResults.length > 0 &&
    (!fetchedEvidenceAvailable || queryIntent.wantsComparison || lowConfidence);
  if (shouldIncludeSupporting) {
    llmSections.push(
      buildSupportingLines(
        supportingResults.slice(0, MAX_LLM_SUPPORTING_RESULTS),
      ).join("\n"),
    );
  }
  const llmSupplements: string[] = [];
  if (lowConfidence) {
    llmSupplements.push(
      "Tip: Search confidence is low. Results may be noisy or incomplete.",
    );
    llmSupplements.push(`Confidence reason: ${confidence.reason}`);
    const relatedLinks = collectLowConfidenceRelatedLinks(results);
    if (relatedLinks.length > 0) {
      llmSupplements.push(
        `Related links to check:\n${
          relatedLinks.map((u) => `- ${u}`).join("\n")
        }`,
      );
    }
    llmSupplements.push(
      "If evidence remains weak, explicitly say confidence is low and ask for a narrower query or more context.",
    );
  }
  const detailText = detailLines.join("\n").trimEnd();
  if (llmSupplements.length > 0) {
    llmSections.push(llmSupplements.join("\n\n"));
  }
  const llmText = llmSections.join("\n\n").trimEnd();
  return {
    summaryDisplay: summaryText,
    returnDisplay: detailText,
    llmContent: llmText,
  };
}

// ============================================================
// Tool Registry
// ============================================================

export const WEB_TOOLS: Record<string, ToolMetadata> = {
  search_web: {
    fn: searchWeb,
    description:
      "Discover relevant web pages and sources using DuckDuckGo. Use this for research, how-to guidance, and live information, then use web_fetch to read a chosen URL. Canonical args include timeRange and prefetch.",
    category: "web",
    argAliases: {
      recency: "timeRange",
      time_range: "timeRange",
      preFetch: "prefetch",
      max_results: "maxResults",
      allowed_domains: "allowedDomains",
      blocked_domains: "blockedDomains",
      search_depth: "searchDepth",
      timeout_ms: "timeoutMs",
      timeout_seconds: "timeoutSeconds",
    },
    formatResult: formatSearchWebResult,
    args: {
      query: "string - Search query",
      maxResults: "number (optional) - Max results (default: 5)",
      timeoutMs: "number (optional) - Request timeout in ms",
      timeoutSeconds: "number (optional) - Request timeout in seconds",
      allowedDomains:
        "string[] (optional) - Only include results from these domains",
      blockedDomains:
        "string[] (optional) - Exclude results from these domains",
      timeRange:
        "string (optional) - Recency window: day|week|month|year|all (default: all)",
      locale:
        "string (optional) - DDG locale hint in 'xx-xx' format (e.g., 'us-en', 'kr-ko')",
      searchDepth:
        "string (optional) - Search profile: low|medium|high (default: medium)",
      prefetch:
        "boolean (optional) - Auto-fetch top results and extract relevant passages (default: true)",
      reformulate:
        "boolean (optional) - Generate query variants for wider recall (default: true)",
    },
    returns: {
      results:
        "Array<{title, url?, snippet?, passages?, pageDescription?, relatedLinks?}>",
      "results[].passages":
        "string[] (optional) - Relevant passages extracted from prefetched page content (max 3, max 512 chars each)",
      count: "number",
      provider: "string",
      citations: "Citation[] - Structured provenance for each result",
      diagnostics: "object (optional) - Verbose ranking/prefetch diagnostics",
      retrievedAt: "string - ISO 8601 timestamp of retrieval",
    },
    safetyLevel: "L0",
    safety: "Read-only web search (auto-approved).",
    transcript: WEB_SEARCH_TRANSCRIPT_ADAPTER,
  },
  fetch_url: {
    fn: fetchUrl,
    description:
      "Fetch a URL and return raw text/HTML/markdown with size limits. Use this for low-level inspection, not as the default page reader.",
    category: "web",
    argAliases: {
      max_bytes: "maxBytes",
      timeout_ms: "timeoutMs",
    },
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
    transcript: FETCH_URL_TRANSCRIPT_ADAPTER,
  },
  web_fetch: {
    fn: webFetch,
    description:
      "Read one or more known URLs with readability + headless Chrome fallback. Prefer this after search_web identifies the page you want to read.",
    category: "web",
    argAliases: {
      max_chars: "maxChars",
      timeout_seconds: "timeoutSeconds",
    },
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
      chromeAttempted:
        "boolean - Chrome rendering was attempted (thin static content detected)",
      chromeRenderChars:
        "number (optional) - chars extracted from Chrome render (only if attempted)",
      redirects: "string[]",
      citations: "Citation[] - Source provenance",
      retrievedAt: "string (optional) - ISO 8601 timestamp",
    },
    safetyLevel: "L0",
    safety: "Read-only web fetch (auto-approved).",
    formatResult: formatWebFetchResult,
    transcript: WEB_FETCH_TRANSCRIPT_ADAPTER,
  },
};
