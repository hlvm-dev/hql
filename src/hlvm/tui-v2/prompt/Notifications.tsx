import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import { DONOR_INACTIVE } from "../theme/donorTheme.ts";

type Props = {
  isLoading: boolean;
  isSearching: boolean;
  queuedCount: number;
  hasStash: boolean;
  historyCount: number;
  footerLabel?: string;
};

export function Notifications({
  isLoading: _isLoading,
  isSearching: _isSearching,
  queuedCount: _queuedCount,
  hasStash: _hasStash,
  historyCount: _historyCount,
  footerLabel: _footerLabel,
}: Props): React.ReactNode {
  return (
    <Box flexShrink={1} justifyContent="flex-end">
      <Text color={DONOR_INACTIVE} wrap="truncate">
        ◐ medium · /effort
      </Text>
    </Box>
  );
}
