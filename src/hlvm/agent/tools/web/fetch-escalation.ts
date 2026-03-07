import type { SearchResult } from "./search-provider.ts";
import type { SearchConfidenceReason } from "./search-ranking.ts";
import type { SearchQueryIntent } from "./query-strategy.ts";

export interface FetchEscalationDecision {
  shouldEscalate: boolean;
  reason?: string;
  maxFetches: number;
}

interface FetchEscalationInput {
  intent: SearchQueryIntent;
  confidenceReason?: SearchConfidenceReason;
  results: SearchResult[];
}

function hasStructuredEvidence(result: SearchResult): boolean {
  return Boolean(
    (result.passages?.length ?? 0) > 0 ||
      result.pageDescription ||
      result.publishedDate,
  );
}

function thinSnippetCount(results: SearchResult[]): number {
  return results
    .slice(0, 3)
    .filter((result) => !hasStructuredEvidence(result) && (result.snippet?.trim().length ?? 0) < 90)
    .length;
}

export function decideFetchEscalation(
  { intent, confidenceReason, results }: FetchEscalationInput,
): FetchEscalationDecision {
  if (results.length === 0) {
    return { shouldEscalate: false, maxFetches: 0 };
  }

  if (intent.wantsComparison) {
    return { shouldEscalate: true, reason: "comparison", maxFetches: 3 };
  }
  if (intent.wantsOfficialDocs || intent.wantsReference) {
    return { shouldEscalate: true, reason: "official_docs", maxFetches: 3 };
  }
  if (intent.wantsReleaseNotes || intent.wantsRecency) {
    return { shouldEscalate: true, reason: "recent_updates", maxFetches: 3 };
  }
  if (confidenceReason && confidenceReason !== "ok") {
    return { shouldEscalate: true, reason: confidenceReason, maxFetches: 2 };
  }
  if (thinSnippetCount(results) >= Math.min(2, results.length)) {
    return { shouldEscalate: true, reason: "thin_snippets", maxFetches: 2 };
  }

  return { shouldEscalate: false, maxFetches: 2 };
}
