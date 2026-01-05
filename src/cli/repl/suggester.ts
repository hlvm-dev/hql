/**
 * HQL REPL Suggester - Fish-style Autosuggestions
 *
 * Provides ghost-text suggestions from command history.
 * Shows gray text after cursor, accept with → or End.
 */

// ============================================================
// Types
// ============================================================

export interface Suggestion {
  /** The complete suggested text (includes current input as prefix) */
  readonly full: string;
  /** The suffix to show as gray ghost text */
  readonly ghost: string;
}

// ============================================================
// Suggestion Functions
// ============================================================

/**
 * Find autosuggestion for current input from history.
 *
 * Algorithm (fish-style):
 * 1. Search history from most recent to oldest
 * 2. Find first entry that starts with current input
 * 3. Return the suffix as ghost text
 *
 * @param currentLine - Current input line
 * @param history - Command history (most recent last)
 * @returns Suggestion or null if no match
 */
export function findSuggestion(
  currentLine: string,
  history: readonly string[]
): Suggestion | null {
  // Don't suggest for empty input
  if (currentLine.length === 0) return null;

  // Search history backwards (most recent first)
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];

    // Skip if entry is same as current input
    if (entry === currentLine) continue;

    // Check prefix match (case-sensitive)
    if (entry.startsWith(currentLine)) {
      return {
        full: entry,
        ghost: entry.slice(currentLine.length),
      };
    }
  }

  return null;
}

/**
 * Accept the suggestion, returning the full suggested text.
 *
 * @param currentLine - Current input line
 * @param suggestion - The suggestion to accept
 * @returns The full accepted text
 */
export function acceptSuggestion(
  currentLine: string,
  suggestion: Suggestion
): string {
  return currentLine + suggestion.ghost;
}

/**
 * Accept only the first word of the suggestion.
 * Useful for Alt+→ partial accept.
 *
 * @param currentLine - Current input line
 * @param suggestion - The suggestion
 * @returns The input with first word of suggestion appended
 */
export function acceptFirstWord(
  currentLine: string,
  suggestion: Suggestion
): string {
  const ghost = suggestion.ghost;

  // Find end of first word in ghost text
  let end = 0;
  // Skip leading spaces
  while (end < ghost.length && ghost[end] === " ") end++;
  // Find end of word
  while (end < ghost.length && ghost[end] !== " ") end++;

  return currentLine + ghost.slice(0, end);
}
