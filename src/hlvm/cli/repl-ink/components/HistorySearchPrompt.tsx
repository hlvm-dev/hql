/**
 * History Search Prompt Component
 *
 * Displays Ctrl+R reverse history search UI.
 * Shows query, matches, and highlighted results.
 */

import React from "react";
import { Box, Text } from "ink";
import type { HistorySearchState } from "../hooks/useHistorySearch.ts";
import { useTheme } from "../../theme/index.ts";
import { highlight } from "../../repl/syntax.ts";

// ============================================================
// Main Component
// ============================================================

interface HistorySearchPromptProps {
  readonly state: HistorySearchState;
}

/**
 * History search prompt displayed during Ctrl+R search mode.
 *
 * Layout:
 * ```
 * (reverse-i-search)`query': matched_result
 * ```
 */
export function HistorySearchPrompt({ state }: HistorySearchPromptProps): React.ReactElement | null {
  const { color } = useTheme();

  if (!state.isSearching) {
    return null;
  }

  const { query, selectedMatch, matches, selectedIndex } = state;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color("accent")}>(reverse-i-search)</Text>
        <Text dimColor>`</Text>
        <Text color={color("success")}>{query}</Text>
        <Text dimColor>'</Text>
        <Text>: </Text>
        {selectedMatch ? (
          <Text>{highlight(selectedMatch.text)}</Text>
        ) : query ? (
          <Text dimColor italic>no match</Text>
        ) : (
          <Text dimColor italic>type to search</Text>
        )}
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>
          {matches.length === 0 && query
            ? "no matches (Esc cancel, keep typing)"
            : matches.length === 1
            ? "1 match (Enter select, Esc cancel)"
            : matches.length > 1
            ? `${selectedIndex + 1}/${matches.length} matches (Ctrl+R next, Ctrl+S prev, Enter select, Esc cancel)`
            : "type to search (Esc cancel)"}
        </Text>
      </Box>
    </Box>
  );
}
