/**
 * Citation span attribution utilities.
 *
 * Goal:
 * - Build a reusable source index from web tool results.
 * - Attribute final response sentence spans to the best matching source.
 */

import type { Citation } from "./search-provider.ts";

export type CitationSourceKind = "snippet" | "passage";

export interface CitationSourceEntry {
  citation: Citation;
  sourceKind: CitationSourceKind;
  sourceText: string;
  tokens: string[];
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

function isObjectValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function tokenize(input: string): string[] {
  const tokens = normalizeText(input)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  return [...new Set(tokens)];
}

function makeCitation(
  url: unknown,
  title: unknown,
  excerpt: unknown,
  provider: unknown,
): Citation | null {
  if (typeof url !== "string" || !url.trim()) return null;
  return {
    url: url.trim(),
    title: typeof title === "string" ? title : "",
    excerpt: typeof excerpt === "string" ? excerpt : undefined,
    provider: typeof provider === "string" ? provider : undefined,
  };
}

function addSourceEntry(
  entries: CitationSourceEntry[],
  seen: Set<string>,
  citation: Citation | null,
  sourceKind: CitationSourceKind,
  text: unknown,
): void {
  if (!citation || typeof text !== "string") return;
  const sourceText = normalizeText(text);
  if (sourceText.length < MIN_SOURCE_TEXT_CHARS) return;
  const tokens = tokenize(sourceText);
  if (tokens.length < DEFAULT_MIN_SHARED_TOKENS) return;

  const key = `${citation.url}|${sourceKind}|${sourceText.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  entries.push({ citation, sourceKind, sourceText, tokens });
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
    const citation = makeCitation(
      item.url,
      item.title,
      item.snippet,
      provider,
    );
    addSourceEntry(entries, seen, citation, "snippet", item.snippet);
    addSourceEntry(entries, seen, citation, "passage", item.pageDescription);
    const passages = Array.isArray(item.passages) ? item.passages : [];
    for (const passage of passages) {
      addSourceEntry(entries, seen, citation, "passage", passage);
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
    );
    addSourceEntry(
      entries,
      seen,
      citation,
      "snippet",
      rawCitation.excerpt,
    );
  }
}

function collectFromFetchLikePayload(
  payload: Record<string, unknown>,
  entries: CitationSourceEntry[],
  seen: Set<string>,
): void {
  const citation = makeCitation(payload.url, payload.title, payload.description, "fetch");
  addSourceEntry(entries, seen, citation, "passage", payload.text);

  const citations = Array.isArray(payload.citations) ? payload.citations : [];
  for (const rawCitation of citations) {
    if (!isObjectValue(rawCitation)) continue;
    const c = makeCitation(
      rawCitation.url,
      rawCitation.title,
      rawCitation.excerpt,
      rawCitation.provider,
    );
    addSourceEntry(entries, seen, c, "snippet", rawCitation.excerpt);
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

function splitSentenceSpans(text: string): Array<{ start: number; end: number; text: string }> {
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
      if (previous.sourceKind !== "passage" && current.sourceKind === "passage") {
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
    if (sentenceTokens.length < minSharedTokens) continue;
    const sentenceTokenSet = new Set(sentenceTokens);

    let best:
      | {
        entry: CitationSourceEntry;
        score: number;
      }
      | null = null;

    for (const candidate of sourceWithSets) {
      const shared = intersectionCount(sentenceTokens, candidate.tokenSet);
      if (shared < minSharedTokens) continue;
      const unionSize = new Set([...sentenceTokenSet, ...candidate.tokenSet]).size;
      if (unionSize === 0) continue;
      const jaccard = shared / unionSize;
      const coverage = shared / sentenceTokens.length;
      const score = (jaccard * 0.7) + (coverage * 0.3);
      if (!best || score > best.score) {
        best = { entry: candidate, score };
      }
    }

    if (!best || best.score < minScore) continue;
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

