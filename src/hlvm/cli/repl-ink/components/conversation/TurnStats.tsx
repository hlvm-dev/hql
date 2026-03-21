/**
 * TurnStats Component
 *
 * Displays turn completion statistics as a styled separator.
 * Inspired by Gemini CLI's line separator pattern.
 * Shows tool count, elapsed time, and token usage (input/output).
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { formatDurationMs } from "../../utils/formatting.ts";
import { buildTurnStatsTextLayout } from "./layout.ts";

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
  { toolCount, durationMs, width, inputTokens, outputTokens, modelId }:
    TurnStatsProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const duration = formatDurationMs(durationMs);
  const tools = toolCount === 0
    ? ""
    : toolCount === 1
    ? "1 tool"
    : `${toolCount} tools`;
  const model = modelId ? modelId.split("/").pop() ?? modelId : "";

  // Build token summary with explicit direction labels.
  // Example: "in 2.8k tokens · out 420 tokens"
  let tokenPart = "";
  if (inputTokens || outputTokens) {
    const segments: string[] = [];
    if (inputTokens) segments.push(`in ${formatTokens(inputTokens)} tokens`);
    if (outputTokens) segments.push(`out ${formatTokens(outputTokens)} tokens`);
    tokenPart = segments.join(" · ");
  }

  const layout = buildTurnStatsTextLayout(
    Math.max(10, width),
    [model, tools, duration, tokenPart],
  );
  const leadingRule = "─".repeat(layout.leftRuleWidth);
  const trailingRule = "─".repeat(layout.rightRuleWidth);

  return (
    <Box marginY={1}>
      {leadingRule.length > 0 && (
        <Text color={sc.chrome.separator}>{leadingRule}</Text>
      )}
      {layout.text.length > 0 && (
        <Text color={sc.text.muted}>
          {leadingRule.length > 0 ? " " : ""}
          {layout.text}
          {trailingRule.length > 0 ? " " : ""}
        </Text>
      )}
      {trailingRule.length > 0 && (
        <Text color={sc.chrome.separator}>{trailingRule}</Text>
      )}
    </Box>
  );
});
