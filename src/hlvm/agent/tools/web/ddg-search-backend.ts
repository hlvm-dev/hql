/**
 * DdgSearchBackend - DuckDuckGo-based full-pipeline web search orchestration.
 *
 * Active path:
 *   query planning -> primary search -> Google News -> follow-up retries ->
 *   raw merged result pool -> fetch-target selection -> fetch enrichment ->
 *   citations + diagnostics assembly
 *
 * Primary chooser: LLM result selection using the active session model.
 * Fallback chooser: small deterministic query-overlap selector.
 */

import { combineSignals } from "../../../../common/timeout-utils.ts";
import type { SearchResult } from "./search-provider.ts";
import {
  filterSearchResultsByDomain,
  normalizeDomain,
} from "./search-provider.ts";
import {
  fetchWithRedirects,
  readResponseBody,
} from "./fetch-core.ts";
import {
  extractReadableContent,
  isHtmlLikeResponse,
  parseHtml,
} from "./html-parser.ts";
import {
  dedupeSearchResultsStable,
  deduplicateSnippetPassages,
  extractRelevantPassages,
  filterSearchResultsForTimeRange,
} from "./search-ranking.ts";
import {
  buildFollowupQueries,
} from "./query-strategy.ts";
import { planSearchQueries } from "./query-decomposition.ts";
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
import {
  rankFetchedEvidenceDeterministically,
  selectSearchResultsDeterministically,
  selectSearchResultsWithLlm,
} from "./search-result-selector.ts";
import { hasStructuredEvidence } from "./web-utils.ts";
import { discoverAllowedDomainResults } from "./domain-discovery.ts";

// ============================================================
// Constants
// ============================================================

const DEFAULT_PREFETCH_TARGETS = 3;
const LOW_CONFIDENCE_PREFETCH_TARGETS = 4;
const MAX_PREFETCH_TARGETS = 5;
const PREFETCH_CANDIDATE_EXTRA_RESULTS = 5;
const PREFETCH_CANDIDATE_MAX_RESULTS = 10;
const AUTO_DEEP_MAX_ROUNDS = 2;
const AUTO_DEEP_EXTRA_RESULTS = 3;
const AUTO_DEEP_MAX_RESULTS = 12;
const QUERY_PLAN_MAX_TOTAL = 3;
const LLM_SELECTOR_TIMEOUT_MS = 5_000;
const PREFETCH_MAX_BYTES = 128_000;
const PREFETCH_MAX_TEXT = 8_000;
const PREFETCH_MAX_REDIRECTS = 2;

// ============================================================
// Helpers
// ============================================================

function mergeSearchResults(
  results: SearchResult[],
  incoming: SearchResult[],
): SearchResult[] {
  return dedupeSearchResultsStable([...results, ...incoming]);
}

function resolvePrefetchTargetCount(
  baseTargetCount: number,
  resultLimit: number,
  lowConfidence: boolean,
): number {
  const boundedBase = Math.max(0, baseTargetCount);
  if (boundedBase === 0) return 0;

  const limitCap = Math.max(1, resultLimit);
  const preferredCount = lowConfidence
    ? Math.max(boundedBase, LOW_CONFIDENCE_PREFETCH_TARGETS)
    : boundedBase;

  return Math.min(MAX_PREFETCH_TARGETS, Math.min(limitCap, preferredCount));
}

function resolveCandidatePoolLimit(
  resultLimit: number,
  shouldPrefetch: boolean,
): number {
  if (!shouldPrefetch) return resultLimit;
  return Math.min(
    PREFETCH_CANDIDATE_MAX_RESULTS,
    Math.max(resultLimit, resultLimit + PREFETCH_CANDIDATE_EXTRA_RESULTS),
  );
}

function buildChooserSignal(parentSignal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(LLM_SELECTOR_TIMEOUT_MS);
  return parentSignal ? combineSignals(timeoutSignal, parentSignal) : timeoutSignal;
}

function buildDomainPinnedQueries(
  query: string,
  allowedDomains?: string[],
): string[] {
  if (!allowedDomains?.length) return [];
  return allowedDomains
    .map(normalizeDomain)
    .filter((domain) => domain.length > 0)
    .slice(0, 2)
    .map((domain) => `site:${domain} ${query}`);
}

function hasAllowedDomainHit(
  results: SearchResult[],
  allowedDomains?: string[],
): boolean {
  if (!allowedDomains?.length) return true;
  const normalized = allowedDomains.map(normalizeDomain).filter((domain) => domain.length > 0);
  if (normalized.length === 0) return true;
  return results.some((result) => {
    if (!result.url) return false;
    try {
      const hostname = new URL(result.url).hostname.toLowerCase();
      return normalized.some((domain) =>
        hostname === domain || hostname.endsWith(`.${domain}`)
      );
    } catch {
      return false;
    }
  });
}

function markFetchTargets(
  results: SearchResult[],
  selectedUrls: string[],
): SearchResult[] {
  const priorities = new Map(
    selectedUrls.map((url, index) => [url, index + 1] as const),
  );

  return results.map((result) => {
    const priority = result.url ? priorities.get(result.url) : undefined;
    return {
      ...result,
      selectedForFetch: priority !== undefined,
      fetchPriority: priority,
    };
  });
}

function orderFetchedFirst(
  results: SearchResult[],
  selectedUrls: string[],
): SearchResult[] {
  if (selectedUrls.length === 0) return results;

  const byUrl = new Map(
    results
      .filter((result) => result.url)
      .map((result) => [result.url!, result] as const),
  );

  const selected = selectedUrls
    .map((url) => byUrl.get(url))
    .filter((result): result is SearchResult => Boolean(result));

  const selectedUrlSet = new Set(selectedUrls);
  const remaining = results.filter((result) =>
    !selectedUrlSet.has(result.url ?? "")
  );

  return [...selected, ...remaining];
}

function annotateFetchedResults(
  orderedResults: SearchResult[],
  annotatedFetchedResults: SearchResult[],
  selectedUrls: string[],
): SearchResult[] {
  if (selectedUrls.length === 0) return orderedResults;

  const annotatedByUrl = new Map(
    annotatedFetchedResults
      .filter((result) => result.url)
      .map((result) => [result.url!, result] as const),
  );

  return orderedResults.map((result) =>
    result.url && annotatedByUrl.has(result.url)
      ? annotatedByUrl.get(result.url)!
      : result
  );
}

// ============================================================
// DdgSearchBackend
// ============================================================

export class DdgSearchBackend implements WebSearchBackend {
  async search(request: WebSearchRequest): Promise<WebSearchResponse> {
    const {
      query,
      limit,
      timeoutMs: timeout,
      allowedDomains,
      blockedDomains,
      timeRange,
      locale,
      searchDepth,
      prefetch: shouldPrefetch,
      reformulate: resolvedReformulate,
      profilePrefetchTargets,
      provider,
      fetchUserAgent,
      toolOptions: options,
    } = request;

    const queryPlan = planSearchQueries({
      userQuery: query,
      maxSubqueries: QUERY_PLAN_MAX_TOTAL,
    });
    const queryIntent = queryPlan.intent;

    const wantsRecent = queryIntent.wantsRecency || queryIntent.wantsReleaseNotes;
    const candidatePoolLimit = resolveCandidatePoolLimit(limit, shouldPrefetch);
    const effectiveQuery = wantsRecent &&
        !VERSION_RE.test(query) &&
        !YEAR_RE.test(query)
      ? `${queryPlan.primaryQuery} ${new Date().getFullYear()}`
      : queryPlan.primaryQuery;

    const newsPromise = wantsRecent
      ? fetchGoogleNewsResults(queryPlan.primaryQuery, {
        limit: Math.min(8, limit),
        timeoutMs: Math.min(3_000, timeout ?? 3_000),
        locale,
      }).catch(() => [] as SearchResult[])
      : Promise.resolve([] as SearchResult[]);

    const result = await provider.search(effectiveQuery, {
      limit: candidatePoolLimit,
      timeoutMs: timeout,
      allowedDomains,
      blockedDomains,
      timeRange,
      locale,
      toolOptions: options,
      reformulate: resolvedReformulate,
      searchDepth,
    });
    const initialProviderDiagnostics =
      result.diagnostics as Record<string, unknown> | undefined;
    const recallExpansionEnabled = resolvedReformulate !== false;
    const executedQueryTrail = [effectiveQuery];
    const executedSubqueries: string[] = [];

    const newsResults = filterSearchResultsByDomain(
      await newsPromise,
      allowedDomains,
      blockedDomains,
    );
    if (newsResults.length > 0) {
      result.results = mergeSearchResults(result.results, newsResults);
      result.count = result.results.length;
    }

    const domainPinnedQueries = buildDomainPinnedQueries(
      queryPlan.primaryQuery,
      allowedDomains,
    );

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
      decompositionApplied: false,
    };
    const followupRoundDiagnostics: Array<Record<string, unknown>> = [];

    const exploratoryQueries = [...domainPinnedQueries, ...queryPlan.subqueries];
    for (const subquery of exploratoryQueries) {
      if (executedQueryTrail.length >= QUERY_PLAN_MAX_TOTAL) break;
      const confidenceBeforeSubquery = assessToolSearchConfidence(query, result.results);
      const shouldTryPinnedQuery = subquery.startsWith("site:");
      if (
        !shouldTryPinnedQuery &&
        result.results.length > 0 &&
        !confidenceBeforeSubquery.lowConfidence
      ) {
        break;
      }
      const subqueryResult = await provider.search(subquery, {
        limit: candidatePoolLimit,
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
      executedSubqueries.push(subquery);
      deepDiagnostics.autoTriggered = true;
      deepDiagnostics.decompositionApplied = deepDiagnostics.decompositionApplied ||
        !shouldTryPinnedQuery;
      if (deepDiagnostics.triggerReason === "none") {
        deepDiagnostics.triggerReason = shouldTryPinnedQuery
          ? "allowed_domain"
          : "decomposition";
      }
      result.results = mergeSearchResults(result.results, subqueryResult.results);
      result.count = result.results.length;
      followupRoundDiagnostics.push({
        phase: shouldTryPinnedQuery ? "allowed_domain" : "decomposition",
        query: subquery,
        providerDiagnostics: subqueryResult.diagnostics ?? undefined,
      });
    }

    let confidenceBeforeDeep = assessToolSearchConfidence(query, result.results);
    const remainingFollowupBudget = Math.max(
      0,
      AUTO_DEEP_MAX_ROUNDS - (executedQueryTrail.length - 1),
    );
    if (
      recallExpansionEnabled &&
      confidenceBeforeDeep.lowConfidence &&
      remainingFollowupBudget > 0
    ) {
      const followupQueries = buildFollowupQueries({
        userQuery: query,
        confidenceReason: confidenceBeforeDeep.reason,
        currentResults: result.results,
        maxQueries: remainingFollowupBudget,
      });

      const seenQueries = new Set(
        executedQueryTrail.map((item) => item.toLowerCase()),
      );
      for (const followupQuery of followupQueries) {
        if (!confidenceBeforeDeep.lowConfidence) break;
        if (!followupQuery || seenQueries.has(followupQuery.toLowerCase())) {
          continue;
        }

        deepDiagnostics.autoTriggered = true;
        if (deepDiagnostics.triggerReason === "none") {
          deepDiagnostics.triggerReason = confidenceBeforeDeep.reason;
        }
        executedQueryTrail.push(followupQuery);
        seenQueries.add(followupQuery.toLowerCase());

        const deepLimit = Math.min(
          AUTO_DEEP_MAX_RESULTS,
          Math.max(candidatePoolLimit, limit + AUTO_DEEP_EXTRA_RESULTS),
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

        result.results = mergeSearchResults(result.results, deepResult.results);
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
    deepDiagnostics.recovered = deepDiagnostics.autoTriggered &&
      !confidenceBeforeDeep.lowConfidence;

    result.results = filterSearchResultsForTimeRange(result.results, timeRange);
    result.count = result.results.length;
    let domainDiscovery: {
      triggered: boolean;
      domains: string[];
      seedUrls: string[];
      fetchedSeedUrls: string[];
      discoveredResultCount: number;
    } = {
      triggered: false,
      domains: [],
      seedUrls: [],
      fetchedSeedUrls: [],
      discoveredResultCount: 0,
    };
    let discoveredDomainResults: SearchResult[] = [];

    if (shouldPrefetch && allowedDomains?.length) {
      const shouldDiscoverFromDomain = result.results.length === 0 ||
        confidenceBeforeDeep.lowConfidence ||
        !hasAllowedDomainHit(result.results, allowedDomains);
      if (shouldDiscoverFromDomain) {
        const discovered = await discoverAllowedDomainResults({
          query,
          allowedDomains,
          maxResults: candidatePoolLimit,
          intent: queryIntent,
          timeoutMs: timeout,
          fetchUserAgent,
          toolOptions: options,
        });
        domainDiscovery = discovered.diagnostics;
        if (discovered.results.length > 0) {
          discoveredDomainResults = discovered.results;
          result.results = dedupeSearchResultsStable([
            ...discovered.results,
            ...result.results,
          ]);
          result.count = result.results.length;
          followupRoundDiagnostics.push({
            phase: "allowed_domain_discovery",
            domains: discovered.diagnostics.domains,
            seedUrls: discovered.diagnostics.seedUrls,
            fetchedSeedUrls: discovered.diagnostics.fetchedSeedUrls,
            discoveredCount: discovered.results.length,
          });
        }
      }
    }

    const confidenceBeforePrefetch = assessToolSearchConfidence(query, result.results);
    const lowConfidenceBeforePrefetch = confidenceBeforePrefetch.lowConfidence;
    let prefetchCandidateCount = 0;
    let prefetchTargets: SearchResult[] = [];
    let chooserUsed = false;
    let chooserStrategy: "llm" | "deterministic" = "deterministic";
    let chooserConfidence: "high" | "medium" | "low" = "low";
    let chooserReason =
      "Deterministic chooser was used to select fetch targets.";
    let chooserPickedIndices: number[] = [];
    let fallbackUsed = false;
    let evidenceStrategy: "deterministic" | "annotated" | "none" = "none";
    let evidenceConfidence: "high" | "medium" | "low" = "low";
    let evidenceReason =
      "No fetched results were available for deterministic evidence ranking.";
    const fetchedUrls: string[] = [];
    const prefersDeterministicRetriever = options?.modelTier === "weak";

    if (shouldPrefetch) {
      const prefetchCandidates = (
        prefersDeterministicRetriever && discoveredDomainResults.length > 0
          ? discoveredDomainResults
          : result.results
      ).filter((entry) => entry.url);
      prefetchCandidateCount = prefetchCandidates.length;
      const defaultPrefetchTargetCount = profilePrefetchTargets > 0
        ? profilePrefetchTargets
        : DEFAULT_PREFETCH_TARGETS;
      const basePrefetchTargetCount = prefersDeterministicRetriever
        ? Math.max(defaultPrefetchTargetCount, LOW_CONFIDENCE_PREFETCH_TARGETS)
        : defaultPrefetchTargetCount;
      const desiredPrefetchTargetCount = resolvePrefetchTargetCount(
        basePrefetchTargetCount,
        limit,
        lowConfidenceBeforePrefetch,
      );
      const prefetchTargetCount = Math.min(
        prefetchCandidateCount,
        desiredPrefetchTargetCount,
      );

      if (prefetchTargetCount > 0) {
        const deterministicInput = {
          query,
          results: prefetchCandidates,
          maxPicks: prefetchTargetCount,
          intent: queryIntent,
          allowedDomains,
          toolOptions: options,
        } as const;

        if (options?.modelId && !prefersDeterministicRetriever) {
          try {
            chooserUsed = true;
            const selection = await selectSearchResultsWithLlm({
              ...deterministicInput,
              toolOptions: {
                ...options,
                signal: buildChooserSignal(options.signal),
              },
            });
            chooserStrategy = selection.strategy;
            chooserConfidence = selection.confidence;
            chooserReason = selection.reason;
            chooserPickedIndices = selection.pickedIndices;
            prefetchTargets = selection.picks.filter((entry) => entry.url);
          } catch (error) {
            fallbackUsed = true;
            const fallbackSelection = selectSearchResultsDeterministically(
              deterministicInput,
            );
            chooserStrategy = fallbackSelection.strategy;
            chooserConfidence = fallbackSelection.confidence;
            chooserReason = error instanceof Error
              ? `LLM chooser failed: ${error.message}. ${fallbackSelection.reason}`
              : `LLM chooser failed. ${fallbackSelection.reason}`;
            chooserPickedIndices = fallbackSelection.pickedIndices;
            prefetchTargets = fallbackSelection.picks.filter((entry) =>
              entry.url
            );
          }
        } else {
          const fallbackSelection = selectSearchResultsDeterministically(
            deterministicInput,
          );
          chooserStrategy = fallbackSelection.strategy;
          chooserConfidence = fallbackSelection.confidence;
          chooserReason = prefersDeterministicRetriever
            ? "Weak-tier model uses deterministic fetch-target selection to reduce tool-calling burden. " +
              fallbackSelection.reason
            : "No active modelId was available for LLM fetch-target selection. " +
              fallbackSelection.reason;
          chooserPickedIndices = fallbackSelection.pickedIndices;
          prefetchTargets = fallbackSelection.picks.filter((entry) => entry.url);
        }

        if (prefetchTargets.length === 0) {
          prefetchTargets = prefetchCandidates.slice(0, prefetchTargetCount);
        }
      }

      const selectedUrls = prefetchTargets
        .map((target) => target.url)
        .filter((url): url is string => Boolean(url));
      result.results = markFetchTargets(result.results, selectedUrls);

      const prefetchTimeout = Math.min(timeout ?? LLM_SELECTOR_TIMEOUT_MS, LLM_SELECTOR_TIMEOUT_MS);
      const settled = await Promise.allSettled(
        prefetchTargets.map(async (target) => {
          const { response } = await fetchWithRedirects(
            target.url!,
            prefetchTimeout,
            { "User-Agent": fetchUserAgent },
            PREFETCH_MAX_REDIRECTS,
            options,
          );
          const body = await readResponseBody(response, PREFETCH_MAX_BYTES);
          const rawHtml = body.text;
          const contentType = response.headers.get("content-type") ?? "";
          if (!isHtmlLikeResponse(contentType, rawHtml)) {
            return { url: target.url!, passages: [] as string[] };
          }

          // Use Readability (battle-tested) for text extraction, regex parseHtml as fallback
          const parsed = parseHtml(rawHtml, PREFETCH_MAX_TEXT, 3);
          const readable = await extractReadableContent(rawHtml, target.url!);
          const extractionText = readable?.text || parsed.text;
          let passages = extractRelevantPassages(query, extractionText);
          if (target.snippet) {
            passages = deduplicateSnippetPassages(target.snippet, passages);
          }

          let relatedLinks: string[] | undefined;
          if (parsed.links.length > 0) {
            try {
              const sourceHost = new URL(target.url!).hostname.toLowerCase();
              relatedLinks = parsed.links.filter((link) => {
                try {
                  return new URL(link).hostname.toLowerCase() !== sourceHost;
                } catch {
                  return false;
                }
              });
              if (relatedLinks.length === 0) relatedLinks = undefined;
            } catch {
              // Ignore malformed URLs in extracted links.
            }
          }

          return {
            url: target.url!,
            passages,
            description: readable?.title ? (parsed.description || readable.title) : parsed.description,
            title: readable?.title || parsed.title,
            publishedDate: parsed.publishedDate,
            relatedLinks,
          };
        }),
      );

      for (const outcome of settled) {
        if (outcome.status !== "fulfilled") continue;
        const enriched = outcome.value;
        fetchedUrls.push(enriched.url);
        const target = result.results.find((entry) => entry.url === enriched.url);
        if (!target) continue;

        if (enriched.passages.length > 0) {
          target.passages = enriched.passages;
        }
        if (enriched.description?.trim()) {
          target.pageDescription = !target.pageDescription ||
              enriched.description.length > target.pageDescription.length
            ? enriched.description
            : target.pageDescription;
        }
        const isGenericTitle = !target.title ||
          target.title.length < 5 ||
          /^(untitled|home|index|page)$/i.test(target.title.trim());
        if (enriched.title && isGenericTitle) {
          target.title = enriched.title;
        }
        if (enriched.relatedLinks) {
          target.relatedLinks = enriched.relatedLinks;
        }
        if (enriched.publishedDate && !target.publishedDate) {
          target.publishedDate = enriched.publishedDate;
        }
      }

      result.results = orderFetchedFirst(result.results, selectedUrls);
      const rankedFetched = rankFetchedEvidenceDeterministically({
        query,
        results: result.results.filter((entry) => entry.selectedForFetch === true),
        intent: queryIntent,
        allowedDomains,
      });
      evidenceConfidence = rankedFetched.confidence;
      evidenceReason = rankedFetched.reason;

      if (rankedFetched.results.length > 0) {
        const supportingResults = result.results.filter((entry) =>
          entry.selectedForFetch !== true
        );
        const orderedFetched = prefersDeterministicRetriever ||
            chooserStrategy === "deterministic" || fallbackUsed
          ? rankedFetched.results
          : selectedUrls
            .map((url) =>
              rankedFetched.results.find((entry) => entry.url === url)
            )
            .filter((entry): entry is SearchResult => Boolean(entry));
        const annotatedResults = annotateFetchedResults(
          [...orderedFetched, ...supportingResults],
          rankedFetched.results,
          selectedUrls,
        );
        result.results = annotatedResults;
        evidenceStrategy = prefersDeterministicRetriever ||
            chooserStrategy === "deterministic" || fallbackUsed
          ? "deterministic"
          : "annotated";
        if (evidenceStrategy === "annotated") {
          evidenceReason =
            "Fetched results kept chooser order and were annotated with deterministic evidence strength.";
        }
      }
    }

    result.results = result.results.slice(0, limit);
    result.count = result.results.length;

    const evidencePages = result.results.filter((entry) =>
      entry.selectedForFetch === true && hasStructuredEvidence(entry)
    );
    const fetchEvidenceCount = evidencePages.length;
    const confidenceFinal = assessToolSearchConfidence(query, result.results);
    const recoveryTriggered =
      initialProviderDiagnostics?.lowConfidenceRetryTriggered === true ||
      deepDiagnostics.recovered;

    const answerAvailable = fetchEvidenceCount >= 1;
    const guidance: RetrievalGuidance = {
      answerAvailable,
      stopReason: answerAvailable
        ? `${fetchEvidenceCount} fetched source(s) include extracted evidence. Prefer these before unfetched search results.`
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
        scoredCount: confidenceFinal.scoredCount,
      },
      prefetch: {
        enabled: shouldPrefetch,
        candidateCount: prefetchCandidateCount,
        targetCount: prefetchTargets.length,
        targetUrls: prefetchTargets.map((entry) => entry.url).filter((url): url is string => Boolean(url)),
        adaptiveDepth: lowConfidenceBeforePrefetch,
        chooserUsed,
        chooserStrategy,
        chooserConfidence,
        chooserReason,
        chooserPickedIndices,
        fallbackUsed,
      },
      deep: deepDiagnostics,
      retrieval: {
        queryTrail: executedQueryTrail,
        rounds: deepDiagnostics.rounds,
        fetchedUrls,
        evidenceUrls: evidencePages.map((entry) => entry.url).filter((url): url is string => Boolean(url)),
        synthesizedFromFetch: fetchEvidenceCount > 0,
        fetchEvidenceCount,
        evidenceStrategy,
        evidenceConfidence,
        evidenceReason,
        weakEvidence: confidenceFinal.lowConfidence,
        decompositionApplied: deepDiagnostics.decompositionApplied,
        subqueries: executedSubqueries,
        newsSupplemented: newsResults.length > 0,
        newsResultCount: newsResults.length,
        domainDiscoveryTriggered: domainDiscovery.triggered,
        domainDiscoveryResultCount: domainDiscovery.discoveredResultCount,
      },
      domainDiscovery,
      recoveryTriggered,
      provider: initialProviderDiagnostics ?? undefined,
      followupRounds: followupRoundDiagnostics,
    };

    const citations = result.results
      .filter((entry) => entry.url)
      .map((entry) => ({
        url: entry.url!,
        title: entry.title,
        excerpt: entry.snippet,
        provider: result.provider,
      }));

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
