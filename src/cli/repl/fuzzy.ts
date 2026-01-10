/**
 * Unified Fuzzy Matching System
 *
 * Provides FZF-style fuzzy matching with scoring.
 * Used by: file search, symbol completion, history search, command completion.
 *
 * Algorithm:
 * - Greedy left-to-right character matching
 * - Scoring bonuses for: consecutive matches, word boundaries, camelCase, exact case
 * - Penalties for: path length, distance from start
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

// ============================================================
// Constants
// ============================================================

/** Word boundary characters for scoring bonuses */
const BOUNDARY_CHARS = new Set(["/", "\\", "-", "_", ".", " ", ":"]);

// ============================================================
// Character Classification (O(1) via charCode)
// ============================================================

/**
 * Check if character is uppercase letter (A-Z)
 * Uses charCodeAt for O(1) check without string allocation
 */
function isUpperCase(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 65 && code <= 90; // A-Z
}

/**
 * Check if character is lowercase letter (a-z)
 * Uses charCodeAt for O(1) check without string allocation
 */
function isLowerCase(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 97 && code <= 122; // a-z
}

// ============================================================
// Core Fuzzy Match
// ============================================================

/**
 * FZF-style fuzzy matching with scoring.
 * Returns score and match indices, or null if no match.
 *
 * Scoring:
 * - Base: +10 per matched character
 * - Consecutive match: +15 * consecutiveCount
 * - Word boundary (after / - _ . etc): +20
 * - CamelCase boundary: +15
 * - Exact case match: +5
 * - Length penalty: -0.5 * target.length
 * - Distance penalty: -2 * firstMatchIndex
 *
 * @param query - The search query (what user typed)
 * @param target - The string to match against
 * @returns FuzzyResult with score and indices, or null if no match
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (!query) return { score: 0, indices: [] };

  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  // Quick check: all query chars must exist in target (O(n) early exit)
  let checkIdx = 0;
  for (const ch of queryLower) {
    checkIdx = targetLower.indexOf(ch, checkIdx);
    if (checkIdx === -1) return null;
    checkIdx++;
  }

  // Find matches using greedy left-to-right approach
  const indices: number[] = [];
  let score = 0;
  let queryIdx = 0;
  let lastMatchIdx = -1;
  let consecutiveCount = 0;

  for (let i = 0; i < targetLower.length && queryIdx < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIdx]) {
      indices.push(i);

      // Base score per match
      score += 10;

      // Consecutive match bonus (big bonus for sequential matches)
      if (lastMatchIdx === i - 1) {
        consecutiveCount++;
        score += consecutiveCount * 15;
      } else {
        consecutiveCount = 0;
      }

      // Word boundary bonus (after boundary char or at start)
      if (i === 0 || BOUNDARY_CHARS.has(target[i - 1])) {
        score += 20;
      }

      // CamelCase bonus (lowercase followed by uppercase)
      if (i > 0 && isUpperCase(target[i]) && isLowerCase(target[i - 1])) {
        score += 15;
      }

      // Exact case match bonus
      if (query[queryIdx] === target[i]) {
        score += 5;
      }

      lastMatchIdx = i;
      queryIdx++;
    }
  }

  // All query characters must match
  if (queryIdx < queryLower.length) {
    return null;
  }

  // Penalties
  score -= target.length * 0.5; // Prefer shorter strings
  score -= indices[0] * 2; // Prefer matches near start

  return { score, indices };
}

/**
 * Fuzzy match optimized for file paths.
 * Adds bonus for matching in filename (after last /).
 */
export function fuzzyMatchPath(query: string, path: string): FuzzyResult | null {
  const result = fuzzyMatch(query, path);
  if (!result) return null;

  // Bonus for matching filename (last component)
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash !== -1 && result.indices.some((i) => i > lastSlash)) {
    return {
      score: result.score + 25,
      indices: result.indices,
    };
  }

  return result;
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Sort items by fuzzy match score (descending).
 * Creates a new sorted array, does not mutate input.
 */
export function fuzzySort<T>(
  items: readonly T[],
  getScore: (item: T) => number
): T[] {
  return [...items].sort((a, b) => getScore(b) - getScore(a));
}

/**
 * Filter items by fuzzy match and sort by score.
 * Convenience function combining match + filter + sort.
 *
 * @param items - Items to filter
 * @param query - Search query
 * @param getText - Function to extract searchable text from item
 * @returns Items that match, sorted by score (best first), with matchResult attached
 */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string
): Array<T & { readonly matchResult: FuzzyResult }> {
  if (!query) {
    // Empty query: return all items with neutral score
    return items.map((item) => ({
      ...item,
      matchResult: { score: 0, indices: [] },
    }));
  }

  const results: Array<T & { readonly matchResult: FuzzyResult }> = [];

  for (const item of items) {
    const result = fuzzyMatch(query, getText(item));
    if (result) {
      results.push({ ...item, matchResult: result });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.matchResult.score - a.matchResult.score);

  return results;
}

/**
 * Binary search to find insertion index in a descending-sorted array.
 * Returns the index where `score` should be inserted to maintain descending order.
 * O(log n) instead of O(n) linear search.
 */
export function binarySearchInsertIdx<T>(
  results: readonly T[],
  score: number,
  getScore: (item: T) => number
): number {
  let lo = 0;
  let hi = results.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (getScore(results[mid]) >= score) {
      lo = mid + 1; // Search right half (lower scores)
    } else {
      hi = mid; // Search left half (higher scores)
    }
  }
  return lo;
}

// ============================================================
// Exports for Testing
// ============================================================

export { isUpperCase, isLowerCase, BOUNDARY_CHARS };
