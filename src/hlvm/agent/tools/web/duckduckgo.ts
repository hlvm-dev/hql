/**
 * DuckDuckGo search: HTML parsing, raw provider ordering, and URL normalization.
 * Extracted from web-tools.ts for modularity.
 */

import { http } from "../../../../common/http-client.ts";
import { ValidationError } from "../../../../common/error.ts";
import { withRetry } from "../../../../common/retry.ts";
import { DEFAULT_USER_AGENT } from "../../../../common/config/web-resolver.ts";
import type { ToolExecutionOptions } from "../../registry.ts";
import { assertUrlAllowed, isTransientHttpError } from "./fetch-core.ts";
import { decodeHtmlEntities, parseAttributes } from "./html-parser.ts";
import {
  dedupeSearchResultsStable,
} from "./search-ranking.ts";
import {
  filterSearchResultsByDomain,
  type SearchTimeRange,
  registerSearchProvider,
  type SearchCallOptions,
  type SearchResult as ProviderSearchResult,
} from "./search-provider.ts";

// ============================================================
// Types
// ============================================================

interface SearchResult {
  title: string;
  url?: string;
  snippet?: string;
  score?: number;
}

/** DuckDuckGo server-side date filter values */
const DDG_DF_PARAM: Partial<Record<SearchTimeRange, string>> = { day: "d", week: "w", month: "m", year: "y" };

// ============================================================
// HTML Tag Helpers
// ============================================================

function stripHtmlTags(input: string): string {
  return decodeHtmlEntities(
    input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  );
}

function normalizeDuckDuckGoResultUrl(rawHref: string): string {
  let href = decodeHtmlEntities(rawHref).trim();
  if (!href) return "";

  if (href.startsWith("//")) {
    href = `https:${href}`;
  } else if (href.startsWith("/")) {
    href = `https://duckduckgo.com${href}`;
  }

  try {
    const parsed = new URL(href);
    const isDuckDuckGoHost = parsed.hostname === "duckduckgo.com" ||
      parsed.hostname.endsWith(".duckduckgo.com");
    if (isDuckDuckGoHost && parsed.pathname.startsWith("/l/")) {
      return parsed.searchParams.get("uddg") ?? href;
    }
    return parsed.toString();
  } catch {
    return href;
  }
}

function normalizeBingResultUrl(rawHref: string): string {
  let href = decodeHtmlEntities(rawHref).trim();
  if (!href) return "";
  if (href.startsWith("//")) href = `https:${href}`;
  if (href.startsWith("/")) href = `https://www.bing.com${href}`;
  try {
    const parsed = new URL(href);
    if (
      (parsed.hostname === "www.bing.com" || parsed.hostname.endsWith(".bing.com")) &&
      parsed.pathname.startsWith("/ck/")
    ) {
      const encodedTarget = parsed.searchParams.get("u");
      if (encodedTarget?.startsWith("a1")) {
        try {
          const normalized = encodedTarget.slice(2)
            .replace(/-/g, "+")
            .replace(/_/g, "/");
          const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
          return atob(padded);
        } catch {
          // Fall through to raw Bing URL if decode fails.
        }
      } else if (encodedTarget?.startsWith("http")) {
        return encodedTarget;
      }
    }
    return parsed.toString();
  } catch {
    return href;
  }
}

function isDuckDuckGoAnomalyPage(html: string): boolean {
  return /anomaly-modal|challenge-form|Unfortunately,\s+bots\s+use\s+DuckDuckGo\s+too/i.test(
    html,
  );
}

// ============================================================
// Result Parsing
// ============================================================

export function parseDuckDuckGoSearchResults(
  html: string,
  limit: number,
): SearchResult[] {
  const anchorRegex = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  const snippetRegex =
    /<(?:a|div|span|td|p)\b[^>]*class\s*=\s*["'][^"']*(?:result__snippet|result-snippet)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span|td|p)>/i;

  const rawMatches: Array<{
    start: number;
    end: number;
    title: string;
    url: string;
  }> = [];
  let match: RegExpExecArray | null;
  const maxRawMatches = Math.max(1, limit * 4);

  while ((match = anchorRegex.exec(html)) !== null) {
    const fullAnchor = match[0] ?? "";
    const openTag = fullAnchor.match(/^<a\b[^>]*>/i)?.[0] ?? "";
    if (!openTag) continue;

    const attrs = parseAttributes(openTag);
    const className = (attrs.class ?? "").toLowerCase();
    const rel = (attrs.rel ?? "").toLowerCase();
    const href = attrs.href;
    if (!href) continue;
    const isResultAnchor = className.includes("result__a") ||
      className.includes("result-link") ||
      (rel.includes("nofollow") && href.includes("/l/?"));
    if (!isResultAnchor) continue;

    const url = normalizeDuckDuckGoResultUrl(href);
    if (!url) continue;

    const titleHtml = fullAnchor.slice(
      openTag.length,
      fullAnchor.length - "</a>".length,
    );
    const title = stripHtmlTags(titleHtml);
    if (!title) continue;

    rawMatches.push({
      start: match.index,
      end: anchorRegex.lastIndex,
      title,
      url,
    });

    if (rawMatches.length >= maxRawMatches) break;
  }

  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();
  for (let i = 0; i < rawMatches.length; i++) {
    const current = rawMatches[i];
    if (seenUrls.has(current.url)) continue;
    seenUrls.add(current.url);

    const nextStart = rawMatches[i + 1]?.start ?? Math.min(
      current.end + 2000,
      html.length,
    );
    const segment = html.slice(current.end, nextStart);
    const snippetMatch = segment.match(snippetRegex);
    const snippet = snippetMatch?.[1] ? stripHtmlTags(snippetMatch[1]) : "";

    results.push({
      title: current.title,
      url: current.url,
      snippet,
    });
    if (results.length >= limit) break;
  }

  return results;
}

export function parseBingSearchResults(
  html: string,
  limit: number,
): SearchResult[] {
  const blockRegex =
    /<li\b[^>]*class\s*=\s*["'][^"']*\bb_algo\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(html)) !== null) {
    const block = match[1] ?? "";
    const anchorMatch = block.match(
      /<h2\b[^>]*>\s*<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!anchorMatch) continue;

    const url = normalizeBingResultUrl(anchorMatch[1] ?? "");
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);

    const title = stripHtmlTags(anchorMatch[2] ?? "");
    if (!title) continue;

    const snippetMatch = block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch?.[1] ? stripHtmlTags(snippetMatch[1]) : "";

    results.push({ title, url, snippet });
    if (results.length >= limit) break;
  }

  return results;
}

// ============================================================
// Query Reformulation
// ============================================================

/** Generate query variants for wider recall (pure string, no LLM). */
export function generateQueryVariants(query: string, maxVariants = 2): string[] {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 2) return [];

  const variants: string[] = [];
  const limit = Math.min(Math.max(0, maxVariants), 2);
  const normalizedWords = words.map((w) =>
    w.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9.]+$/gi, "")
  );

  // Reorder: swap first and last significant words
  if (words.length >= 2 && variants.length < limit) {
    const reordered = [...words];
    [reordered[0], reordered[reordered.length - 1]] = [reordered[reordered.length - 1], reordered[0]];
    const v = reordered.join(" ");
    if (v !== query.trim()) variants.push(v);
  }

  // Drop qualifier: avoid dropping version/year tokens (e.g., 2.2, 2025).
  if (words.length >= 3 && variants.length < limit) {
    const dropQualifierWords = new Set([
      "change",
      "changes",
      "docs",
      "documentation",
      "guide",
      "intro",
      "latest",
      "new",
      "note",
      "notes",
      "release",
      "tutorial",
      "update",
      "updates",
    ]);
    const isVersionToken = (token: string): boolean => /\d/.test(token);
    let dropIndex = -1;

    for (let i = 0; i < normalizedWords.length; i++) {
      const token = normalizedWords[i];
      if (!token || isVersionToken(token)) continue;
      if (!dropQualifierWords.has(token)) continue;
      if (dropIndex === -1 || token.length < normalizedWords[dropIndex].length) {
        dropIndex = i;
      }
    }

    if (dropIndex === -1) {
      for (let i = 0; i < normalizedWords.length; i++) {
        const token = normalizedWords[i];
        if (!token || isVersionToken(token)) continue;
        if (token.length > 4) continue;
        if (dropIndex === -1 || token.length < normalizedWords[dropIndex].length) {
          dropIndex = i;
        }
      }
    }

    if (dropIndex >= 0) {
      const dropped = words.filter((_w, idx) => idx !== dropIndex).join(" ");
      if (dropped.split(/\s+/).length >= 2 && dropped !== query.trim()) {
        variants.push(dropped);
      }
    }
  }

  // Add context for how-to/what-is queries
  const lower = query.trim().toLowerCase();
  if (variants.length < limit && (lower.startsWith("how to") || lower.startsWith("what is"))) {
    variants.push(`${query.trim()} guide`);
  }

  return variants.slice(0, limit);
}

// ============================================================
// Search Implementation
// ============================================================

async function fetchDdgPage(
  query: string,
  timeRange: SearchTimeRange,
  locale: string | undefined,
  timeoutMs: number | undefined,
  options: ToolExecutionOptions | undefined,
  offset?: number,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const df = DDG_DF_PARAM[timeRange];
  if (df) params.set("df", df);
  if (locale) params.set("kl", locale);
  if (offset && offset > 0) params.set("s", String(offset));
  const endpoint = `https://html.duckduckgo.com/html/?${params}`;
  assertUrlAllowed(endpoint, options);

  const response = await withRetry(
    () => http.fetchRaw(endpoint, {
      timeout: timeoutMs,
      headers: {
        "Accept": "text/html",
        "User-Agent": DEFAULT_USER_AGENT,
      },
    }),
    { maxAttempts: 2, initialDelayMs: 500, shouldRetry: isTransientHttpError },
  );
  if (!response.ok) {
    throw new ValidationError(
      `DuckDuckGo search failed with HTTP ${response.status}`,
      "search_web",
    );
  }

  const html = await response.text();
  if (isDuckDuckGoAnomalyPage(html)) {
    throw new ValidationError(
      "DuckDuckGo search was blocked by an anti-bot challenge.",
      "search_web",
    );
  }
  return parseDuckDuckGoSearchResults(html, Math.max(30, 20));
}

async function fetchBingPage(
  query: string,
  timeoutMs: number | undefined,
  options: ToolExecutionOptions | undefined,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const endpoint = `https://www.bing.com/search?${params}`;
  assertUrlAllowed(endpoint, options);

  const response = await withRetry(
    () => http.fetchRaw(endpoint, {
      timeout: timeoutMs,
      headers: {
        "Accept": "text/html",
        "User-Agent": DEFAULT_USER_AGENT,
      },
    }),
    { maxAttempts: 2, initialDelayMs: 500, shouldRetry: isTransientHttpError },
  );
  if (!response.ok) {
    throw new ValidationError(
      `Bing search failed with HTTP ${response.status}`,
      "search_web",
    );
  }

  const html = await response.text();
  return parseBingSearchResults(html, Math.max(30, 20));
}

async function duckDuckGoSearch(
  query: string,
  limit: number,
  timeoutMs: number | undefined,
  timeRange: SearchTimeRange,
  options?: ToolExecutionOptions,
  locale?: string,
  allowedDomains?: string[],
  blockedDomains?: string[],
  _reformulate = true,
): Promise<Record<string, unknown>> {
  let page1: SearchResult[];
  let provider = "duckduckgo";
  let fallbackProvider: string | undefined;
  let anomalyBlocked = false;
  try {
    page1 = await fetchDdgPage(query, timeRange, locale, timeoutMs, options);
  } catch (error) {
    if (
      error instanceof ValidationError &&
      error.message.includes("anti-bot challenge")
    ) {
      anomalyBlocked = true;
      page1 = await fetchBingPage(query, timeoutMs, options);
      provider = "bing-html";
      fallbackProvider = "bing-html";
    } else {
      throw error;
    }
  }

  const deduped = dedupeSearchResultsStable(page1);
  const filtered = (allowedDomains?.length || blockedDomains?.length)
    ? filterSearchResultsByDomain(deduped, allowedDomains, blockedDomains)
    : deduped;
  const topResults = filtered.slice(0, limit);
  const diagnostics: Record<string, unknown> = {
    rawProviderOrder: true,
    anomalyBlocked,
    parsedCount: page1.length,
    dedupedCount: deduped.length,
    filteredCount: filtered.length,
    fallbackProvider,
  };

  return {
    query,
    provider,
    results: topResults,
    count: topResults.length,
    diagnostics,
  };
}

// ============================================================
// Provider Registration
// ============================================================

export function registerDuckDuckGo(): void {
  registerSearchProvider({
    name: "duckduckgo",
    displayName: "DuckDuckGo",
    requiresApiKey: false,
    async search(query: string, opts: SearchCallOptions) {
      const raw = await duckDuckGoSearch(
        query,
        opts.limit,
        opts.timeoutMs,
        opts.timeRange ?? "all",
        opts.toolOptions,
        opts.locale,
        opts.allowedDomains,
        opts.blockedDomains,
        opts.reformulate ?? true,
      );
      return {
        query: raw.query as string,
        provider: raw.provider as string,
        results: raw.results as ProviderSearchResult[],
        count: raw.count as number,
        diagnostics: (raw as { diagnostics?: Record<string, unknown> }).diagnostics,
      };
    },
  });
}
