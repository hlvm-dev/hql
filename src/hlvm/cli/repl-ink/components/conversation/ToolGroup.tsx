/**
 * ToolGroup Component
 *
 * Flat list of tool calls with consistent indentation.
 * No bordered container — each tool renders independently.
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { ToolCallItem } from "./ToolCallItem.tsx";
import type { ToolCallDisplay } from "../../types.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";
import { resolveCollapsedToolList } from "./layout.ts";

interface ToolGroupProps {
  tools: ToolCallDisplay[];
  width: number;
  isToolExpanded?: (toolId: string) => boolean;
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
