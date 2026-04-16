import React from "react";
import Box from "../ink/components/Box.tsx";
import { Notifications } from "./Notifications.tsx";
import { PromptInputFooterLeftSide } from "./PromptInputFooterLeftSide.tsx";
import type { PromptInputMode } from "../types/textInputTypes.ts";
import { useTerminalSize } from "../hooks/useTerminalSize.ts";

type Props = {
  mode: PromptInputMode;
  isLoading: boolean;
  isSearching: boolean;
  queuedCount: number;
  hasStash: boolean;
  historyCount: number;
  footerLabel?: string;
};

export function PromptInputFooter({
  mode,
  isLoading,
  isSearching,
  queuedCount,
  hasStash,
  historyCount,
  footerLabel,
}: Props): React.ReactNode {
  const { columns } = useTerminalSize();
  const stacked = columns < 72;

  return (
    <Box
      flexDirection={stacked ? "column" : "row"}
      justifyContent={stacked ? "flex-start" : "space-between"}
      paddingLeft={2}
      gap={stacked ? 0 : 1}
    >
      <PromptInputFooterLeftSide
        mode={mode}
        isSearching={isSearching}
        isLoading={isLoading}
        queuedCount={queuedCount}
        footerLabel={footerLabel}
      />
      <Box>
        <Notifications
          isLoading={isLoading}
          isSearching={isSearching}
          queuedCount={queuedCount}
          hasStash={hasStash}
          historyCount={historyCount}
          footerLabel={footerLabel}
        />
      </Box>
    </Box>
  );
}
