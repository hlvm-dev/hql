/**
 * TaskBadge Component
 *
 * Shows a badge indicator when background tasks are active.
 * Displays in Banner: [↓2] for 2 active downloads
 */

import React from "npm:react@18";
import { Text, Box } from "npm:ink@5";
import { useTheme } from "../../theme/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";

// ============================================================
// Component
// ============================================================

export function TaskBadge(): React.ReactElement | null {
  const { color } = useTheme();
  const { activeCount, completedCount } = useTaskManager();

  // Don't show if no tasks
  if (activeCount === 0 && completedCount === 0) {
    return null;
  }

  return (
    <Box>
      {activeCount > 0 && (
        <Text color={color("warning")}>
          [↓{activeCount}]
        </Text>
      )}
      {completedCount > 0 && activeCount === 0 && (
        <Text color={color("success")}>
          [✓{completedCount}]
        </Text>
      )}
    </Box>
  );
}

// ============================================================
// Compact Badge (for inline use)
// ============================================================

export function TaskBadgeCompact(): React.ReactElement | null {
  const { color } = useTheme();
  const { activeCount } = useTaskManager();

  if (activeCount === 0) return null;

  return (
    <Text color={color("warning")}>↓{activeCount}</Text>
  );
}
