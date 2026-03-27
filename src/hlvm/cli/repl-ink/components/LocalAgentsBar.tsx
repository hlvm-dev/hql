import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../common/utils.ts";
import { useSemanticColors } from "../../theme/index.ts";
import type { LocalAgentEntry } from "../utils/local-agents.ts";

export function shouldRenderLocalAgentsBar(
  entries: LocalAgentEntry[],
  focused: boolean,
  teamWorkerSummary?: string,
): boolean {
  return entries.length > 0 && (focused || !teamWorkerSummary);
}

export function buildLocalAgentsBarLine(
  entries: LocalAgentEntry[],
  focused: boolean,
  width: number,
): { summary: string; hints: string } | null {
  if (entries.length === 0) return null;
  const runningCount = entries.filter((entry) => entry.status === "running")
    .length;
  const singleEntry = entries[0];
  const summary = entries.length === 1 && singleEntry
    ? `${singleEntry.name} (${singleEntry.statusLabel})`
    : `${entries.length} local agents`;
  const hints = focused
    ? entries.length === 1 ? "Enter open · Esc back" : "Enter manage · Esc back"
    : entries.length === 1
    ? "Enter open · Ctrl+T manager"
    : `${runningCount} working · ↓ manage · Ctrl+T manager`;
  const maxSummaryWidth = Math.max(12, width - hints.length - 3);
  return {
    summary: truncate(summary, maxSummaryWidth),
    hints,
  };
}

interface LocalAgentsBarProps {
  entries: LocalAgentEntry[];
  focused: boolean;
  teamWorkerSummary?: string;
  width: number;
}

export function LocalAgentsBar(
  { entries, focused, teamWorkerSummary, width }: LocalAgentsBarProps,
): React.ReactElement | null {
  const sc = useSemanticColors();
  const line = useMemo(
    () => buildLocalAgentsBarLine(entries, focused, width),
    [entries, focused, width],
  );

  if (
    !line || !shouldRenderLocalAgentsBar(entries, focused, teamWorkerSummary)
  ) {
    return null;
  }

  return (
    <Box marginTop={0} marginBottom={0}>
      {focused
        ? (
          <Text
            backgroundColor={sc.shell.chipActive.background}
            color={sc.shell.chipActive.foreground}
            bold
          >
            {` ${line.summary} `}
          </Text>
        )
        : <Text color={sc.text.primary} bold>{line.summary}</Text>}
      <Text color={sc.text.muted}>{" · "}</Text>
      <Text color={sc.text.muted}>{line.hints}</Text>
    </Box>
  );
}
