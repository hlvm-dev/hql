/**
 * Unified Fuzzy Matching System
 *
 * Provides fzf-inspired fuzzy matching with shared scoring presets.
 * Used by: file search, symbol completion, history search, command completion.
 *
 * Design goals:
 * - One matcher SSOT for scoring, highlighting, and tie-breaking
 * - Better ranking than the old greedy scorer without changing caller APIs
 * - Stable ordering for equal-score candidates
 */

// ============================================================
// Types
// ============================================================

export interface FuzzyResult {
  /** Match score (higher = better match) */
  readonly score: number;
  /** Indices of matched characters in target string (for highlighting) */
  readonly indices: readonly number[];
}

export type FuzzyPreset =
  | "generic"
  | "symbol"
  | "path"
  | "command"
  | "history";

interface MatchPresetConfig {
  readonly baseMatch: number;
  readonly boundaryBonus: number;
  readonly delimiterBoundaryBonus: number;
  readonly camelBonus: number;
  readonly exactCaseBonus: number;
  readonly consecutiveBonus: number;
  readonly gapStartPenalty: number;
  readonly gapExtensionPenalty: number;
  readonly firstCharMultiplier: number;
  readonly startPenalty: number;
  readonly lengthPenalty: number;
  readonly spanPenalty: number;
  readonly exactBonus: number;
  readonly prefixBonus: number;
  readonly basenameBonus: number;
  readonly basenamePrefixBonus: number;
  readonly basenameExactBonus: number;
}

interface MatchState {
  readonly score: number;
  readonly firstIndex: number;
  readonly lastIndex: number;
  readonly prevCandidateIndex: number;
}

// ============================================================
// Constants
// ============================================================

/** Word boundary characters for scoring bonuses */
const BOUNDARY_CHARS = new Set(["/", "\\", "-", "_", ".", " ", ":"]);
const MAX_DP_MATRIX_SIZE = 4096;

const PRESET_CONFIGS: Record<FuzzyPreset, MatchPresetConfig> = {
  generic: {
    baseMatch: 20,
    boundaryBonus: 12,
    delimiterBoundaryBonus: 14,
    camelBonus: 10,
    exactCaseBonus: 4,
    consecutiveBonus: 15,
    gapStartPenalty: 5,
    gapExtensionPenalty: 2,
    firstCharMultiplier: 2,
    startPenalty: 2,
    lengthPenalty: 1,
    spanPenalty: 1,
    exactBonus: 26,
    prefixBonus: 18,
    basenameBonus: 0,
    basenamePrefixBonus: 0,
    basenameExactBonus: 0,
  },
  symbol: {
    baseMatch: 20,
    boundaryBonus: 13,
    delimiterBoundaryBonus: 15,
    camelBonus: 13,
    exactCaseBonus: 4,
    consecutiveBonus: 16,
    gapStartPenalty: 4,
    gapExtensionPenalty: 2,
    firstCharMultiplier: 2,
    startPenalty: 2,
    lengthPenalty: 1,
    spanPenalty: 1,
    exactBonus: 28,
    prefixBonus: 20,
    basenameBonus: 0,
    basenamePrefixBonus: 0,
    basenameExactBonus: 0,
  },
  path: {
    baseMatch: 18,
    boundaryBonus: 10,
    delimiterBoundaryBonus: 16,
    camelBonus: 8,
    exactCaseBonus: 3,
    consecutiveBonus: 16,
    gapStartPenalty: 4,
    gapExtensionPenalty: 2,
    firstCharMultiplier: 2,
    startPenalty: 1,
    lengthPenalty: 0,
    spanPenalty: 1,
    exactBonus: 24,
    prefixBonus: 16,
    basenameBonus: 6,
    basenamePrefixBonus: 18,
    basenameExactBonus: 24,
  },
  command: {
    baseMatch: 20,
    boundaryBonus: 16,
    delimiterBoundaryBonus: 18,
    camelBonus: 10,
    exactCaseBonus: 4,
    consecutiveBonus: 17,
    gapStartPenalty: 4,
    gapExtensionPenalty: 2,
    firstCharMultiplier: 3,
    startPenalty: 3,
    lengthPenalty: 1,
    spanPenalty: 1,
    exactBonus: 28,
    prefixBonus: 24,
    basenameBonus: 0,
    basenamePrefixBonus: 0,
    basenameExactBonus: 0,
  },
  history: {
    baseMatch: 18,
    boundaryBonus: 10,
    delimiterBoundaryBonus: 12,
    camelBonus: 8,
    exactCaseBonus: 3,
    consecutiveBonus: 14,
    gapStartPenalty: 4,
    gapExtensionPenalty: 2,
    firstCharMultiplier: 2,
    startPenalty: 1,
    lengthPenalty: 0,
    spanPenalty: 1,
    exactBonus: 22,
    prefixBonus: 16,
    basenameBonus: 0,
    basenamePrefixBonus: 0,
    basenameExactBonus: 0,
  },
};

// ============================================================
// Character Classification (O(1) via charCode)
// ============================================================

function isUpperCase(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 65 && code <= 90;
}

function isLowerCase(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 97 && code <= 122;
}

function getSpan(indices: readonly number[] | undefined): number {
  if (!indices || indices.length <= 1) return 0;
  return indices[indices.length - 1] - indices[0];
}

function compareState(a: MatchState | null, b: MatchState | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (b.score !== a.score) return b.score - a.score;
  if (a.firstIndex !== b.firstIndex) return a.firstIndex - b.firstIndex;
  const aSpan = a.lastIndex - a.firstIndex;
  const bSpan = b.lastIndex - b.firstIndex;
  if (aSpan !== bSpan) return aSpan - bSpan;
  return a.lastIndex - b.lastIndex;
}

function isBetterState(candidate: MatchState, current: MatchState | null): boolean {
  return compareState(candidate, current) < 0;
}

function getPositionBonus(
  target: string,
  index: number,
  config: MatchPresetConfig,
  preset: FuzzyPreset,
  lastSlash: number,
): number {
  let bonus = 0;

  if (index === 0) {
    bonus += config.delimiterBoundaryBonus;
  } else {
    const prev = target[index - 1];
    if (BOUNDARY_CHARS.has(prev)) {
      bonus += prev === "/" || prev === "\\"
        ? config.delimiterBoundaryBonus
        : config.boundaryBonus;
    } else if (isUpperCase(target[index]) && isLowerCase(prev)) {
      bonus += config.camelBonus;
    }
  }

  if (preset === "path" && index > lastSlash) {
    bonus += config.basenameBonus;
  }

  return bonus;
}

function getTransitionScore(
  prevIndex: number,
  nextIndex: number,
  config: MatchPresetConfig,
): number {
  const gap = nextIndex - prevIndex - 1;
  if (gap <= 0) {
    return config.consecutiveBonus;
  }
  return -(config.gapStartPenalty + Math.max(0, gap - 1) * config.gapExtensionPenalty);
}

function getResultBonuses(
  queryLower: string,
  targetLower: string,
  indices: readonly number[],
  config: MatchPresetConfig,
  preset: FuzzyPreset,
  lastSlash: number,
): number {
  if (indices.length === 0) return 0;

  let bonus = 0;
  const firstIndex = indices[0];
  const span = getSpan(indices);

  bonus -= firstIndex * config.startPenalty;
  bonus -= targetLower.length * config.lengthPenalty;
  bonus -= span * config.spanPenalty;

  if (targetLower === queryLower) {
    bonus += config.exactBonus;
  } else if (targetLower.startsWith(queryLower)) {
    bonus += config.prefixBonus;
  }

  if (preset === "path") {
    const basename = targetLower.slice(lastSlash + 1);
    if (basename === queryLower) {
      bonus += config.basenameExactBonus;
    } else if (basename.startsWith(queryLower)) {
      bonus += config.basenamePrefixBonus;
    }
  }

  return bonus;
}

function quickMatchExists(queryLower: string, targetLower: string): boolean {
  let searchIndex = 0;
  for (const ch of queryLower) {
    searchIndex = targetLower.indexOf(ch, searchIndex);
    if (searchIndex === -1) return false;
    searchIndex++;
  }
  return true;
}

function collectMatchPositions(queryLower: string, targetLower: string): number[][] {
  const positions: number[][] = [];
  for (let qi = 0; qi < queryLower.length; qi++) {
    const matches: number[] = [];
    const queryCode = queryLower.charCodeAt(qi);
    for (let ti = 0; ti < targetLower.length; ti++) {
      if (targetLower.charCodeAt(ti) === queryCode) {
        matches.push(ti);
      }
    }
    if (matches.length === 0) return [];
    positions.push(matches);
  }
  return positions;
}

function scoreGreedy(
  query: string,
  target: string,
  preset: FuzzyPreset,
): FuzzyResult | null {
  const config = PRESET_CONFIGS[preset];
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  if (!quickMatchExists(queryLower, targetLower)) {
    return null;
  }

  const lastSlash = preset === "path"
    ? Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\"))
    : -1;
  const indices: number[] = [];
  let queryIndex = 0;
  let score = 0;
  let previousMatch = -1;

  for (let i = 0; i < target.length && queryIndex < query.length; i++) {
    if (targetLower.charCodeAt(i) !== queryLower.charCodeAt(queryIndex)) {
      continue;
    }

    const positionBonus = getPositionBonus(target, i, config, preset, lastSlash);
    const caseBonus = target.charCodeAt(i) === query.charCodeAt(queryIndex)
      ? config.exactCaseBonus
      : 0;
    score += config.baseMatch + positionBonus + caseBonus;
    if (queryIndex === 0) {
      score += positionBonus * (config.firstCharMultiplier - 1);
    } else {
      score += getTransitionScore(previousMatch, i, config);
    }
    previousMatch = i;
    indices.push(i);
    queryIndex++;
  }

  if (queryIndex !== query.length) {
    return null;
  }

  score += getResultBonuses(queryLower, targetLower, indices, config, preset, lastSlash);
  return { score, indices };
}

// ============================================================
// Public API
// ============================================================

/**
 * Fzf-inspired fuzzy matching with shared scoring presets.
 * Returns score and match indices, or null if no match.
 */
export function fuzzyMatch(
  query: string,
  target: string,
  preset: FuzzyPreset = "generic",
): FuzzyResult | null {
  if (!query) return { score: 0, indices: [] };

  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  if (!quickMatchExists(queryLower, targetLower)) {
    return null;
  }

  const positions = collectMatchPositions(queryLower, targetLower);
  if (positions.length === 0) {
    return null;
  }

  const matrixSize = positions.reduce((total, next) => total + next.length, 0) * positions.length;
  if (matrixSize > MAX_DP_MATRIX_SIZE) {
    return scoreGreedy(query, target, preset);
  }

  const config = PRESET_CONFIGS[preset];
  const lastSlash = preset === "path"
    ? Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\"))
    : -1;
  const positionBonuses = target.split("").map((_, index) =>
    getPositionBonus(target, index, config, preset, lastSlash)
  );
  const states: MatchState[][] = [];

  for (let qi = 0; qi < positions.length; qi++) {
    const layerPositions = positions[qi];
    const layerStates: MatchState[] = [];

    for (let ci = 0; ci < layerPositions.length; ci++) {
      const targetIndex = layerPositions[ci];
      const caseBonus = target.charCodeAt(targetIndex) === query.charCodeAt(qi)
        ? config.exactCaseBonus
        : 0;
      const baseScore = config.baseMatch + positionBonuses[targetIndex] + caseBonus;

      let bestState: MatchState | null = null;

      if (qi === 0) {
        bestState = {
          score: baseScore + positionBonuses[targetIndex] * (config.firstCharMultiplier - 1),
          firstIndex: targetIndex,
          lastIndex: targetIndex,
          prevCandidateIndex: -1,
        };
      } else {
        const previousLayer = states[qi - 1];
        const previousPositions = positions[qi - 1];

        for (let pi = 0; pi < previousLayer.length; pi++) {
          const previousIndex = previousPositions[pi];
          if (previousIndex >= targetIndex) {
            continue;
          }

          const candidate: MatchState = {
            score: previousLayer[pi].score +
              baseScore +
              getTransitionScore(previousIndex, targetIndex, config),
            firstIndex: previousLayer[pi].firstIndex,
            lastIndex: targetIndex,
            prevCandidateIndex: pi,
          };

          if (isBetterState(candidate, bestState)) {
            bestState = candidate;
          }
        }
      }

      layerStates.push(bestState ?? {
        score: Number.NEGATIVE_INFINITY,
        firstIndex: targetIndex,
        lastIndex: targetIndex,
        prevCandidateIndex: -1,
      });
    }

    states.push(layerStates);
  }

  const finalLayer = states[states.length - 1];
  let bestCandidateIndex = -1;
  let bestState: MatchState | null = null;

  for (let ci = 0; ci < finalLayer.length; ci++) {
    const candidate = finalLayer[ci];
    if (!Number.isFinite(candidate.score)) continue;
    if (isBetterState(candidate, bestState)) {
      bestState = candidate;
      bestCandidateIndex = ci;
    }
  }

  if (!bestState || bestCandidateIndex === -1) {
    return null;
  }

  const indices = new Array<number>(positions.length);
  let currentCandidateIndex = bestCandidateIndex;

  for (let qi = positions.length - 1; qi >= 0; qi--) {
    indices[qi] = positions[qi][currentCandidateIndex];
    currentCandidateIndex = states[qi][currentCandidateIndex].prevCandidateIndex;
  }

  const score = bestState.score +
    getResultBonuses(queryLower, targetLower, indices, config, preset, lastSlash);

  return { score, indices };
}

/**
 * Fuzzy match optimized for file paths.
 */
export function fuzzyMatchPath(query: string, path: string): FuzzyResult | null {
  return fuzzyMatch(query, path, "path");
}

/**
 * Compare scored fuzzy candidates deterministically.
 * Negative return value means `a` should sort before `b`.
 */
export function compareScoredFuzzyMatches(
  aText: string,
  aScore: number,
  aIndices: readonly number[] | undefined,
  bText: string,
  bScore: number,
  bIndices: readonly number[] | undefined,
): number {
  if (bScore !== aScore) return bScore - aScore;

  const aStart = aIndices?.[0] ?? Number.MAX_SAFE_INTEGER;
  const bStart = bIndices?.[0] ?? Number.MAX_SAFE_INTEGER;
  if (aStart !== bStart) return aStart - bStart;

  const aSpan = getSpan(aIndices);
  const bSpan = getSpan(bIndices);
  if (aSpan !== bSpan) return aSpan - bSpan;

  if (aText.length !== bText.length) return aText.length - bText.length;
  return aText.localeCompare(bText);
}

/**
 * Calculate minimum score threshold for quality filtering.
 */
function calculateMinScore(query: string, preset: FuzzyPreset): number {
  if (!query) return 0;
  const config = PRESET_CONFIGS[preset];
  if (query.length === 1) {
    return config.baseMatch + Math.floor(config.boundaryBonus / 2);
  }
  return query.length * (config.baseMatch + Math.floor(config.consecutiveBonus / 2));
}

/**
 * Filter items by fuzzy match and sort by score.
 */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
  options?: { minScore?: number | "auto"; preset?: FuzzyPreset },
): Array<T & { readonly matchResult: FuzzyResult }> {
  const preset = options?.preset ?? "generic";

  if (!query) {
    return items.map((item) => ({
      ...item,
      matchResult: { score: 0, indices: [] },
    }));
  }

  const results: Array<T & { readonly matchResult: FuzzyResult }> = [];
  const threshold = options?.minScore === "auto"
    ? calculateMinScore(query, preset)
    : options?.minScore ?? Number.NEGATIVE_INFINITY;

  for (const item of items) {
    const result = fuzzyMatch(query, getText(item), preset);
    if (result && result.score >= threshold) {
      results.push({ ...item, matchResult: result });
    }
  }

  results.sort((a, b) =>
    compareScoredFuzzyMatches(
      getText(a),
      a.matchResult.score,
      a.matchResult.indices,
      getText(b),
      b.matchResult.score,
      b.matchResult.indices,
    )
  );

  return results;
}

