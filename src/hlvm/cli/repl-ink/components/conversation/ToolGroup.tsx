/**
 * ToolGroup Component
 *
 * Bordered container for a group of tool calls.
 * Border color reflects aggregate status.
 * Header: "Tools (completed/total)" with progress bar when running.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { ToolCallItem } from "./ToolCallItem.tsx";
import { ProgressBar } from "./ProgressBar.tsx";
import type { ToolCallDisplay } from "../../types.ts";

interface ToolGroupProps {
  tools: ToolCallDisplay[];
  width: number;
  isToolExpanded?: (toolId: string) => boolean;
}

/** Determine aggregate status for border coloring */
function aggregateStatus(
  tools: ToolCallDisplay[],
): "pending" | "running" | "success" | "error" {
  const hasError = tools.some((t) => t.status === "error");
  if (hasError) return "error";
  const hasRunning = tools.some((t) => t.status === "running");
  if (hasRunning) return "running";
  const allSuccess = tools.every((t) => t.status === "success");
  if (allSuccess) return "success";
  return "pending";
}

export function ToolGroup({
  tools,
  width,
  isToolExpanded,
}: ToolGroupProps): React.ReactElement {
  const sc = useSemanticColors();

  const status = aggregateStatus(tools);
  const completed = tools.filter(
    (t) => t.status === "success" || t.status === "error",
  ).length;
  const total = tools.length;
  const isAllDone = completed === total;

  // Map aggregate status to border color
  let borderColor: string;
  switch (status) {
    case "success":
      borderColor = sc.tool.success;
      break;
    case "running":
      borderColor = sc.tool.running;
      break;
    case "error":
      borderColor = sc.tool.error;
      break;
    default:
      borderColor = sc.border.dim;
  }

  // Inner width accounts for border + padding (2 border chars + 2 padding chars = 4)
  const innerWidth = Math.max(10, width - 4);
  const showProgressBar = !isAllDone && innerWidth >= 28;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingLeft={1}
      paddingRight={1}
      width={width}
    >
      {/* Header with progress */}
      <Box justifyContent="space-between">
        <Text bold color={borderColor}>
          {isAllDone ? `Tools (${total})` : `Tools (${completed}/${total})`}
        </Text>
        {showProgressBar && (
          <ProgressBar current={completed} total={total} width={Math.min(15, innerWidth - 20)} />
        )}
      </Box>

      {/* Tool items */}
      {tools.map((tool) => (
        <Box key={tool.id}>
          <ToolCallItem
            tool={tool}
            width={innerWidth}
            expanded={Boolean(isToolExpanded?.(tool.id))}
          />
        </Box>
      ))}
    </Box>
  );
}
