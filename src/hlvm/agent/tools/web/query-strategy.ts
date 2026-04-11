import type { SearchResult } from "./search-provider.ts";
import type { SearchConfidenceReason } from "./search-ranking.ts";
import {
  COMPARISON_RE,
  OFFICIAL_DOCS_RE,
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

const DROP_QUALIFIER_WORDS = new Set([
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
const COMPARISON_LEAD_IN_RE = /^(?:compare|comparison|differences?|difference between|between)\b[\s:,-]*/i;
const COMPARISON_FILLER_RE = /^(?:official|docs?|documentation|reference|guide|latest|recent|current)\b[\s:,-]*/i;

function normalizeSearchQueryCandidate(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

function addUniqueSearchQuery(
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

function appendQueryQualifier(query: string, qualifier: string): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;
  if (new RegExp(`\\b${qualifier.replace(/\s+/g, "\\s+")}\\b`, "i").test(trimmed)) {
    return trimmed;
  }
  return `${trimmed} ${qualifier}`.trim();
}

function stripOuterPunctuation(value: string): string {
  return value.replace(/^[^a-z0-9"'`]+|[^a-z0-9"'`.]+$/gi, "").trim();
}

function extractQuotedEntity(
  value: string,
  pick: "first" | "last",
): string | undefined {
  const matches = [...value.matchAll(/"([^"]+)"|'([^']+)'/g)];
  if (matches.length === 0) return undefined;
  const match = pick === "first" ? matches[0] : matches[matches.length - 1];
  return stripOuterPunctuation((match[1] ?? match[2] ?? "").trim()) || undefined;
}

function cleanComparisonSide(value: string): string {
  let cleaned = value.trim();
  let previous = "";
  while (cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned.replace(COMPARISON_LEAD_IN_RE, "").trim();
    cleaned = cleaned.replace(COMPARISON_FILLER_RE, "").trim();
  }
  return cleaned;
}

function tokenizeComparisonSide(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => stripOuterPunctuation(token))
    .filter((token) => token.length > 0);
}

function buildComparisonEntity(
  side: string,
  pick: "leading" | "trailing",
  desiredTokenCount?: number,
): { entity?: string; tokenCount: number; remainingTokens: string[] } {
  const quoted = extractQuotedEntity(side, pick === "leading" ? "first" : "last");
  if (quoted) {
    const stripped = side.replace(quoted, " ");
    return {
      entity: quoted,
      tokenCount: tokenizeComparisonSide(quoted).length,
      remainingTokens: tokenizeComparisonSide(cleanComparisonSide(stripped)),
    };
  }

  const cleaned = cleanComparisonSide(side);
  const tokens = tokenizeComparisonSide(cleaned);
  if (tokens.length === 0) {
    return { entity: undefined, tokenCount: 0, remainingTokens: [] };
  }

  const boundedDesired = desiredTokenCount && desiredTokenCount > 0
    ? Math.min(desiredTokenCount, 3, tokens.length)
    : Math.min(tokens.length, 3);
  const entityTokens = pick === "leading"
    ? tokens.slice(0, boundedDesired)
    : tokens.slice(-boundedDesired);
  const remainingTokens = pick === "leading"
    ? tokens.slice(boundedDesired)
    : tokens.slice(0, Math.max(0, tokens.length - boundedDesired));
  return {
    entity: entityTokens.join(" "),
    tokenCount: entityTokens.length,
    remainingTokens,
  };
}

function splitComparisonQuery(query: string): { left: string; right: string } | undefined {
  const vsMatch = query.match(/^(.*?)\s+(?:vs\.?|versus)\s+(.+)$/i);
  if (vsMatch) {
    return { left: vsMatch[1] ?? "", right: vsMatch[2] ?? "" };
  }

  const compareBody = query.replace(COMPARISON_LEAD_IN_RE, "").trim();
  if (!compareBody || compareBody === query.trim()) return undefined;
  const joined = compareBody.match(/^(.*?)\s+(?:and|with|to)\s+(.+)$/i);
  if (joined) {
    return { left: joined[1] ?? "", right: joined[2] ?? "" };
  }

  return undefined;
}

function buildComparisonDecompositionQueries(
  query: string,
  maxQueries: number,
): string[] {
  if (maxQueries <= 0 || !COMPARISON_RE.test(query)) return [];

  const sides = splitComparisonQuery(query);
  if (!sides) return [];

  const leftSide = cleanComparisonSide(sides.left);
  const rightSide = cleanComparisonSide(sides.right);
  if (!leftSide || !rightSide) return [];

  const leftTokens = tokenizeComparisonSide(leftSide);
  if (leftTokens.length === 0 || leftTokens.length > 3) return [];

  const leftEntity = buildComparisonEntity(leftSide, "trailing");
  const rightEntity = buildComparisonEntity(
    rightSide,
    "leading",
    leftEntity.tokenCount || 1,
  );
  if (!leftEntity.entity || !rightEntity.entity) return [];
  if (leftEntity.entity.toLowerCase() === rightEntity.entity.toLowerCase()) return [];

  const sharedContext = [
    ...leftEntity.remainingTokens,
    ...rightEntity.remainingTokens,
  ]
    .join(" ")
    .trim();
  const queries: string[] = [];
  const seen = new Set<string>();
  addUniqueSearchQuery(
    queries,
    seen,
    [leftEntity.entity, sharedContext].filter(Boolean).join(" "),
    maxQueries,
  );
  addUniqueSearchQuery(
    queries,
    seen,
    [rightEntity.entity, sharedContext].filter(Boolean).join(" "),
    maxQueries,
  );
  return queries;
}

/** Generate query variants for wider recall (pure string, no LLM). */
export function generateQueryVariants(query: string, maxVariants = 2): string[] {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 2) return [];

  const variants: string[] = [];
  const limit = Math.min(Math.max(0, maxVariants), 2);
  const normalizedWords = words.map((w) =>
    w.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9.]+$/gi, "")
  );

  if (words.length >= 2 && variants.length < limit) {
    const reordered = [...words];
    [reordered[0], reordered[reordered.length - 1]] = [reordered[reordered.length - 1], reordered[0]];
    const variant = reordered.join(" ");
    if (variant !== query.trim()) variants.push(variant);
  }

  if (words.length >= 3 && variants.length < limit) {
    const isVersionToken = (token: string): boolean => /\d/.test(token);
    let dropIndex = -1;

    for (let i = 0; i < normalizedWords.length; i++) {
      const token = normalizedWords[i];
      if (!token || isVersionToken(token)) continue;
      if (!DROP_QUALIFIER_WORDS.has(token)) continue;
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
      const dropped = words.filter((_word, index) => index !== dropIndex).join(" ");
      if (dropped.split(/\s+/).length >= 2 && dropped !== query.trim()) {
        variants.push(dropped);
      }
    }
  }

  const lower = query.trim().toLowerCase();
  if (variants.length < limit && (lower.startsWith("how to") || lower.startsWith("what is"))) {
    variants.push(`${query.trim()} guide`);
  }

  return variants.slice(0, limit);
}

/** Derive computed intent fields from primary intent flags. */
function deriveIntentFields(
  trimmed: string,
  primary: {
    wantsOfficialDocs: boolean;
    wantsComparison: boolean;
    wantsRecency: boolean;
    wantsVersionSpecific: boolean;
    wantsReleaseNotes: boolean;
    wantsReference: boolean;
  },
): SearchQueryIntent {
  const wantsAuthoritativeBias = primary.wantsOfficialDocs || primary.wantsReference || primary.wantsReleaseNotes;
  const wantsMultiSourceSynthesis = primary.wantsComparison || primary.wantsReleaseNotes;
  const wantsQueryDecomposition = primary.wantsComparison ||
    primary.wantsReleaseNotes ||
    ((primary.wantsOfficialDocs || primary.wantsReference) && trimmed.split(/\s+/).length >= 5) ||
    (primary.wantsRecency && wantsAuthoritativeBias && trimmed.split(/\s+/).length >= 6);
  const wantsFetchFirst = wantsAuthoritativeBias || wantsMultiSourceSynthesis || primary.wantsRecency;
  return {
    ...primary,
    wantsQueryDecomposition,
    wantsFetchFirst,
    wantsMultiSourceSynthesis,
    wantsAuthoritativeBias,
  };
}

/**
 * Detects search intent signals from a query string (sync, for formatting hot path).
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
  return deriveIntentFields(trimmed, {
    wantsOfficialDocs, wantsComparison, wantsRecency,
    wantsVersionSpecific, wantsReleaseNotes, wantsReference,
  });
}

export function prefersSingleHostSources(
  query: string,
  intent?: SearchQueryIntent,
  allowedDomains?: string[],
): boolean {
  const resolvedIntent = intent ?? detectSearchQueryIntent(query);
  if ((allowedDomains?.length ?? 0) > 0) return true;
  if (resolvedIntent.wantsReference || resolvedIntent.wantsVersionSpecific) {
    return true;
  }
  return /\b(official|api|manual|spec)\b/i.test(query);
}

export function buildFollowupQueries(
  input: FollowupQueryInput,
): string[] {
  return buildFollowupQueriesWithIntent(input);
}

function buildFollowupQueriesWithIntent(
  { userQuery, confidenceReason, currentResults: _currentResults, maxQueries, intent: precomputedIntent }:
    FollowupQueryInput & { intent?: SearchQueryIntent },
): string[] {
  const trimmed = userQuery.trim();
  if (!trimmed || maxQueries <= 0) return [];

  const intent = precomputedIntent ?? detectSearchQueryIntent(trimmed);
  const seen = new Set<string>([trimmed.toLowerCase()]);
  const queries: string[] = [];

  if (
    queries.length < maxQueries &&
    (intent.wantsQueryDecomposition || intent.wantsComparison)
  ) {
    const decomposed = buildComparisonDecompositionQueries(
      trimmed,
      maxQueries - queries.length,
    );
    for (const candidate of decomposed) {
      addUniqueSearchQuery(queries, seen, candidate, maxQueries);
    }
  }

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
