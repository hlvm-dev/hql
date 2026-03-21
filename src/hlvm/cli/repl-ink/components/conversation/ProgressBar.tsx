/**
 * ProgressBar Component (conversation)
 *
 * Simple current/total progress bar for tool execution:
 * [████░░░░░░] 3/7
 */

import React from "react";
import { Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";

const FILLED_CHAR = "\u2588";
const EMPTY_CHAR = "\u2591";

export interface ProgressBarSegments {
  success: number;
  error: number;
  running: number;
  pending: number;
}

interface SimpleProgressBarProps {
  current: number;
  total: number;
  width?: number;
  mode?: "simple";
  showCounts?: boolean;
}

interface SegmentedProgressBarProps {
  mode: "segmented";
  total: number;
  width: number;
  segments: ProgressBarSegments;
  showCounts?: boolean;
}

type ProgressBarProps = SimpleProgressBarProps | SegmentedProgressBarProps;

export function computeSegmentedProgressCells(
  segments: ProgressBarSegments,
  total: number,
  width: number,
): ProgressBarSegments {
  const safeWidth = Math.max(0, width);
  const safeTotal = Math.max(1, total || 1);
  const rawEntries = [
    ["success", Math.max(0, segments.success)],
    ["error", Math.max(0, segments.error)],
    ["running", Math.max(0, segments.running)],
    ["pending", Math.max(0, segments.pending)],
  ] as const;
  const entries = rawEntries.map(([key, value]) => {
    const exact = (value / safeTotal) * safeWidth;
    return {
      key,
      value,
      whole: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  let remaining = safeWidth - entries.reduce((sum, entry) => sum + entry.whole, 0);
  const distributeOrder = [...entries].sort((a, b) => {
    if (b.remainder === a.remainder) return 0;
    return b.remainder - a.remainder;
  });

  while (remaining > 0) {
    const next = distributeOrder.find((entry) => entry.value > 0);
    if (!next) break;
    next.whole += 1;
    remaining -= 1;
    distributeOrder.push(distributeOrder.shift()!);
  }

  return {
    success: entries.find((entry) => entry.key === "success")?.whole ?? 0,
    error: entries.find((entry) => entry.key === "error")?.whole ?? 0,
    running: entries.find((entry) => entry.key === "running")?.whole ?? 0,
    pending: entries.find((entry) => entry.key === "pending")?.whole ?? 0,
  };
}

export const ProgressBar = React.memo(function ProgressBar(
  props: ProgressBarProps,
): React.ReactElement {
  const sc = useSemanticColors();

  if (props.mode === "segmented") {
    const safeTotal = Math.max(1, props.total || 1);
    const cells = computeSegmentedProgressCells(
      props.segments,
      safeTotal,
      Math.max(3, props.width),
    );
    const completeCount = props.segments.success + props.segments.error;

    return (
      <Text>
        <Text color={sc.text.muted}>[</Text>
        <Text color={sc.tool.success}>{FILLED_CHAR.repeat(cells.success)}</Text>
        <Text color={sc.tool.error}>{FILLED_CHAR.repeat(cells.error)}</Text>
        <Text color={sc.tool.running}>{FILLED_CHAR.repeat(cells.running)}</Text>
        <Text color={sc.text.muted}>{EMPTY_CHAR.repeat(cells.pending)}</Text>
        <Text color={sc.text.muted}>]</Text>
        {props.showCounts !== false && (
          <Text color={sc.text.muted}> {completeCount}/{safeTotal}</Text>
        )}
      </Text>
    );
  }

  const { current, total, width = 10, showCounts = true } = props;

  // Defensive: clamp values
  const safeTotal = Math.max(1, total || 1);
  const safeCurrent = Math.max(0, Math.min(safeTotal, current || 0));
  const safeWidth = Math.max(3, width);

  const ratio = safeCurrent / safeTotal;
  const filled = Math.round(ratio * safeWidth);
  const empty = safeWidth - filled;

  const bar = FILLED_CHAR.repeat(filled) + EMPTY_CHAR.repeat(empty);

  return (
    <Text>
      <Text color={sc.tool.running}>[{bar}]</Text>
      {showCounts && <Text color={sc.text.muted}> {safeCurrent}/{safeTotal}</Text>}
    </Text>
  );
});
