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
import type { TurnCompletionStatus } from "../../types.ts";

interface TurnStatsProps {
  toolCount: number;
  durationMs: number;
  width: number;
  inputTokens?: number;
  outputTokens?: number;
  modelId?: string;
  status: TurnCompletionStatus;
  summary?: string;
  activityTrail?: string[];
}

/** Compact token count formatter: 420 -> "420", 2800 -> "2.8k", 12500 -> "13k" */
function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export const TurnStats = React.memo(function TurnStats(
  {
    toolCount,
    durationMs,
    inputTokens,
    outputTokens,
    status,
    summary,
    activityTrail,
    width,
  }: TurnStatsProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const duration = formatDurationMs(durationMs);
  const contentWidth = Math.max(10, width - TRANSCRIPT_LAYOUT.detailIndent);

  const metricParts: string[] = [];
  if (toolCount > 0) {
    metricParts.push(
      toolCount === 1 ? "1 tool use" : `${toolCount} tool uses`,
    );
  }
  if (inputTokens || outputTokens) {
    const total = (inputTokens ?? 0) + (outputTokens ?? 0);
    metricParts.push(`${formatTokens(total)} tokens`);
  }
  const primaryLabel = status === "completed"
    ? `✻ Completed in ${duration}`
    : status === "cancelled"
    ? `! Cancelled after ${duration}`
    : `✗ Failed after ${duration}`;
  const primaryColor = status === "completed"
    ? sc.status.success
    : status === "cancelled"
    ? sc.status.warning
    : sc.status.error;

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      marginBottom={0}
      paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
    >
      <Box width={contentWidth} justifyContent="space-between">
        <Text color={primaryColor}>{primaryLabel}</Text>
        {metricParts.length > 0 && (
          <Text color={sc.text.muted}>{metricParts.join(" · ")}</Text>
        )}
      </Box>
      {summary && (
        <Box marginTop={1}>
          <Text color={sc.text.secondary}>{summary}</Text>
        </Box>
      )}
      {activityTrail && activityTrail.length > 0 && (
        <Box marginTop={summary ? 1 : 0} flexDirection="column">
          {activityTrail.map((label) => (
            <Box key={label}>
              <Text color={sc.text.muted}>{`· ${label}`}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
});
