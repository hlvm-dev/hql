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
import { ToolStatusIcon } from "./ToolStatusIcon.tsx";
import { ToolResult } from "./ToolResult.tsx";
import type { ToolCallDisplay } from "../../types.ts";
import { buildToolCallTextLayout } from "./layout.ts";
import { ConversationCallout } from "./ConversationCallout.tsx";
import {
  getToolResultLabel,
  getToolResultTone,
} from "./conversation-chrome.ts";

interface ToolCallItemProps {
  tool: ToolCallDisplay;
  width: number;
  expanded?: boolean;
  animateStatusIcon?: boolean;
}

export function resolveToolResultText(
  tool: Pick<ToolCallDisplay, "resultSummaryText" | "resultText">,
  expanded: boolean,
): string {
  if (expanded) return tool.resultText ?? tool.resultSummaryText ?? "";
  return tool.resultSummaryText ?? tool.resultText ?? "";
}

export const ToolCallItem = React.memo(function ToolCallItem(
  { tool, width, expanded = false, animateStatusIcon = false }:
    ToolCallItemProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const layout = buildToolCallTextLayout(
    Math.max(0, width - 2),
    tool.name,
    tool.argsSummary,
    tool.durationMs,
  );

  const nameColor = tool.status === "error" ? sc.status.error : sc.text.primary;
  const argsColor = tool.status === "error"
    ? sc.status.error
    : sc.text.secondary;

  return (
    <Box flexDirection="column">
      <Box>
        <ToolStatusIcon status={tool.status} animate={animateStatusIcon} />
        <Text></Text>
        <Text bold color={nameColor}>{tool.name}</Text>
        {layout.argsText && (
          <Text color={argsColor}>
            {" "}
            {layout.argsText}
          </Text>
        )}
        {layout.gapWidth > 0 && <Text>{" ".repeat(layout.gapWidth)}</Text>}
        {layout.durationText && (
          <Text color={sc.text.muted}>{layout.durationText}</Text>
        )}
      </Box>

      {resolveToolResultText(tool, expanded) && tool.status !== "running" && (
        <Box marginLeft={2} flexDirection="column">
          <ConversationCallout
            title={getToolResultLabel(tool.status)}
            tone={getToolResultTone(tool.status)}
            marginBottom={0}
          >
            <Box marginTop={0}>
              <ToolResult
                text={resolveToolResultText(tool, expanded)}
                width={Math.max(10, width - 10)}
                maxLines={tool.status === "error" ? 12 : 8}
                expanded={expanded}
                tone={tool.status === "error" ? "error" : "default"}
              />
            </Box>
          </ConversationCallout>
        </Box>
      )}
    </Box>
  );
});
