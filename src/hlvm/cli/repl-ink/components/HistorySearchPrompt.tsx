/**
 * History Search Prompt Component
 *
 * Displays Ctrl+R reverse history search UI.
 * Shows query, matches, and highlighted results.
 */

import React from "react";
import { Box, Text } from "ink";
import type { HistorySearchState } from "../hooks/useHistorySearch.ts";
import { useSemanticColors } from "../../theme/index.ts";
import { HighlightedText } from "./HighlightedText.tsx";
import { ChromeChip } from "./ChromeChip.tsx";
import {
  getHistorySearchHintText,
  getHistorySearchMatchLabel,
} from "../utils/shell-chrome.ts";

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
export function HistorySearchPrompt(
  { state }: HistorySearchPromptProps,
): React.ReactElement | null {
  const sc = useSemanticColors();

  if (!state.isSearching) {
    return null;
  }

  const { query, selectedMatch, matches, selectedIndex } = state;
  const matchLabel = getHistorySearchMatchLabel(
    query,
    matches.length,
    selectedIndex,
  );
  const hintText = getHistorySearchHintText(query, matches.length);

  return (
    <Box flexDirection="column">
      <Box>
        <ChromeChip text="History search" tone="active" />
        <Text color={query ? sc.shell.prompt : sc.text.muted}>
          {query ? ` ${query}` : " start typing"}
        </Text>
        <Text color={sc.text.muted}>{` · ${matchLabel}`}</Text>
      </Box>
      <Box marginTop={0}>
        {selectedMatch
          ? (
            <HighlightedText
              text={selectedMatch.text}
              matchIndices={selectedMatch.matchIndices}
              highlightColor={sc.status.warning}
              baseColor={sc.text.primary}
            />
          )
          : query
          ? <Text color={sc.text.muted} italic>No match</Text>
          : <Text color={sc.text.muted} italic>Search history by typing.</Text>}
      </Box>
      <Box>
        <Text color={sc.shell.queueHint}>
          {hintText}
        </Text>
      </Box>
    </Box>
  );
}
