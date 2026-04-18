/**
 * ToolGroup Component
 *
 * Flat list of tool calls with consistent indentation.
 * No bordered container — each tool renders independently.
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../../common/utils.ts";
import { useSemanticColors } from "../../../theme/index.ts";
import { ToolCallItem } from "./ToolCallItem.tsx";
import type { ToolCallDisplay } from "../../types.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";
import { resolveCollapsedToolList } from "./layout.ts";
import { resolveToolTranscriptGroupSummary } from "./tool-transcript.ts";

interface ToolGroupProps {
  tools: ToolCallDisplay[];
  width: number;
  isToolExpanded?: (toolId: string) => boolean;
}

function buildCollapsedToolSummary(
  tools: ToolCallDisplay[],
  hiddenIndexes: readonly number[],
): string | undefined {
  if (hiddenIndexes.length === 0) return undefined;

  const grouped = new Map<string, ToolCallDisplay[]>();
  for (const index of hiddenIndexes) {
    const tool = tools[index];
    if (!tool) continue;
    const key = `${tool.name}:${tool.status}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(tool);
      continue;
    }
    grouped.set(key, [tool]);
  }

  const parts = Array.from(grouped.values())
    .sort((a, b) => b.length - a.length)
    .slice(0, 3)
    .map((group) =>
      resolveToolTranscriptGroupSummary(
        group[0]!.name,
        group.map((tool) => ({
          name: tool.name,
          displayName: tool.displayName,
          argsSummary: tool.argsSummary,
          status: tool.status,
          resultSummaryText: tool.resultSummaryText,
          resultDetailText: tool.resultDetailText,
          resultMeta: tool.resultMeta,
        })),
      ) ?? undefined
    )
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => part.trim());

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export const ToolGroup = React.memo(function ToolGroup({
  tools,
  width,
  isToolExpanded,
}: ToolGroupProps): React.ReactElement {
  const sc = useSemanticColors();
  const innerWidth = Math.max(10, width - 2);
  const activeRunningToolId = tools.find((tool) => tool.status === "running")
    ?.id;
  const hasRunningShellTool = tools.some((tool) =>
    tool.status === "running" &&
    (tool.name === "shell_exec" || tool.name === "shell_script")
  );

  const toolElements = useMemo(() => {
    const anyExpanded = tools.some((t) => isToolExpanded?.(t.id));
    if (anyExpanded) {
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

    const collapsed = resolveCollapsedToolList(tools, 5);
    if (!collapsed) {
      return tools.map((tool) => (
        <Box key={tool.id}>
          <ToolCallItem
            tool={tool}
            width={innerWidth}
            expanded={false}
            animateStatusIcon={tool.id === activeRunningToolId}
          />
        </Box>
      ));
    }

    const visible = new Set(collapsed.visibleTools);
    const hiddenIndexes = tools
      .map((_, index) => index)
      .filter((index) => !visible.has(index));
    const collapsedSummary = buildCollapsedToolSummary(tools, hiddenIndexes);
    const hiddenAfterIndex = collapsed.visibleTools.find((visibleIndex, idx) =>
      idx < collapsed.visibleTools.length - 1 &&
      collapsed.visibleTools[idx + 1] - visibleIndex > 1
    );

    return tools.flatMap((tool, index) => {
      if (!visible.has(index)) return [];
      const elements = [
        (
          <Box key={tool.id}>
            <ToolCallItem
              tool={tool}
              width={innerWidth}
              expanded={false}
              animateStatusIcon={tool.id === activeRunningToolId}
            />
          </Box>
        ),
      ];
      if (hiddenAfterIndex === index) {
        elements.push(
          <Box key={`collapsed-${tool.id}`} marginLeft={2}>
            <Text color={sc.text.muted}>
              +{collapsed.hiddenCount} more tool uses (ctrl+o to expand)
            </Text>
          </Box>,
        );
        if (collapsedSummary) {
          elements.push(
            <Box key={`collapsed-summary-${tool.id}`} marginLeft={2}>
              <Text color={sc.text.muted}>
                {truncate(`⎿ ${collapsedSummary}`, Math.max(18, innerWidth))}
              </Text>
            </Box>,
          );
        }
      }
      return elements;
    });
  }, [tools, isToolExpanded, activeRunningToolId, sc, innerWidth]);

  return (
    <Box
      flexDirection="column"
      paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
    >
      {toolElements}
      {hasRunningShellTool && (
        <Box marginLeft={2} marginTop={1}>
          <Text color={sc.text.muted}>(ctrl+b to run in background)</Text>
        </Box>
      )}
    </Box>
  );
});
