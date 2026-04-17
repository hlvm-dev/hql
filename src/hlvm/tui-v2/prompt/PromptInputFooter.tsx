import React from "react";
import Box from "../ink/components/Box.tsx";
import { Notifications } from "./Notifications.tsx";
import { PromptInputFooterLeftSide } from "./PromptInputFooterLeftSide.tsx";
import { ShortcutsHelpMenu } from "./ShortcutsHelpMenu.tsx";
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
  helpOpen?: boolean;
};

export function PromptInputFooter({
  mode,
  isLoading,
  isSearching,
  queuedCount,
  hasStash,
  historyCount,
  footerLabel,
  helpOpen,
}: Props): React.ReactNode {
  const { columns } = useTerminalSize();
  const stacked = columns < 72;

  // CC parity: when `?` has toggled the help menu on an empty prompt, the
  // footer row is replaced by the shortcuts grid until the next keystroke
  // closes it. Mirrors ~/dev/ClaudeCode-main/components/PromptInput/
  // PromptInputFooter.tsx:135-137 `if (helpOpen) return <PromptInputHelpMenu/>`.
  if (helpOpen) {
    return <ShortcutsHelpMenu dimColor paddingX={2} gap={2} />;
  }

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
