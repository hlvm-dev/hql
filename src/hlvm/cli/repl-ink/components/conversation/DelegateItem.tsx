import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { formatDurationMs } from "../../utils/formatting.ts";
import type { DelegateItem as DelegateItemData } from "../../types.ts";

interface DelegateItemProps {
  item: DelegateItemData;
  width: number;
}

function truncate(text: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (text.length <= maxLen) return text;
  return maxLen > 3 ? `${text.slice(0, maxLen - 1)}…` : text.slice(0, maxLen);
}

export function DelegateItem(
  { item, width }: DelegateItemProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const accent = item.status === "error"
    ? sc.status.error
    : item.status === "success"
    ? sc.status.success
    : sc.status.warning;
  const icon = item.status === "error" ? "✗" : item.status === "success" ? "✓" : "↗";
  const duration = item.durationMs != null
    ? ` · ${formatDurationMs(item.durationMs)}`
    : "";
  const body = item.status === "error"
    ? item.error
    : item.summary;

  return (
    <Box flexDirection="row" width={width} marginBottom={1}>
      <Box width={4} flexShrink={0}>
        <Text color={accent} bold>{icon} </Text>
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
          {truncate(`Delegate ${item.agent}`, Math.max(10, width - 8))}
        </Text>
        <Text color={sc.text.secondary}>
          {truncate(item.task, Math.max(10, width - 8))}
          {duration}
        </Text>
        {body && (
          <Text color={item.status === "error" ? sc.status.error : sc.text.muted}>
            {truncate(body, Math.max(10, width - 8))}
          </Text>
        )}
      </Box>
    </Box>
  );
}
