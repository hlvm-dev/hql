/**
 * DuckDuckGo search: HTML parsing, result scoring, URL normalization.
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
  dedupeSearchResults,
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

/** DuckDuckGo server-side date filter values */
const DDG_DF_PARAM: Partial<Record<SearchTimeRange, string>> = { day: "d", week: "w", month: "m", year: "y" };

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
// Domain Filtering
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

// ============================================================
// Query Reformulation
// ============================================================

/** Generate query variants for wider recall (pure string, no LLM). */
export function generateQueryVariants(query: string, maxVariants = 2): string[] {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 2) return [];

  const variants: string[] = [];

  // Reorder: swap first and last significant words
  if (words.length >= 2) {
    const reordered = [...words];
    [reordered[0], reordered[reordered.length - 1]] = [reordered[reordered.length - 1], reordered[0]];
    const v = reordered.join(" ");
    if (v !== query.trim()) variants.push(v);
  }

  // Drop qualifier: remove shortest word (only if result >= 2 words)
  if (words.length >= 3 && variants.length < maxVariants) {
    const shortest = words.reduce((min, w) => w.length < min.length ? w : min, words[0]);
    const dropped = words.filter((w) => w !== shortest).join(" ");
    if (dropped.split(/\s+/).length >= 2 && dropped !== query.trim()) {
      variants.push(dropped);
    }
  }

  // Add context for how-to/what-is queries
  const lower = query.trim().toLowerCase();
  if (variants.length < maxVariants && (lower.startsWith("how to") || lower.startsWith("what is"))) {
    variants.push(`${query.trim()} guide`);
  }

  return variants.slice(0, Math.min(maxVariants, 2));
}

// ============================================================
// Search Implementation
// ============================================================

const MAX_DDG_PAGES = 2;

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
  return parseDuckDuckGoSearchResults(html, Math.max(30, 20));
}

export async function duckDuckGoSearch(
  query: string,
  limit: number,
  timeoutMs: number | undefined,
  timeRange: SearchTimeRange,
  options?: ToolExecutionOptions,
  locale?: string,
  allowedDomains?: string[],
  blockedDomains?: string[],
  reformulate = true,
): Promise<Record<string, unknown>> {
  const page1 = await fetchDdgPage(query, timeRange, locale, timeoutMs, options);
  let allResults: SearchResult[] = [...page1];

  // Rank page 1 to check if we need more results
  const scored1 = rankSearchResults(query, allResults, timeRange);
  const filtered1 = (allowedDomains?.length || blockedDomains?.length)
    ? filterResultsByDomain(scored1, allowedDomains, blockedDomains)
    : scored1;

  // If page 1 is insufficient, fire page 2 + query variants in parallel
  if (filtered1.length < limit && page1.length > 0) {
    const variantTimeout = Math.max(2000, Math.floor((timeoutMs ?? 30000) / 3));
    const fetches: Promise<SearchResult[]>[] = [];

    // Page 2 of original query
    if (MAX_DDG_PAGES > 1) {
      fetches.push(
        fetchDdgPage(query, timeRange, locale, variantTimeout, options, page1.length)
          .catch(() => [] as SearchResult[]),
      );
    }

    // Query variants (best-effort)
    if (reformulate) {
      const variants = generateQueryVariants(query);
      for (const variant of variants) {
        fetches.push(
          fetchDdgPage(variant, timeRange, locale, variantTimeout, options)
            .catch(() => [] as SearchResult[]),
        );
      }
    }

    const settled = await Promise.allSettled(fetches);
    for (const outcome of settled) {
      if (outcome.status === "fulfilled" && outcome.value.length > 0) {
        allResults.push(...outcome.value);
      }
    }

    // Dedup via canonical URL (SSOT)
    allResults = dedupeSearchResults(allResults) as SearchResult[];
  }

  // Re-rank the full merged set
  const scored = allResults.length === page1.length && filtered1.length >= limit
    ? scored1
    : rankSearchResults(query, allResults, timeRange);
  const filtered = allResults.length === page1.length && filtered1.length >= limit
    ? filtered1
    : (allowedDomains?.length || blockedDomains?.length)
      ? filterResultsByDomain(scored, allowedDomains, blockedDomains)
      : scored;
  const topResults = filtered.slice(0, limit);

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
      };
    },
  });
}
