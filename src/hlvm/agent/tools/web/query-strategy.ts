import type { SearchResult } from "./search-provider.ts";
import type { SearchConfidenceReason } from "./search-ranking.ts";
import { generateQueryVariants } from "./duckduckgo.ts";
import {
  COMPARISON_RE,
  OFFICIAL_DOCS_RE,
  QUOTED_PHRASE_RE,
  RECENCY_RE,
  REFERENCE_RE,
  RELEASE_NOTES_RE,
  VERSION_RE,
  YEAR_RE,
} from "./intent-patterns.ts";

export interface SearchQueryIntent {
  wantsOfficialDocs: boolean;
  wantsComparison: boolean;
  wantsRecency: boolean;
  wantsVersionSpecific: boolean;
  wantsReleaseNotes: boolean;
  wantsReference: boolean;
  wantsQueryDecomposition: boolean;
  wantsFetchFirst: boolean;
  wantsMultiSourceSynthesis: boolean;
  wantsAuthoritativeBias: boolean;
}

interface FollowupQueryInput {
  userQuery: string;
  confidenceReason: SearchConfidenceReason;
  currentResults: SearchResult[];
  maxQueries: number;
}

export function normalizeSearchQueryCandidate(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

export function addUniqueSearchQuery(
  queries: string[],
  seen: Set<string>,
  query: string,
  maxQueries: number,
): void {
  const normalized = normalizeSearchQueryCandidate(query);
  if (!normalized) return;
  const key = normalized.toLowerCase();
  if (seen.has(key)) return;
  if (queries.length >= maxQueries) return;
  seen.add(key);
  queries.push(normalized);
}

export function appendQueryQualifier(query: string, qualifier: string): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;
  if (new RegExp(`\\b${qualifier.replace(/\s+/g, "\\s+")}\\b`, "i").test(trimmed)) {
    return trimmed;
  }
  return `${trimmed} ${qualifier}`.trim();
}

export function extractQuotedPhrases(query: string): string[] {
  return query.match(QUOTED_PHRASE_RE) ?? [];
}

/**
 * Detects search intent signals from a query string.
 *
 * All patterns are English-only (see intent-patterns.ts). Non-English queries produce
 * all-false intent booleans, resulting in generic unbiased search. The `locale` parameter
 * on search tools affects DDG/Google News result filtering, not intent detection.
 */
export function detectSearchQueryIntent(query: string): SearchQueryIntent {
  const trimmed = query.trim();
  const wantsOfficialDocs = OFFICIAL_DOCS_RE.test(trimmed);
  const wantsComparison = COMPARISON_RE.test(trimmed);
  const wantsVersionSpecific = VERSION_RE.test(trimmed);
  const wantsReleaseNotes = RELEASE_NOTES_RE.test(trimmed);
  const wantsReference = REFERENCE_RE.test(trimmed);
  const wantsRecency = RECENCY_RE.test(trimmed) || (YEAR_RE.test(trimmed) && !wantsVersionSpecific);
  const wantsAuthoritativeBias = wantsOfficialDocs || wantsReference || wantsReleaseNotes;
  const wantsMultiSourceSynthesis = wantsComparison || wantsReleaseNotes;
  const wantsQueryDecomposition = wantsComparison ||
    wantsReleaseNotes ||
    ((wantsOfficialDocs || wantsReference) && trimmed.split(/\s+/).length >= 5) ||
    (wantsRecency && wantsAuthoritativeBias && trimmed.split(/\s+/).length >= 6);
  const wantsFetchFirst = wantsAuthoritativeBias || wantsMultiSourceSynthesis || wantsRecency;
  return {
    wantsOfficialDocs,
    wantsComparison,
    wantsRecency,
    wantsVersionSpecific,
    wantsReleaseNotes,
    wantsReference,
    wantsQueryDecomposition,
    wantsFetchFirst,
    wantsMultiSourceSynthesis,
    wantsAuthoritativeBias,
  };
}

export function buildFollowupQueries(
  { userQuery, confidenceReason, currentResults, maxQueries }: FollowupQueryInput,
): string[] {
  const trimmed = userQuery.trim();
  if (!trimmed || maxQueries <= 0) return [];

  const intent = detectSearchQueryIntent(trimmed);
  const seen = new Set<string>([trimmed.toLowerCase()]);
  const queries: string[] = [];

  const variant = generateQueryVariants(trimmed, 1)[0];
  if (
    variant &&
    variant.toLowerCase() !== trimmed.toLowerCase() &&
    (confidenceReason === "low_score" || confidenceReason === "mixed")
  ) {
    addUniqueSearchQuery(queries, seen, variant, maxQueries);
  }

  if (queries.length < maxQueries && (intent.wantsOfficialDocs || intent.wantsReference)) {
    addUniqueSearchQuery(
      queries,
      seen,
      appendQueryQualifier(trimmed, intent.wantsReference ? "official documentation reference" : "official docs"),
      maxQueries,
    );
  }

  if (queries.length < maxQueries && (intent.wantsComparison || confidenceReason === "low_diversity")) {
    addUniqueSearchQuery(
      queries,
      seen,
      appendQueryQualifier(trimmed, intent.wantsComparison ? "comparison tradeoffs" : "independent sources"),
      maxQueries,
    );
  }

  if (
    queries.length < maxQueries &&
    (intent.wantsReleaseNotes || confidenceReason === "low_coverage")
  ) {
    addUniqueSearchQuery(
      queries,
      seen,
      appendQueryQualifier(
        trimmed,
        intent.wantsReleaseNotes || intent.wantsRecency
          ? "release notes changelog"
          : intent.wantsVersionSpecific || intent.wantsReference || intent.wantsOfficialDocs
          ? "official reference guide"
          : "overview guide",
      ),
      maxQueries,
    );
  }

  if (queries.length < maxQueries && intent.wantsRecency && !YEAR_RE.test(trimmed)) {
    addUniqueSearchQuery(
      queries,
      seen,
      appendQueryQualifier(trimmed, String(new Date().getUTCFullYear())),
      maxQueries,
    );
  }

  if (queries.length < maxQueries) {
    addUniqueSearchQuery(
      queries,
      seen,
      appendQueryQualifier(
        trimmed,
        intent.wantsComparison
          ? "comparison tradeoffs"
          : intent.wantsVersionSpecific || intent.wantsReference || intent.wantsOfficialDocs
          ? "official reference guide"
          : "overview guide",
      ),
      maxQueries,
    );
  }

  return queries.slice(0, maxQueries);
}
