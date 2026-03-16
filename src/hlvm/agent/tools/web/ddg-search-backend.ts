/**
 * DdgSearchBackend - Thin bounded web retrieval.
 *
 * Strong models own routing, iteration, and final synthesis.
 * This backend only does:
 *   search -> optional low-confidence recovery -> fetch/enrich -> evidence annotation
 */

import type { Citation, SearchResult } from "./search-provider.ts";
import {
  fetchWithRedirects,
  readResponseBody,
} from "./fetch-core.ts";
import {
  extractStructuredBlocks,
  extractReadableContent,
  isHtmlLikeResponse,
  MAIN_CONTENT_MIN_CHARS,
  parseHtml,
  restoreStructuredBlocks,
} from "./html-parser.ts";
import { renderWithChrome } from "./headless-chrome.ts";
import {
  dedupeSearchResultsStable,
  deduplicateSnippetPassages,
  extractRelevantPassages,
  filterSearchResultsForTimeRange,
  scorePassage,
  tokenizeQuery,
} from "./search-ranking.ts";
import {
  assessToolSearchConfidence,
  LOW_CONFIDENCE_SCORE_THRESHOLD,
  type WebSearchBackend,
  type WebSearchRequest,
  type WebSearchResponse,
} from "./search-backend.ts";
import {
  rankFetchedEvidenceDeterministically,
  reorderFetchedEvidenceWithLlm,
  selectSearchResultsDeterministically,
  selectSearchResultsWithLlm,
} from "./search-result-selector.ts";
import {
  annotateSearchResultSources,
} from "./source-authority.ts";
import {
  detectSearchQueryIntent,
  prefersSingleHostSources,
} from "./query-strategy.ts";
import { hasStructuredEvidence, isAuthoritativeSourceClass, resultHost } from "./web-utils.ts";
import { getAgentLogger } from "../../logger.ts";

const DEFAULT_PREFETCH_TARGETS = 3;
const MAX_PREFETCH_TARGETS = 5;
const PREFETCH_CANDIDATE_EXTRA_RESULTS = 5;
const PREFETCH_CANDIDATE_MAX_RESULTS = 10;
const PREFETCH_MAX_BYTES = 128_000;
const PREFETCH_MAX_TEXT = 12_000;
const PREFETCH_MAX_REDIRECTS = 2;
const PREFETCH_TIMEOUT_MS = 5_000;
const MAX_FOCUSED_CITATIONS = 3;
const MAX_BROAD_CITATIONS = 4;
const CHROME_ESCALATION_TIMEOUT_MS = 15_000;

function resolvePrefetchTargetCount(
  baseTargetCount: number,
  resultLimit: number,
): number {
  const boundedBase = Math.max(0, baseTargetCount);
  if (boundedBase === 0) return 0;
  return Math.min(MAX_PREFETCH_TARGETS, Math.max(1, Math.min(resultLimit, boundedBase)));
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

/** Extract hostname from result URL, with empty-string fallback. */
function getResultHost(result: SearchResult): string {
  return resultHost(result.url) ?? "";
}

function isAuthoritativeResult(result: SearchResult): boolean {
  return isAuthoritativeSourceClass(result.sourceClass);
}

function toCitation(result: SearchResult, providerName: string, query?: string): Citation | null {
  if (!result.url) return null;
  let excerpt = result.passages?.[0] ?? result.pageDescription ?? result.snippet;

  // Pick the most query-relevant passage (not just the first) when query is available.
  if (query && result.passages && result.passages.length > 1) {
    const tokens = tokenizeQuery(query);
    if (tokens.length > 0) {
      let bestScore = -1;
      for (const passage of result.passages) {
        const score = scorePassage(passage.toLowerCase(), tokens);
        if (score > bestScore) {
          bestScore = score;
          excerpt = passage;
        }
      }
    }
  }

  return {
    url: result.url,
    title: result.title,
    excerpt,
    provider: providerName,
    sourceKind: (result.passages?.length || result.pageDescription)
      ? "passage"
      : "snippet",
    sourceClass: result.sourceClass,
  };
}

function appendCitationGroup(
  sink: Citation[],
  seenUrls: Set<string>,
  results: SearchResult[],
  providerName: string,
  limit: number,
  query?: string,
): void {
  for (const result of results) {
    if (sink.length >= limit || !result.url || seenUrls.has(result.url)) continue;
    const citation = toCitation(result, providerName, query);
    if (!citation) continue;
    seenUrls.add(result.url);
    sink.push(citation);
  }
}

function hasAuthoritativeCitation(citations: Citation[]): boolean {
  return citations.some((citation) => isAuthoritativeSourceClass(citation.sourceClass));
}

function buildSearchCitations(
  results: SearchResult[],
  providerName: string,
  lowConfidence: boolean,
  wantsBroadCoverage: boolean,
  query?: string,
): Citation[] {
  const limit = wantsBroadCoverage ? MAX_BROAD_CITATIONS : MAX_FOCUSED_CITATIONS;
  const citations: Citation[] = [];
  const seenUrls = new Set<string>();
  const resultsWithUrl = results.filter((result) => Boolean(result.url));
  const fetchedResults = resultsWithUrl.filter((result) =>
    result.selectedForFetch === true
  );
  const fetchedEvidence = fetchedResults.filter((result) =>
    hasStructuredEvidence(result)
  );
  const authoritativeFetchedEvidence = fetchedEvidence.filter(isAuthoritativeResult);
  const primaryFetchedEvidence = !wantsBroadCoverage &&
      authoritativeFetchedEvidence.length > 0
    ? authoritativeFetchedEvidence
    : fetchedEvidence;
  const authoritativeSelected = fetchedResults.filter((result) =>
    !hasStructuredEvidence(result) && isAuthoritativeResult(result)
  );
  const authoritativeSupporting = resultsWithUrl.filter((result) =>
    result.selectedForFetch !== true && isAuthoritativeResult(result)
  );
  const selectedFallback = fetchedResults.filter((result) =>
    !hasStructuredEvidence(result) || !isAuthoritativeResult(result)
  );

  appendCitationGroup(
    citations,
    seenUrls,
    primaryFetchedEvidence,
    providerName,
    limit,
    query,
  );
  appendCitationGroup(
    citations,
    seenUrls,
    authoritativeSelected,
    providerName,
    limit,
    query,
  );
  appendCitationGroup(
    citations,
    seenUrls,
    authoritativeSupporting,
    providerName,
    limit,
    query,
  );

  const authoritativeCoverage = hasAuthoritativeCitation(citations);
  if (
    citations.length === 0 ||
    ((wantsBroadCoverage || lowConfidence) && !authoritativeCoverage)
  ) {
    appendCitationGroup(
      citations,
      seenUrls,
      selectedFallback,
      providerName,
      limit,
      query,
    );
  }

  if (citations.length === 0) {
    appendCitationGroup(
      citations,
      seenUrls,
      resultsWithUrl,
      providerName,
      limit,
      query,
    );
  }

  return citations;
}

function ensureDistinctTopHosts(
  targets: SearchResult[],
  candidates: SearchResult[],
  maxTargets: number,
): SearchResult[] {
  if (targets.length < 2 || maxTargets < 2) return targets;
  const firstHost = getResultHost(targets[0]);
  const secondHost = getResultHost(targets[1]);
  if (!firstHost || !secondHost || firstHost !== secondHost) return targets;

  const selectedUrls = new Set(targets.map((result) => result.url).filter(Boolean));
  const fallback = candidates.find((candidate) => {
    if (!candidate.url || selectedUrls.has(candidate.url)) return false;
    const host = getResultHost(candidate);
    return host.length > 0 && host !== firstHost;
  });
  if (!fallback) return targets;

  return [
    targets[0],
    fallback,
    ...targets.slice(1).filter((result) => result.url !== fallback.url),
  ].slice(0, maxTargets);
}

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

    const candidatePoolLimit = resolveCandidatePoolLimit(limit, shouldPrefetch);
    const intent = detectSearchQueryIntent(query);
    const result = await provider.search(query, {
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
    const providerDiagnostics =
      result.diagnostics as Record<string, unknown> | undefined;

    result.results = filterSearchResultsForTimeRange(
      dedupeSearchResultsStable(result.results),
      timeRange,
    );
    result.count = result.results.length;

    let prefetchCandidateCount = 0;
    let prefetchTargets: SearchResult[] = [];
    let selectionConfidence: "high" | "medium" | "low" = "low";
    let selectionStrategy: "deterministic" | "llm" = "deterministic";
    let selectionReason =
      "Deterministic fetch selection prioritized query overlap and host diversity.";
    let evidenceStrategy: "deterministic" | "llm" | "none" = "none";
    let evidenceConfidence: "high" | "medium" | "low" = "low";
    let evidenceReason =
      "No fetched results were available for deterministic evidence ranking.";
    const fetchedUrls: string[] = [];
    let chromeEscalated = false;
    let chromeUrl: string | undefined;
    let chromeAccepted = false;

    if (shouldPrefetch) {
      const prefetchCandidates = result.results.filter((entry) => entry.url);
      prefetchCandidateCount = prefetchCandidates.length;
      const defaultPrefetchTargetCount = profilePrefetchTargets > 0
        ? profilePrefetchTargets
        : DEFAULT_PREFETCH_TARGETS;
      const prefetchTargetCount = Math.min(
        prefetchCandidateCount,
        resolvePrefetchTargetCount(defaultPrefetchTargetCount, limit),
      );

      if (prefetchTargetCount > 0) {
        const selectorInput = {
          query,
          results: prefetchCandidates,
          maxPicks: prefetchTargetCount,
          intent,
          allowedDomains,
          toolOptions: options,
        };
        let selection;
        if (options?.modelTier === "frontier") {
          try {
            selection = await selectSearchResultsWithLlm(selectorInput);
          } catch (err) {
            getAgentLogger().warn(
              `LLM result selector failed, falling back to deterministic: ${(err as Error).message}`,
            );
            selection = selectSearchResultsDeterministically(selectorInput);
          }
        } else {
          selection = selectSearchResultsDeterministically(selectorInput);
        }
        selectionConfidence = selection.confidence;
        selectionStrategy = selection.strategy;
        selectionReason = selection.reason;
        const picksWithUrl = selection.picks.filter((entry) => entry.url);
        // Skip host diversity enforcement only when the query is clearly asking
        // for a single authoritative host or the caller already constrained it.
        prefetchTargets = prefersSingleHostSources(
            query,
            intent,
            allowedDomains,
          )
          ? picksWithUrl.slice(0, prefetchTargetCount)
          : ensureDistinctTopHosts(picksWithUrl, prefetchCandidates, prefetchTargetCount);
        if (prefetchTargets.length === 0) {
          prefetchTargets = prefetchCandidates.slice(0, prefetchTargetCount);
        }
      }

      const selectedUrls = prefetchTargets
        .map((target) => target.url)
        .filter((url): url is string => Boolean(url));
      result.results = markFetchTargets(result.results, selectedUrls);

      const prefetchTimeout = Math.min(timeout ?? PREFETCH_TIMEOUT_MS, PREFETCH_TIMEOUT_MS);
      const settled = await Promise.allSettled(
        prefetchTargets.map(async (target) => {
          const { finalUrl, response } = await fetchWithRedirects(
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

          const { cleaned: cleanedHtml, blocks: structuredBlocks } = extractStructuredBlocks(rawHtml);
          const parsed = parseHtml(cleanedHtml, PREFETCH_MAX_TEXT, 3);
          const readable = await extractReadableContent(cleanedHtml, finalUrl);
          const readableStructured = readable?.content
            ? parseHtml(readable.content, PREFETCH_MAX_TEXT, 1)
            : null;
          let extractionText = readableStructured?.text || readable?.text || parsed.text;
          if (structuredBlocks.size > 0) {
            extractionText = restoreStructuredBlocks(extractionText, structuredBlocks);
          }
          let passages = extractRelevantPassages(query, extractionText);
          if (target.snippet) {
            passages = deduplicateSnippetPassages(target.snippet, passages);
          }

          let relatedLinks: string[] | undefined;
          if (parsed.links.length > 0) {
            try {
              const sourceHost = new URL(finalUrl).hostname.toLowerCase();
              relatedLinks = parsed.links.filter((link) => {
                try {
                  const parsedLink = new URL(link);
                  if (!["http:", "https:"].includes(parsedLink.protocol)) return false;
                  return parsedLink.hostname.toLowerCase() !== sourceHost;
                } catch {
                  return false;
                }
              });
              if (relatedLinks.length === 0) relatedLinks = undefined;
            } catch {
              // Ignore malformed extracted links.
            }
          }

          return {
            url: target.url!,
            finalUrl,
            passages,
            description: parsed.description || undefined,
            title: readable?.title || parsed.title,
            publishedDate: parsed.publishedDate,
            relatedLinks,
          };
        }),
      );

      for (const outcome of settled) {
        if (outcome.status !== "fulfilled") continue;
        const enriched = outcome.value;
        fetchedUrls.push(enriched.finalUrl ?? enriched.url);
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

      // Chrome escalation: if top-1 prefetch target yielded no usable passages, re-render
      // with headless Chrome (SPA / JS-gated content). Only top-1, never multiple (singleton).
      if (prefetchTargets.length > 0) {
        const top1Url = prefetchTargets[0].url;
        if (top1Url) {
          const top1Result = result.results.find((entry) => entry.url === top1Url);
          const hasNoPassages = !top1Result?.passages || top1Result.passages.length === 0;
          if (hasNoPassages) {
            chromeEscalated = true;
            chromeUrl = top1Url;
            try {
              const rendered = await renderWithChrome(top1Url, CHROME_ESCALATION_TIMEOUT_MS);
              if (rendered) {
                const { cleaned: cleanedChrome, blocks: chromeBlocks } = extractStructuredBlocks(rendered);
                const chromeParsed = parseHtml(cleanedChrome, PREFETCH_MAX_TEXT, 3);
                const chromeReadable = await extractReadableContent(cleanedChrome, top1Url);
                let chromeText = chromeReadable?.text || chromeParsed.text;
                if (chromeBlocks.size > 0) {
                  chromeText = restoreStructuredBlocks(chromeText, chromeBlocks);
                }
                if (chromeText.length >= MAIN_CONTENT_MIN_CHARS && top1Result) {
                  chromeAccepted = true;
                  const chromePassages = extractRelevantPassages(query, chromeText);
                  if (chromePassages.length > 0) {
                    top1Result.passages = chromePassages;
                  }
                  if (chromeParsed.description?.trim()) {
                    top1Result.pageDescription = chromeParsed.description;
                  }
                  if (chromeReadable?.title || chromeParsed.title) {
                    const isGenericTitle = !top1Result.title ||
                      top1Result.title.length < 5 ||
                      /^(untitled|home|index|page)$/i.test(top1Result.title.trim());
                    if (isGenericTitle) {
                      top1Result.title = chromeReadable?.title || chromeParsed.title;
                    }
                  }
                }
              }
            } catch {
              // Graceful: if Chrome fails, keep original content.
            }
          }
        }
      }

      result.results = orderFetchedFirst(result.results, selectedUrls);
      const rankedFetched = rankFetchedEvidenceDeterministically({
        query,
        results: result.results.filter((entry) => entry.selectedForFetch === true),
        intent,
        allowedDomains,
      });

      // Frontier: LLM reorders already-annotated results by semantic relevance
      if (options?.modelTier === "frontier" && rankedFetched.results.length > 1) {
        try {
          const reordered = await reorderFetchedEvidenceWithLlm({
            query,
            results: result.results.filter((entry) => entry.selectedForFetch === true),
            intent,
            allowedDomains,
            annotated: rankedFetched.results,
            toolOptions: options,
          });
          rankedFetched.results = reordered.results;
          rankedFetched.confidence = reordered.confidence;
          rankedFetched.reason = reordered.reason;
          evidenceStrategy = "llm";
        } catch (err) {
          getAgentLogger().warn(
            `LLM evidence reorder failed, keeping deterministic order: ${(err as Error).message}`,
          );
        }
      }

      evidenceConfidence = rankedFetched.confidence;
      evidenceReason = rankedFetched.reason;

      if (rankedFetched.results.length > 0) {
        if (
          !prefersSingleHostSources(
            query,
            intent,
            allowedDomains,
          )
        ) {
          rankedFetched.results = ensureDistinctTopHosts(
            rankedFetched.results,
            rankedFetched.results,
            rankedFetched.results.length,
          );
        }
        const supportingResults = result.results.filter((entry) =>
          entry.selectedForFetch !== true
        );
        result.results = annotateFetchedResults(
          [...rankedFetched.results, ...supportingResults],
          rankedFetched.results,
          selectedUrls,
        );
        evidenceStrategy = "deterministic";
      }
    }

    const annotatedResults = annotateSearchResultSources(
      result.results,
      allowedDomains,
    );
    result.results = prefersSingleHostSources(
        query,
        intent,
        allowedDomains,
      )
      ? annotatedResults.slice(0, limit)
      : ensureDistinctTopHosts(annotatedResults, annotatedResults, limit)
        .slice(0, limit);
    result.count = result.results.length;

    const evidencePages = result.results.filter((entry) =>
      entry.selectedForFetch === true && hasStructuredEvidence(entry)
    );
    const confidenceFinal = assessToolSearchConfidence(query, result.results);
    const wantsBroadCoverage = Boolean(
      intent.wantsComparison || intent.wantsMultiSourceSynthesis,
    );

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
        selectionStrategy,
        selectionConfidence,
        selectionReason,
      },
      retrieval: {
        fetchedUrls,
        evidenceUrls: evidencePages.map((entry) => entry.url).filter((url): url is string => Boolean(url)),
        fetchEvidenceCount: evidencePages.length,
        evidenceStrategy,
        evidenceConfidence,
        evidenceReason,
        weakEvidence: confidenceFinal.lowConfidence,
        chromeEscalated,
        chromeUrl,
        chromeAccepted,
      },
      provider: providerDiagnostics ?? undefined,
    };

    const citations = buildSearchCitations(
      result.results,
      result.provider,
      confidenceFinal.lowConfidence,
      wantsBroadCoverage,
      query,
    );

    return {
      query: result.query,
      provider: result.provider,
      results: result.results,
      count: result.count,
      citations,
      diagnostics,
    };
  }
}
