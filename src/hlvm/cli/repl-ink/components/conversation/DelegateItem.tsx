import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../../common/utils.ts";
import { listDelegateTranscriptLines } from "../../../../agent/delegate-transcript.ts";
import { useSemanticColors } from "../../../theme/index.ts";
import { formatDurationMs } from "../../utils/formatting.ts";
import type { DelegateItem as DelegateItemData } from "../../types.ts";

interface DelegateItemProps {
  item: DelegateItemData;
  width: number;
  expanded?: boolean;
}

export const DelegateItem = React.memo(function DelegateItem(
  { item, width, expanded = false }: DelegateItemProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const accentMap: Record<string, string> = {
    error: sc.status.error,
    success: sc.status.success,
    cancelled: sc.text.muted,
    queued: sc.text.muted,
  };
  const iconMap: Record<string, string> = {
    error: "✗",
    success: "✓",
    cancelled: "○",
    queued: "⏳",
  };
  const accent = accentMap[item.status] ?? sc.status.warning;
  const icon = iconMap[item.status] ?? "↗";
  const duration = item.durationMs != null
    ? ` · ${formatDurationMs(item.durationMs)}`
    : "";
  const body = item.status === "error"
    ? item.error
    : item.status === "cancelled"
    ? "Cancelled"
    : item.summary;

  // Show nickname in header when available
  const header = item.nickname
    ? `${item.nickname} [${item.agent}]`
    : `Delegate ${item.agent}`;

  return (
    <Box flexDirection="row" width={width} marginBottom={1}>
      <Box width={4} flexShrink={0}>
        <Text color={accent} bold>{icon}</Text>
      </Box>
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="single"
        borderLeft
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor={accent}
        paddingLeft={1}
      >
        <Text bold color={accent}>
          {truncate(header, Math.max(10, width - 8), "…")}
        </Text>
        <Text color={sc.text.secondary}>
          {truncate(item.task, Math.max(10, width - 8), "…")}
          {duration}
        </Text>
        {body && (
          <Text
            color={item.status === "error" ? sc.status.error : sc.text.muted}
          >
            {truncate(body, Math.max(10, width - 8), "…")}
          </Text>
        )}
        {item.childSessionId && (
          <Text color={sc.text.muted}>
            {truncate(
              `child session: ${item.childSessionId}`,
              Math.max(10, width - 8),
              "…",
            )}
          </Text>
        )}
        {expanded && item.snapshot && (
          <Box flexDirection="column" marginTop={1}>
            {listDelegateTranscriptLines(item.snapshot).map((line, index) => (
              <React.Fragment key={`${item.id}-event-${index}`}>
                <Text color={sc.text.muted}>
                  {truncate(
                    line,
                    Math.max(10, width - 8),
                    "…",
                  )}
                </Text>
              </React.Fragment>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
});
