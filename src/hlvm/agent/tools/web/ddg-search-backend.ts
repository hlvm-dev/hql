/**
 * DdgSearchBackend - DuckDuckGo-based full-pipeline web search orchestration.
 *
 * Implements WebSearchBackend by coordinating:
 *   query planning → primary search → Google News → decomposition subqueries →
 *   confidence retry loop → prefetch escalation → evidence enrichment →
 *   re-ranking → citation + diagnostics assembly
 *
 * All heuristic modules are consumed as-is (no changes).
 */

import type { SearchResult } from "./search-provider.ts";
import { filterSearchResultsByDomain } from "./search-provider.ts";
import {
  fetchWithRedirects,
  readResponseBody,
} from "./fetch-core.ts";
import {
  isHtmlLikeResponse,
  parseHtml,
} from "./html-parser.ts";
import {
  classifySourceAuthority,
  dedupeSearchResults,
  deduplicateSnippetPassages,
  extractRelevantPassages,
  rankSearchResults,
  sourceQualityPenalty,
} from "./search-ranking.ts";
import {
  buildFollowupQueries,
} from "./query-strategy.ts";
import {
  annotateEvidenceStrength,
  rerankForSynthesis,
  selectEvidencePages,
} from "./evidence-selection.ts";
import { planSearchQueries } from "./query-decomposition.ts";
import { decideFetchEscalation, type FetchEscalationDecision } from "./fetch-escalation.ts";
import { fetchGoogleNewsResults } from "./google-news.ts";
import {
  assessToolSearchConfidence,
  LOW_CONFIDENCE_SCORE_THRESHOLD,
  type RetrievalGuidance,
  type WebSearchBackend,
  type WebSearchRequest,
  type WebSearchResponse,
} from "./search-backend.ts";
import { VERSION_RE, YEAR_RE } from "./intent-patterns.ts";

// ============================================================
// Constants
// ============================================================

const DEFAULT_PREFETCH_TARGETS = 2;
const LOW_CONFIDENCE_PREFETCH_TARGETS = 3;
const MAX_PREFETCH_TARGETS = 4;
const AUTO_DEEP_MAX_ROUNDS = 2;
const AUTO_DEEP_EXTRA_RESULTS = 3;
const AUTO_DEEP_MAX_RESULTS = 12;
const QUERY_PLAN_MAX_TOTAL = 3;

// ============================================================
// Helpers (moved from web-tools.ts)
// ============================================================

function mergeAndRankSearchResults(
  query: string,
  current: SearchResult[],
  incoming: SearchResult[],
  timeRange: string,
  limit: number,
): SearchResult[] {
  const merged = dedupeSearchResults([...current, ...incoming]);
  return rankSearchResults(query, merged, timeRange as "day" | "week" | "month" | "year" | "all").slice(0, limit);
}

export function selectDiversePrefetchTargets(results: SearchResult[], maxTargets: number): SearchResult[] {
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

function resolvePrefetchTargetCount(baseTargetCount: number, lowConfidence: boolean): number {
  const boundedBase = Math.max(0, baseTargetCount);
  if (!lowConfidence) return boundedBase;
  return Math.min(MAX_PREFETCH_TARGETS, Math.max(boundedBase, LOW_CONFIDENCE_PREFETCH_TARGETS));
}

// ============================================================
// DdgSearchBackend
// ============================================================

export class DdgSearchBackend implements WebSearchBackend {
  async search(request: WebSearchRequest): Promise<WebSearchResponse> {
    const {
      query, limit, timeoutMs: timeout, allowedDomains, blockedDomains,
      timeRange, locale, searchDepth, prefetch: shouldPrefetch,
      reformulate: resolvedReformulate, profilePrefetchTargets,
      provider, fetchUserAgent, toolOptions: options,
    } = request;

    const queryPlan = planSearchQueries({ userQuery: query, maxSubqueries: QUERY_PLAN_MAX_TOTAL });
    const queryIntent = queryPlan.intent;

    // Conservative year injection: only for recency/release queries without explicit year/version
    const wantsRecent = queryIntent.wantsRecency || queryIntent.wantsReleaseNotes;
    const effectiveQuery = wantsRecent && !VERSION_RE.test(query) && !YEAR_RE.test(query)
      ? `${queryPlan.primaryQuery} ${new Date().getFullYear()}`
      : queryPlan.primaryQuery;

    // Start Google News RSS fetch in parallel when query signals recency interest
    const newsPromise = wantsRecent
      ? fetchGoogleNewsResults(queryPlan.primaryQuery, {
          limit: Math.min(8, limit),
          timeoutMs: Math.min(3000, timeout ?? 3000),
          locale,
        }).catch(() => [] as SearchResult[])
      : Promise.resolve([] as SearchResult[]);

    const result = await provider.search(effectiveQuery, {
      limit,
      timeoutMs: timeout,
      allowedDomains,
      blockedDomains,
      timeRange,
      locale,
      toolOptions: options,
      reformulate: resolvedReformulate,
      searchDepth,
    });
    const initialProviderDiagnostics = result.diagnostics as Record<string, unknown> | undefined;
    const executedQueryTrail = [queryPlan.primaryQuery];

    // Merge Google News results (awaits the parallel fetch started above)
    const newsResults = filterSearchResultsByDomain(
      await newsPromise,
      allowedDomains,
      blockedDomains,
    );
    if (newsResults.length > 0) {
      result.results = mergeAndRankSearchResults(query, result.results, newsResults, timeRange, limit);
      result.count = result.results.length;
    }

    // --- Planned extra searches: decomposition first, then bounded follow-up retries ---
    const deepDiagnostics: {
      autoTriggered: boolean;
      rounds: number;
      triggerReason: string;
      queryTrail: string[];
      recovered: boolean;
      decompositionApplied: boolean;
    } = {
      autoTriggered: false,
      rounds: 1,
      triggerReason: "none",
      queryTrail: executedQueryTrail,
      recovered: false,
      decompositionApplied: queryPlan.mode === "decomposed",
    };
    const followupRoundDiagnostics: Array<Record<string, unknown>> = [];

    for (const subquery of queryPlan.subqueries) {
      if (executedQueryTrail.length >= QUERY_PLAN_MAX_TOTAL) break;
      const subqueryResult = await provider.search(subquery, {
        limit,
        timeoutMs: timeout,
        allowedDomains,
        blockedDomains,
        timeRange,
        locale,
        toolOptions: options,
        reformulate: true,
        searchDepth: searchDepth === "low" ? "medium" : searchDepth,
      });
      executedQueryTrail.push(subquery);
      deepDiagnostics.autoTriggered = true;
      if (deepDiagnostics.triggerReason === "none") deepDiagnostics.triggerReason = "decomposition";
      result.results = mergeAndRankSearchResults(query, result.results, subqueryResult.results, timeRange, limit);
      result.count = result.results.length;
      followupRoundDiagnostics.push({
        phase: "decomposition",
        query: subquery,
        providerDiagnostics: subqueryResult.diagnostics ?? undefined,
      });
    }

    let confidenceBeforeDeep = assessToolSearchConfidence(query, result.results);
    const remainingFollowupBudget = Math.max(0, AUTO_DEEP_MAX_ROUNDS - (executedQueryTrail.length - 1));
    if (confidenceBeforeDeep.lowConfidence && remainingFollowupBudget > 0) {
      const followupQueries = buildFollowupQueries({
        userQuery: query,
        confidenceReason: confidenceBeforeDeep.reason,
        currentResults: result.results,
        maxQueries: remainingFollowupBudget,
      });

      const seenQueries = new Set(executedQueryTrail.map((item) => item.toLowerCase()));
      for (const followupQuery of followupQueries) {
        if (!confidenceBeforeDeep.lowConfidence) break;
        if (!followupQuery || seenQueries.has(followupQuery.toLowerCase())) continue;
        deepDiagnostics.autoTriggered = true;
        if (deepDiagnostics.triggerReason === "none") {
          deepDiagnostics.triggerReason = confidenceBeforeDeep.reason;
        }
        executedQueryTrail.push(followupQuery);
        seenQueries.add(followupQuery.toLowerCase());

        const deepLimit = Math.min(
          AUTO_DEEP_MAX_RESULTS,
          Math.max(limit, limit + AUTO_DEEP_EXTRA_RESULTS),
        );

        const deepResult = await provider.search(followupQuery, {
          limit: deepLimit,
          timeoutMs: timeout,
          allowedDomains,
          blockedDomains,
          timeRange,
          locale,
          toolOptions: options,
          reformulate: true,
          searchDepth: "high",
        });

        result.results = mergeAndRankSearchResults(query, result.results, deepResult.results, timeRange, limit);
        result.count = result.results.length;
        followupRoundDiagnostics.push({
          phase: "followup",
          query: followupQuery,
          providerDiagnostics: deepResult.diagnostics ?? undefined,
        });

        confidenceBeforeDeep = assessToolSearchConfidence(query, result.results);
      }
    }
    deepDiagnostics.queryTrail = executedQueryTrail;
    deepDiagnostics.rounds = executedQueryTrail.length;
    deepDiagnostics.recovered = deepDiagnostics.autoTriggered && !confidenceBeforeDeep.lowConfidence;

    // --- Fetch-first escalation: fetch evidence pages before final synthesis ---
    const confidenceBeforePrefetch = confidenceBeforeDeep;
    const lowConfidenceBeforePrefetch = confidenceBeforePrefetch.lowConfidence;
    let prefetchCandidateCount = 0;
    let prefetchTargets: SearchResult[] = [];
    let anyDateEnriched = false;
    const fetchedUrls: string[] = [];
    const fetchDecision: FetchEscalationDecision = shouldPrefetch
      ? decideFetchEscalation({
        intent: queryIntent,
        confidenceReason: lowConfidenceBeforePrefetch ? confidenceBeforePrefetch.reason : undefined,
        results: result.results,
      })
      : { shouldEscalate: false, reason: undefined, maxFetches: 0 };
    if (shouldPrefetch) {
      prefetchCandidateCount = result.results.filter((r) => r.url).length;
      const defaultPrefetchTargetCount = profilePrefetchTargets > 0
        ? profilePrefetchTargets
        : DEFAULT_PREFETCH_TARGETS;
      const prefetchTargetCount = Math.max(
        defaultPrefetchTargetCount,
        fetchDecision.shouldEscalate
          ? fetchDecision.maxFetches
          : resolvePrefetchTargetCount(defaultPrefetchTargetCount, lowConfidenceBeforePrefetch),
      );
      const fetchRanked = rerankForSynthesis(result.results, {
        maxPages: prefetchTargetCount,
        intent: queryIntent,
      });
      prefetchTargets = selectEvidencePages(fetchRanked, {
        maxPages: prefetchTargetCount,
        intent: queryIntent,
      });
      if (prefetchTargets.length < prefetchTargetCount) {
        const needed = prefetchTargetCount - prefetchTargets.length;
        const diverseBackfill = selectDiversePrefetchTargets(fetchRanked, prefetchTargetCount)
          .filter((candidate) => !prefetchTargets.some((selected) => selected.url === candidate.url))
          .slice(0, needed);
        prefetchTargets = [...prefetchTargets, ...diverseBackfill];
      }
      const prefetchPriority = new Map(
        prefetchTargets
          .map((target, index) => target.url ? [target.url, index + 1] as const : undefined)
          .filter((entry): entry is readonly [string, number] => Boolean(entry)),
      );
      result.results = result.results.map((entry) => {
        const priority = entry.url ? prefetchPriority.get(entry.url) : undefined;
        return {
          ...entry,
          selectedForFetch: priority !== undefined,
          fetchPriority: priority ?? entry.fetchPriority,
        };
      });

      const PREFETCH_TIMEOUT = Math.min(timeout ?? 5000, 5000);  // capped at 5s
      const PREFETCH_MAX_BYTES = 32_000;  // ~32KB raw HTML per page
      const PREFETCH_MAX_TEXT = 8_000;    // 8K chars for passage extraction

      const settled = await Promise.allSettled(
        prefetchTargets.map(async (r) => {
          const { response } = await fetchWithRedirects(
            r.url!,
            PREFETCH_TIMEOUT,
            { "User-Agent": fetchUserAgent },
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
            publishedDate: parsed.publishedDate,
            relatedLinks,
          };
        }),
      );

      // Attach enrichment to matching results (best-effort)
      for (const outcome of settled) {
        if (outcome.status !== "fulfilled") continue;
        const v = outcome.value;
        fetchedUrls.push(v.url);
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

    // Re-rank after fetch enrichment so synthesis is driven by fetched evidence, not snippets.
    if (anyDateEnriched || fetchedUrls.length > 0) {
      result.results = rankSearchResults(query, result.results, timeRange).slice(0, limit);
    }
    result.results = rerankForSynthesis(result.results, {
      maxPages: limit,
      intent: queryIntent,
    }).slice(0, limit);
    const evidencePages = selectEvidencePages(result.results, {
      maxPages: 3,
      intent: queryIntent,
    });
    const evidenceUrlSet = new Set(
      evidencePages.map((entry) => entry.url).filter((url): url is string => Boolean(url)),
    );
    result.results = annotateEvidenceStrength(
      result.results.map((entry) => ({
        ...entry,
        selectedForSynthesis: evidenceUrlSet.has(entry.url ?? ""),
      })),
      queryIntent,
    );

    // Annotate source authority on all results
    for (const r of result.results) {
      if (r.url) {
        r.sourceAuthority = classifySourceAuthority(r.url, query);
      }
    }

    const citations = result.results
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
    const recoveryTriggered = initialProviderDiagnostics?.lowConfidenceRetryTriggered === true ||
      deepDiagnostics.recovered;
    const fetchEvidenceCount = evidencePages.filter((r) =>
      (r.passages?.length ?? 0) > 0 || Boolean(r.pageDescription) || Boolean(r.publishedDate)
    ).length;

    // Compute retrieval guidance — sufficiency signal for the LLM
    const highEvidencePages = evidencePages.filter(r =>
      (r.passages?.length ?? 0) > 0 && r.evidenceStrength === "high"
    );
    const answerAvailable = highEvidencePages.length >= 1 && !confidenceFinal.lowConfidence;
    const guidance: RetrievalGuidance = {
      answerAvailable,
      stopReason: answerAvailable
        ? `${highEvidencePages.length} high-quality evidence page(s) with extracted passages. Respond from these unless deeper detail is needed.`
        : undefined,
    };

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
      retrieval: {
        queryTrail: executedQueryTrail,
        rounds: deepDiagnostics.rounds,
        fetchedUrls,
        evidenceUrls: evidencePages.map((r) => r.url).filter((url): url is string => Boolean(url)),
        synthesizedFromFetch: evidencePages.some((r) => (r.passages?.length ?? 0) > 0 || Boolean(r.pageDescription)),
        fetchEvidenceCount,
        weakEvidence: confidenceFinal.lowConfidence,
        decompositionApplied: queryPlan.mode === "decomposed",
        subqueries: queryPlan.subqueries,
        fetchEscalationReason: fetchDecision.reason,
        newsSupplemented: newsResults.length > 0,
        newsResultCount: newsResults.length,
      },
      recoveryTriggered,
      qualityPenaltiesApplied,
      provider: initialProviderDiagnostics ?? undefined,
      followupRounds: followupRoundDiagnostics,
    };

    return {
      query: result.query,
      provider: result.provider,
      results: result.results,
      count: result.count,
      citations,
      diagnostics,
      guidance,
    };
  }
}
