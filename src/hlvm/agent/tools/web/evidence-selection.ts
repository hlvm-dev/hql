import type { SearchResult } from "./search-provider.ts";
import {
  domainAuthorityBoost,
  extractResultAgeDays,
  sourceQualityPenalty,
} from "./search-ranking.ts";
import type { SearchQueryIntent } from "./query-strategy.ts";

export type EvidenceStrength = "high" | "medium" | "low";

export interface EvidenceSelectionOptions {
  maxPages?: number;
  intent?: SearchQueryIntent;
}

function resultHost(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function evidenceReason(result: SearchResult, intent?: SearchQueryIntent): string {
  if ((result.passages?.length ?? 0) > 0) return "page passages";
  if (intent?.wantsReleaseNotes && result.publishedDate) return "dated source";
  if (domainAuthorityBoost(result.url ?? "") > 0.2) return "authoritative source";
  if (result.pageDescription) return "page metadata";
  return "snippet only";
}

function hasStrongEvidence(result: SearchResult): boolean {
  return Boolean((result.passages?.length ?? 0) > 0 || result.pageDescription || result.publishedDate);
}

function hasUsableEvidence(
  result: SearchResult,
  intent: SearchQueryIntent | undefined,
  selectedCount: number,
): boolean {
  if (hasStrongEvidence(result)) return true;
  if (intent?.wantsComparison && selectedCount > 0 && Boolean(result.snippet)) return true;
  return false;
}

function evidenceScore(result: SearchResult, intent?: SearchQueryIntent): number {
  const passages = Math.min(2, result.passages?.length ?? 0);
  const authority = domainAuthorityBoost(result.url ?? "") * 8;
  const quality = Math.max(0, 2.5 - sourceQualityPenalty(result));
  const pageDescription = result.pageDescription ? 1.25 : 0;
  const snippet = result.snippet ? 0.5 : 0;
  const published = result.publishedDate ? 1 : 0;
  const recency = intent?.wantsRecency || intent?.wantsReleaseNotes
    ? Math.max(0, 1.5 - ((extractResultAgeDays(result) ?? 999) / 180))
    : 0;
  const docsBias = intent?.wantsOfficialDocs || intent?.wantsReference
    ? authority * 0.6
    : 0;
  const comparisonBias = intent?.wantsComparison && result.passages?.length
    ? 0.75
    : 0;

  return (passages * 2.5) + authority + quality + pageDescription + snippet + published + recency + docsBias +
    comparisonBias;
}

function synthesisScore(result: SearchResult, intent?: SearchQueryIntent): number {
  const evidence = evidenceScore(result, intent);
  const passageBias = (result.passages?.length ?? 0) > 0 ? 2 : 0;
  const descriptionBias = result.pageDescription ? 0.75 : 0;
  const datedBias = (intent?.wantsRecency || intent?.wantsReleaseNotes) && result.publishedDate ? 0.75 : 0;
  const comparisonFallbackBias = intent?.wantsComparison && !(result.passages?.length ?? 0) && result.snippet ? 0.35 : 0;
  return evidence + passageBias + descriptionBias + datedBias + comparisonFallbackBias;
}

function toEvidenceStrength(score: number): EvidenceStrength {
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function uniqueByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const unique: SearchResult[] = [];
  for (const result of results) {
    const key = result.url ?? `${result.title}|${result.snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(result);
  }
  return unique;
}

export function annotateEvidenceStrength(
  results: SearchResult[],
  intent?: SearchQueryIntent,
): SearchResult[] {
  return results.map((result) => {
    const score = evidenceScore(result, intent);
    return {
      ...result,
      evidenceStrength: toEvidenceStrength(score),
      evidenceReason: evidenceReason(result, intent),
    };
  });
}

export function bestEvidenceSummary(result: SearchResult): string | undefined {
  return result.passages?.[0] ?? result.pageDescription ?? result.snippet;
}

export function rerankForSynthesis(
  results: SearchResult[],
  options: EvidenceSelectionOptions = {},
): SearchResult[] {
  const intent = options.intent;
  const annotated = annotateEvidenceStrength(results, intent);
  const sorted = uniqueByUrl(annotated)
    .sort((a, b) => synthesisScore(b, intent) - synthesisScore(a, intent));

  const seenHosts = new Map<string, number>();
  const diversified = sorted.map((result, index) => {
    const host = resultHost(result.url);
    const seenCount = host ? (seenHosts.get(host) ?? 0) : 0;
    if (host) seenHosts.set(host, seenCount + 1);
    const diversityPenalty = (intent?.wantsMultiSourceSynthesis || intent?.wantsComparison) ? seenCount * 0.8 : seenCount * 0.4;
    return {
      ...result,
      fetchPriority: index + 1,
      score: (result.score ?? 0) + synthesisScore(result, intent) - diversityPenalty,
    };
  });

  return diversified.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

export function selectEvidencePages(
  results: SearchResult[],
  options: EvidenceSelectionOptions = {},
): SearchResult[] {
  const maxPages = Math.max(1, options.maxPages ?? 3);
  const intent = options.intent;
  const ranked = rerankForSynthesis(results, options);

  const selected: SearchResult[] = [];
  const selectedHosts = new Set<string>();
  const needsDiversity = Boolean(intent?.wantsComparison || intent?.wantsOfficialDocs || intent?.wantsReference);

  const passes = needsDiversity ? [true, false] : [false];
  for (const requireUniqueHost of passes) {
    for (const result of ranked) {
      if (selected.length >= maxPages) break;
      if (selected.some((entry) => entry.url === result.url)) continue;
      const host = resultHost(result.url);
      const sameHost = host ? selectedHosts.has(host) : false;
      if (requireUniqueHost && sameHost) continue;
      const hasEvidence = hasUsableEvidence(result, intent, selected.length);
      if (!hasEvidence && selected.length > 0) continue;
      selected.push(result);
      if (host) selectedHosts.add(host);
    }
    if (selected.length >= maxPages) break;
  }

  if (selected.length < Math.min(maxPages, ranked.length)) {
    for (const result of ranked) {
      if (selected.length >= maxPages) break;
      if (selected.some((entry) => entry.url === result.url)) continue;
      const host = resultHost(result.url);
      const sameHost = host ? selectedHosts.has(host) : false;
      const hasEvidence = hasUsableEvidence(result, intent, selected.length);
      if (needsDiversity && sameHost && selected.length === 0) continue;
      if (!hasEvidence && selected.length > 0) continue;
      selected.push(result);
      if (host) selectedHosts.add(host);
    }
  }

  return selected.slice(0, maxPages);
}
