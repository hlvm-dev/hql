/**
 * TurnStats Component
 *
 * Displays turn completion statistics as a compact single line.
 * Format: Done (N tool uses · Xk tokens · Ns)
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { formatDurationMs } from "../../utils/formatting.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";

interface TurnStatsProps {
  toolCount: number;
  durationMs: number;
  width: number;
  inputTokens?: number;
  outputTokens?: number;
  modelId?: string;
}

/** Compact token count formatter: 420 -> "420", 2800 -> "2.8k", 12500 -> "13k" */
function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export const TurnStats = React.memo(function TurnStats(
  { toolCount, durationMs, inputTokens, outputTokens }:
    TurnStatsProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const duration = formatDurationMs(durationMs);

  const parts: string[] = [];
  if (toolCount > 0) {
    parts.push(
      toolCount === 1 ? "1 tool use" : `${toolCount} tool uses`,
    );
  }
  if (inputTokens || outputTokens) {
    const total = (inputTokens ?? 0) + (outputTokens ?? 0);
    parts.push(`${formatTokens(total)} tokens`);
  }
  parts.push(duration);

  return (
    <Box
      marginBottom={1}
      paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
    >
      <Text color={sc.text.muted}>Done ({parts.join(" \u00B7 ")})</Text>
    </Box>
  );
});
