import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AgentConversationItem, HqlEvalItem } from "../types.ts";
import { TranscriptHistory } from "./TranscriptHistory.tsx";
import { buildBalancedTextRow } from "../utils/display-chrome.ts";
import { useSemanticColors } from "../../theme/index.ts";

interface TranscriptViewerOverlayProps {
  historyItems: AgentConversationItem[];
  liveItems?: AgentConversationItem[];
  evalHistory: HqlEvalItem[];
  width: number;
  onClose: () => void;
}

export function TranscriptViewerOverlay(
  {
    historyItems,
    liveItems = [],
    evalHistory,
    width,
    onClose,
  }: TranscriptViewerOverlayProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const [showAll, setShowAll] = useState(false);
  const header = useMemo(
    () =>
      buildBalancedTextRow(
        Math.max(16, width),
        "Conversation history",
        showAll ? "Ctrl+E compact · Esc close" : "Ctrl+E show all · Esc close",
      ),
    [showAll, width],
  );

  useInput((input, key) => {
    const lowerInput = input.toLowerCase();
    if (
      key.escape || (key.ctrl && (lowerInput === "c" || lowerInput === "[")) ||
      lowerInput === "q"
    ) {
      onClose();
      return;
    }
    if (key.ctrl && lowerInput === "e") {
      setShowAll((prev: boolean) => !prev);
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text color={sc.text.muted}>{header.leftText}</Text>
        {header.gapWidth > 0 && <Text>{" ".repeat(header.gapWidth)}</Text>}
        <Text color={sc.text.muted}>{header.rightText}</Text>
      </Box>
      <TranscriptHistory
        historyItems={historyItems}
        liveItems={liveItems}
        evalHistory={evalHistory}
        width={width}
        reservedRows={3}
        allowToggleHotkeys={false}
        expandAll={showAll}
      />
    </Box>
  );
}
