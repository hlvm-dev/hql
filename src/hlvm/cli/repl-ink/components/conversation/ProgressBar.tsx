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

interface ProgressBarProps {
  current: number;
  total: number;
  width?: number;
}

export const ProgressBar = React.memo(function ProgressBar({
  current,
  total,
  width = 10,
}: ProgressBarProps): React.ReactElement {
  const sc = useSemanticColors();

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
      <Text color={sc.text.muted}> {safeCurrent}/{safeTotal}</Text>
    </Text>
  );
});
