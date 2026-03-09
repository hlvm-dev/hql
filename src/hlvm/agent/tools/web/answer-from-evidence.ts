import type { SearchResult } from "./search-provider.ts";
import type { SearchQueryIntent } from "./query-strategy.ts";
import { scorePassage, tokenizeQuery } from "./search-ranking.ts";
import { hasStructuredEvidence } from "./web-utils.ts";
import { classifySearchResultSource } from "./source-authority.ts";

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
  sourceClass?: SearchResult["sourceClass"];
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
  allowedDomains?: string[];
}

interface EvidenceCandidate {
  result: SearchResult;
  text: string;
  score: number;
  sourceKind: "passage" | "pageDescription" | "snippet";
  authorityScore: number;
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

function resultEvidenceEntries(
  result: SearchResult,
): Array<{ text: string; sourceKind: EvidenceCandidate["sourceKind"] }> {
  const entries: Array<{ text: string; sourceKind: EvidenceCandidate["sourceKind"] }> = [];
  for (const passage of result.passages ?? []) {
    if (passage.trim()) {
      entries.push({ text: passage.trim(), sourceKind: "passage" });
    }
  }
  if (result.pageDescription?.trim()) {
    entries.push({
      text: result.pageDescription.trim(),
      sourceKind: "pageDescription",
    });
  }
  if (entries.length === 0 && result.snippet?.trim()) {
    entries.push({ text: result.snippet.trim(), sourceKind: "snippet" });
  }
  return entries;
}

function isDirectQuestion(query: string): boolean {
  return /^(?:what|how|why|when|where|which|who)\b/i.test(query.trim());
}

function scoreAnswerCandidate(
  query: string,
  sentence: string,
  sourceKind: EvidenceCandidate["sourceKind"],
  authorityScore: number,
): number {
  let score = 0;
  if (sourceKind === "passage") score += 0.75;
  if (sourceKind === "pageDescription") score += 0.25;
  score += authorityScore * 0.5;

  if (/(?:https?:\/\/|www\.)/i.test(sentence)) {
    score -= 6;
  }

  if (isDirectQuestion(query)) {
    const hasDefinitionLike =
      /\b(?:is|are)\s+(?:a|an|the|one of|used|called|defined|known|considered)\b/i
        .test(sentence);
    const hasExplanatoryVerb =
      /\b(?:allows|enables|ensures|prevents|causes|triggers|handles|manages|provides|returns|invokes|executes|runs|calls|performs|processes)\b/i
        .test(sentence);
    const hasCausalTimingContext =
      /\b(?:when|whenever|before|after|during|because|since|so that|in order to|once|until)\b/i
        .test(sentence);

    // 1. Definitional copula: "X is a Y", "X are used for Y"
    if (hasDefinitionLike) {
      score += 1.5;
    }
    // 2. Explanatory verbs: sentence describes mechanism/behavior
    if (hasExplanatoryVerb) {
      score += 0.75;
    }
    // 3. Causal/temporal connectors: explains when/why/how
    if (hasCausalTimingContext && (hasDefinitionLike || hasExplanatoryVerb)) {
      score += 0.5;
    }
    // 4. Fluff/listicle penalty
    if (
      /^\d+\s+(?:ways?|tips?|tricks?|things?|reasons?|examples?|best|top|essential)\b/i.test(sentence) ||
      /\b(?:everything you need to know|complete guide|ultimate guide|definitive guide|step[- ]by[- ]step)\b/i.test(sentence) ||
      /\b(?:powerful tool|amazing|incredible|game[- ]?chang|revolutionary|must[- ]have)\b/i.test(sentence)
    ) {
      score -= 3;
    }
    // 5. Title-echo penalty: article headline fragments, not content
    if (
      /^(?:understanding|exploring|mastering|learn(?:ing)?|discover(?:ing)?|introduction|intro|getting started|overview|table of contents|example use)\b/i
        .test(sentence) ||
      /\b(?:your original request)\b/i.test(sentence)
    ) {
      score -= 2;
    }
  }

  return score;
}

function collectEvidenceCandidates(
  query: string,
  results: SearchResult[],
  allowedDomains?: string[],
): EvidenceCandidate[] {
  const tokens = tokenizeQuery(query);
  const seen = new Set<string>();
  const candidates: EvidenceCandidate[] = [];

  for (const result of results) {
    const authority = classifySearchResultSource(result, allowedDomains);
    for (const evidence of resultEvidenceEntries(result)) {
      const evidenceText = evidence.text;
      for (const sentence of splitSentences(evidenceText)) {
        const key = `${result.url ?? ""}|${sentence.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const score = scorePassage(sentence.toLowerCase(), tokens) +
          scoreAnswerCandidate(
            query,
            sentence,
            evidence.sourceKind,
            authority.authorityScore,
          );
        if (score <= 0) continue;
        candidates.push({
          result,
          text: sentence,
          score,
          sourceKind: evidence.sourceKind,
          authorityScore: authority.authorityScore,
        });
      }
    }
  }

  return candidates.sort((a, b) =>
    b.score - a.score ||
    b.authorityScore - a.authorityScore ||
    sourceKindRank(b.sourceKind) - sourceKindRank(a.sourceKind) ||
    evidenceRank(b.result) - evidenceRank(a.result) ||
    (a.result.url ?? "").localeCompare(b.result.url ?? "")
  );
}

function sourceKindRank(kind: EvidenceCandidate["sourceKind"]): number {
  switch (kind) {
    case "passage":
      return 3;
    case "pageDescription":
      return 2;
    case "snippet":
      return 1;
  }
}

function directAnswerOrderScore(text: string): number {
  let score = 0;
  // Definite noun phrase opener: "The X does Y"
  if (/^(?:The|A|An)\s+\w/i.test(text)) score += 1.5;
  // Definitional copula: "X is/are a/an/the Y"
  if (/\b\w+\s+(?:is|are)\s+(?:a|an|the|one of|used|called|defined|known)\b/i.test(text)) score += 2;
  // Demonstrative + verb: "It allows...", "This ensures..."
  if (/^(?:It|This|That)\s+(?:is|are|was|allows|enables|ensures|provides|returns|means|refers)\b/i.test(text)) score += 1;
  return score;
}

function isSelfContainedDirectAnswer(query: string, sentence: string): boolean {
  if (!isDirectQuestion(query)) return false;
  if (sentence.length < 60) return false;
  // Must define/classify something
  const hasDefinition = /\b(?:is|are|was|were|means|refers to|represents|denotes|involves|consists of|serves as|functions as)\b/i
    .test(sentence);
  // Must also explain behavior/purpose/timing
  const hasExplanation = /\b(?:when|whenever|before|after|during|once|until|because|since|so that|in order to|if|unless|by|allows|enables|ensures|prevents|causes|triggers|which|that)\b/i
    .test(sentence) || /\bfor\s+\w+ing\b/i.test(sentence);
  return hasDefinition && hasExplanation;
}

function evidenceRank(result: SearchResult): number {
  if (result.evidenceStrength === "high") return 3;
  if (result.evidenceStrength === "medium") return 2;
  if (result.evidenceStrength === "low") return 1;
  if ((result.passages?.length ?? 0) > 0) return 2;
  if (result.pageDescription?.trim()) return 1;
  return 0;
}

function rankResults(
  results: SearchResult[],
  allowedDomains?: string[],
): SearchResult[] {
  return [...results].sort((a, b) =>
    evidenceRank(b) - evidenceRank(a) ||
    classifySearchResultSource(b, allowedDomains).authorityScore -
      classifySearchResultSource(a, allowedDomains).authorityScore ||
    ((b.passages?.length ?? 0) - (a.passages?.length ?? 0)) ||
    ((a.fetchPriority ?? Number.MAX_SAFE_INTEGER) -
      (b.fetchPriority ?? Number.MAX_SAFE_INTEGER)) ||
    (a.url ?? "").localeCompare(b.url ?? "")
  );
}

function toSources(
  results: SearchResult[],
  allowedDomains?: string[],
): DeterministicAnswerSource[] {
  return results
    .filter((result) => result.url)
    .slice(0, MAX_SOURCES)
    .map((result) => ({
      url: result.url!,
      title: result.title,
      evidenceStrength: result.evidenceStrength,
      publishedDate: result.publishedDate,
      sourceClass: classifySearchResultSource(result, allowedDomains).sourceClass,
    }));
}

function buildDirectAnswer(
  query: string,
  ranked: SearchResult[],
  candidates: EvidenceCandidate[],
): { text: string; mode: DeterministicAnswerMode } {
  const selectedCandidates = candidates.slice(0, MAX_DIRECT_SENTENCES);
  if (isDirectQuestion(query)) {
    selectedCandidates.sort((a, b) =>
      directAnswerOrderScore(b.text) - directAnswerOrderScore(a.text) ||
      b.authorityScore - a.authorityScore ||
      b.score - a.score
    );
  }
  const [topCandidate, nextCandidate] = selectedCandidates;
  if (topCandidate && isSelfContainedDirectAnswer(query, topCandidate.text)) {
    return { text: topCandidate.text, mode: "direct" };
  }
  if (
    topCandidate &&
    nextCandidate &&
    (topCandidate.score >= nextCandidate.score + 2.5 ||
      topCandidate.authorityScore >= nextCandidate.authorityScore + 2)
  ) {
    return { text: topCandidate.text, mode: "direct" };
  }
  const selected = selectedCandidates.map((item) => item.text);
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
    input.allowedDomains,
  );
  if (ranked.length === 0) return undefined;

  const candidates = collectEvidenceCandidates(
    input.query,
    ranked,
    input.allowedDomains,
  );
  const hasGroundedEvidence = ranked.some((result) => hasStructuredEvidence(result));
  const built = !hasGroundedEvidence && input.lowConfidence
    ? buildInsufficientEvidenceAnswer(
      "Available evidence is limited. The fetched sources did not expose enough grounded text to produce a strong answer.",
    )
    : input.intent?.wantsRecency || input.intent?.wantsReleaseNotes
    ? buildRecencyAnswer(ranked)
    : input.intent?.wantsComparison || input.intent?.wantsMultiSourceSynthesis
    ? buildComparisonAnswer(ranked)
    : buildDirectAnswer(input.query, ranked, candidates);

  return {
    text: built.text,
    mode: built.mode,
    confidence: resolveConfidence(ranked, input.lowConfidence, built.mode),
    strategy: input.modelTier === "weak" ? "deterministic" : "llm_polish",
    sources: toSources(ranked, input.allowedDomains),
  };
}
