import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import type { HistorySearchState } from "../../cli/repl-ink/hooks/useHistorySearch.ts";
import { DONOR_INACTIVE } from "../theme/donorTheme.ts";
import { HighlightedText } from "./HighlightedText.tsx";

type Props = {
  readonly state: HistorySearchState;
};

export function HistorySearchPrompt({ state }: Props): React.ReactElement | null {
  if (!state.isSearching) {
    return null;
  }

  const { query, selectedMatch, matches, selectedIndex } = state;
  const matchLabel = !query.trim()
    ? "type to search"
    : matches.length === 0
    ? "no match"
    : matches.length === 1
    ? "1 match"
    : `${selectedIndex + 1}/${matches.length} matches`;
  const hintText = !query.trim()
    ? "Type to search · Esc cancel"
    : matches.length <= 1
    ? "Enter select · Esc cancel"
    : "Ctrl+R next · Ctrl+S prev · Enter select · Esc cancel";

  return (
    <Box marginTop={1} flexDirection="column">
      <Box>
        <Text bold>History search</Text>
        <Text color={DONOR_INACTIVE}>{query ? ` ${query}` : " start typing"}</Text>
        <Text color={DONOR_INACTIVE}>{` · ${matchLabel}`}</Text>
      </Box>
      <Box>
        {selectedMatch
          ? (
            <HighlightedText
              text={selectedMatch.text}
              matchIndices={selectedMatch.matchIndices}
              highlightColor="yellow"
              baseColor="white"
            />
          )
          : query
          ? <Text color={DONOR_INACTIVE} italic>No match</Text>
          : <Text color={DONOR_INACTIVE} italic>Search history by typing.</Text>}
      </Box>
      <Box>
        <Text color={DONOR_INACTIVE}>{hintText}</Text>
      </Box>
    </Box>
  );
}
