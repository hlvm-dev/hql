/**
 * MemoryActivityLine Component
 *
 * Compact single-line display for memory activity (recall/write/search).
 * Collapsed: "  ◆ Recalled 2, wrote 1 memory"
 * Expanded: tree-line details with scores/fact IDs.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import type { MemoryActivityDetail } from "../../types.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";

interface MemoryActivityLineProps {
  recalled: number;
  written: number;
  searched?: { query: string; count: number };
  details: MemoryActivityDetail[];
  expanded?: boolean;
}

function buildSummaryText(
  recalled: number,
  written: number,
  searched?: { query: string; count: number },
): string {
  const parts: string[] = [];
  if (recalled > 0) parts.push(`Recalled ${recalled}`);
  if (written > 0) parts.push(`wrote ${written}`);
  if (searched) parts.push(`searched "${searched.query}"`);
  if (parts.length === 0) return "";
  return parts.join(", ") + " memory";
}

export const MemoryActivityLine = React.memo(function MemoryActivityLine({
  recalled,
  written,
  searched,
  details,
  expanded = false,
}: MemoryActivityLineProps): React.ReactElement | null {
  const sc = useSemanticColors();
  const summary = buildSummaryText(recalled, written, searched);
  if (!summary) return null;

  return (
    <Box flexDirection="column">
      <Box paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}>
        <Text color={sc.text.muted}>◆ {summary}</Text>
      </Box>
      {expanded && details.length > 0 && (
        <Box
          flexDirection="column"
          marginLeft={TRANSCRIPT_LAYOUT.detailIndent * 2}
        >
          {details.map((detail, i) => {
            const isLast = i === details.length - 1;
            const prefix = isLast ? "└─" : "├─";
            const label = detail.action === "recalled"
              ? "Recalled"
              : detail.action === "wrote"
              ? "Wrote"
              : "Searched";
            const scoreStr = typeof detail.score === "number"
              ? ` (${detail.score})`
              : "";
            const factStr = typeof detail.factId === "number"
              ? ` → #${detail.factId}`
              : "";
            return (
              <Box key={i}>
                <Text color={sc.text.muted}>
                  {prefix} {label}: "{detail.text}"{scoreStr}{factStr}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
});
