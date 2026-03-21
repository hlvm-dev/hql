/**
 * Background Tasks Overlay
 *
 * True floating overlay for managing background HQL evaluation tasks.
 * Uses raw ANSI escape codes for absolute positioning (same pattern as CommandPaletteOverlay).
 *
 * Features:
 * - True floating overlay (doesn't push content down)
 * - Task list with status indicators
 * - Result viewing for completed tasks
 * - Cancel/dismiss actions
 * - Theme-aware colors
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useInput, useStdout } from "ink";
import { useTheme } from "../../theme/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";
import {
  type DelegateTask,
  type EvalTask,
  isDelegateTask,
  isEvalTask,
  isTaskActive,
  type Task,
} from "../../repl/task-manager/types.ts";
import { calculateScrollWindow } from "../completion/navigation.ts";
import { formatEvalTaskResultLines } from "../utils/eval-task-results.ts";
import {
  ansi,
  BACKGROUND_TASKS_OVERLAY_SPEC,
  bg,
  clearOverlay,
  drawOverlayFrame,
  fg,
  OVERLAY_BG_COLOR,
  resolveOverlayChromeLayout,
  resolveOverlayFrame,
  type RGB,
  shouldClearOverlay,
  themeToOverlayColors,
  writeToTerminal,
} from "../overlay/index.ts";
import { truncate } from "../../../../common/utils.ts";
import { padTo } from "../utils/formatting.ts";
import { STATUS_GLYPHS } from "../ui-constants.ts";
import {
  buildBalancedTextRow,
  buildRightSlotTextLayout,
  buildSectionLabelText,
} from "../utils/display-chrome.ts";

// ============================================================
// Types
// ============================================================

interface BackgroundTasksOverlayProps {
  onClose: () => void;
}

type ViewMode = "list" | "result";

// ============================================================
// Layout Constants
// ============================================================

const PADDING = BACKGROUND_TASKS_OVERLAY_SPEC.padding;

interface BackgroundTaskSummaryCounts {
  active: number;
  completed: number;
  failed: number;
  cancelled: number;
}

function getBackgroundTaskSummaryCounts(
  tasks: Task[],
): BackgroundTaskSummaryCounts {
  return tasks.reduce<BackgroundTaskSummaryCounts>(
    (summary, task) => {
      if (isTaskActive(task)) {
        summary.active += 1;
      } else if (task.status === "completed") {
        summary.completed += 1;
      } else if (task.status === "failed") {
        summary.failed += 1;
      } else if (task.status === "cancelled") {
        summary.cancelled += 1;
      }
      return summary;
    },
    { active: 0, completed: 0, failed: 0, cancelled: 0 },
  );
}

function getBackgroundTaskPreview(task: Task): string {
  return isEvalTask(task) ? task.preview : task.label;
}

export function buildBackgroundTasksSummaryRows(
  tasks: Task[],
  {
    viewMode,
    selectedIndex,
    viewingTask,
    resultLines,
  }: {
    viewMode: ViewMode;
    selectedIndex: number;
    viewingTask: Task | null;
    resultLines: string[];
  },
  contentWidth: number,
): [string, string] {
  if (viewMode === "result" && viewingTask) {
    const primary = buildBalancedTextRow(
      contentWidth,
      `Status ${viewingTask.status}`,
      resultLines.length === 1 ? "1 line" : `${resultLines.length} lines`,
    );
    const secondary = buildBalancedTextRow(
      contentWidth,
      getBackgroundTaskPreview(viewingTask),
      isTaskActive(viewingTask) ? "running" : "saved result",
    );
    return [
      primary.leftText + " ".repeat(primary.gapWidth) + primary.rightText,
      secondary.leftText + " ".repeat(secondary.gapWidth) + secondary.rightText,
    ];
  }

  const counts = getBackgroundTaskSummaryCounts(tasks);
  const primary = buildBalancedTextRow(
    contentWidth,
    `Active ${counts.active} · Done ${counts.completed}`,
    `Failed ${counts.failed} · Cancelled ${counts.cancelled}`,
  );
  const secondary = buildBalancedTextRow(
    contentWidth,
    "Eval + delegate tasks",
    tasks.length > 0
      ? `Selected ${selectedIndex + 1}/${tasks.length}`
      : "Selected 0/0",
  );
  return [
    primary.leftText + " ".repeat(primary.gapWidth) + primary.rightText,
    secondary.leftText + " ".repeat(secondary.gapWidth) + secondary.rightText,
  ];
}

export function formatBackgroundTaskResultLine(
  line: string,
  contentWidth: number,
): string {
  const sectionMatch = /^---\s+(.+?)\s+---$/.exec(line.trim());
  if (!sectionMatch) return truncate(line, contentWidth);
  return buildSectionLabelText(sectionMatch[1], contentWidth);
}

// ============================================================
// Component
// ============================================================

export function BackgroundTasksOverlay({
  onClose,
}: BackgroundTasksOverlayProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { stdout } = useStdout();
  const { tasks, cancel, clearCompleted, removeTask } = useTaskManager();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [viewingTaskId, setViewingTaskId] = useState<string | null>(null);
  const [resultScrollOffset, setResultScrollOffset] = useState(0);
  const terminalColumns = stdout?.columns ?? 0;
  const terminalRows = stdout?.rows ?? 0;
  const overlayFrame = useMemo(
    () =>
      resolveOverlayFrame(
        BACKGROUND_TASKS_OVERLAY_SPEC.width,
        BACKGROUND_TASKS_OVERLAY_SPEC.height,
        {
          minWidth: BACKGROUND_TASKS_OVERLAY_SPEC.minWidth,
          minHeight: BACKGROUND_TASKS_OVERLAY_SPEC.minHeight,
        },
      ),
    [terminalColumns, terminalRows],
  );
  const chromeLayout = useMemo(
    () =>
      resolveOverlayChromeLayout(
        overlayFrame.height,
        BACKGROUND_TASKS_OVERLAY_SPEC,
      ),
    [overlayFrame.height],
  );
  const contentWidth = Math.max(
    16,
    overlayFrame.width - PADDING.left - PADDING.right,
  );
  const visibleRows = Math.max(
    3,
    chromeLayout.visibleRows,
  );
  const previousFrameRef = useRef<typeof overlayFrame | null>(null);

  // Theme colors
  const colors = useMemo(() => ({
    ...themeToOverlayColors(theme),
    bgStyle: bg(OVERLAY_BG_COLOR),
  }), [theme]);

  // Filter and sort tasks — include both eval and delegate tasks
  const bgTasks = useMemo(() => {
    const filtered = tasks.filter((t: Task) =>
      isEvalTask(t) || isDelegateTask(t)
    );
    // Sort: active first, then by creation time descending
    return filtered.sort((a: Task, b: Task) => {
      const aActive = isTaskActive(a) ? 0 : 1;
      const bActive = isTaskActive(b) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return b.createdAt - a.createdAt;
    });
  }, [tasks]);

  // Get viewing task
  const viewingTask = viewingTaskId
    ? bgTasks.find((t: Task) => t.id === viewingTaskId)
    : null;

  // Format result for display
  const resultLines = useMemo(() => {
    if (!viewingTask) return [];
    if (isEvalTask(viewingTask)) {
      return formatEvalTaskResultLines(viewingTask);
    }
    if (isDelegateTask(viewingTask)) {
      const dt = viewingTask as DelegateTask;
      const lines: string[] = [];
      lines.push(`Agent: ${dt.nickname} [${dt.agent}]`);
      lines.push(`Task: ${dt.task}`);
      lines.push(`Status: ${dt.status}`);
      if (dt.threadId) lines.push(`Thread: ${dt.threadId}`);
      if (dt.childSessionId) lines.push(`Session: ${dt.childSessionId}`);
      if (dt.summary) {
        lines.push("", "--- Result ---", ...dt.summary.split("\n"));
      }
      if (dt.error) {
        lines.push("", "--- Error ---", ...String(dt.error).split("\n"));
      }
      if (dt.snapshot?.events.length) {
        lines.push("", "--- Events ---");
        for (const ev of dt.snapshot.events) {
          if (ev.type === "tool_end") {
            lines.push(
              `  ${ev.success ? "✓" : "✗"} ${ev.name}: ${
                ev.summary ?? ev.content ?? ""
              }`,
            );
          }
        }
      }
      return lines;
    }
    return [];
  }, [viewingTask]);

  // Reset selection if out of bounds
  useEffect(() => {
    if (selectedIndex >= bgTasks.length && bgTasks.length > 0) {
      setSelectedIndex(Math.max(0, bgTasks.length - 1));
    }
  }, [bgTasks.length, selectedIndex]);

  // Draw the overlay
  const drawOverlay = useCallback(() => {
    if (shouldClearOverlay(previousFrameRef.current, overlayFrame)) {
      clearOverlay(previousFrameRef.current!);
    }
    previousFrameRef.current = overlayFrame;

    const bgStyle = colors.bgStyle;
    let output = ansi.cursorSave + ansi.cursorHide;

    // Helper: draw a row with exact OVERLAY_WIDTH (ensures full background coverage)
    // Takes a callback that appends content and returns visible char count
    const drawRow = (y: number, renderContent: () => number) => {
      output += ansi.cursorTo(overlayFrame.x, y) + bgStyle;
      const visibleLen = renderContent();
      // Pad to exact width
      const remaining = overlayFrame.width - visibleLen;
      if (remaining > 0) {
        output += " ".repeat(remaining);
      }
    };

    // Helper: draw empty row
    const drawEmptyRow = (y: number) => {
      drawRow(y, () => 0);
    };

    // === Top padding ===
    for (let i = 0; i < PADDING.top; i++) {
      drawEmptyRow(overlayFrame.y + i);
    }

    const headerY = overlayFrame.y + PADDING.top;
    const title = viewMode === "list" ? "Background Tasks" : "Result";
    const escHint = viewMode === "list" ? "esc close" : "esc back";

    const [summaryText, hintText] = buildBackgroundTasksSummaryRows(
      bgTasks,
      {
        viewMode,
        selectedIndex,
        viewingTask,
        resultLines,
      },
      contentWidth,
    );

    drawRow(headerY, () => {
      output += " ".repeat(PADDING.left);
      output += fg(colors.accent) + summaryText + ansi.reset + bgStyle;
      return PADDING.left + summaryText.length;
    });

    drawRow(headerY + 1, () => {
      output += " ".repeat(PADDING.left);
      output += fg(colors.muted) + hintText + ansi.reset + bgStyle;
      return PADDING.left + hintText.length;
    });

    // === Content rows ===
    if (viewMode === "list") {
      // Task list view
      const window = calculateScrollWindow(
        selectedIndex,
        bgTasks.length,
        visibleRows,
      );
      const visibleTasks = bgTasks.slice(window.start, window.end);

      for (let row = 0; row < visibleRows; row++) {
        const rowY = overlayFrame.y + chromeLayout.contentStart + row;
        const task = visibleTasks[row];

        drawRow(rowY, () => {
          if (!task) {
            if (row === 0 && bgTasks.length === 0) {
              // Show "No tasks" message
              output += " ".repeat(PADDING.left);
              output += fg(colors.muted) + "No tasks" + ansi.reset + bgStyle;
              return PADDING.left + 8;
            }
            return 0; // Empty row
          }

          const actualIndex = window.start + row;
          const isSelected = actualIndex === selectedIndex;

          // Status icon and color
          let icon: string;
          let iconColor: RGB;
          switch (task.status) {
            case "running":
              icon = STATUS_GLYPHS.running;
              iconColor = colors.warning;
              break;
            case "completed":
              icon = STATUS_GLYPHS.success;
              iconColor = colors.success;
              break;
            case "failed":
              icon = STATUS_GLYPHS.error;
              iconColor = colors.error;
              break;
            case "cancelled":
              icon = STATUS_GLYPHS.pending;
              iconColor = colors.muted;
              break;
            default:
              icon = STATUS_GLYPHS.pending;
              iconColor = colors.muted;
          }

          // Status text
          let statusText: string;
          switch (task.status) {
            case "running":
              statusText = "running";
              break;
            case "completed":
              statusText = "done";
              break;
            case "failed":
              statusText = "failed";
              break;
            case "cancelled":
              statusText = "cancelled";
              break;
            default:
              statusText = task.status;
          }

          if (isSelected) {
            output += bg(colors.warning) + ansi.fg(30, 30, 30);
          }

          let len = 0;

          output += " ".repeat(PADDING.left);
          len += PADDING.left;
          output += isSelected ? "▸ " : "  ";
          len += 2;
          output += fg(iconColor) + icon + ansi.reset;
          if (isSelected) output += bg(colors.warning) + ansi.fg(30, 30, 30);
          else output += bgStyle;
          output += " ";
          len += 2;

          const rowLayout = buildRightSlotTextLayout(
            Math.max(8, contentWidth - 4),
            getBackgroundTaskPreview(task),
            statusText,
            10,
          );
          output += rowLayout.leftText;
          output += " ".repeat(rowLayout.gapWidth);
          if (!isSelected) output += fg(colors.muted);
          output += padTo(rowLayout.rightText, 10);
          output += ansi.reset + bgStyle;
          len += rowLayout.leftText.length + rowLayout.gapWidth + 10;

          return len;
        });
      }
    } else {
      // Result view
      const maxResultRows = visibleRows;
      const visibleLines = resultLines.slice(
        resultScrollOffset,
        resultScrollOffset + maxResultRows,
      );

      for (let row = 0; row < visibleRows; row++) {
        const rowY = overlayFrame.y + chromeLayout.contentStart + row;
        const line = visibleLines[row];

        drawRow(rowY, () => {
          if (row === 0 && resultScrollOffset > 0) {
            // Show "more above" indicator
            const text = "↑ more above...";
            output += " ".repeat(PADDING.left);
            output += fg(colors.muted) + text + ansi.reset + bgStyle;
            return PADDING.left + text.length;
          }
          if (
            row === visibleRows - 1 &&
            resultScrollOffset + maxResultRows < resultLines.length
          ) {
            // Show "more below" indicator
            const text = "↓ more below...";
            output += " ".repeat(PADDING.left);
            output += fg(colors.muted) + text + ansi.reset + bgStyle;
            return PADDING.left + text.length;
          }
          if (line !== undefined) {
            output += " ".repeat(PADDING.left);
            const truncatedLine = formatBackgroundTaskResultLine(
              line,
              contentWidth,
            );
            output += truncatedLine;
            return PADDING.left + truncatedLine.length;
          }
          return 0; // Empty row
        });
      }
    }

    // === Footer row ===
    const footerY = overlayFrame.y + chromeLayout.footerY;
    const footerText = truncate(
      viewMode === "list"
        ? "↑↓ nav  Enter view  x dismiss  c clear"
        : "↑↓ scroll  q/Esc back",
      contentWidth,
    );
    const countText = viewMode === "list" && bgTasks.length > 0
      ? `${selectedIndex + 1}/${bgTasks.length}`
      : "";

    drawRow(footerY, () => {
      output += " ".repeat(PADDING.left);
      const footerLayout = buildBalancedTextRow(
        contentWidth,
        footerText,
        countText,
      );
      output += fg(colors.muted) + footerLayout.leftText + ansi.reset + bgStyle;
      output += " ".repeat(footerLayout.gapWidth);
      output += fg(colors.muted) + footerLayout.rightText + ansi.reset +
        bgStyle;
      return PADDING.left + footerLayout.leftText.length +
        footerLayout.gapWidth +
        footerLayout.rightText.length;
    });

    // === Bottom padding ===
    for (let i = 0; i < PADDING.bottom; i++) {
      drawEmptyRow(overlayFrame.y + overlayFrame.height - PADDING.bottom + i);
    }

    output += drawOverlayFrame(overlayFrame, {
      borderColor: colors.accent,
      backgroundColor: OVERLAY_BG_COLOR,
      title,
      rightText: escHint,
    });
    output += ansi.reset + ansi.cursorRestore + ansi.cursorShow;

    writeToTerminal(output);
  }, [
    colors,
    bgTasks,
    selectedIndex,
    viewMode,
    viewingTask,
    resultLines,
    resultScrollOffset,
    contentWidth,
    chromeLayout.contentStart,
    chromeLayout.footerY,
    overlayFrame,
    visibleRows,
  ]);

  // Draw overlay on changes
  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  // Keyboard handling
  useInput((input, key) => {
    if (viewMode === "result") {
      // Result view navigation
      if (key.escape || input === "q") {
        setViewMode("list");
        setViewingTaskId(null);
        setResultScrollOffset(0);
        return;
      }
      if (key.upArrow || input === "k") {
        setResultScrollOffset((o: number) => Math.max(0, o - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setResultScrollOffset((o: number) =>
          Math.min(Math.max(0, resultLines.length - visibleRows), o + 1)
        );
        return;
      }
      if (key.pageUp || input === "u") {
        setResultScrollOffset((o: number) => Math.max(0, o - visibleRows));
        return;
      }
      if (key.pageDown || input === "d") {
        setResultScrollOffset((o: number) =>
          Math.min(
            Math.max(0, resultLines.length - visibleRows),
            o + visibleRows,
          )
        );
        return;
      }
      return;
    }

    // List view
    if (key.escape) {
      onClose();
      return;
    }

    // Guard: no navigation when list is empty
    if (bgTasks.length === 0) {
      return;
    }

    if (key.upArrow || input === "k") {
      setSelectedIndex((i: number) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((i: number) => Math.min(bgTasks.length - 1, i + 1));
      return;
    }

    // View result
    if (key.return && bgTasks[selectedIndex]) {
      const task = bgTasks[selectedIndex];
      setViewingTaskId(task.id);
      setViewMode("result");
      setResultScrollOffset(0);
      return;
    }

    // Cancel/dismiss
    if (input === "x" && bgTasks[selectedIndex]) {
      const task = bgTasks[selectedIndex];
      if (isTaskActive(task)) {
        cancel(task.id);
      } else {
        removeTask(task.id);
      }
      return;
    }

    // Clear all completed
    if (input === "c") {
      clearCompleted();
      return;
    }
  });

  // Return null - we render directly to terminal
  return null;
}
