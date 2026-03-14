/**
 * Citation span attribution utilities.
 *
 * Goal:
 * - Build a reusable source index from web tool results.
 * - Attribute final response sentence spans to the best matching source.
 */

import type { Citation } from "./search-provider.ts";
import type { LLMSource } from "../../tool-call.ts";
import { isObjectValue } from "../../../../common/utils.ts";

export type CitationSourceKind = "snippet" | "passage";

export interface CitationSourceEntry {
  citation: Citation;
  sourceKind: CitationSourceKind;
  sourceText: string;
  tokens: string[];
  evidenceStrength?: "high" | "medium" | "low";
  evidenceReason?: string;
  evidenceRank: number;
}

export interface CitationSpan {
  citation: Citation;
  startIndex: number;
  endIndex: number;
  confidence: number;
  spanText: string;
  sourceKind: CitationSourceKind;
}

export interface CitationAttributionOptions {
  minScore?: number;
  minSharedTokens?: number;
}

export interface ToolResultForCitation {
  toolName: string;
  result?: unknown;
}

const DEFAULT_MIN_SCORE = 0.3;
const DEFAULT_MIN_SHARED_TOKENS = 3;
const MIN_SOURCE_TEXT_CHARS = 24;
const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "because",
  "before",
  "could",
  "from",
  "have",
  "into",
  "many",
  "might",
  "more",
  "most",
  "other",
  "should",
  "some",
  "than",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "very",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
]);

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function hasNonAsciiText(input: string): boolean {
  return /[^\x00-\x7F]/.test(input);
}

function minimumSharedTokensForText(input: string): number {
  return hasNonAsciiText(input) ? 1 : DEFAULT_MIN_SHARED_TOKENS;
}

function tokenize(input: string): string[] {
  const tokens = normalizeText(input)
    .toLowerCase()
    .match(/[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)*/gu) ?? [];
  const minLength = hasNonAsciiText(input) ? 1 : 3;
  const filtered = tokens
    .map((token) => token.trim())
    .filter((token) =>
      token.length >= minLength &&
      (!/^[a-z]+$/.test(token) || !STOP_WORDS.has(token))
    );
  return [...new Set(filtered)];
}

function makeCitation(
  url: unknown,
  title: unknown,
  excerpt: unknown,
  provider: unknown,
  options: {
    provenance?: Citation["provenance"];
    sourceId?: string;
    sourceType?: Citation["sourceType"];
    providerMetadata?: Record<string, unknown>;
  } = {},
): Citation | null {
  if (typeof url !== "string" || !url.trim()) return null;
  return {
    url: url.trim(),
    title: typeof title === "string" ? title : "",
    excerpt: typeof excerpt === "string" ? excerpt : undefined,
    provider: typeof provider === "string" ? provider : undefined,
    provenance: options.provenance,
    sourceId: options.sourceId,
    sourceType: options.sourceType,
    providerMetadata: options.providerMetadata,
  };
}

function evidenceStrengthRank(value: unknown): number {
  switch (value) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function addSourceEntry(
  entries: CitationSourceEntry[],
  seen: Set<string>,
  citation: Citation | null,
  sourceKind: CitationSourceKind,
  text: unknown,
  options: {
    evidenceStrength?: "high" | "medium" | "low";
    evidenceReason?: string;
    evidenceRank?: number;
  } = {},
): void {
  if (!citation || typeof text !== "string") return;
  const sourceText = normalizeText(text);
  if (sourceText.length < MIN_SOURCE_TEXT_CHARS) return;
  const tokens = tokenize(sourceText);
  if (tokens.length < minimumSharedTokensForText(sourceText)) return;

  const key = `${citation.url}|${sourceKind}|${sourceText.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  entries.push({
    citation,
    sourceKind,
    sourceText,
    tokens,
    evidenceStrength: options.evidenceStrength,
    evidenceReason: options.evidenceReason,
    evidenceRank: options.evidenceRank ?? evidenceStrengthRank(options.evidenceStrength),
  });
}

function collectFromSearchLikePayload(
  payload: Record<string, unknown>,
  entries: CitationSourceEntry[],
  seen: Set<string>,
): void {
  const provider = payload.provider;
  const results = Array.isArray(payload.results) ? payload.results : [];
  for (const item of results) {
    if (!isObjectValue(item)) continue;
    const evidenceStrength = item.evidenceStrength === "high" || item.evidenceStrength === "medium" || item.evidenceStrength === "low"
      ? item.evidenceStrength
      : undefined;
    const evidenceReason = typeof item.evidenceReason === "string" ? item.evidenceReason : undefined;
    const baseEvidenceRank = evidenceStrengthRank(evidenceStrength) +
      (Array.isArray(item.passages) && item.passages.length > 0 ? 2 : 0) +
      (typeof item.pageDescription === "string" && item.pageDescription.trim().length > 0 ? 1 : 0);
    const citation = makeCitation(
      item.url,
      item.title,
      item.snippet,
      provider,
      { provenance: "retrieval", sourceType: "url" },
    );
    addSourceEntry(entries, seen, citation, "snippet", item.snippet, {
      evidenceStrength,
      evidenceReason,
      evidenceRank: baseEvidenceRank,
    });
    addSourceEntry(entries, seen, citation, "passage", item.pageDescription, {
      evidenceStrength,
      evidenceReason,
      evidenceRank: baseEvidenceRank + 1,
    });
    const passages = Array.isArray(item.passages) ? item.passages : [];
    for (const passage of passages) {
      addSourceEntry(entries, seen, citation, "passage", passage, {
        evidenceStrength,
        evidenceReason,
        evidenceRank: baseEvidenceRank + 2,
      });
    }
  }

  const citations = Array.isArray(payload.citations) ? payload.citations : [];
  for (const rawCitation of citations) {
    if (!isObjectValue(rawCitation)) continue;
    const citation = makeCitation(
      rawCitation.url,
      rawCitation.title,
      rawCitation.excerpt,
      rawCitation.provider,
      { provenance: "retrieval", sourceType: "url" },
    );
    addSourceEntry(
      entries,
      seen,
      citation,
      "snippet",
      rawCitation.excerpt,
      { evidenceRank: 1 },
    );
  }
}

function collectFromFetchLikePayload(
  payload: Record<string, unknown>,
  entries: CitationSourceEntry[],
  seen: Set<string>,
): void {
  const citation = makeCitation(
    payload.url,
    payload.title,
    payload.description,
    "fetch",
    { provenance: "retrieval", sourceType: "url" },
  );
  addSourceEntry(entries, seen, citation, "passage", payload.text, {
    evidenceStrength: "high",
    evidenceReason: "fetched page",
    evidenceRank: 5,
  });

  const citations = Array.isArray(payload.citations) ? payload.citations : [];
  for (const rawCitation of citations) {
    if (!isObjectValue(rawCitation)) continue;
    const c = makeCitation(
      rawCitation.url,
      rawCitation.title,
      rawCitation.excerpt,
      rawCitation.provider,
      { provenance: "retrieval", sourceType: "url" },
    );
    addSourceEntry(entries, seen, c, "snippet", rawCitation.excerpt, {
      evidenceRank: 2,
    });
  }
}

/**
 * Build a citation source index from raw tool results.
 * Accepts successful web tool payloads and extracts snippet/passage text.
 */
export function buildCitationSourceIndex(
  toolResults: ToolResultForCitation[],
): CitationSourceEntry[] {
  const entries: CitationSourceEntry[] = [];
  const seen = new Set<string>();

  for (const item of toolResults) {
    if (!item || !isObjectValue(item.result)) continue;
    if (
      item.toolName !== "search_web" &&
      item.toolName !== "web_fetch" &&
      item.toolName !== "fetch_url"
    ) {
      continue;
    }

    const payload = item.result as Record<string, unknown>;
    collectFromSearchLikePayload(payload, entries, seen);
    collectFromFetchLikePayload(payload, entries, seen);

    const batchResults = Array.isArray(payload.results) ? payload.results : [];
    for (const batchItem of batchResults) {
      if (!isObjectValue(batchItem)) continue;
      collectFromFetchLikePayload(batchItem, entries, seen);
    }
  }

  return entries;
}

export function mapLlmSourcesToCitations(
  sources: LLMSource[] | undefined,
): Citation[] {
  if (!Array.isArray(sources) || sources.length === 0) return [];

  const deduped = new Map<string, Citation>();
  for (const source of sources) {
    if (!source || source.sourceType !== "url" || typeof source.url !== "string" || source.url.length === 0) {
      continue;
    }
    const key = source.url.trim();
    if (deduped.has(key)) continue;
    deduped.set(key, {
      url: key,
      title: source.title ?? key,
      provenance: "provider",
      sourceId: source.id,
      sourceType: source.sourceType,
      providerMetadata: source.providerMetadata,
    });
  }

  return [...deduped.values()];
}

export function buildRetrievalCitations(
  sourceIndex: CitationSourceEntry[] | undefined,
): Citation[] {
  if (!Array.isArray(sourceIndex) || sourceIndex.length === 0) return [];

  const bestByUrl = new Map<string, CitationSourceEntry>();
  for (const entry of sourceIndex) {
    const current = bestByUrl.get(entry.citation.url);
    if (
      !current ||
      entry.evidenceRank > current.evidenceRank ||
      (entry.evidenceRank === current.evidenceRank &&
        entry.sourceKind === "passage" &&
        current.sourceKind !== "passage")
    ) {
      bestByUrl.set(entry.citation.url, entry);
    }
  }

  return [...bestByUrl.values()]
    .sort((a, b) => b.evidenceRank - a.evidenceRank)
    .map((entry) => ({
      ...entry.citation,
      provenance: "retrieval",
      sourceKind: entry.sourceKind,
      confidence: undefined,
      startIndex: undefined,
      endIndex: undefined,
      spanText: undefined,
    }));
}

function splitSentenceSpans(
  text: string,
): Array<{ start: number; end: number; text: string }> {
  const spans: Array<{ start: number; end: number; text: string }> = [];
  const sentenceRegex = /[^.!?\n]+[.!?\n]?/g;
  let match: RegExpExecArray | null;
  while ((match = sentenceRegex.exec(text)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const leftTrim = raw.length - raw.trimStart().length;
    const rightTrim = raw.length - raw.trimEnd().length;
    const start = match.index + leftTrim;
    const end = match.index + raw.length - rightTrim;
    if (end > start) spans.push({ start, end, text: trimmed });
  }
  return spans;
}

function intersectionCount(a: string[], bSet: Set<string>): number {
  let count = 0;
  for (const token of a) {
    if (bSet.has(token)) count++;
  }
  return count;
}

function mergeAdjacentSpans(
  responseText: string,
  spans: CitationSpan[],
): CitationSpan[] {
  if (spans.length <= 1) return spans;
  const merged: CitationSpan[] = [];
  const sorted = [...spans].sort((a, b) => a.startIndex - b.startIndex);
  for (const current of sorted) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.citation.url === current.citation.url &&
      current.startIndex <= previous.endIndex + 1
    ) {
      previous.endIndex = Math.max(previous.endIndex, current.endIndex);
      previous.confidence = Math.max(previous.confidence, current.confidence);
      previous.spanText = responseText
        .slice(previous.startIndex, previous.endIndex)
        .trim();
      if (
        previous.sourceKind !== "passage" && current.sourceKind === "passage"
      ) {
        previous.sourceKind = "passage";
      }
      continue;
    }
    merged.push({ ...current });
  }
  return merged;
}

/**
 * Attribute response sentence spans to indexed citations by token overlap.
 */
export function attributeCitationSpans(
  responseText: string,
  sourceIndex: CitationSourceEntry[],
  options: CitationAttributionOptions = {},
): CitationSpan[] {
  if (!responseText.trim() || sourceIndex.length === 0) return [];
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const minSharedTokens = options.minSharedTokens ?? DEFAULT_MIN_SHARED_TOKENS;
  const sourceWithSets = sourceIndex.map((entry) => ({
    ...entry,
    tokenSet: new Set(entry.tokens),
  }));

  const attributed: CitationSpan[] = [];
  for (const sentence of splitSentenceSpans(responseText)) {
    const sentenceTokens = tokenize(sentence.text);
    const sentenceMinSharedTokens = hasNonAsciiText(sentence.text)
      ? 1
      : minSharedTokens;
    if (sentenceTokens.length < sentenceMinSharedTokens) continue;
    const sentenceTokenSet = new Set(sentenceTokens);

    let best:
      | {
        entry: CitationSourceEntry;
        score: number;
        adjustedScore: number;
      }
      | null = null;
    let runnerUpAdjustedScore = Number.NEGATIVE_INFINITY;

    for (const candidate of sourceWithSets) {
      const sharedTokenThreshold =
        hasNonAsciiText(sentence.text) || hasNonAsciiText(candidate.sourceText)
          ? 1
          : minSharedTokens;
      const shared = intersectionCount(sentenceTokens, candidate.tokenSet);
      if (shared < sharedTokenThreshold) continue;
      // |A union B| = |A| + |B| - |A intersect B| avoids allocating a new Set per candidate.
      const unionSize = sentenceTokenSet.size + candidate.tokenSet.size - shared;
      if (unionSize === 0) continue;
      const jaccard = shared / unionSize;
      const coverage = shared / sentenceTokens.length;
      const score = (jaccard * 0.7) + (coverage * 0.3);
      const adjustedScore = score +
        (candidate.sourceKind === "passage" ? 0.02 : 0) +
        Math.min(0.06, candidate.evidenceRank * 0.01);
      if (!best || adjustedScore > best.adjustedScore) {
        if (best) runnerUpAdjustedScore = Math.max(runnerUpAdjustedScore, best.adjustedScore);
        best = { entry: candidate, score, adjustedScore };
      } else {
        runnerUpAdjustedScore = Math.max(runnerUpAdjustedScore, adjustedScore);
      }
    }

    if (!best || best.score < minScore) continue;
    if (runnerUpAdjustedScore > Number.NEGATIVE_INFINITY && (best.adjustedScore - runnerUpAdjustedScore) < 0.03) {
      continue;
    }
    attributed.push({
      citation: best.entry.citation,
      startIndex: sentence.start,
      endIndex: sentence.end,
      confidence: Number(best.score.toFixed(2)),
      spanText: sentence.text,
      sourceKind: best.entry.sourceKind,
    });
  }

  return mergeAdjacentSpans(responseText, attributed);
}
