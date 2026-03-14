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
import type { EvalTask, DelegateTask, Task } from "../../repl/task-manager/types.ts";
import { isEvalTask, isDelegateTask, isTaskActive } from "../../repl/task-manager/types.ts";
import { calculateScrollWindow } from "../completion/navigation.ts";
import { formatEvalTaskResultLines } from "../utils/eval-task-results.ts";
import {
  ansi,
  bg,
  clearOverlay,
  fg,
  OVERLAY_BG_COLOR,
  type RGB,
  resolveOverlayFrame,
  shouldClearOverlay,
  themeToOverlayColors,
  writeToTerminal,
} from "../overlay/index.ts";
import { truncate } from "../../../../common/utils.ts";
import { padTo } from "../utils/formatting.ts";

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

const OVERLAY_WIDTH = 60;
const OVERLAY_HEIGHT = 20;
const PADDING = { top: 1, bottom: 1, left: 2, right: 2 };
const HEADER_ROWS = 3; // header + hint + empty
const CONTENT_START = PADDING.top + HEADER_ROWS;
const MIN_OVERLAY_WIDTH = 42;
const MIN_OVERLAY_HEIGHT = 12;

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
      resolveOverlayFrame(OVERLAY_WIDTH, OVERLAY_HEIGHT, {
        minWidth: MIN_OVERLAY_WIDTH,
        minHeight: MIN_OVERLAY_HEIGHT,
      }),
    [terminalColumns, terminalRows],
  );
  const contentWidth = Math.max(
    16,
    overlayFrame.width - PADDING.left - PADDING.right,
  );
  const visibleRows = Math.max(
    3,
    overlayFrame.height - CONTENT_START - PADDING.bottom - 1,
  );
  const previousFrameRef = useRef<typeof overlayFrame | null>(null);

  // Theme colors
  const colors = useMemo(() => ({
    ...themeToOverlayColors(theme),
    bgStyle: bg(OVERLAY_BG_COLOR),
  }), [theme]);

  // Filter and sort tasks — include both eval and delegate tasks
  const bgTasks = useMemo(() => {
    const filtered = tasks.filter((t: Task) => isEvalTask(t) || isDelegateTask(t));
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
            lines.push(`  ${ev.success ? "✓" : "✗"} ${ev.name}: ${ev.summary ?? ev.content ?? ""}`);
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

    // === Header row ===
    const headerY = overlayFrame.y + PADDING.top;
    const title = viewMode === "list" ? "Background Tasks" : "Result";
    const escHint = viewMode === "list" ? "esc close" : "esc back";

    drawRow(headerY, () => {
      output += " ".repeat(PADDING.left);
      output += fg(colors.primary) + ansi.bold + title + ansi.reset + bgStyle;
      const midPad = contentWidth - title.length - escHint.length;
      output += " ".repeat(midPad);
      output += fg(colors.muted) + escHint + ansi.reset + bgStyle;
      output += " ".repeat(PADDING.right);
      return overlayFrame.width;
    });

    // === Hint row ===
    const hintY = headerY + 1;
    const hintPreview = viewingTask
      ? (isEvalTask(viewingTask) ? (viewingTask as EvalTask).preview : viewingTask.label)
      : "";
    const hint = viewMode === "list"
      ? "Background agents & eval tasks"
      : truncate(hintPreview, contentWidth);

    drawRow(hintY, () => {
      output += " ".repeat(PADDING.left);
      output += fg(colors.muted) + hint + ansi.reset + bgStyle;
      return PADDING.left + hint.length;
    });

    // === Empty row after hint ===
    drawEmptyRow(hintY + 1);

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
        const rowY = overlayFrame.y + CONTENT_START + row;
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
              icon = "⏳";
              iconColor = colors.warning;
              break;
            case "completed":
              icon = "✓";
              iconColor = colors.success;
              break;
            case "failed":
              icon = "✗";
              iconColor = colors.error;
              break;
            case "cancelled":
              icon = "○";
              iconColor = colors.muted;
              break;
            default:
              icon = "○";
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

          // Build row with selection highlight
          if (isSelected) {
            output += bg(colors.warning) + ansi.fg(30, 30, 30);
          }

          let len = 0;

          // Selection indicator
          output += isSelected ? " ▸ " : "   ";
          len += 3;

          // Icon (using simpler ASCII for consistent width)
          output += fg(iconColor) + icon + ansi.reset;
          if (isSelected) output += bg(colors.warning) + ansi.fg(30, 30, 30);
          else output += bgStyle;
          output += " ";
          len += 2; // icon + space

          // Preview (truncated) — use preview for eval, label for delegate
          const previewMaxLen = Math.max(8, contentWidth - 15);
          const previewText = isEvalTask(task)
            ? (task as EvalTask).preview
            : task.label;
          const preview = padTo(
            truncate(previewText, previewMaxLen),
            previewMaxLen,
          );
          output += preview;
          len += previewMaxLen;

          // Status (right-aligned)
          const statusPadded = padTo(statusText, 10);
          if (!isSelected) output += fg(colors.muted);
          output += statusPadded;
          output += ansi.reset + bgStyle;
          len += 10;

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
        const rowY = overlayFrame.y + CONTENT_START + row;
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
            const truncatedLine = truncate(line, contentWidth);
            output += truncatedLine;
            return PADDING.left + truncatedLine.length;
          }
          return 0; // Empty row
        });
      }
    }

    // === Footer row ===
    const footerY = overlayFrame.y + overlayFrame.height - PADDING.bottom - 1;
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
      output += fg(colors.muted) + footerText + ansi.reset + bgStyle;
      const midPad = contentWidth - footerText.length - countText.length;
      output += " ".repeat(Math.max(1, midPad));
      output += countText;
      return PADDING.left + footerText.length + Math.max(1, midPad) +
        countText.length;
    });

    // === Bottom padding ===
    for (let i = 0; i < PADDING.bottom; i++) {
      drawEmptyRow(overlayFrame.y + overlayFrame.height - PADDING.bottom + i);
    }

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
