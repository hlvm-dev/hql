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

import React, { useState, useEffect, useCallback, useRef, useMemo } from "npm:react@18";
import { useInput } from "npm:ink@5";
import { useTheme } from "../../theme/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";
import type { EvalTask } from "../../repl/task-manager/types.ts";
import { isEvalTask, isTaskActive } from "../../repl/task-manager/types.ts";
import {
  clearOverlay,
  getTerminalSize,
  ansi,
  hexToRgb,
} from "../overlay/index.ts";

// ============================================================
// Types
// ============================================================

interface BackgroundTasksOverlayProps {
  onClose: () => void;
}

type ViewMode = "list" | "result";

type RGB = [number, number, number];

// ============================================================
// Layout Constants
// ============================================================

const OVERLAY_WIDTH = 60;
const OVERLAY_HEIGHT = 20;
const PADDING = { top: 1, bottom: 1, left: 2, right: 2 };
const HEADER_ROWS = 3;  // header + hint + empty
const CONTENT_START = PADDING.top + HEADER_ROWS;
const VISIBLE_ROWS = OVERLAY_HEIGHT - CONTENT_START - PADDING.bottom - 2; // -2 for footer
const BG_COLOR: RGB = [35, 35, 40];

// Shared encoder for terminal output
const encoder = new TextEncoder();

// ============================================================
// Helpers
// ============================================================

/** Calculate centered position */
function getOverlayPosition(): { x: number; y: number } {
  const term = getTerminalSize();
  return {
    x: Math.max(2, Math.floor((term.columns - OVERLAY_WIDTH) / 2)),
    y: Math.max(2, Math.floor((term.rows - OVERLAY_HEIGHT) / 2)),
  };
}

/** Create ANSI foreground color string from RGB */
function fg(rgb: RGB): string {
  return ansi.fg(rgb[0], rgb[1], rgb[2]);
}

/** Create ANSI background color string from RGB */
function bg(rgb: RGB): string {
  return ansi.bg(rgb[0], rgb[1], rgb[2]);
}

/** Truncate string to max length with ellipsis */
function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 3) + "..." : str;
}

/** Pad string to exact length */
function padTo(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

// ============================================================
// Component
// ============================================================

export function BackgroundTasksOverlay({
  onClose,
}: BackgroundTasksOverlayProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { tasks, cancel, clearCompleted, removeTask } = useTaskManager();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [viewingTaskId, setViewingTaskId] = useState<string | null>(null);
  const [resultScrollOffset, setResultScrollOffset] = useState(0);

  const overlayPosRef = useRef({ x: 0, y: 0 });
  const isFirstRender = useRef(true);

  // Theme colors
  const colors = useMemo(() => ({
    primary: hexToRgb(theme.primary) as RGB,
    success: hexToRgb(theme.success) as RGB,
    warning: hexToRgb(theme.warning) as RGB,
    error: hexToRgb(theme.error) as RGB,
    muted: hexToRgb(theme.muted) as RGB,
    accent: hexToRgb(theme.accent) as RGB,
    bgStyle: bg(BG_COLOR),
  }), [theme]);

  // Filter and sort tasks
  const evalTasks = useMemo(() => {
    const filtered = tasks.filter(isEvalTask);
    return [...filtered].sort((a, b) => {
      const order: Record<string, number> = {
        running: 0, pending: 1, completed: 2, failed: 3, cancelled: 4,
      };
      return (order[a.status] ?? 5) - (order[b.status] ?? 5);
    });
  }, [tasks]);

  // Get viewing task
  const viewingTask = viewingTaskId
    ? evalTasks.find((t: EvalTask) => t.id === viewingTaskId)
    : null;

  // Format result for display
  const resultLines = useMemo(() => {
    if (!viewingTask) return [];
    const lines: string[] = [];
    if (viewingTask.status === "completed" && viewingTask.result !== undefined) {
      const resultStr = typeof viewingTask.result === "string"
        ? viewingTask.result
        : JSON.stringify(viewingTask.result, null, 2);
      lines.push(...resultStr.split("\n"));
    } else if (viewingTask.status === "failed" && viewingTask.error) {
      lines.push(`Error: ${viewingTask.error.message}`);
    } else if (viewingTask.status === "running") {
      lines.push("Still evaluating...");
    } else if (viewingTask.status === "cancelled") {
      lines.push("Evaluation was cancelled");
    }
    return lines;
  }, [viewingTask]);

  // Reset selection if out of bounds
  useEffect(() => {
    if (selectedIndex >= evalTasks.length && evalTasks.length > 0) {
      setSelectedIndex(Math.max(0, evalTasks.length - 1));
    }
  }, [evalTasks.length, selectedIndex]);

  // Draw the overlay
  const drawOverlay = useCallback(() => {
    const pos = getOverlayPosition();
    overlayPosRef.current = pos;

    const contentWidth = OVERLAY_WIDTH - PADDING.left - PADDING.right;
    const bgStyle = colors.bgStyle;
    let output = ansi.cursorSave + ansi.cursorHide;

    // Helper: draw a row with exact OVERLAY_WIDTH (ensures full background coverage)
    // Takes a callback that appends content and returns visible char count
    const drawRow = (y: number, renderContent: () => number) => {
      output += ansi.cursorTo(pos.x, y) + bgStyle;
      const visibleLen = renderContent();
      // Pad to exact width
      const remaining = OVERLAY_WIDTH - visibleLen;
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
      drawEmptyRow(pos.y + i);
    }

    // === Header row ===
    const headerY = pos.y + PADDING.top;
    const title = viewMode === "list" ? "Background Tasks" : "Result";
    const escHint = "esc";

    drawRow(headerY, () => {
      output += " ".repeat(PADDING.left);
      output += fg(colors.primary) + ansi.bold + title + ansi.reset + bgStyle;
      const midPad = contentWidth - title.length - escHint.length;
      output += " ".repeat(midPad);
      output += fg(colors.muted) + escHint + ansi.reset + bgStyle;
      output += " ".repeat(PADDING.right);
      return OVERLAY_WIDTH;
    });

    // === Hint row ===
    const hintY = headerY + 1;
    const hint = viewMode === "list"
      ? "Type /bg during eval to push here"
      : truncate(viewingTask?.preview || "", contentWidth);

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
      const visibleTasks = evalTasks.slice(0, VISIBLE_ROWS);

      for (let row = 0; row < VISIBLE_ROWS; row++) {
        const rowY = pos.y + CONTENT_START + row;
        const task = visibleTasks[row];

        drawRow(rowY, () => {
          if (!task) {
            if (row === 0 && evalTasks.length === 0) {
              // Show "No tasks" message
              output += " ".repeat(PADDING.left);
              output += fg(colors.muted) + "No tasks" + ansi.reset + bgStyle;
              return PADDING.left + 8;
            }
            return 0;  // Empty row
          }

          const isSelected = row === selectedIndex;

          // Status icon and color
          let icon: string;
          let iconColor: RGB;
          switch (task.status) {
            case "running": icon = "⏳"; iconColor = colors.warning; break;
            case "completed": icon = "✓"; iconColor = colors.success; break;
            case "failed": icon = "✗"; iconColor = colors.error; break;
            case "cancelled": icon = "○"; iconColor = colors.muted; break;
            default: icon = "○"; iconColor = colors.muted;
          }

          // Status text
          let statusText: string;
          switch (task.status) {
            case "running": statusText = "running"; break;
            case "completed": statusText = "done"; break;
            case "failed": statusText = "failed"; break;
            case "cancelled": statusText = "cancelled"; break;
            default: statusText = task.status;
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
          len += 2;  // icon + space

          // Preview (truncated)
          const previewMaxLen = contentWidth - 15;
          const preview = padTo(truncate(task.preview, previewMaxLen), previewMaxLen);
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
      const maxResultRows = VISIBLE_ROWS;
      const visibleLines = resultLines.slice(resultScrollOffset, resultScrollOffset + maxResultRows);

      for (let row = 0; row < VISIBLE_ROWS; row++) {
        const rowY = pos.y + CONTENT_START + row;
        const line = visibleLines[row];

        drawRow(rowY, () => {
          if (row === 0 && resultScrollOffset > 0) {
            // Show "more above" indicator
            const text = "↑ more above...";
            output += " ".repeat(PADDING.left);
            output += fg(colors.muted) + text + ansi.reset + bgStyle;
            return PADDING.left + text.length;
          }
          if (row === VISIBLE_ROWS - 1 && resultScrollOffset + maxResultRows < resultLines.length) {
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
          return 0;  // Empty row
        });
      }
    }

    // === Footer row ===
    const footerY = pos.y + OVERLAY_HEIGHT - PADDING.bottom - 1;
    const footerText = viewMode === "list"
      ? "↑↓ nav  Enter view  x dismiss  c clear"
      : "↑↓ scroll  q/Esc back";
    const countText = viewMode === "list" && evalTasks.length > 0
      ? `${selectedIndex + 1}/${evalTasks.length}`
      : "";

    drawRow(footerY, () => {
      output += " ".repeat(PADDING.left);
      output += fg(colors.muted) + footerText + ansi.reset + bgStyle;
      const midPad = contentWidth - footerText.length - countText.length;
      output += " ".repeat(Math.max(1, midPad));
      output += countText;
      return PADDING.left + footerText.length + Math.max(1, midPad) + countText.length;
    });

    // === Bottom padding ===
    for (let i = 0; i < PADDING.bottom; i++) {
      drawEmptyRow(pos.y + OVERLAY_HEIGHT - PADDING.bottom + i);
    }

    output += ansi.reset + ansi.cursorRestore + ansi.cursorShow;

    Deno.stdout.writeSync(encoder.encode(output));
  }, [colors, evalTasks, selectedIndex, viewMode, viewingTask, resultLines, resultScrollOffset]);

  // Draw overlay on changes
  useEffect(() => {
    drawOverlay();
    isFirstRender.current = false;
  }, [drawOverlay]);

  // Clear overlay on unmount
  useEffect(() => {
    return () => {
      const pos = overlayPosRef.current;
      if (pos.x !== 0 || pos.y !== 0) {
        clearOverlay({
          x: pos.x,
          y: pos.y,
          width: OVERLAY_WIDTH,
          height: OVERLAY_HEIGHT,
        });
      }
    };
  }, []);

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
          Math.min(Math.max(0, resultLines.length - VISIBLE_ROWS), o + 1));
        return;
      }
      if (key.pageUp || input === "u") {
        setResultScrollOffset((o: number) => Math.max(0, o - VISIBLE_ROWS));
        return;
      }
      if (key.pageDown || input === "d") {
        setResultScrollOffset((o: number) =>
          Math.min(Math.max(0, resultLines.length - VISIBLE_ROWS), o + VISIBLE_ROWS));
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
    if (evalTasks.length === 0) {
      return;
    }

    if (key.upArrow || input === "k") {
      setSelectedIndex((i: number) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((i: number) => Math.min(evalTasks.length - 1, i + 1));
      return;
    }

    // View result
    if (key.return && evalTasks[selectedIndex]) {
      const task = evalTasks[selectedIndex];
      setViewingTaskId(task.id);
      setViewMode("result");
      setResultScrollOffset(0);
      return;
    }

    // Cancel/dismiss
    if (input === "x" && evalTasks[selectedIndex]) {
      const task = evalTasks[selectedIndex];
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
