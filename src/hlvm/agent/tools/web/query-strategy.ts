import type { SearchResult } from "./search-provider.ts";
import type { SearchConfidenceReason } from "./search-ranking.ts";
import { generateQueryVariants } from "./duckduckgo.ts";

export interface SearchQueryIntent {
  wantsOfficialDocs: boolean;
  wantsComparison: boolean;
  wantsRecency: boolean;
  wantsVersionSpecific: boolean;
  wantsReleaseNotes: boolean;
  wantsReference: boolean;
}

interface FollowupQueryInput {
  userQuery: string;
  confidenceReason: SearchConfidenceReason;
  currentResults: SearchResult[];
  maxQueries: number;
}

const OFFICIAL_DOCS_RE = /\b(official|docs?|documentation|reference|api)\b/i;
const COMPARISON_RE = /\b(compare|comparison|versus|vs\.?|tradeoffs?|differences?)\b/i;
const RECENCY_RE = /\b(latest|recent|today|current|new|updated?|changes?)\b/i;
const RELEASE_NOTES_RE = /\b(changelog|release notes?|what(?:'s| is) new)\b/i;
const YEAR_RE = /\b(?:19|20)\d{2}\b/;
const VERSION_RE = /\bv?\d+(?:\.\d+){1,3}\b/;

function addUniqueQuery(
  queries: string[],
  seen: Set<string>,
  query: string,
  maxQueries: number,
): void {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized) return;
  const key = normalized.toLowerCase();
  if (seen.has(key)) return;
  if (queries.length >= maxQueries) return;
  seen.add(key);
  queries.push(normalized);
}

function wantsStructuredReference(query: string): boolean {
  return /\b(reference|api|spec|syntax|manual|guide)\b/i.test(query);
}

function appendQualifier(query: string, qualifier: string): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;
  if (new RegExp(`\\b${qualifier.replace(/\s+/g, "\\s+")}\\b`, "i").test(trimmed)) {
    return trimmed;
  }
  return `${trimmed} ${qualifier}`.trim();
}

export function detectSearchQueryIntent(query: string): SearchQueryIntent {
  const trimmed = query.trim();
  return {
    wantsOfficialDocs: OFFICIAL_DOCS_RE.test(trimmed),
    wantsComparison: COMPARISON_RE.test(trimmed),
    wantsRecency: RECENCY_RE.test(trimmed) || YEAR_RE.test(trimmed),
    wantsVersionSpecific: VERSION_RE.test(trimmed),
    wantsReleaseNotes: RELEASE_NOTES_RE.test(trimmed),
    wantsReference: wantsStructuredReference(trimmed),
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
    addUniqueQuery(queries, seen, variant, maxQueries);
  }

  if (queries.length < maxQueries && (intent.wantsOfficialDocs || intent.wantsReference)) {
    addUniqueQuery(
      queries,
      seen,
      appendQualifier(trimmed, intent.wantsReference ? "official documentation reference" : "official docs"),
      maxQueries,
    );
  }

  if (queries.length < maxQueries && (intent.wantsComparison || confidenceReason === "low_diversity")) {
    addUniqueQuery(
      queries,
      seen,
      appendQualifier(trimmed, intent.wantsComparison ? "comparison tradeoffs" : "independent sources"),
      maxQueries,
    );
  }

  if (
    queries.length < maxQueries &&
    (intent.wantsReleaseNotes || confidenceReason === "low_coverage")
  ) {
    addUniqueQuery(
      queries,
      seen,
      appendQualifier(
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
    addUniqueQuery(queries, seen, appendQualifier(trimmed, String(new Date().getUTCFullYear())), maxQueries);
  }

  if (queries.length < maxQueries) {
    addUniqueQuery(
      queries,
      seen,
      appendQualifier(
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
