/**
 * ToolCallItem Component
 *
 * Single-line display for one tool call within a ToolGroup.
 * Layout: [StatusIcon] tool_name args_summary (duration)
 * Optional result text shown as indented sub-line.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { formatDurationMs } from "../../utils/formatting.ts";
import { ToolStatusIcon } from "./ToolStatusIcon.tsx";
import { ToolResult } from "./ToolResult.tsx";
import type { ToolCallDisplay } from "../../types.ts";

interface ToolCallItemProps {
  tool: ToolCallDisplay;
  width: number;
  expanded?: boolean;
}

function truncate(text: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (text.length <= maxLen) return text;
  return maxLen > 3 ? text.slice(0, maxLen - 1) + "…" : text.slice(0, maxLen);
}

export function resolveToolResultText(
  tool: Pick<ToolCallDisplay, "resultSummaryText" | "resultText">,
  expanded: boolean,
): string {
  if (expanded) return tool.resultText ?? tool.resultSummaryText ?? "";
  return tool.resultSummaryText ?? tool.resultText ?? "";
}

export function ToolCallItem(
  { tool, width, expanded = false }: ToolCallItemProps,
): React.ReactElement {
  const sc = useSemanticColors();

  const durationStr = tool.durationMs != null ? `(${formatDurationMs(tool.durationMs)})` : "";
  const fixedWidth = 2 + tool.name.length + 1 + (durationStr ? durationStr.length + 1 : 0);
  const argsWidth = Math.max(0, width - fixedWidth);
  const argsSummary = truncate(tool.argsSummary, argsWidth);

  const nameColor = tool.status === "error" ? sc.status.error : sc.text.primary;
  const argsColor = tool.status === "error" ? sc.status.error : sc.text.secondary;

  return (
    <Box flexDirection="column">
      <Box>
        <ToolStatusIcon status={tool.status} />
        <Text> </Text>
        <Text bold color={nameColor}>{tool.name}</Text>
        {argsSummary && (
          <Text color={argsColor}>
            {" "}{argsSummary}
          </Text>
        )}
        {durationStr && <Text color={sc.text.muted}> · {durationStr}</Text>}
      </Box>

      {resolveToolResultText(tool, expanded) && tool.status !== "running" && (
        <Box
          marginLeft={2}
          flexDirection="column"
          borderStyle="single"
          borderLeft
          borderRight={false}
          borderTop={false}
          borderBottom={false}
          borderColor={tool.status === "error" ? sc.status.error : sc.border.default}
          paddingLeft={1}
        >
          <ToolResult
            text={resolveToolResultText(tool, expanded)}
            width={Math.max(10, width - 6)}
            maxLines={tool.status === "error" ? 12 : 8}
            expanded={expanded}
            tone={tool.status === "error" ? "error" : "default"}
          />
        </Box>
      )}
    </Box>
  );
}
