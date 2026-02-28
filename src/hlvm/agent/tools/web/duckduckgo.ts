/**
 * DuckDuckGo search: HTML parsing, result scoring, URL normalization.
 * Extracted from web-tools.ts for modularity.
 */

import { http } from "../../../../common/http-client.ts";
import { ValidationError } from "../../../../common/error.ts";
import type { ToolExecutionOptions } from "../../registry.ts";
import { assertUrlAllowed } from "./fetch-core.ts";
import { decodeHtmlEntities, parseAttributes } from "./html-parser.ts";
import {
  rankSearchResults,
} from "./search-ranking.ts";
import {
  isAllowedByDomainFilters,
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

export function scoreSearchResults(
  query: string,
  results: SearchResult[],
): SearchResult[] {
  return rankSearchResults(query, results, "all");
}

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

// ============================================================
// Search Implementation
// ============================================================

export async function duckDuckGoSearch(
  query: string,
  limit: number,
  timeoutMs: number | undefined,
  timeRange: SearchTimeRange,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  const endpoint = `https://html.duckduckgo.com/html/?q=${
    encodeURIComponent(query)
  }`;
  assertUrlAllowed(endpoint, options);

  const response = await http.fetchRaw(endpoint, {
    timeout: timeoutMs,
    headers: {
      "Accept": "text/html",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new ValidationError(
      `DuckDuckGo search failed with HTTP ${response.status}`,
      "search_web",
    );
  }

  const html = await response.text();
  const candidateLimit = Math.max(limit * 4, limit);
  const parsedResults = parseDuckDuckGoSearchResults(html, candidateLimit);
  const scored = rankSearchResults(query, parsedResults, timeRange);
  const topResults = scored.slice(0, limit);

  return {
    query,
    provider: "duckduckgo",
    results: topResults,
    count: topResults.length,
  };
}

// ============================================================
// Provider Registration
// ============================================================

function filterResultsByDomain(
  results: ProviderSearchResult[],
  allowed?: string[],
  blocked?: string[],
): ProviderSearchResult[] {
  return results.filter((r) => {
    if (!r.url) return true;
    try {
      const hostname = new URL(r.url).hostname;
      return isAllowedByDomainFilters(hostname, allowed, blocked);
    } catch {
      return true;
    }
  });
}

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
      );
      let results = raw.results as ProviderSearchResult[];
      if (opts.allowedDomains?.length || opts.blockedDomains?.length) {
        results = filterResultsByDomain(results, opts.allowedDomains, opts.blockedDomains);
      }
      return {
        query: raw.query as string,
        provider: raw.provider as string,
        results,
        count: results.length,
      };
    },
  });
}
