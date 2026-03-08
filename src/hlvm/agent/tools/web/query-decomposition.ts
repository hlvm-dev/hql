import {
  addUniqueSearchQuery,
  appendQueryQualifier,
  detectSearchQueryIntent,
  normalizeSearchQueryCandidate,
  type SearchQueryIntent,
} from "./query-strategy.ts";

export interface QueryPlan {
  primaryQuery: string;
  subqueries: string[];
  intent: SearchQueryIntent;
  mode: "single" | "decomposed";
}

interface QueryPlanInput {
  userQuery: string;
  maxSubqueries?: number;
}

const MAX_SUBQUERIES = 3;
const COMPARISON_SPLIT_RE = /\b(?:vs\.?|versus)\b/i;
const LEADING_COMPARE_RE = /^\s*compare\s+/i;
const TRAILING_COMPARISON_WORDS_RE = /\b(compare|comparison|tradeoffs?|differences?)\b/gi;

function sanitizeQueryFragment(query: string): string {
  return normalizeSearchQueryCandidate(
    query
      .replace(LEADING_COMPARE_RE, "")
      .replace(TRAILING_COMPARISON_WORDS_RE, "")
      .replace(/[?]+$/g, "")
      .trim(),
  );
}

function maybeAppendDocsQualifier(query: string, intent: SearchQueryIntent): string {
  if (intent.wantsReference) return appendQueryQualifier(query, "official documentation reference");
  if (intent.wantsOfficialDocs || intent.wantsAuthoritativeBias) {
    return appendQueryQualifier(query, "official docs");
  }
  return appendQueryQualifier(query, "deployment guide");
}

function buildComparisonSubqueries(
  baseQuery: string,
  intent: SearchQueryIntent,
  maxSubqueries: number,
): string[] {
  const parts = baseQuery.split(COMPARISON_SPLIT_RE).map(sanitizeQueryFragment).filter(Boolean);
  if (parts.length < 2) return [];

  const [left, right] = parts;
  const queries: string[] = [];
  const seen = new Set<string>([baseQuery.toLowerCase()]);

  addUniqueSearchQuery(queries, seen, maybeAppendDocsQualifier(left, intent), maxSubqueries);
  addUniqueSearchQuery(queries, seen, maybeAppendDocsQualifier(right, intent), maxSubqueries);
  addUniqueSearchQuery(
    queries,
    seen,
    appendQueryQualifier(`${left} vs ${right}`, "comparison tradeoffs"),
    maxSubqueries,
  );

  return queries;
}

function buildDocsSubqueries(
  baseQuery: string,
  intent: SearchQueryIntent,
  maxSubqueries: number,
): string[] {
  const queries: string[] = [];
  const seen = new Set<string>([baseQuery.toLowerCase()]);
  const stripped = sanitizeQueryFragment(baseQuery);

  addUniqueSearchQuery(
    queries,
    seen,
    maybeAppendDocsQualifier(stripped, intent),
    maxSubqueries,
  );
  addUniqueSearchQuery(
    queries,
    seen,
    appendQueryQualifier(stripped, intent.wantsReference ? "reference guide" : "documentation guide"),
    maxSubqueries,
  );

  return queries;
}

function buildReleaseSubqueries(
  baseQuery: string,
  intent: SearchQueryIntent,
  maxSubqueries: number,
): string[] {
  const queries: string[] = [];
  const seen = new Set<string>([baseQuery.toLowerCase()]);
  const stripped = sanitizeQueryFragment(baseQuery);

  addUniqueSearchQuery(
    queries,
    seen,
    appendQueryQualifier(stripped, "release notes changelog"),
    maxSubqueries,
  );
  addUniqueSearchQuery(
    queries,
    seen,
    appendQueryQualifier(
      stripped,
      intent.wantsReleaseNotes
        ? "official blog changelog"
        : intent.wantsOfficialDocs || intent.wantsReference
        ? "documentation updates"
        : "official updates",
    ),
    maxSubqueries,
  );

  return queries;
}

export function planSearchQueries(
  { userQuery, maxSubqueries = MAX_SUBQUERIES }: QueryPlanInput,
): QueryPlan {
  const primaryQuery = normalizeSearchQueryCandidate(userQuery);
  const intent = detectSearchQueryIntent(primaryQuery);
  const totalLimit = Math.max(1, Math.min(MAX_SUBQUERIES, maxSubqueries));
  const limit = Math.max(0, totalLimit - 1);

  if (!primaryQuery || !intent.wantsQueryDecomposition || limit === 0) {
    return { primaryQuery, subqueries: [], intent, mode: "single" };
  }

  const candidates: string[] = [];
  const comparisonQueries = intent.wantsComparison
    ? buildComparisonSubqueries(primaryQuery, intent, limit)
    : [];
  const docsQueries = (intent.wantsOfficialDocs || intent.wantsReference)
    ? buildDocsSubqueries(primaryQuery, intent, limit)
    : [];
  const releaseQueries = (intent.wantsReleaseNotes || intent.wantsRecency)
    ? buildReleaseSubqueries(primaryQuery, intent, limit)
    : [];

  const seen = new Set<string>([primaryQuery.toLowerCase()]);
  for (const query of [...comparisonQueries, ...docsQueries, ...releaseQueries]) {
    addUniqueSearchQuery(candidates, seen, query, limit);
  }

  return {
    primaryQuery,
    subqueries: candidates.slice(0, limit),
    intent,
    mode: candidates.length > 0 ? "decomposed" : "single",
  };
}
