/**
 * Ctrl+R History Search Hook
 *
 * Provides interactive reverse-search through command history.
 * Uses fuzzy matching for flexible searching.
 */

import { useState, useCallback, useMemo } from "react";
import { compareScoredFuzzyMatches, fuzzyMatch } from "../../repl/fuzzy.ts";
import type { HistoryEntry } from "../../repl/history-storage.ts";

// ============================================================
// Types
// ============================================================

interface HistoryMatch {
  /** The underlying history entry */
  readonly entry: HistoryEntry;
  /** The history entry text */
  readonly text: string;
  /** Index in the history array */
  readonly historyIndex: number;
  /** Fuzzy match score */
  readonly score: number;
  /** Match indices for highlighting */
  readonly matchIndices: readonly number[];
}

export interface HistorySearchState {
  /** Whether search mode is active */
  readonly isSearching: boolean;
  /** Current search query */
  readonly query: string;
  /** Matched history entries (sorted by score) */
  readonly matches: readonly HistoryMatch[];
  /** Currently selected match index */
  readonly selectedIndex: number;
  /** Currently selected match (convenience) */
  readonly selectedMatch: HistoryMatch | null;
}

interface HistorySearchActions {
  /** Enter search mode */
  readonly startSearch: () => void;
  /** Exit search mode */
  readonly cancelSearch: () => void;
  /** Update search query */
  readonly setQuery: (query: string) => void;
  /** Append character to query */
  readonly appendToQuery: (char: string) => void;
  /** Remove last character from query */
  readonly backspace: () => void;
  /** Select next match (Ctrl+R again) */
  readonly selectNext: () => void;
  /** Select previous match (Ctrl+S) */
  readonly selectPrev: () => void;
  /** Confirm selection and exit */
  readonly confirm: () => HistoryEntry | null;
}

// ============================================================
// Hook Implementation
// ============================================================

const MAX_MATCHES = 50; // Limit matches for performance

/**
 * Hook for Ctrl+R reverse history search.
 *
 * Usage:
 * ```tsx
 * const { state, actions } = useHistorySearch(history);
 *
 * // On Ctrl+R: actions.startSearch()
 * // On typing: actions.appendToQuery(char)
 * // On Enter: const selected = actions.confirm(); onChange(selected)
 * // On Escape: actions.cancelSearch()
 * ```
 */
export function useHistorySearch(
  history: readonly HistoryEntry[]
): { state: HistorySearchState; actions: HistorySearchActions } {
  // State
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQueryState] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Compute matches when query changes
  const matches = useMemo(() => {
    if (!isSearching || !query) {
      return [];
    }

    const results: HistoryMatch[] = [];
    const seen = new Set<string>();  // Deduplicate history entries

    // Search history in reverse order (most recent first)
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      const text = entry.cmd;

      // Skip duplicates - show only most recent occurrence
      if (seen.has(text)) continue;
      seen.add(text);

      const result = fuzzyMatch(query, text, "history");

      if (result) {
        results.push({
          entry,
          text,
          historyIndex: i,
          score: result.score,
          matchIndices: result.indices,
        });
      }

      // Limit results for performance
      if (results.length >= MAX_MATCHES) break;
    }

    // Sort by score (descending)
    results.sort((a, b) =>
      compareScoredFuzzyMatches(
        a.text,
        a.score,
        a.matchIndices,
        b.text,
        b.score,
        b.matchIndices,
      )
    );

    return results;
  }, [history, query, isSearching]);

  // Selected match
  const selectedMatch = matches[selectedIndex] ?? null;

  // Actions
  const startSearch = useCallback(() => {
    setIsSearching(true);
    setQueryState("");
    setSelectedIndex(0);
  }, []);

  const cancelSearch = useCallback(() => {
    setIsSearching(false);
    setQueryState("");
    setSelectedIndex(0);
  }, []);

  const setQuery = useCallback((newQuery: string) => {
    setQueryState(newQuery);
    setSelectedIndex(0); // Reset selection on query change
  }, []);

  const appendToQuery = useCallback((char: string) => {
    setQueryState((prev: string) => prev + char);
    setSelectedIndex(0);
  }, []);

  const backspace = useCallback(() => {
    setQueryState((prev: string) => prev.slice(0, -1));
    setSelectedIndex(0);
  }, []);

  const selectNext = useCallback(() => {
    setSelectedIndex((prev: number) =>
      matches.length > 0 ? (prev + 1) % matches.length : 0
    );
  }, [matches.length]);

  const selectPrev = useCallback(() => {
    setSelectedIndex((prev: number) =>
      matches.length > 0 ? (prev - 1 + matches.length) % matches.length : 0
    );
  }, [matches.length]);

  const confirm = useCallback((): HistoryEntry | null => {
    const result = selectedMatch?.entry ?? null;
    setIsSearching(false);
    setQueryState("");
    setSelectedIndex(0);
    return result;
  }, [selectedMatch]);

  return {
    state: {
      isSearching,
      query,
      matches,
      selectedIndex,
      selectedMatch,
    },
    actions: {
      startSearch,
      cancelSearch,
      setQuery,
      appendToQuery,
      backspace,
      selectNext,
      selectPrev,
      confirm,
    },
  };
}
