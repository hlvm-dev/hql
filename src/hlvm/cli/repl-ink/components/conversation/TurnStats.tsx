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
import { formatTokens } from "../../../delegate-group-format.ts";
import type { TurnCompletionStatus } from "../../types.ts";

interface TurnStatsProps {
  toolCount: number;
  durationMs: number;
  width: number;
  inputTokens?: number;
  outputTokens?: number;
  modelId?: string;
  costUsd?: number;
  costEstimated?: boolean;
  continuedThisTurn?: boolean;
  continuationCount?: number;
  compactionReason?: "proactive_pressure" | "overflow_retry";
  status: TurnCompletionStatus;
  summary?: string;
  activityTrail?: string[];
}

function formatUsd(costUsd: number): string {
  if (costUsd >= 1) return `$${costUsd.toFixed(2)}`;
  if (costUsd >= 0.01) return `$${costUsd.toFixed(3)}`;
  return `$${costUsd.toFixed(4)}`;
}

export const TurnStats = React.memo(function TurnStats(
  {
    toolCount,
    durationMs,
    inputTokens,
    outputTokens,
    costUsd,
    costEstimated,
    continuationCount,
    compactionReason,
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
  if (typeof costUsd === "number" && Number.isFinite(costUsd)) {
    metricParts.push(
      costEstimated ? `${formatUsd(costUsd)} est.` : formatUsd(costUsd),
    );
  }
  if ((continuationCount ?? 0) > 0) {
    metricParts.push(
      continuationCount === 1
        ? "1 continuation"
        : `${continuationCount} continuations`,
    );
  }
  if (compactionReason) {
    metricParts.push(
      compactionReason === "proactive_pressure"
        ? "compacted"
        : "overflow retry",
    );
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
