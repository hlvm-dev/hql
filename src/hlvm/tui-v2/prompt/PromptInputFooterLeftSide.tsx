import React from "react";
import Text from "../ink/components/Text.tsx";
import type { PromptInputMode } from "../types/textInputTypes.ts";
import { DONOR_INACTIVE } from "../theme/donorTheme.ts";

type Props = {
  mode: PromptInputMode;
  isSearching: boolean;
  isLoading: boolean;
  queuedCount: number;
  footerLabel?: string;
};

export function PromptInputFooterLeftSide({
  mode: _mode,
  isSearching,
  isLoading,
  queuedCount: _queuedCount,
  footerLabel,
}: Props): React.ReactNode {
  if (isSearching) {
    return (
      <Text color={DONOR_INACTIVE}>
        search open · Enter keeps match · Esc closes
      </Text>
    );
  }

  if (isLoading) {
    return <Text color={DONOR_INACTIVE}>esc to interrupt</Text>;
  }

  if (footerLabel) {
    return <Text color={DONOR_INACTIVE}>{footerLabel}</Text>;
  }

  return <Text color={DONOR_INACTIVE}>? for shortcuts</Text>;
}
