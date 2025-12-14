/**
 * String Similarity Utilities for "Did you mean?" suggestions
 *
 * Uses Damerau-Levenshtein distance to find similar identifiers,
 * which handles transpositions (common in typos like "teh" → "the").
 */

/**
 * Calculate the Damerau-Levenshtein distance between two strings.
 * This counts transpositions (swapping adjacent characters) as a single edit,
 * which is more accurate for typo detection than plain Levenshtein.
 *
 * @param a - First string
 * @param b - Second string
 * @returns The edit distance
 *
 * @example
 * damerauLevenshteinDistance("prnitln", "println") // 1 (transposition)
 * damerauLevenshteinDistance("teh", "the") // 1 (transposition)
 */
function damerauLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const m = a.length;
  const n = b.length;

  // Create matrix with extra row and column for boundary conditions
  const d: number[][] = Array(m + 2)
    .fill(null)
    .map(() => Array(n + 2).fill(0));

  const maxDist = m + n;
  d[0][0] = maxDist;

  for (let i = 0; i <= m; i++) {
    d[i + 1][0] = maxDist;
    d[i + 1][1] = i;
  }

  for (let j = 0; j <= n; j++) {
    d[0][j + 1] = maxDist;
    d[1][j + 1] = j;
  }

  // Character to last position map
  const lastPos: Map<string, number> = new Map();

  for (let i = 1; i <= m; i++) {
    let lastMatchCol = 0;

    for (let j = 1; j <= n; j++) {
      const i1 = lastPos.get(b[j - 1]) ?? 0;
      const j1 = lastMatchCol;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      if (cost === 0) {
        lastMatchCol = j;
      }

      d[i + 1][j + 1] = Math.min(
        d[i][j] + cost, // substitution
        d[i + 1][j] + 1, // insertion
        d[i][j + 1] + 1, // deletion
        d[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1), // transposition
      );
    }

    lastPos.set(a[i - 1], i);
  }

  return d[m + 1][n + 1];
}

/**
 * Calculate max allowed edit distance based on string length.
 * Shorter strings require closer matches to avoid false positives.
 *
 * @param length - Length of the unknown identifier
 * @returns Maximum allowed edit distance
 */
function getMaxDistance(length: number): number {
  if (length <= 3) return 1; // Short: max 1 edit
  if (length <= 6) return 2; // Medium: max 2 edits
  return 3; // Long: max 3 edits
}

/**
 * Find the most similar name from a list of candidates.
 * Returns null if no sufficiently similar name is found.
 *
 * @param unknown - The unknown/misspelled identifier
 * @param candidates - List of valid identifiers to compare against
 * @returns The most similar name, or null if none is close enough
 *
 * @example
 * findSimilarName("prnitln", ["print", "println", "map"])
 * // Returns "println"
 *
 * findSimilarName("xyzabc", ["map", "filter", "reduce"])
 * // Returns null (too different)
 */
export function findSimilarName(
  unknown: string,
  candidates: string[],
): string | null {
  if (!unknown || candidates.length === 0) {
    return null;
  }

  const maxDistance = getMaxDistance(unknown.length);

  let bestMatch: string | null = null;
  let bestDistance = maxDistance + 1;

  for (const candidate of candidates) {
    // Quick filter: skip if length difference is too large
    if (Math.abs(candidate.length - unknown.length) > maxDistance) {
      continue;
    }

    // Skip exact matches (not a typo)
    if (candidate === unknown) {
      continue;
    }

    const distance = damerauLevenshteinDistance(unknown, candidate);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = candidate;
    } else if (distance === bestDistance && bestMatch !== null) {
      // For ties, prefer alphabetically first (deterministic)
      if (candidate < bestMatch) {
        bestMatch = candidate;
      }
    }
  }

  return bestDistance <= maxDistance ? bestMatch : null;
}
