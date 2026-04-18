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
import { getCcTurnCompletionVerb } from "./cc-turn-copy.ts";

/** Format a token count as a compact human-readable string (e.g. 1.2k, 3.4M). */
function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

interface TurnStatsProps {
  id: string;
  toolCount: number;
  durationMs: number;
  width: number;
  inputTokens?: number;
  outputTokens?: number;
  modelId?: string;
  continuedThisTurn?: boolean;
  continuationCount?: number;
  compactionReason?: "proactive_pressure" | "overflow_retry";
  status: TurnCompletionStatus;
  summary?: string;
  activityTrail?: string[];
}

export const TurnStats = React.memo(function TurnStats(
  {
    id,
    toolCount,
    durationMs,
    inputTokens,
    outputTokens,
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
  const completionVerb = React.useMemo(
    () => getCcTurnCompletionVerb(`${id}:${status}:${durationMs}`),
    [durationMs, id, status],
  );

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
    ? `${completionVerb} for ${duration}`
    : status === "cancelled"
    ? `Cancelled after ${duration}`
    : `Failed after ${duration}`;
  const primaryColor = status === "completed"
    ? sc.text.muted
    : status === "cancelled"
    ? sc.status.warning
    : sc.status.error;
  const prefix = status === "completed"
    ? "✻"
    : status === "cancelled"
    ? "!"
    : "✗";
  const line = `${prefix} ${primaryLabel}${
    metricParts.length > 0 ? ` · ${metricParts.join(" · ")}` : ""
  }`;

  return (
    <Box
      marginTop={0}
      marginBottom={0}
      paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
      width={width}
    >
      <Text color={primaryColor} wrap="truncate-end">{line}</Text>
    </Box>
  );
});
