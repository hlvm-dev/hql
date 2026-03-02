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

interface TurnStatsProps {
  toolCount: number;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** Compact token count formatter: 420 -> "420", 2800 -> "2.8k", 12500 -> "13k" */
function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function TurnStats({ toolCount, durationMs, inputTokens, outputTokens }: TurnStatsProps): React.ReactElement {
  const sc = useSemanticColors();
  const duration = formatDurationMs(durationMs);
  const tools = toolCount === 0 ? "" : toolCount === 1 ? "1 tool" : `${toolCount} tools`;

  // Build token summary with explicit direction labels.
  // Example: "in 2.8k tokens · out 420 tokens"
  let tokenPart = "";
  if (inputTokens || outputTokens) {
    const segments: string[] = [];
    if (inputTokens) segments.push(`in ${formatTokens(inputTokens)} tokens`);
    if (outputTokens) segments.push(`out ${formatTokens(outputTokens)} tokens`);
    tokenPart = segments.join(" · ");
  }

  const parts = [tools, duration, tokenPart].filter(Boolean).join(" \u00b7 ");

  return (
    <Box marginY={1}>
      <Text color={sc.text.muted} dimColor>
        {`\u2500\u2500\u2500 ${parts} \u2500\u2500\u2500`}
      </Text>
    </Box>
  );
}
