/**
 * ProgressBar Component
 *
 * Renders a text-based progress bar for downloads and other tasks.
 * Minimal design: ████████░░░░░░░░ 48%
 */

import React from "npm:react@18";
import { Text } from "npm:ink@5";
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

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

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
