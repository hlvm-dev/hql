/**
 * HQL REPL Suggester - Fish-style Autosuggestions
 *
 * Provides ghost-text suggestions from command history AND user bindings.
 * Shows gray text after cursor, accept with → or End.
 */

import { getWordAtCursor } from "./completer.ts";

// ============================================================
// Binding Sort Cache (avoids O(n log n) sort on every keystroke)
// ============================================================

let _cachedSortedBindings: string[] | null = null;
let _lastBindingsRef: ReadonlySet<string> | null = null;

function getSortedBindings(bindings: ReadonlySet<string>): string[] {
  // Only re-sort if bindings Set reference changed
  if (bindings !== _lastBindingsRef) {
    _cachedSortedBindings = [...bindings].sort();
    _lastBindingsRef = bindings;
  }
  return _cachedSortedBindings!;
}

// ============================================================
// Types
// ============================================================

export interface Suggestion {
  /** The complete suggested text (includes current input as prefix) */
  readonly full: string;
  /** The suffix to show as gray ghost text */
  readonly ghost: string;
}

/**
 * Find autosuggestion for current input from history AND bindings.
 *
 * Algorithm:
 * 1. First check if current word matches any binding (inline completion)
 * 2. Then search history from most recent to oldest
 * 3. Return the suffix as ghost text (first line only for multi-line)
 */
export function findSuggestion(
  currentLine: string,
  history: readonly string[],
  bindings?: ReadonlySet<string>
): Suggestion | null {
  if (currentLine.length === 0) return null;

  // Check for binding completion (inline word completion)
  if (bindings && bindings.size > 0) {
    const { word, start } = getWordAtCursor(currentLine, currentLine.length);

    if (word.length >= 2) {
      // Find first matching binding (sorted for consistency, cached)
      for (const binding of getSortedBindings(bindings)) {
        if (binding.startsWith(word) && binding !== word) {
          const prefix = currentLine.slice(0, start);
          return { full: prefix + binding, ghost: binding.slice(word.length) };
        }
      }
    }
  }

  // Search history backwards (most recent first)
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry === currentLine) continue;

    if (entry.startsWith(currentLine)) {
      let ghost = entry.slice(currentLine.length);
      const newlinePos = ghost.indexOf('\n');
      if (newlinePos !== -1) ghost = ghost.slice(0, newlinePos) + ' ...';
      return { full: entry, ghost };
    }
  }

  return null;
}

/**
 * Accept the suggestion, returning the full suggested text.
 */
export function acceptSuggestion(suggestion: Suggestion): string {
  return suggestion.full;
}
