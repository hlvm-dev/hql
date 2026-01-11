/**
 * BackgroundTasks Panel
 *
 * Shows all background tasks with progress.
 * Allows canceling running tasks and clearing completed ones.
 */

import React, { useState, useEffect } from "npm:react@18";
import { Box, Text, useInput } from "npm:ink@5";
import { useTheme } from "../../theme/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";
import { ProgressBar, formatBytes, formatElapsed } from "./ProgressBar.tsx";
import type { Task, ModelPullTask } from "../../repl/task-manager/types.ts";
import { isModelPullTask, isTaskActive } from "../../repl/task-manager/types.ts";

// ============================================================
// Types
// ============================================================

interface BackgroundTasksProps {
  onClose: () => void;
}

// ============================================================
// Task Item Component
// ============================================================

function TaskItem({
  task,
  isSelected,
}: {
  task: Task;
  isSelected: boolean;
}): React.ReactElement {
  const { color } = useTheme();

  // Get status icon
  let icon: string;
  let iconColor: string;
  switch (task.status) {
    case "running":
      icon = "↓";
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

  // Get model name for pull tasks
  const name = isModelPullTask(task) ? (task as ModelPullTask).modelName : task.label;
  const displayName = name.length > 20 ? name.slice(0, 17) + "..." : name.padEnd(20);

  // Build progress/status text
  let statusText: React.ReactNode;
  if (task.status === "running" && isModelPullTask(task)) {
    const pullTask = task as ModelPullTask;
    const { progress } = pullTask;
    if (progress.total && progress.completed) {
      statusText = (
        <>
          <ProgressBar percent={progress.percent || 0} width={12} showPercent={true} />
          <Text dimColor> {formatBytes(progress.completed)}/{formatBytes(progress.total)}</Text>
        </>
      );
    } else {
      statusText = <Text dimColor>{progress.status || "..."}</Text>;
    }
  } else if (task.status === "completed") {
    statusText = (
      <Text dimColor>
        completed {task.completedAt ? formatElapsed(task.completedAt) : ""}
      </Text>
    );
  } else if (task.status === "failed") {
    statusText = <Text color={color("error")}>failed: {task.error?.message || "unknown"}</Text>;
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
        <Text dimColor> [x]</Text>
      </Text>
    </Box>
  );
}

// ============================================================
// Main Component
// ============================================================

export function BackgroundTasks({ onClose }: BackgroundTasksProps): React.ReactElement {
  const { color } = useTheme();
  const { tasks, cancel, clearCompleted, removeTask } = useTaskManager();
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Sort tasks: running first, then pending, then completed/failed/cancelled
  const sortedTasks = [...tasks].sort((a, b) => {
    const order: Record<string, number> = {
      running: 0,
      pending: 1,
      completed: 2,
      failed: 3,
      cancelled: 4,
    };
    return (order[a.status] ?? 5) - (order[b.status] ?? 5);
  });

  // Reset selection if out of bounds
  useEffect(() => {
    if (selectedIndex >= sortedTasks.length) {
      setSelectedIndex(Math.max(0, sortedTasks.length - 1));
    }
  }, [sortedTasks.length, selectedIndex]);

  // Keyboard handling
  useInput((input, key) => {
    // Navigation
    if (key.upArrow || input === "k") {
      setSelectedIndex((i: number) => Math.max(0, i - 1));
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((i: number) => Math.min(sortedTasks.length - 1, i + 1));
    }

    // Cancel/clear selected task
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

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold color={color("primary")}> Background Tasks </Text>
      <Text> </Text>

      {sortedTasks.length === 0 ? (
        <Text dimColor>  No tasks</Text>
      ) : (
        sortedTasks.map((task, i) => (
          <Box key={task.id}>
            <TaskItem task={task} isSelected={i === selectedIndex} />
          </Box>
        ))
      )}

      <Text> </Text>
      <Text dimColor>  ↑↓ navigate   x cancel/clear   c clear all done   Esc close</Text>
    </Box>
  );
}
