/**
 * BackgroundTasks Panel
 *
 * Shows background HQL evaluation tasks (Claude Code style).
 * Tasks are created when user presses Ctrl+B during evaluation.
 * Model downloads are handled separately in ModelBrowser.
 */

import React, { useState, useEffect } from "npm:react@18";
import { Box, Text, useInput } from "npm:ink@5";
import { useTheme } from "../../theme/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";
import type { EvalTask } from "../../repl/task-manager/types.ts";
import { isEvalTask, isTaskActive } from "../../repl/task-manager/types.ts";

// ============================================================
// Types
// ============================================================

interface BackgroundTasksProps {
  onClose: () => void;
}

/** View mode for the panel */
type ViewMode = "list" | "result";

// ============================================================
// Task Item Component (Eval tasks only)
// ============================================================

function EvalTaskItem({
  task,
  isSelected,
}: {
  task: EvalTask;
  isSelected: boolean;
}): React.ReactElement {
  const { color } = useTheme();

  // Status icon and color
  let icon: string;
  let iconColor: string;

  switch (task.status) {
    case "running":
      icon = "⏳";
      iconColor = color("warning");
      break;
    case "pending":
      icon = "○";
      iconColor = color("muted");
      break;
    case "completed":
      icon = "✓";
      iconColor = color("success");
      break;
    case "failed":
      icon = "✗";
      iconColor = color("error");
      break;
    case "cancelled":
      icon = "○";
      iconColor = color("muted");
      break;
    default:
      icon = "?";
      iconColor = color("muted");
  }

  // Display name: truncated code preview
  const displayName = task.preview.length > 35
    ? task.preview.slice(0, 32) + "..."
    : task.preview.padEnd(35);

  // Status text based on task state
  let statusText: React.ReactNode;

  if (task.status === "running") {
    statusText = <Text dimColor>evaluating...</Text>;
  } else if (task.status === "completed") {
    statusText = <Text dimColor>done</Text>;
  } else if (task.status === "failed") {
    statusText = <Text color={color("error")}>failed</Text>;
  } else if (task.status === "cancelled") {
    statusText = <Text dimColor>cancelled</Text>;
  } else {
    statusText = <Text dimColor>{task.status}</Text>;
  }

  return (
    <Box>
      <Text inverse={isSelected}>
        <Text color={iconColor}>{icon}</Text>
        <Text> {displayName} </Text>
        {statusText}
        <Text dimColor> [Enter]</Text>
      </Text>
    </Box>
  );
}

// ============================================================
// Result View Component
// ============================================================

function ResultView({
  task,
  onClose,
}: {
  task: EvalTask;
  onClose: () => void;
}): React.ReactElement {
  const { color } = useTheme();
  const [scrollOffset, setScrollOffset] = useState(0);
  const maxVisibleLines = 15;

  // Format result for display
  const resultLines: string[] = [];
  if (task.status === "completed" && task.result !== undefined) {
    const resultStr = typeof task.result === "string"
      ? task.result
      : JSON.stringify(task.result, null, 2);
    resultLines.push(...resultStr.split("\n"));
  } else if (task.status === "failed" && task.error) {
    resultLines.push(`Error: ${task.error.message}`);
  } else if (task.status === "running") {
    resultLines.push("Still evaluating...");
  } else if (task.status === "cancelled") {
    resultLines.push("Evaluation was cancelled");
  }

  // Keyboard handling
  useInput((input, key) => {
    if (key.escape || input === "q") {
      onClose();
    }
    if (key.upArrow || input === "k") {
      setScrollOffset((o: number) => Math.max(0, o - 1));
    }
    if (key.downArrow || input === "j") {
      setScrollOffset((o: number) => Math.min(Math.max(0, resultLines.length - maxVisibleLines), o + 1));
    }
    // Page up/down
    if (key.pageUp || input === "u") {
      setScrollOffset((o: number) => Math.max(0, o - maxVisibleLines));
    }
    if (key.pageDown || input === "d") {
      setScrollOffset((o: number) => Math.min(Math.max(0, resultLines.length - maxVisibleLines), o + maxVisibleLines));
    }
    // Go to top/bottom
    if (input === "g") {
      setScrollOffset(0);
    }
    if (input === "G") {
      setScrollOffset(Math.max(0, resultLines.length - maxVisibleLines));
    }
  });

  const visibleLines = resultLines.slice(scrollOffset, scrollOffset + maxVisibleLines);
  const canScrollUp = scrollOffset > 0;
  const canScrollDown = scrollOffset + maxVisibleLines < resultLines.length;

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold color={color("primary")}> Result </Text>
      <Text dimColor>  {task.preview.slice(0, 50)}{task.preview.length > 50 ? "..." : ""}</Text>
      <Text> </Text>

      {canScrollUp && <Text dimColor>  ↑ more above...</Text>}

      {visibleLines.length === 0 ? (
        <Text dimColor>  (no result)</Text>
      ) : (
        visibleLines.map((line, i) => (
          <Box key={scrollOffset + i}>
            <Text> {line}</Text>
          </Box>
        ))
      )}

      {canScrollDown && <Text dimColor>  ↓ more below...</Text>}

      <Text> </Text>
      <Text dimColor>  ↑↓/jk scroll   u/d page   g/G top/bottom   q/Esc back</Text>
    </Box>
  );
}

// ============================================================
// Main Component
// ============================================================

export function BackgroundTasks({ onClose }: BackgroundTasksProps): React.ReactElement {
  const { color } = useTheme();
  const { tasks, cancel, clearCompleted, removeTask, getEvalResult } = useTaskManager();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [viewingTaskId, setViewingTaskId] = useState<string | null>(null);

  // Filter to eval tasks only (model downloads shown in ModelBrowser)
  const evalTasks = tasks.filter(isEvalTask);

  // Sort tasks: running first, then pending, then completed/failed/cancelled
  const sortedTasks = [...evalTasks].sort((a, b) => {
    const order: Record<string, number> = {
      running: 0,
      pending: 1,
      completed: 2,
      failed: 3,
      cancelled: 4,
    };
    return (order[a.status] ?? 5) - (order[b.status] ?? 5);
  });

  // Get the task being viewed (if any)
  const viewingTask = viewingTaskId
    ? sortedTasks.find((t) => t.id === viewingTaskId)
    : null;

  // Reset selection if out of bounds
  useEffect(() => {
    if (selectedIndex >= sortedTasks.length) {
      setSelectedIndex(Math.max(0, sortedTasks.length - 1));
    }
  }, [sortedTasks.length, selectedIndex]);

  // Keyboard handling for list view
  useInput((input, key) => {
    // Only handle list view here
    if (viewMode !== "list") return;

    // Navigation
    if (key.upArrow || input === "k") {
      setSelectedIndex((i: number) => Math.max(0, i - 1));
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((i: number) => Math.min(sortedTasks.length - 1, i + 1));
    }

    // View result
    if (key.return && sortedTasks[selectedIndex]) {
      const task = sortedTasks[selectedIndex];
      setViewingTaskId(task.id);
      setViewMode("result");
    }

    // Cancel/clear selected task
    // Note: For eval tasks, "cancel" marks it as cancelled and ignores the result,
    // but the underlying Promise may continue (JavaScript limitation).
    // True cancellation would require AbortController support in the evaluation chain.
    if (input === "x" && sortedTasks[selectedIndex]) {
      const task = sortedTasks[selectedIndex];
      if (isTaskActive(task)) {
        cancel(task.id);
      } else {
        removeTask(task.id);
      }
    }

    // Clear all completed
    if (input === "c") {
      clearCompleted();
    }

    // Close
    if (key.escape) {
      onClose();
    }
  });

  // Result view mode
  if (viewMode === "result" && viewingTask) {
    return (
      <ResultView
        task={viewingTask}
        onClose={() => {
          setViewMode("list");
          setViewingTaskId(null);
        }}
      />
    );
  }

  // List view
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold color={color("primary")}> Background Tasks </Text>
      <Text dimColor>  Press Ctrl+B while evaluating to push to background</Text>
      <Text> </Text>

      {sortedTasks.length === 0 ? (
        <Text dimColor>  No tasks</Text>
      ) : (
        sortedTasks.map((task, i) => (
          <Box key={task.id}>
            <EvalTaskItem task={task} isSelected={i === selectedIndex} />
          </Box>
        ))
      )}

      <Text> </Text>
      <Text dimColor>  ↑↓ navigate   Enter view   x dismiss   c clear done   Esc close</Text>
    </Box>
  );
}
