/**
 * Conflict detection and optional temporal invalidation.
 */

import { invalidateFact, searchFactsFts } from "./facts.ts";
import { type ModelTier } from "../agent/constants.ts";

interface ConflictCandidate {
  factId: number;
  content: string;
  category: string;
  score: number;
}

export async function detectConflicts(content: string, category: string): Promise<ConflictCandidate[]> {
  const categoryTrimmed = category.trim();
  const ftsResults = searchFactsFts(content, 12)
    .filter((fact) => fact.category === categoryTrimmed)
    .filter((fact) => fact.content !== content);

  if (ftsResults.length === 0) return [];

  const existingContents = ftsResults.map((f) => f.content);
  const { classifyFactConflicts } = await import("../runtime/local-llm.ts");
  const llmResult = await classifyFactConflicts(content, existingContents);

  const candidates: ConflictCandidate[] = [];
  for (const conflict of llmResult.conflicts) {
    const fact = ftsResults[conflict.index];
    if (!fact) continue;
    candidates.push({
      factId: fact.id,
      content: fact.content,
      category: fact.category,
      score: conflict.score,
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

export function autoInvalidateConflicts(
  candidates: ConflictCandidate[],
  modelTier: ModelTier,
): number[] {
  if (modelTier !== "enhanced") return [];

  const invalidated: number[] = [];
  for (const candidate of candidates) {
    if (candidate.score >= 0.9) {
      invalidateFact(candidate.factId);
      invalidated.push(candidate.factId);
    }
  }

  return invalidated;
}
