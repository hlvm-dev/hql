/**
 * String Similarity Utilities for "Did you mean?" suggestions
 *
 * Provides Levenshtein distance calculation and similar name finding
 * for typo correction in error messages.
 */

/**
 * Calculate the Levenshtein (edit) distance between two strings.
 * This is the minimum number of single-character edits (insertions,
 * deletions, or substitutions) required to transform one string into another.
 *
 * @param a - First string
 * @param b - Second string
 * @returns The edit distance between the two strings
 *
 * @example
 * levenshteinDistance("println", "prnitln") // 2
 * levenshteinDistance("map", "mpa") // 2
 * levenshteinDistance("filter", "filtre") // 2
 */
export function levenshteinDistance(a: string, b: string): number {
  // Handle edge cases
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Create matrix
  const m = a.length;
  const n = b.length;

  // Use two rows instead of full matrix for space efficiency
  let prevRow: number[] = new Array(n + 1);
  let currRow: number[] = new Array(n + 1);

  // Initialize first row
  for (let j = 0; j <= n; j++) {
    prevRow[j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= m; i++) {
    currRow[0] = i;

    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // deletion
        currRow[j - 1] + 1, // insertion
        prevRow[j - 1] + cost, // substitution
      );
    }

    // Swap rows
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[n];
}

/**
 * Calculate the Damerau-Levenshtein distance, which also accounts for
 * transpositions (swapping two adjacent characters).
 * This is more useful for typo detection since transpositions are common.
 *
 * @param a - First string
 * @param b - Second string
 * @returns The Damerau-Levenshtein distance
 *
 * @example
 * damerauLevenshteinDistance("println", "prnitln") // 1 (transposition)
 * damerauLevenshteinDistance("teh", "the") // 1 (transposition)
 */
export function damerauLevenshteinDistance(a: string, b: string): number {
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
 * Options for finding similar names
 */
export interface FindSimilarOptions {
  /** Maximum edit distance to consider (default: auto based on length) */
  maxDistance?: number;
  /** Use Damerau-Levenshtein (handles transpositions) instead of plain Levenshtein */
  useTranspositions?: boolean;
  /** Maximum number of suggestions to return (default: 1) */
  maxSuggestions?: number;
  /** Case-insensitive matching (default: false) */
  caseInsensitive?: boolean;
}

/**
 * Find the most similar name from a list of candidates.
 * Returns null if no sufficiently similar name is found.
 *
 * @param unknown - The unknown/misspelled identifier
 * @param candidates - List of valid identifiers to compare against
 * @param options - Configuration options
 * @returns The most similar name, or null if none is close enough
 *
 * @example
 * findSimilarName("prnitln", ["print", "println", "map", "filter"])
 * // "println"
 *
 * findSimilarName("masp", ["map", "filter", "reduce"])
 * // "map"
 */
export function findSimilarName(
  unknown: string,
  candidates: string[],
  options: FindSimilarOptions = {},
): string | null {
  const {
    useTranspositions = true,
    maxSuggestions = 1,
    caseInsensitive = false,
  } = options;

  // Calculate max distance based on string length if not provided
  // Short names (1-3 chars): max 1 edit
  // Medium names (4-6 chars): max 2 edits
  // Long names (7+ chars): max 3 edits
  const maxDistance =
    options.maxDistance ??
    (unknown.length <= 3 ? 1 : unknown.length <= 6 ? 2 : 3);

  const distanceFn = useTranspositions
    ? damerauLevenshteinDistance
    : levenshteinDistance;

  const compareUnknown = caseInsensitive ? unknown.toLowerCase() : unknown;

  // Track all matches with their distances
  const matches: { name: string; distance: number }[] = [];

  for (const candidate of candidates) {
    // Skip if length difference is too large (quick filter)
    if (Math.abs(candidate.length - unknown.length) > maxDistance) {
      continue;
    }

    // Skip exact matches (not a typo)
    if (candidate === unknown) {
      continue;
    }

    const compareCandidate = caseInsensitive
      ? candidate.toLowerCase()
      : candidate;

    const dist = distanceFn(compareUnknown, compareCandidate);

    if (dist <= maxDistance) {
      matches.push({ name: candidate, distance: dist });
    }
  }

  if (matches.length === 0) {
    return null;
  }

  // Sort by distance (closest first), then alphabetically for ties
  matches.sort((a, b) => {
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    return a.name.localeCompare(b.name);
  });

  // Return single best match or multiple if requested
  if (maxSuggestions === 1) {
    return matches[0].name;
  }

  // For multiple suggestions, we'd return an array - but interface expects string | null
  // So for now, just return the best match
  return matches[0].name;
}

/**
 * Find multiple similar names from candidates.
 *
 * @param unknown - The unknown/misspelled identifier
 * @param candidates - List of valid identifiers
 * @param maxSuggestions - Maximum suggestions to return (default: 3)
 * @param options - Additional options
 * @returns Array of similar names, sorted by similarity
 */
export function findSimilarNames(
  unknown: string,
  candidates: string[],
  maxSuggestions: number = 3,
  options: Omit<FindSimilarOptions, "maxSuggestions"> = {},
): string[] {
  const { useTranspositions = true, caseInsensitive = false } = options;

  const maxDistance =
    options.maxDistance ??
    (unknown.length <= 3 ? 1 : unknown.length <= 6 ? 2 : 3);

  const distanceFn = useTranspositions
    ? damerauLevenshteinDistance
    : levenshteinDistance;

  const compareUnknown = caseInsensitive ? unknown.toLowerCase() : unknown;

  const matches: { name: string; distance: number }[] = [];

  for (const candidate of candidates) {
    if (Math.abs(candidate.length - unknown.length) > maxDistance) {
      continue;
    }

    if (candidate === unknown) {
      continue;
    }

    const compareCandidate = caseInsensitive
      ? candidate.toLowerCase()
      : candidate;

    const dist = distanceFn(compareUnknown, compareCandidate);

    if (dist <= maxDistance) {
      matches.push({ name: candidate, distance: dist });
    }
  }

  matches.sort((a, b) => {
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    return a.name.localeCompare(b.name);
  });

  return matches.slice(0, maxSuggestions).map((m) => m.name);
}
