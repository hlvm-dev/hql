import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../../common/utils.ts";
import { useSemanticColors } from "../../../theme/index.ts";
import type { DelegateGroupItem as DelegateGroupData } from "../../types.ts";
import {
  getDelegateStatusGlyph,
  getDelegateStatusTone,
} from "./conversation-chrome.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";
import {
  computeDelegateGroupStats,
  formatDelegateEntryLine,
  formatDelegateGroupSummary,
  getDelegateGroupStatus,
  getEntryLatestActivity,
} from "../../../delegate-group-format.ts";

interface DelegateGroupProps {
  item: DelegateGroupData;
  width: number;
  expanded?: boolean;
}

function toneToColor(
  tone: string,
  sc: ReturnType<typeof useSemanticColors>,
): string {
  switch (tone) {
    case "error":
      return sc.status.error;
    case "success":
      return sc.status.success;
    case "neutral":
      return sc.text.muted;
    default:
      return sc.status.warning;
  }
}

export const DelegateGroup = React.memo(function DelegateGroup(
  { item, width, expanded = false }: DelegateGroupProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const stats = computeDelegateGroupStats(item.entries);
  const groupStatus = getDelegateGroupStatus(stats);
  const groupTone = groupStatus === "mixed" ? "warning" : groupStatus;
  const groupColor = toneToColor(groupTone, sc);
  const groupIcon = groupStatus === "running"
    ? "↗"
    : groupStatus === "success"
    ? getDelegateStatusGlyph("success")
    : groupStatus === "error"
    ? getDelegateStatusGlyph("error")
    : "↗";
  const summaryText = formatDelegateGroupSummary(stats);
  const contentWidth = Math.max(10, width - TRANSCRIPT_LAYOUT.detailIndent - 4);

  return (
    <Box flexDirection="column" width={width} marginBottom={1}>
      {/* Collapsed header */}
      <Box
        flexDirection="row"
        paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
        width={width}
      >
        <Text color={groupColor} bold>{groupIcon}</Text>
        <Text>{" "}</Text>
        <Text color={groupColor} bold>
          {truncate(summaryText, contentWidth, "…")}
        </Text>
      </Box>

      {/* Expanded: tree of entries */}
      {expanded &&
        item.entries.map((entry, index) => {
          const isLast = index === item.entries.length - 1;
          const prefix = isLast ? "└─" : "├─";
          const childPrefix = isLast ? "   " : "│  ";
          const entryTone = getDelegateStatusTone(entry.status);
          const entryColor = toneToColor(entryTone, sc);
          const entryIcon = getDelegateStatusGlyph(entry.status);
          const entryLine = formatDelegateEntryLine(entry);
          const activity = getEntryLatestActivity(entry);
          const lineWidth = Math.max(
            10,
            width - TRANSCRIPT_LAYOUT.detailIndent - 6,
          );

          return (
            <Box
              key={entry.id}
              flexDirection="column"
              paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
            >
              <Box flexDirection="row">
                <Text color={sc.text.muted}>{prefix} </Text>
                <Text color={entryColor}>{entryIcon}</Text>
                <Text>{" "}</Text>
                <Text color={entryColor}>
                  {truncate(entryLine, lineWidth, "…")}
                </Text>
              </Box>
              <Box flexDirection="row">
                <Text color={sc.text.muted}>{childPrefix}└ </Text>
                <Text color={sc.text.muted}>
                  {truncate(activity, lineWidth, "…")}
                </Text>
              </Box>
            </Box>
          );
        })}
    </Box>
  );
});
