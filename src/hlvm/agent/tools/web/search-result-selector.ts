import { ai } from "../../../api/ai.ts";
import { ValidationError } from "../../../../common/error.ts";
import type { Message, ToolDefinition } from "../../../providers/types.ts";
import type { ToolExecutionOptions } from "../../registry.ts";
import {
  isAllowedByDomainFilters,
  normalizeDomain,
  type SearchResult,
} from "./search-provider.ts";
import {
  prefersSingleHostSources,
  type SearchQueryIntent,
} from "./query-strategy.ts";
import {
  tokenizeSearchText,
  tokenizeQuery,
} from "./search-ranking.ts";
import {
  analyzeResultUrl,
  hasStructuredEvidence,
  resultHost,
} from "./web-utils.ts";
import { classifySearchResultSource } from "./source-authority.ts";
import {
  COMPARISON_TERMS,
  OFFICIAL_DOCS_TERMS,
  REFERENCE_TERMS,
} from "./intent-patterns.ts";

export interface SelectSearchResultsInput {
  query: string;
  results: SearchResult[];
  maxPicks: number;
  intent?: SearchQueryIntent;
  allowedDomains?: string[];
  toolOptions?: ToolExecutionOptions;
}

export interface DeterministicSearchSignalInput {
  query: string;
  intent?: SearchQueryIntent;
  allowedDomains?: string[];
}

export interface SearchSelectionResult {
  picks: SearchResult[];
  pickedIndices: number[];
  confidence: "high" | "medium" | "low";
  reason: string;
  strategy: "llm" | "deterministic";
}

export interface RankFetchedEvidenceInput {
  query: string;
  results: SearchResult[];
  intent?: SearchQueryIntent;
  allowedDomains?: string[];
}

export interface RankedFetchedEvidenceResult {
  results: SearchResult[];
  confidence: "high" | "medium" | "low";
  reason: string;
}

const MAX_SELECTOR_CANDIDATES = 10;
const DOC_SIGNAL_LABELS = new Set([
  "api",
  "dev",
  "developer",
  "developers",
  "doc",
  "docs",
  "guide",
  "learn",
  "manual",
  "reference",
]);
const DOC_SIGNAL_PATHS = new Set([
  "api",
  "doc",
  "docs",
  "guide",
  "guides",
  "learn",
  "manual",
  "reference",
]);
const RELEASE_SIGNAL_TERMS = [
  "announcement",
  "announcing",
  "changelog",
  "release notes",
  "release",
  "releases",
  "what's new",
  "whats new",
];
const LIFECYCLE_SIGNAL_TERMS = [
  "end of life",
  "end-of-life",
  "eol",
  "lifecycle",
  "support status",
];

const COMPOUND_TERM_RE = /\b[a-z0-9]+(?:[._-][a-z0-9]+)+\b/gi;

const SELECT_RESULTS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "select_search_results",
    description:
      "Select the best search results to fetch first for answering the user's question.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        picks: {
          type: "array",
          description: "Ordered zero-based result indices to fetch first.",
          items: { type: "integer", minimum: 0 },
        },
        confidence: {
          type: "string",
          enum: ["high", "medium", "low"],
        },
        reason: {
          type: "string",
          description: "One short sentence explaining the selection.",
        },
      },
      required: ["picks", "confidence", "reason"],
    },
  },
};

function intentGuidance(intent?: SearchQueryIntent): string {
  if (!intent) return "Prefer direct sources that best answer the exact question.";

  const parts: string[] = [];
  if (intent.wantsOfficialDocs || intent.wantsReference) {
    parts.push("Prefer official/reference docs when they directly answer the question.");
  }
  if (intent.wantsReleaseNotes || intent.wantsRecency) {
    parts.push("Prefer current or release-specific sources when dates are available.");
  }
  if (intent.wantsComparison || intent.wantsMultiSourceSynthesis) {
    parts.push("Prefer a diverse set of domains that cover complementary perspectives.");
  } else {
    parts.push("Avoid duplicate hosts unless multiple pages from the same site are clearly the best evidence.");
  }
  return parts.join(" ");
}

function buildSelectionMessages(
  input: SelectSearchResultsInput,
): Message[] {
  const candidates = input.results
    .slice(0, MAX_SELECTOR_CANDIDATES)
    .map((result, index) => {
      const published = result.publishedDate ? ` | published: ${result.publishedDate}` : "";
      const snippet = result.snippet?.trim() ? `\n  snippet: ${result.snippet.trim()}` : "";
      return `[${index}] ${result.title} | host: ${resultHost(result.url) ?? "unknown"}${published}\n  url: ${
        result.url ?? "unknown"
      }${snippet}`;
    })
    .join("\n\n");

  return [
    {
      role: "system",
      content:
        "You are selecting which web search results a coding agent should fetch first. " +
        "Return only the function call. Do not answer the user question.",
    },
    {
      role: "user",
      content:
        `Query: ${input.query}\n` +
        `Target picks: ${input.maxPicks}\n` +
        `${intentGuidance(input.intent)}\n\n` +
        "Results:\n" +
        candidates,
    },
  ];
}

function domainNoiseTokens(allowedDomains?: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const domain of allowedDomains ?? []) {
    const normalized = normalizeDomain(domain);
    for (const token of tokenizeSearchText(normalized)) {
      tokens.add(token);
    }
  }
  return tokens;
}

function intentNoiseTokens(intent?: SearchQueryIntent): Set<string> {
  const tokens = new Set<string>();
  if (!intent) return tokens;

  if (intent.wantsOfficialDocs) {
    for (const term of OFFICIAL_DOCS_TERMS) {
      for (const token of tokenizeSearchText(term)) tokens.add(token);
    }
  }
  if (intent.wantsReference) {
    for (const term of REFERENCE_TERMS) {
      for (const token of tokenizeSearchText(term)) tokens.add(token);
    }
  }
  if (intent.wantsComparison) {
    for (const term of COMPARISON_TERMS) {
      for (const token of tokenizeSearchText(term)) tokens.add(token);
    }
  }

  return tokens;
}

function selectorTokens(
  query: string,
  allowedDomains?: string[],
  intent?: SearchQueryIntent,
): string[] {
  const noiseTokens = domainNoiseTokens(allowedDomains);
  const intentNoise = intentNoiseTokens(intent);
  const compoundNoise = compoundComponentNoiseTokens(query);
  return tokenizeQuery(query).filter((token) =>
    token !== "site" &&
    !noiseTokens.has(token) &&
    !intentNoise.has(token) &&
    !compoundNoise.has(token)
  );
}

function normalizeMatchText(value?: string): string {
  return value?.toLowerCase() ?? "";
}

function normalizeCompoundTerm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function extractCompoundTerms(text: string): string[] {
  const matches = text.match(COMPOUND_TERM_RE) ?? [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const match of matches) {
    const term = normalizeCompoundTerm(match);
    if (term.length < 4 || seen.has(term)) continue;
    seen.add(term);
    normalized.push(term);
  }
  return normalized;
}

function extractCompoundQueryTerms(query: string): string[] {
  return extractCompoundTerms(query);
}

function compoundComponentNoiseTokens(query: string): Set<string> {
  const noise = new Set<string>();
  const matches = query.match(COMPOUND_TERM_RE) ?? [];
  for (const match of matches) {
    for (const token of tokenizeSearchText(match)) {
      noise.add(token);
    }
  }
  return noise;
}

function compoundTermMatches(text: string, compoundTerms: string[]): number {
  if (compoundTerms.length === 0) return 0;
  const collapsed = normalizeCompoundTerm(text);
  let matches = 0;
  for (const term of compoundTerms) {
    if (collapsed.includes(term)) {
      matches += 1;
    }
  }
  return matches;
}

function compoundTermAdjustment(text: string, compoundTerms: string[]): number {
  if (compoundTerms.length === 0) return 0;
  if (compoundTermMatches(text, compoundTerms) > 0) return 0;
  return extractCompoundTerms(text).length > 0 ? -13 : -11;
}

function matchedTokenCount(textTokens: Set<string>, tokens: string[]): number {
  if (textTokens.size === 0) return 0;
  let matches = 0;
  for (const token of tokens) {
    if (textTokens.has(token)) matches++;
  }
  return matches;
}

function parseToolArguments(
  value: unknown,
): { picks?: unknown; confidence?: unknown; reason?: unknown } | null {
  if (value && typeof value === "object") {
    return value as { picks?: unknown; confidence?: unknown; reason?: unknown };
  }
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? parsed as { picks?: unknown; confidence?: unknown; reason?: unknown }
      : null;
  } catch {
    return null;
  }
}

function sanitizePickedIndices(
  picks: unknown,
  candidateCount: number,
  maxPicks: number,
): number[] {
  if (!Array.isArray(picks)) return [];

  const unique = new Set<number>();
  for (const value of picks) {
    if (!Number.isInteger(value)) continue;
    const index = Number(value);
    if (index < 0 || index >= candidateCount) continue;
    unique.add(index);
    if (unique.size >= maxPicks) break;
  }
  return [...unique];
}

function backfillIndices(
  indices: number[],
  candidateCount: number,
  maxPicks: number,
): number[] {
  if (indices.length >= maxPicks) return indices;

  const seen = new Set(indices);
  const completed = [...indices];
  for (let i = 0; i < candidateCount; i++) {
    if (completed.length >= maxPicks) break;
    if (seen.has(i)) continue;
    seen.add(i);
    completed.push(i);
  }
  return completed;
}

function hasAnyTerm(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function hasDocLikeSignal(result: SearchResult): boolean {
  const title = normalizeMatchText(result.title);
  const snippet = normalizeMatchText(result.snippet);
  const analysis = analyzeResultUrl(result.url);
  const signalText = `${title} ${snippet}`;

  return DOC_SIGNAL_LABELS.size > 0 &&
    (
      analysis?.subdomainLabels.some((label) => DOC_SIGNAL_LABELS.has(label)) ||
      analysis?.pathSegments.some((segment) => DOC_SIGNAL_PATHS.has(segment)) ||
      hasAnyTerm(signalText, ["api", "docs", "documentation", "reference", "guide", "learn"])
    ) === true;
}

function hasReleaseSignal(result: SearchResult): boolean {
  const title = normalizeMatchText(result.title);
  const snippet = normalizeMatchText(result.snippet);
  const analysis = analyzeResultUrl(result.url);
  const signalText = `${title} ${snippet}`;

  return hasAnyTerm(signalText, RELEASE_SIGNAL_TERMS) ||
    analysis?.pathSegments.some((segment) =>
      hasAnyTerm(segment, ["announce", "blog", "changelog", "release", "releases"])
    ) === true;
}

function hasLifecycleSignal(result: SearchResult): boolean {
  const title = normalizeMatchText(result.title);
  const snippet = normalizeMatchText(result.snippet);
  const pageDescription = normalizeMatchText(result.pageDescription);
  return hasAnyTerm(
    `${title} ${snippet} ${pageDescription}`,
    LIFECYCLE_SIGNAL_TERMS,
  );
}

function hasComparisonSignal(result: SearchResult): boolean {
  const title = normalizeMatchText(result.title);
  const snippet = normalizeMatchText(result.snippet);
  return hasAnyTerm(`${title} ${snippet}`, COMPARISON_TERMS);
}

function hostCompoundTermMatches(
  result: SearchResult,
  compoundTerms: string[],
): boolean {
  if (compoundTerms.length === 0) return false;
  const analysis = analyzeResultUrl(result.url);
  if (!analysis) return false;
  return compoundTermMatches(analysis.hostWithoutWww, compoundTerms) > 0 ||
    analysis.subdomainLabels.some((label) =>
      compoundTermMatches(label, compoundTerms) > 0
    );
}

function allowedDomainBoost(
  result: SearchResult,
  allowedDomains?: string[],
): number {
  if (!allowedDomains?.length || !result.url) return 0;
  try {
    const hostname = new URL(result.url).hostname;
    return isAllowedByDomainFilters(hostname, allowedDomains, undefined)
      ? 5
      : 0;
  } catch {
    return 0;
  }
}

function authorityBoost(
  result: SearchResult,
  input: DeterministicSearchSignalInput,
  mode: "selection" | "fetched",
): number {
  const authority = classifySearchResultSource(result, input.allowedDomains);
  const authoritativeBias = Boolean(input.intent?.wantsAuthoritativeBias);

  switch (authority.sourceClass) {
    case "official_docs":
      return authoritativeBias
        ? mode === "fetched" ? 5.5 : 4.5
        : mode === "fetched" ? 3.25 : 2.5;
    case "vendor_docs":
      return authoritativeBias
        ? mode === "fetched" ? 4.5 : 3.5
        : mode === "fetched" ? 2.5 : 1.75;
    case "repo_docs":
      return authoritativeBias
        ? mode === "fetched" ? 3 : 2.25
        : mode === "fetched" ? 1.5 : 1;
    case "technical_article":
      return authoritativeBias
        ? mode === "fetched" ? -1.25 : -1.5
        : 0.5;
    case "forum":
      return mode === "fetched" ? -1.5 : -1;
    case "other":
      return 0;
  }
}

function releaseIntentAuthorityAdjustment(
  result: SearchResult,
  input: DeterministicSearchSignalInput,
  compoundTerms: string[],
): number {
  if (!(input.intent?.wantsReleaseNotes || input.intent?.wantsRecency)) {
    return 0;
  }

  const authority = classifySearchResultSource(result, input.allowedDomains);
  const releaseSignal = hasReleaseSignal(result);
  let score = authority.isAuthoritative
    ? releaseSignal ? 6 : -1.25
    : releaseSignal ? 0.5 : -2.5;
  if (releaseSignal && hostCompoundTermMatches(result, compoundTerms)) {
    score += 5;
  }
  if (hasLifecycleSignal(result)) {
    score -= 3;
  }
  if (releaseSignal && result.publishedDate) {
    score += 0.5;
  }
  if (authority.isCommunity) {
    score -= 1.5;
  }
  return score;
}

function deterministicBaseScore(
  result: SearchResult,
  queryTokens: string[],
  input: DeterministicSearchSignalInput,
): number {
  const title = normalizeMatchText(result.title);
  const snippet = normalizeMatchText(result.snippet);
  const phrase = normalizeMatchText(input.query).trim();
  const compoundTerms = extractCompoundQueryTerms(input.query);
  const titleTokens = new Set(tokenizeSearchText(result.title ?? ""));
  const snippetTokens = new Set(tokenizeSearchText(result.snippet ?? ""));
  const urlTokens = new Set(tokenizeSearchText(result.url ?? ""));
  const candidateText = `${result.title ?? ""} ${result.snippet ?? ""} ${result.url ?? ""}`;

  const titleMatches = matchedTokenCount(titleTokens, queryTokens);
  const snippetMatches = matchedTokenCount(snippetTokens, queryTokens);
  const urlMatches = matchedTokenCount(urlTokens, queryTokens);
  const compoundMatches = compoundTermMatches(candidateText, compoundTerms);

  let score = 0;
  score += titleMatches * 3;
  score += snippetMatches * 1.5;
  score += urlMatches;
  score += compoundMatches * 4;
  score += compoundTermAdjustment(candidateText, compoundTerms);

  if (phrase.length >= 8 && (title.includes(phrase) || snippet.includes(phrase))) {
    score += 2;
  }
  if (result.url?.startsWith("https://")) score += 0.25;
  if (result.publishedDate) score += 0.25;
  if (titleMatches > 0 && snippetMatches > 0) score += 0.5;
  score += allowedDomainBoost(result, input.allowedDomains);
  score += authorityBoost(result, input, "selection");

  if (input.intent?.wantsOfficialDocs || input.intent?.wantsReference) {
    if (hasDocLikeSignal(result)) score += 2.5;
  }
  if (input.intent?.wantsReleaseNotes || input.intent?.wantsRecency) {
    if (hasReleaseSignal(result)) score += 2;
    if (result.publishedDate) score += 0.5;
    score += releaseIntentAuthorityAdjustment(result, input, compoundTerms);
  }
  if (input.intent?.wantsComparison || input.intent?.wantsMultiSourceSynthesis) {
    if (hasComparisonSignal(result)) score += 1.5;
  }

  if ((result.title?.trim().length ?? 0) < 8) score -= 0.5;
  if (!(result.snippet?.trim())) score -= 0.25;

  return score;
}

function deterministicConfidence(topScore?: number): "high" | "medium" | "low" {
  if (topScore === undefined) return "low";
  if (topScore >= 8) return "high";
  if (topScore >= 4) return "medium";
  return "low";
}

function deterministicReason(input: SelectSearchResultsInput, usedAllowedDomain: boolean): string {
  if (usedAllowedDomain) {
    return "Deterministic fallback prioritized allowed domains and query overlap.";
  }
  if (input.intent?.wantsOfficialDocs || input.intent?.wantsReference) {
    return "Deterministic fallback prioritized doc-like results with strong query overlap.";
  }
  if (input.intent?.wantsComparison || input.intent?.wantsMultiSourceSynthesis) {
    return "Deterministic fallback balanced query overlap with host diversity.";
  }
  if (input.intent?.wantsReleaseNotes || input.intent?.wantsRecency) {
    return "Deterministic fallback prioritized query overlap and release-specific signals.";
  }
  return "Deterministic fallback prioritized query overlap and diverse hosts.";
}

interface DeterministicCandidateScore {
  index: number;
  host?: string;
  baseScore: number;
}

function orderDeterministicIndices(
  scored: DeterministicCandidateScore[],
  maxItems: number,
  singleHostBias: boolean,
  diversityPenalty: number,
): number[] {
  const selectedIndices: number[] = [];
  const selectedSet = new Set<number>();
  const hostSelections = new Map<string, number>();

  while (selectedIndices.length < Math.min(maxItems, scored.length)) {
    let best:
      | {
        index: number;
        adjustedScore: number;
      }
      | undefined;

    for (const candidate of scored) {
      if (selectedSet.has(candidate.index)) continue;
      const hostPenalty = candidate.host
        ? (hostSelections.get(candidate.host) ?? 0) * diversityPenalty
        : 0;
      const adjustedScore = candidate.baseScore - hostPenalty;

      if (
        !best ||
        adjustedScore > best.adjustedScore ||
        (adjustedScore === best.adjustedScore && candidate.index < best.index)
      ) {
        best = { index: candidate.index, adjustedScore };
      }
    }

    if (!best) break;

    if (!singleHostBias && selectedIndices.length < 2) {
      let bestUnseenHost:
        | {
          index: number;
          adjustedScore: number;
        }
        | undefined;

      for (const candidate of scored) {
        if (selectedSet.has(candidate.index)) continue;
        const seenCount = candidate.host ? (hostSelections.get(candidate.host) ?? 0) : 0;
        if (seenCount > 0) continue;
        if (
          !bestUnseenHost ||
          candidate.baseScore > bestUnseenHost.adjustedScore ||
          (candidate.baseScore === bestUnseenHost.adjustedScore &&
            candidate.index < bestUnseenHost.index)
        ) {
          bestUnseenHost = {
            index: candidate.index,
            adjustedScore: candidate.baseScore,
          };
        }
      }

      const bestHostSeenCount = scored[best.index]?.host
        ? (hostSelections.get(scored[best.index]!.host!) ?? 0)
        : 0;
      if (
        bestUnseenHost &&
        bestHostSeenCount > 0 &&
        bestUnseenHost.adjustedScore >= best.adjustedScore - 2.5
      ) {
        best = bestUnseenHost;
      }
    }

    selectedIndices.push(best.index);
    selectedSet.add(best.index);
    const host = scored[best.index]?.host;
    if (host) {
      hostSelections.set(host, (hostSelections.get(host) ?? 0) + 1);
    }
  }

  return selectedIndices;
}

function evidenceReason(
  result: SearchResult,
  titleMatches: number,
  snippetMatches: number,
  pageMatches: number,
  passageMatches: number,
): string {
  if ((result.passages?.length ?? 0) > 0 && passageMatches >= Math.max(titleMatches, pageMatches, snippetMatches, 1)) {
    return "Fetched passages matched the query directly.";
  }
  if (result.pageDescription?.trim() && pageMatches > 0) {
    return "Fetched page metadata matched the query.";
  }
  if ((result.passages?.length ?? 0) > 0) {
    return "Fetched passages provided supporting evidence.";
  }
  if (result.snippet?.trim() && snippetMatches > 0) {
    return "Search snippet remained the clearest supporting signal.";
  }
  return "Only limited supporting evidence was available.";
}

function fetchedEvidenceScore(
  result: SearchResult,
  queryTokens: string[],
  input: RankFetchedEvidenceInput,
): {
  score: number;
  evidenceStrength: "high" | "medium" | "low";
  evidenceReason: string;
} {
  const title = normalizeMatchText(result.title);
  const pageDescription = normalizeMatchText(result.pageDescription);
  const passagesText = normalizeMatchText((result.passages ?? []).join(" "));
  const phrase = normalizeMatchText(input.query).trim();
  const compoundTerms = extractCompoundQueryTerms(input.query);
  const titleTokens = new Set(tokenizeSearchText(result.title ?? ""));
  const snippetTokens = new Set(tokenizeSearchText(result.snippet ?? ""));
  const urlTokens = new Set(tokenizeSearchText(result.url ?? ""));
  const pageTokens = new Set(tokenizeSearchText(result.pageDescription ?? ""));
  const passageTokens = new Set(tokenizeSearchText((result.passages ?? []).join(" ")));
  const candidateText =
    `${result.title ?? ""} ${result.snippet ?? ""} ${result.url ?? ""} ${result.pageDescription ?? ""} ${passagesText}`;

  const titleMatches = matchedTokenCount(titleTokens, queryTokens);
  const snippetMatches = matchedTokenCount(snippetTokens, queryTokens);
  const urlMatches = matchedTokenCount(urlTokens, queryTokens);
  const pageMatches = matchedTokenCount(pageTokens, queryTokens);
  const passageMatches = matchedTokenCount(passageTokens, queryTokens);
  const compoundMatches = compoundTermMatches(candidateText, compoundTerms);
  const hasPassages = (result.passages?.length ?? 0) > 0;
  const hasEvidence = hasStructuredEvidence(result);

  let score = 0;
  score += titleMatches * 2;
  score += snippetMatches * 0.75;
  score += urlMatches * 0.5;
  score += pageMatches * 2.25;
  score += passageMatches * 3;
  score += compoundMatches * 3.5;
  score += compoundTermAdjustment(candidateText, compoundTerms);

  if (phrase.length >= 8 &&
    (title.includes(phrase) || pageDescription.includes(phrase) || passagesText.includes(phrase))
  ) {
    score += 2;
  }

  if (hasPassages) score += 4 + Math.min(2, result.passages!.length);
  else if (result.pageDescription?.trim()) score += 2;

  if (result.url?.startsWith("https://")) score += 0.25;
  if (result.publishedDate) score += 0.25;
  score += allowedDomainBoost(result, input.allowedDomains) * 0.6;
  score += authorityBoost(result, input, "fetched");

  if (input.intent?.wantsOfficialDocs || input.intent?.wantsReference) {
    if (hasDocLikeSignal(result)) score += 2;
  }
  if (input.intent?.wantsReleaseNotes || input.intent?.wantsRecency) {
    if (hasReleaseSignal(result)) score += 1.5;
    if (result.publishedDate) score += 0.5;
    score += releaseIntentAuthorityAdjustment(result, input, compoundTerms);
  }
  if (input.intent?.wantsComparison || input.intent?.wantsMultiSourceSynthesis) {
    if (hasComparisonSignal(result)) score += 1.25;
  }

  if (!hasEvidence) score -= 1.5;

  const evidenceStrength: "high" | "medium" | "low" = hasPassages && score >= 10
    ? "high"
    : hasEvidence && score >= 5
    ? "medium"
    : "low";

  return {
    score,
    evidenceStrength,
    evidenceReason: evidenceReason(
      result,
      titleMatches,
      snippetMatches,
      pageMatches,
      passageMatches,
    ),
  };
}

function annotateFetchedResult(
  result: SearchResult,
  evidenceStrength: "high" | "medium" | "low",
  evidenceReason: string,
): SearchResult {
  return {
    ...result,
    evidenceStrength,
    evidenceReason,
  };
}

function prefersSingleHostBias(input: DeterministicSearchSignalInput): boolean {
  return prefersSingleHostSources(
    input.query,
    input.intent,
    input.allowedDomains,
  );
}

export function buildDeterministicSearchResultScorer(
  input: DeterministicSearchSignalInput,
): (result: SearchResult) => number {
  const queryTokens = selectorTokens(input.query, input.allowedDomains, input.intent);
  return (result: SearchResult) =>
    deterministicBaseScore(result, queryTokens, input);
}

export function selectSearchResultsDeterministically(
  input: SelectSearchResultsInput,
): SearchSelectionResult {
  const candidates = input.results.slice(0, MAX_SELECTOR_CANDIDATES);
  if (candidates.length === 0 || input.maxPicks <= 0) {
    return {
      picks: [],
      pickedIndices: [],
      confidence: "low",
      reason: "No candidates available.",
      strategy: "deterministic",
    };
  }

  const scoreResult = buildDeterministicSearchResultScorer(input);
  const scored = candidates.map((result, index) => {
    const analysis = analyzeResultUrl(result.url);
    return {
      index,
      host: analysis?.hostWithoutWww ?? analysis?.host,
      allowedDomainMatch: allowedDomainBoost(result, input.allowedDomains) > 0,
      baseScore: scoreResult(result),
    };
  });

  const singleHostBias = prefersSingleHostBias(input);
  const diversityPenalty = singleHostBias
    ? 0.75
    : input.intent?.wantsComparison || input.intent?.wantsMultiSourceSynthesis
    ? 2.5
    : 2;
  const selectedIndices = orderDeterministicIndices(
    scored,
    Math.min(input.maxPicks, scored.length),
    singleHostBias,
    diversityPenalty,
  );

  const pickedIndices = backfillIndices(
    selectedIndices,
    candidates.length,
    input.maxPicks,
  );
  const topScore = pickedIndices.length > 0
    ? scored[pickedIndices[0]]?.baseScore
    : undefined;
  const usedAllowedDomain = pickedIndices.some((index) =>
    scored[index]?.allowedDomainMatch === true
  );

  return {
    picks: pickedIndices.map((index) => candidates[index]),
    pickedIndices,
    confidence: deterministicConfidence(topScore),
    reason: deterministicReason(input, usedAllowedDomain),
    strategy: "deterministic",
  };
}

export function rankFetchedEvidenceDeterministically(
  input: RankFetchedEvidenceInput,
): RankedFetchedEvidenceResult {
  if (input.results.length === 0) {
    return {
      results: [],
      confidence: "low",
      reason: "No fetched results were available to rank.",
    };
  }

  const queryTokens = selectorTokens(input.query, input.allowedDomains, input.intent);
  const scored = input.results.map((result, index) => {
    const analysis = analyzeResultUrl(result.url);
    const evidence = fetchedEvidenceScore(result, queryTokens, input);
    return {
      index,
      host: analysis?.hostWithoutWww ?? analysis?.host,
      baseScore: evidence.score,
      annotated: annotateFetchedResult(
        result,
        evidence.evidenceStrength,
        evidence.evidenceReason,
      ),
    };
  });

  const singleHostBias = prefersSingleHostBias({
    query: input.query,
    allowedDomains: input.allowedDomains,
    intent: input.intent,
  });
  const diversityPenalty = singleHostBias
    ? 0.5
    : input.intent?.wantsComparison || input.intent?.wantsMultiSourceSynthesis
    ? 1.75
    : 1;

  const orderedIndices = backfillIndices(
    orderDeterministicIndices(
      scored,
      scored.length,
      singleHostBias,
      diversityPenalty,
    ),
    scored.length,
    scored.length,
  );
  const topScore = orderedIndices.length > 0
    ? scored[orderedIndices[0]]?.baseScore
    : undefined;

  return {
    results: orderedIndices.map((index) => scored[index].annotated),
    confidence: deterministicConfidence(topScore),
    reason: "Deterministic post-fetch evidence ranking prioritized extracted evidence and direct query coverage.",
  };
}

// ============================================================
// LLM Evidence Reordering (Frontier only)
// ============================================================

export interface ReorderFetchedEvidenceInput extends RankFetchedEvidenceInput {
  annotated: SearchResult[];
  toolOptions?: ToolExecutionOptions;
}

const REORDER_EVIDENCE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "reorder_evidence",
    description:
      "Reorder pre-annotated fetched search results by semantic relevance to the query.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        order: {
          type: "array",
          description:
            "Zero-based indices of annotated results in best-to-worst order.",
          items: { type: "integer", minimum: 0 },
        },
        confidence: {
          type: "string",
          enum: ["high", "medium", "low"],
        },
        reason: {
          type: "string",
          description: "One short sentence explaining the reordering rationale.",
        },
      },
      required: ["order", "confidence", "reason"],
    },
  },
};

function buildReorderMessages(
  input: ReorderFetchedEvidenceInput,
): Message[] {
  const candidates = input.annotated
    .map((result, index) => {
      const strength = result.evidenceStrength?.toUpperCase() ?? "UNKNOWN";
      const passages = (result.passages ?? []).slice(0, 2).join(" | ").slice(0, 200);
      const desc = result.pageDescription?.slice(0, 120) ?? "";
      const snippet = result.snippet?.slice(0, 120) ?? "";
      return `[${index}] ${result.title} | evidence: ${strength}\n  url: ${result.url ?? "unknown"}\n  passages: ${passages || "(none)"}\n  desc: ${desc || snippet}`;
    })
    .join("\n\n");

  return [
    {
      role: "system",
      content:
        "You are reordering fetched web search results by semantic relevance. " +
        "Each result already has evidence annotations. Your job is to reorder them so the most query-relevant result comes first. " +
        "Return only the function call. Do not answer the user question.",
    },
    {
      role: "user",
      content:
        `Query: ${input.query}\n` +
        `Results to reorder (${input.annotated.length}):\n\n` +
        candidates,
    },
  ];
}

export async function reorderFetchedEvidenceWithLlm(
  input: ReorderFetchedEvidenceInput,
): Promise<RankedFetchedEvidenceResult> {
  if (input.annotated.length <= 1) {
    return {
      results: input.annotated,
      confidence: input.annotated.length === 1 ? "medium" : "low",
      reason: "Single or no results — no reordering needed.",
    };
  }

  const response = await ai.chatStructured(
    buildReorderMessages(input),
    {
      model: input.toolOptions?.modelId,
      signal: input.toolOptions?.signal,
      temperature: 0,
      maxTokens: 200,
      tools: [REORDER_EVIDENCE_TOOL],
    },
  );

  const toolCall = response.toolCalls?.find((call) =>
    call.function?.name === REORDER_EVIDENCE_TOOL.function.name
  );
  const args = parseToolArguments(toolCall?.function?.arguments);
  if (!args) {
    throw new ValidationError(
      "LLM reorder returned no structured response.",
      "search_web",
    );
  }

  const rawOrder = Array.isArray(args.picks) ? args.picks : (args as Record<string, unknown>).order;
  const indices = sanitizePickedIndices(
    rawOrder,
    input.annotated.length,
    input.annotated.length,
  );
  // Backfill any missing indices to preserve all results
  const fullOrder = backfillIndices(indices, input.annotated.length, input.annotated.length);

  const confidence = args.confidence === "high" || args.confidence === "medium" || args.confidence === "low"
    ? args.confidence
    : "medium";
  const reason = typeof args.reason === "string" && args.reason.trim()
    ? args.reason.trim()
    : "LLM reordered fetched evidence by semantic relevance.";

  return {
    results: fullOrder.map((index) => input.annotated[index]),
    confidence,
    reason,
  };
}

export async function selectSearchResultsWithLlm(
  input: SelectSearchResultsInput,
): Promise<SearchSelectionResult> {
  const candidates = input.results.slice(0, MAX_SELECTOR_CANDIDATES);
  if (candidates.length === 0 || input.maxPicks <= 0) {
    return {
      picks: [],
      pickedIndices: [],
      confidence: "low",
      reason: "No candidates available.",
      strategy: "llm",
    };
  }

  const response = await ai.chatStructured(
    buildSelectionMessages(input),
    {
      model: input.toolOptions?.modelId,
      signal: input.toolOptions?.signal,
      temperature: 0,
      maxTokens: 200,
      tools: [SELECT_RESULTS_TOOL],
    },
  );

  const toolCall = response.toolCalls?.find((call) =>
    call.function?.name === SELECT_RESULTS_TOOL.function.name
  );
  const args = parseToolArguments(toolCall?.function?.arguments);
  if (!args) {
    throw new ValidationError(
      "LLM selector returned no structured selection.",
      "search_web",
    );
  }

  const confidence = args.confidence === "high" || args.confidence === "medium" || args.confidence === "low"
    ? args.confidence
    : "medium";
  const reason = typeof args.reason === "string" && args.reason.trim()
    ? args.reason.trim()
    : "LLM selected the most relevant results to fetch first.";
  const pickedIndices = backfillIndices(
    sanitizePickedIndices(args.picks, candidates.length, input.maxPicks),
    candidates.length,
    input.maxPicks,
  );

  return {
    picks: pickedIndices.map((index) => candidates[index]),
    pickedIndices,
    confidence,
    reason,
    strategy: "llm",
  };
}
