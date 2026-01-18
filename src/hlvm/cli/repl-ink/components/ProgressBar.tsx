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

/**
 * Format elapsed time
 */
function formatElapsed(startTime: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  if (elapsed < 60) return `${elapsed}s ago`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  return `${Math.floor(elapsed / 3600)}h ago`;
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

// ============================================================
// Inline Progress (with size info)
// ============================================================

interface InlineProgressProps {
  /** Completed bytes */
  completed?: number;
  /** Total bytes */
  total?: number;
  /** Status text (fallback if no bytes) */
  status?: string;
  /** Bar width */
  width?: number;
}

/**
 * Inline progress with size: ████████░░░░░░░░ 48% 7.1/14.7GB
 */
function InlineProgress({
  completed,
  total,
  status,
  width = 16,
}: InlineProgressProps): React.ReactElement {
  // Calculate percent
  const percent = total && completed ? Math.round((completed / total) * 100) : 0;

  // If no total, show status text
  if (!total) {
    return <Text dimColor>{status || "..."}</Text>;
  }

  return (
    <Text>
      <ProgressBar percent={percent} width={width} showPercent />
      <Text dimColor> {formatBytes(completed || 0)}/{formatBytes(total)}</Text>
    </Text>
  );
}
