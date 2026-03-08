/**
 * Search ranking SSOT for DDG web search.
 * Provides canonical URL handling, confidence assessment, and passage extraction.
 */

import type { SearchResult, SearchTimeRange } from "./search-provider.ts";
import { resultHost } from "./web-utils.ts";

const TRACKING_QUERY_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "ref",
  "source",
  "utm_campaign",
  "utm_content",
  "utm_id",
  "utm_medium",
  "utm_source",
  "utm_term",
  "ved",
]);
const TIME_RANGE_MAX_DAYS: Record<Exclude<SearchTimeRange, "all">, number> = {
  day: 1,
  week: 7,
  month: 31,
  year: 366,
};

function normalizeSearchToken(token: string): string {
  const normalized = token
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (normalized.length < 2) return "";
  if (normalized.endsWith("ies") && normalized.length > 4) {
    return `${normalized.slice(0, -3)}y`;
  }
  if (normalized.endsWith("s") && !normalized.endsWith("ss") && normalized.length > 4) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function pushNormalizedToken(
  seen: Set<string>,
  tokens: string[],
  raw: string,
): void {
  const normalized = normalizeSearchToken(raw);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  tokens.push(normalized);
}

export function tokenizeSearchText(text: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const fragments = text
    .split(/[\s\-_.:/?#=&]+/)
    .map((fragment) => fragment.trim())
    .filter(Boolean);

  for (const fragment of fragments) {
    pushNormalizedToken(seen, tokens, fragment);
    const expanded = fragment.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/\s+/)
      .filter(Boolean);
    for (const piece of expanded) {
      if (piece.length < 4) continue;
      pushNormalizedToken(seen, tokens, piece);
    }
  }

  return tokens;
}

export function tokenizeQuery(query: string): string[] {
  return tokenizeSearchText(query);
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function dedupeKey(result: SearchResult): string {
  return canonicalizeResultUrl(result.url) ??
    `no-url:${(result.title ?? "").toLowerCase()}:${
      (result.snippet ?? "").toLowerCase()
    }`;
}

function mergedText(valueA?: string, valueB?: string): string | undefined {
  const left = valueA?.trim() ?? "";
  const right = valueB?.trim() ?? "";
  if (!left) return right || undefined;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

function mergedTitle(valueA?: string, valueB?: string): string {
  const left = valueA?.trim() ?? "";
  const right = valueB?.trim() ?? "";
  if (!left) return right;
  if (!right) return left;
  const genericTitle = /^(home|index|page|untitled)$/i;
  if (genericTitle.test(left) && !genericTitle.test(right)) return right;
  if (genericTitle.test(right) && !genericTitle.test(left)) return left;
  return right.length > left.length ? right : left;
}

function mergedStringArray(
  existing?: string[],
  incoming?: string[],
): string[] | undefined {
  const values = [...(existing ?? []), ...(incoming ?? [])]
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (values.length === 0) return undefined;
  return [...new Set(values)];
}

function mergedScore(existing?: number, incoming?: number): number | undefined {
  const left = typeof existing === "number" && Number.isFinite(existing)
    ? existing
    : undefined;
  const right = typeof incoming === "number" && Number.isFinite(incoming)
    ? incoming
    : undefined;
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}

function confidenceSurfaceScore(result: SearchResult): number {
  let score = 0;
  const titleLength = result.title?.trim().length ?? 0;
  const snippetLength = result.snippet?.trim().length ?? 0;

  if (titleLength >= 30) score += 2;
  else if (titleLength >= 12) score += 1;

  if (snippetLength >= 120) score += 4;
  else if (snippetLength >= 60) score += 3;
  else if (snippetLength >= 35) score += 2;
  else if (snippetLength >= 15) score += 1;

  if (result.url) score += 1;
  if ((result.url ?? "").startsWith("https://")) score += 1;

  return score;
}

export type SearchConfidenceReason =
  | "ok"
  | "low_score"
  | "low_diversity"
  | "low_coverage"
  | "mixed";

export interface SearchConfidenceAssessment {
  lowConfidence: boolean;
  reason: SearchConfidenceReason;
  reasons: Array<"low_score" | "low_diversity" | "low_coverage">;
  avgScore?: number;
  hostDiversity: number;
  queryCoverage: number;
  considered: number;
  scoredCount: number;
}

export interface SearchConfidenceOptions {
  sampleSize?: number;
  scoreThreshold?: number;
  diversityThreshold?: number;
  coverageThreshold?: number;
}

/** Shared confidence assessment used by retries, enrichment depth, and formatting hints. */
export function assessSearchConfidence(
  query: string,
  results: SearchResult[],
  options: SearchConfidenceOptions = {},
): SearchConfidenceAssessment {
  const sampleSize = Math.max(1, options.sampleSize ?? 5);
  const scoreThreshold = options.scoreThreshold ?? 4;
  const diversityThreshold = options.diversityThreshold ?? 0.4;
  const coverageThreshold = options.coverageThreshold ?? 0.55;

  const sample = results.slice(0, sampleSize);
  const considered = sample.length;
  const scored = sample.filter((r) =>
    typeof r.score === "number" && Number.isFinite(r.score)
  );
  const scoredAvg = scored.length > 0
    ? scored.reduce((sum, r) => sum + (r.score ?? 0), 0) / scored.length
    : undefined;
  const avgScore = scoredAvg ?? (considered > 0
    ? sample.reduce((sum, result) => sum + confidenceSurfaceScore(result), 0) / considered
    : undefined);

  const uniqueHosts = new Set(
    sample.map((r) => resultHost(r.url)).filter((h): h is string => Boolean(h)),
  ).size;
  const hostDiversity = considered > 0 ? uniqueHosts / considered : 1;

  const queryTokens = tokenizeQuery(query);
  const mergedText = sample
    .map((r) =>
      `${r.title ?? ""} ${r.snippet ?? ""} ${r.url ?? ""}`.toLowerCase()
    )
    .join(" ");
  const matchedQueryTokens =
    queryTokens.filter((t) => mergedText.includes(t)).length;
  const queryCoverage = queryTokens.length > 0
    ? matchedQueryTokens / queryTokens.length
    : 1;

  const reasons: Array<"low_score" | "low_diversity" | "low_coverage"> = [];
  if (avgScore !== undefined && avgScore < scoreThreshold) {
    reasons.push("low_score");
  }
  if (considered >= 3 && hostDiversity < diversityThreshold) {
    reasons.push("low_diversity");
  }
  if (queryTokens.length >= 2 && queryCoverage < coverageThreshold) {
    reasons.push("low_coverage");
  }

  const lowConfidence = reasons.length > 0;
  const reason: SearchConfidenceReason = !lowConfidence
    ? "ok"
    : reasons.length === 1
    ? reasons[0]
    : "mixed";

  return {
    lowConfidence,
    reason,
    reasons,
    avgScore,
    hostDiversity,
    queryCoverage,
    considered,
    scoredCount: scored.length,
  };
}

function qualityScore(result: SearchResult): number {
  return (result.title?.length ?? 0) + (result.snippet?.length ?? 0) +
    ((result.score ?? 0) * 8);
}

export function canonicalizeResultUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();

    if (
      (parsed.protocol === "https:" && parsed.port === "443") ||
      (parsed.protocol === "http:" && parsed.port === "80")
    ) {
      parsed.port = "";
    }

    parsed.pathname = normalizePathname(parsed.pathname);

    const cleanedParams = [...parsed.searchParams.entries()]
      .filter(([key]) => !TRACKING_QUERY_PARAMS.has(key.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));

    parsed.search = "";
    cleanedParams.forEach(([key, value]) =>
      parsed.searchParams.append(key, value)
    );

    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function dedupeSearchResults(results: SearchResult[]): SearchResult[] {
  const bestByCanonical = new Map<string, SearchResult>();

  for (const result of results) {
    const key = dedupeKey(result);
    const existing = bestByCanonical.get(key);
    if (!existing) {
      bestByCanonical.set(key, result);
      continue;
    }
    if (qualityScore(result) > qualityScore(existing)) {
      bestByCanonical.set(key, result);
    }
  }

  return [...bestByCanonical.values()];
}

export function dedupeSearchResultsStable(results: SearchResult[]): SearchResult[] {
  const unique: SearchResult[] = [];
  const indexByKey = new Map<string, number>();

  for (const result of results) {
    const key = dedupeKey(result);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, unique.length);
      unique.push(result);
      continue;
    }

    const existing = unique[existingIndex];
    unique[existingIndex] = {
      ...existing,
      title: mergedTitle(existing.title, result.title),
      url: existing.url ?? result.url,
      snippet: mergedText(existing.snippet, result.snippet),
      score: mergedScore(existing.score, result.score),
      publishedDate: existing.publishedDate ?? result.publishedDate,
      passages: mergedStringArray(existing.passages, result.passages),
      pageDescription: mergedText(existing.pageDescription, result.pageDescription),
      relatedLinks: mergedStringArray(existing.relatedLinks, result.relatedLinks),
      evidenceStrength: existing.evidenceStrength ?? result.evidenceStrength,
      evidenceReason: existing.evidenceReason ?? result.evidenceReason,
      fetchPriority: existing.fetchPriority ?? result.fetchPriority,
      selectedForFetch: existing.selectedForFetch === true || result.selectedForFetch === true,
    };
  }

  return unique;
}

function parseAgeSnippetDays(snippet?: string): number | undefined {
  const text = snippet?.toLowerCase() ?? "";
  if (!text) return undefined;

  const relative = text.match(/\b(\d+)\s+(day|week|month|year)s?\s+ago\b/);
  if (relative) {
    const count = Number(relative[1]);
    const unit = relative[2];
    if (unit === "day") return count;
    if (unit === "week") return count * 7;
    if (unit === "month") return count * 31;
    if (unit === "year") return count * 366;
  }

  const absolute = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (!absolute) return undefined;
  const parsed = new Date(absolute[1]);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  const diffMs = Date.now() - parsed.getTime();
  return Math.max(0, diffMs / (24 * 60 * 60 * 1000));
}

export function estimateResultAgeDays(result: SearchResult): number | undefined {
  if (result.publishedDate) {
    const published = new Date(result.publishedDate);
    if (Number.isFinite(published.getTime())) {
      const diffMs = Date.now() - published.getTime();
      return Math.max(0, diffMs / (24 * 60 * 60 * 1000));
    }
  }
  return parseAgeSnippetDays(result.snippet);
}

export function filterSearchResultsForTimeRange(
  results: SearchResult[],
  timeRange: SearchTimeRange,
): SearchResult[] {
  if (timeRange === "all") return results;
  const maxDays = TIME_RANGE_MAX_DAYS[timeRange];
  return results.filter((result) => {
    const ageDays = estimateResultAgeDays(result);
    return ageDays === undefined || ageDays <= maxDays;
  });
}

// ============================================================
// Passage Extraction
// ============================================================

const PASSAGE_MAX_CHARS = 280;
const PASSAGE_MIN_CHARS = 40;

/**
 * Score a lowercased paragraph against query tokens.
 * Components: coverage (fraction of tokens present) × (TF + proximity).
 * - TF: sum of log(1 + occurrences) dampens high-frequency repetition.
 * - Proximity: bonus when ≥2 tokens match — shorter span between first
 *   occurrences of distinct tokens → higher bonus (1 / (1 + span/100)).
 */
export function scorePassage(lower: string, tokens: string[]): number {
  const positions: number[] = []; // first-occurrence index per matched token
  let tf = 0;

  for (const t of tokens) {
    let idx = lower.indexOf(t);
    if (idx === -1) continue;
    positions.push(idx);
    // Count all occurrences for TF
    let count = 0;
    while (idx !== -1) {
      count++;
      idx = lower.indexOf(t, idx + t.length);
    }
    tf += Math.log(1 + count);
  }

  if (positions.length === 0) return 0;

  const coverage = positions.length / tokens.length;

  // Proximity bonus: only meaningful with ≥2 matched tokens
  let proximity = 0;
  if (positions.length >= 2) {
    const span = Math.max(...positions) - Math.min(...positions);
    proximity = 1 / (1 + span / 100);
  }

  return coverage * (tf + proximity);
}

export function extractRelevantPassages(
  query: string,
  text: string,
  maxPassages = 3,
): string[] {
  if (!text || !query) return [];

  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  // Split into paragraphs at double-newline or single-newline boundaries
  const paragraphs = text
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter((p) => p.length >= PASSAGE_MIN_CHARS);

  if (paragraphs.length === 0) return [];

  // Score each paragraph: coverage × (term-frequency + proximity bonus)
  const scored = paragraphs.map((p) => {
    const lower = p.toLowerCase();
    return { text: p, score: scorePassage(lower, tokens) };
  });

  return scored
    .filter((s) => s.score > 0) // Must match at least 1 query token
    .sort((a, b) => b.score - a.score) // Best matches first
    .slice(0, maxPassages)
    .map((s) =>
      s.text.length > PASSAGE_MAX_CHARS
        ? s.text.slice(0, PASSAGE_MAX_CHARS - 1) + "\u2026"
        : s.text
    );
}

/** Drop passages that substantially overlap with the DDG snippet (Jaccard > 0.6). */
export function deduplicateSnippetPassages(
  snippet: string,
  passages: string[],
): string[] {
  if (!snippet || passages.length === 0) return passages;
  const snippetTokens = new Set(tokenizeQuery(snippet));
  if (snippetTokens.size === 0) return passages;

  return passages.filter((passage) => {
    const passageTokens = new Set(tokenizeQuery(passage));
    if (passageTokens.size === 0) return true;
    let intersection = 0;
    for (const t of snippetTokens) {
      if (passageTokens.has(t)) intersection++;
    }
    const union = snippetTokens.size + passageTokens.size - intersection;
    return union === 0 || (intersection / union) <= 0.6;
  });
}
