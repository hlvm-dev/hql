import type { SearchResult } from "./search-provider.ts";
import type { SearchQueryIntent } from "./query-strategy.ts";
import { scorePassage, tokenizeQuery } from "./search-ranking.ts";
import { hasStructuredEvidence } from "./web-utils.ts";

export type DeterministicAnswerMode =
  | "direct"
  | "comparison"
  | "recency"
  | "insufficient_evidence";

export interface DeterministicAnswerSource {
  url: string;
  title: string;
  evidenceStrength?: "high" | "medium" | "low";
  publishedDate?: string;
}

export interface DeterministicAnswerDraft {
  text: string;
  confidence: "high" | "medium" | "low";
  mode: DeterministicAnswerMode;
  strategy: "deterministic" | "llm_polish";
  sources: DeterministicAnswerSource[];
}

interface BuildDeterministicAnswerInput {
  query: string;
  results: SearchResult[];
  intent?: SearchQueryIntent;
  lowConfidence?: boolean;
  modelTier?: "weak" | "mid" | "frontier";
}

interface EvidenceCandidate {
  result: SearchResult;
  text: string;
  score: number;
}

const MAX_DIRECT_SENTENCES = 2;
const MAX_COMPARE_ROWS = 3;
const MAX_RECENCY_ROWS = 3;
const MAX_SOURCES = 3;

function cleanSentence(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function splitSentences(value: string): string[] {
  return value
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map(cleanSentence)
    .filter((sentence) => sentence.length >= 24);
}

function resultEvidenceTexts(result: SearchResult): string[] {
  const texts = [...(result.passages ?? [])];
  if (result.pageDescription?.trim()) texts.push(result.pageDescription.trim());
  if (texts.length === 0 && result.snippet?.trim()) texts.push(result.snippet.trim());
  return texts;
}

function collectEvidenceCandidates(
  query: string,
  results: SearchResult[],
): EvidenceCandidate[] {
  const tokens = tokenizeQuery(query);
  const seen = new Set<string>();
  const candidates: EvidenceCandidate[] = [];

  for (const result of results) {
    for (const evidenceText of resultEvidenceTexts(result)) {
      for (const sentence of splitSentences(evidenceText)) {
        const key = `${result.url ?? ""}|${sentence.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const score = scorePassage(sentence.toLowerCase(), tokens);
        if (score <= 0) continue;
        candidates.push({ result, text: sentence, score });
      }
    }
  }

  return candidates.sort((a, b) =>
    b.score - a.score ||
    evidenceRank(b.result) - evidenceRank(a.result) ||
    (a.result.url ?? "").localeCompare(b.result.url ?? "")
  );
}

function evidenceRank(result: SearchResult): number {
  if (result.evidenceStrength === "high") return 3;
  if (result.evidenceStrength === "medium") return 2;
  if (result.evidenceStrength === "low") return 1;
  if ((result.passages?.length ?? 0) > 0) return 2;
  if (result.pageDescription?.trim()) return 1;
  return 0;
}

function rankResults(results: SearchResult[]): SearchResult[] {
  return [...results].sort((a, b) =>
    evidenceRank(b) - evidenceRank(a) ||
    ((b.passages?.length ?? 0) - (a.passages?.length ?? 0)) ||
    ((a.fetchPriority ?? Number.MAX_SAFE_INTEGER) -
      (b.fetchPriority ?? Number.MAX_SAFE_INTEGER)) ||
    (a.url ?? "").localeCompare(b.url ?? "")
  );
}

function toSources(results: SearchResult[]): DeterministicAnswerSource[] {
  return results
    .filter((result) => result.url)
    .slice(0, MAX_SOURCES)
    .map((result) => ({
      url: result.url!,
      title: result.title,
      evidenceStrength: result.evidenceStrength,
      publishedDate: result.publishedDate,
    }));
}

function buildDirectAnswer(
  ranked: SearchResult[],
  candidates: EvidenceCandidate[],
): { text: string; mode: DeterministicAnswerMode } {
  const selected = candidates.slice(0, MAX_DIRECT_SENTENCES).map((item) => item.text);
  if (selected.length > 0) {
    return { text: selected.join(" "), mode: "direct" };
  }

  const fallback = ranked[0];
  const fallbackText = resultEvidenceTexts(fallback).map(cleanSentence).find(Boolean);
  if (fallbackText) {
    return { text: fallbackText, mode: "direct" };
  }

  return {
    text: "Available evidence is limited. The fetched sources did not expose enough grounded text to produce a strong answer.",
    mode: "insufficient_evidence",
  };
}

function buildComparisonAnswer(ranked: SearchResult[]): { text: string; mode: DeterministicAnswerMode } {
  const lines = ranked
    .slice(0, MAX_COMPARE_ROWS)
    .map((result) => {
      const excerpt = resultEvidenceTexts(result).map(cleanSentence).find(Boolean) ??
        "Limited extracted evidence.";
      return `- ${result.title}: ${excerpt}`;
    });
  if (lines.length === 0) {
    return {
      text: "Available evidence is limited. The fetched sources did not expose enough grounded text to compare reliably.",
      mode: "insufficient_evidence",
    };
  }
  return {
    text: `Comparison from fetched evidence:\n${lines.join("\n")}`,
    mode: "comparison",
  };
}

function buildRecencyAnswer(ranked: SearchResult[]): { text: string; mode: DeterministicAnswerMode } {
  const rows = ranked
    .filter((result) => result.publishedDate || hasStructuredEvidence(result))
    .slice(0, MAX_RECENCY_ROWS)
    .map((result) => {
      const label = result.publishedDate ? `${result.publishedDate} — ` : "";
      const excerpt = resultEvidenceTexts(result).map(cleanSentence).find(Boolean) ??
        "Limited extracted evidence.";
      return `- ${label}${result.title}: ${excerpt}`;
    });

  if (rows.length === 0) {
    return {
      text: "Available evidence is limited. The fetched sources did not expose enough dated evidence to summarize recency confidently.",
      mode: "insufficient_evidence",
    };
  }

  return {
    text: `Latest fetched evidence:\n${rows.join("\n")}`,
    mode: "recency",
  };
}

function buildInsufficientEvidenceAnswer(
  message: string,
): { text: string; mode: DeterministicAnswerMode } {
  return {
    text: message,
    mode: "insufficient_evidence",
  };
}

function resolveConfidence(
  ranked: SearchResult[],
  lowConfidence: boolean | undefined,
  mode: DeterministicAnswerMode,
): "high" | "medium" | "low" {
  if (mode === "insufficient_evidence") return "low";
  if (lowConfidence) return "low";
  const top = ranked[0];
  if (!top) return "low";
  if (top.evidenceStrength === "high") return "high";
  if (top.evidenceStrength === "medium" || hasStructuredEvidence(top)) return "medium";
  return "low";
}

export function buildDeterministicAnswer(
  input: BuildDeterministicAnswerInput,
): DeterministicAnswerDraft | undefined {
  const ranked = rankResults(
    input.results.filter((result) =>
      result.selectedForFetch === true || hasStructuredEvidence(result)
    ),
  );
  if (ranked.length === 0) return undefined;

  const candidates = collectEvidenceCandidates(input.query, ranked);
  const hasGroundedEvidence = ranked.some((result) => hasStructuredEvidence(result));
  const built = !hasGroundedEvidence && input.lowConfidence
    ? buildInsufficientEvidenceAnswer(
      "Available evidence is limited. The fetched sources did not expose enough grounded text to produce a strong answer.",
    )
    : input.intent?.wantsRecency || input.intent?.wantsReleaseNotes
    ? buildRecencyAnswer(ranked)
    : input.intent?.wantsComparison || input.intent?.wantsMultiSourceSynthesis
    ? buildComparisonAnswer(ranked)
    : buildDirectAnswer(ranked, candidates);

  return {
    text: built.text,
    mode: built.mode,
    confidence: resolveConfidence(ranked, input.lowConfidence, built.mode),
    strategy: input.modelTier === "weak" ? "deterministic" : "llm_polish",
    sources: toSources(ranked),
  };
}
