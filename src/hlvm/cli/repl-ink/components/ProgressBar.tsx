/**
 * ProgressBar Component
 *
 * Renders a text-based progress bar for downloads and other tasks.
 * Minimal design: ████████░░░░░░░░ 48%
 */

import React from "react";
import { Text } from "ink";
import { useTheme } from "../../theme/index.ts";

// ============================================================
// Constants
// ============================================================

const FILLED_CHAR = "█";
const EMPTY_CHAR = "░";

// ============================================================
// Types
// ============================================================

interface ProgressBarProps {
  /** Progress percentage (0-100) */
  percent: number;
  /** Width in characters (default: 16) */
  width?: number;
  /** Show percentage text after bar */
  showPercent?: boolean;
  /** Color variant */
  variant?: "default" | "success" | "error";
}

// ============================================================
// Helpers
// ============================================================

export { formatBytes } from "../../../../common/limits.ts";

// ============================================================
// Component
// ============================================================

export function ProgressBar({
  percent,
  width = 16,
  showPercent = true,
  variant = "default",
}: ProgressBarProps): React.ReactElement {
  const { color } = useTheme();

  // Clamp percent to 0-100, handling NaN
  const safePercent = isNaN(percent) ? 0 : percent;
  const clampedPercent = Math.max(0, Math.min(100, safePercent));
  const filled = Math.round((clampedPercent / 100) * width);
  const empty = width - filled;

  // Build bar string
  const bar = FILLED_CHAR.repeat(filled) + EMPTY_CHAR.repeat(empty);

  // Determine color based on variant
  let barColor: string;
  switch (variant) {
    case "success":
      barColor = color("success");
      break;
    case "error":
      barColor = color("error");
      break;
    default:
      barColor = color("primary");
  }

  return (
    <Text>
      <Text color={barColor}>{bar}</Text>
      {showPercent && <Text dimColor> {Math.round(clampedPercent)}%</Text>}
    </Text>
  );
}
