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
import { resolveCollapsedToolList } from "./layout.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";

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

  const toolElements = useMemo(() => {
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
  }, [tools, isToolExpanded, activeRunningToolId, sc, innerWidth]);

  return (
    <Box
      flexDirection="column"
      paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
    >
      {toolElements}
    </Box>
  );
});
