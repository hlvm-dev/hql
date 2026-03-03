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
  assessSearchConfidence,
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

const MAX_DDG_PAGES = 2;
const LOW_CONFIDENCE_SECOND_PASS_SCORE = 3;

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
  const initialConfidence = assessSearchConfidence(query, filtered1, {
    sampleSize: limit,
    scoreThreshold: LOW_CONFIDENCE_SECOND_PASS_SCORE,
    diversityThreshold: 0.35,
    coverageThreshold: 0.5,
  });
  const lowConfidence = initialConfidence.lowConfidence;
  const needsCoverageExpansion = filtered1.length < limit && page1.length > 0;
  const diagnostics: Record<string, unknown> = {
    avgScoreInitial: initialConfidence.avgScore,
    lowConfidenceInitial: lowConfidence,
    lowConfidenceThreshold: LOW_CONFIDENCE_SECOND_PASS_SCORE,
    confidenceReasonInitial: initialConfidence.reason,
    confidenceReasonsInitial: initialConfidence.reasons,
    needsCoverageExpansion,
    lowConfidenceRetryTriggered: false,
    variantQueries: [] as string[],
    secondPassFetches: 0,
  };

  // Run a second pass when either coverage is low or first-pass confidence is low.
  if ((needsCoverageExpansion || lowConfidence) && page1.length > 0) {
    const variantTimeout = Math.max(2000, Math.floor((timeoutMs ?? 30000) / 3));
    const fetches: Promise<SearchResult[]>[] = [];

    // Page 2 of original query
    if (needsCoverageExpansion && MAX_DDG_PAGES > 1) {
      fetches.push(
        fetchDdgPage(query, timeRange, locale, variantTimeout, options, page1.length)
          .catch(() => [] as SearchResult[]),
      );
    }

    // Query variants (best-effort). Use one variant for confidence retry.
    if (reformulate) {
      const variants = generateQueryVariants(query, needsCoverageExpansion ? 2 : 1);
      diagnostics.variantQueries = variants;
      const variantSubset = needsCoverageExpansion ? variants : variants.slice(0, 1);
      for (const variant of variantSubset) {
        fetches.push(
          fetchDdgPage(variant, timeRange, locale, variantTimeout, options)
            .catch(() => [] as SearchResult[]),
        );
      }
      if (!needsCoverageExpansion && variantSubset.length > 0) {
        diagnostics.lowConfidenceRetryTriggered = true;
        diagnostics.lowConfidenceRetryQuery = variantSubset[0];
      }
    }

    diagnostics.secondPassFetches = fetches.length;
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
  const finalConfidence = assessSearchConfidence(query, topResults, {
    sampleSize: limit,
    scoreThreshold: LOW_CONFIDENCE_SECOND_PASS_SCORE,
    diversityThreshold: 0.35,
    coverageThreshold: 0.5,
  });
  diagnostics.avgScoreFinal = finalConfidence.avgScore;
  diagnostics.lowConfidenceFinal = finalConfidence.lowConfidence;
  diagnostics.confidenceReasonFinal = finalConfidence.reason;
  diagnostics.confidenceReasonsFinal = finalConfidence.reasons;

  return {
    query,
    provider: "duckduckgo",
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
