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
import {
  buildToolGroupCountSlot,
  buildToolGroupProgressSlot,
  resolveCollapsedToolList,
} from "./layout.ts";

interface ToolGroupProps {
  tools: ToolCallDisplay[];
  width: number;
  isToolExpanded?: (toolId: string) => boolean;
}

/** Determine aggregate status for border coloring */
function aggregateStatus(
  tools: ToolCallDisplay[],
): "pending" | "running" | "success" | "error" | "partial" {
  const hasRunning = tools.some((t) => t.status === "running");
  if (hasRunning) return "running";
  const hasError = tools.some((t) => t.status === "error");
  const allSuccess = tools.every((t) => t.status === "success");
  if (allSuccess) return "success";
  const allError = tools.every((t) => t.status === "error");
  if (allError) return "error";
  if (hasError) return "partial";
  return "pending";
}

export function getToolGroupProgressWidth(innerWidth: number): number | null {
  if (innerWidth >= 34) return 18;
  if (innerWidth >= 28) return 12;
  return null;
}

export const ToolGroup = React.memo(function ToolGroup({
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
  const successCount = tools.filter((tool) => tool.status === "success").length;
  const errorCount = tools.filter((tool) => tool.status === "error").length;
  const runningCount = tools.filter((tool) => tool.status === "running").length;
  const pendingCount = Math.max(
    0,
    total - successCount - errorCount - runningCount,
  );
  const activeRunningToolId = tools.find((tool) => tool.status === "running")
    ?.id;

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
    case "partial":
      borderColor = sc.status.warning;
      break;
    default:
      borderColor = sc.border.dim;
  }

  // Inner width accounts for border + padding (2 border chars + 2 padding chars = 4)
  const innerWidth = Math.max(10, width - 4);
  const progressWidth = getToolGroupProgressWidth(innerWidth);
  const showProgressBar = !isAllDone && progressWidth !== null;
  const statusLabel = status === "running"
    ? "running"
    : status === "error"
    ? "failed"
    : status === "partial"
    ? "partial"
    : isAllDone
    ? "complete"
    : "pending";
  const countLabel = buildToolGroupCountSlot(completed, total, isAllDone);
  const progressCountLabel = buildToolGroupProgressSlot(completed, total);

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
        <Box>
          <Text bold color={borderColor}>Tools</Text>
          <Text color={sc.text.secondary}>{countLabel}</Text>
          <Text color={sc.text.muted}>· {statusLabel}</Text>
        </Box>
        <Box>
          {showProgressBar && (
            <>
              <ProgressBar
                mode="segmented"
                total={total}
                width={progressWidth}
                showCounts={false}
                segments={{
                  success: successCount,
                  error: errorCount,
                  running: runningCount,
                  pending: pendingCount,
                }}
              />
              <Text color={sc.text.muted}></Text>
            </>
          )}
          <Text color={sc.text.muted}>{progressCountLabel}</Text>
        </Box>
      </Box>

      {/* Tool items */}
      {(() => {
        const anyExpanded = tools.some((t) => isToolExpanded?.(t.id));
        const collapsed = anyExpanded
          ? null
          : resolveCollapsedToolList(tools);

        if (!collapsed) {
          return tools.map((tool) => (
            <Box key={tool.id}>
              <ToolCallItem
                tool={tool}
                width={innerWidth}
                expanded={Boolean(isToolExpanded?.(tool.id))}
                animateStatusIcon={tool.id === activeRunningToolId}
              />
            </Box>
          ));
        }

        const visibleSet = new Set(collapsed.visibleTools);
        const items: React.ReactElement[] = [];
        let collapseSummaryInserted = false;

        for (let i = 0; i < tools.length; i++) {
          if (visibleSet.has(i)) {
            items.push(
              <Box key={tools[i].id}>
                <ToolCallItem
                  tool={tools[i]}
                  width={innerWidth}
                  expanded={false}
                  animateStatusIcon={tools[i].id === activeRunningToolId}
                />
              </Box>,
            );
          } else if (!collapseSummaryInserted) {
            collapseSummaryInserted = true;
            items.push(
              <Box key="__collapsed__" marginLeft={2}>
                <Text color={sc.text.muted}>
                  … {collapsed.hiddenCount} more tool
                  {collapsed.hiddenCount === 1 ? "" : "s"}
                </Text>
              </Box>,
            );
          }
        }
        return items;
      })()}
    </Box>
  );
});
