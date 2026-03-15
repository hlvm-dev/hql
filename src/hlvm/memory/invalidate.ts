/**
 * Conflict detection and optional temporal invalidation.
 */

import { invalidateFact, searchFactsFts } from "./facts.ts";

export type MemoryModelTier = "weak" | "mid" | "frontier";

interface ConflictCandidate {
  factId: number;
  content: string;
  category: string;
  score: number;
}

const NON_ALPHANUMERIC_RE = /[^a-z0-9\s]/g;

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(NON_ALPHANUMERIC_RE, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function detectConflicts(content: string, category: string): ConflictCandidate[] {
  const categoryTrimmed = category.trim();
  const contentTokens = tokenize(content);
  const candidates = searchFactsFts(content, 12)
    .filter((fact) => fact.category === categoryTrimmed)
    .filter((fact) => fact.content !== content)
    .map((fact) => {
      const overlap = jaccard(contentTokens, tokenize(fact.content));
      return {
        factId: fact.id,
        content: fact.content,
        category: fact.category,
        score: overlap,
      } satisfies ConflictCandidate;
    })
    .filter((candidate) => candidate.score > 0.4)
    .sort((a, b) => b.score - a.score);

  return candidates;
}

export function autoInvalidateConflicts(
  candidates: ConflictCandidate[],
  modelTier: MemoryModelTier,
): number[] {
  if (modelTier !== "frontier") return [];

  const invalidated: number[] = [];
  for (const candidate of candidates) {
    if (candidate.score >= 0.9) {
      invalidateFact(candidate.factId);
      invalidated.push(candidate.factId);
    }
  }

  return invalidated;
}
