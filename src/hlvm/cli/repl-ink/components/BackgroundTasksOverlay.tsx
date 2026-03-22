/**
 * Tasks Overlay — Claude Code-Style Task Management
 *
 * True floating overlay showing both agent team tasks (TaskCreate/TaskUpdate)
 * and background eval/delegate tasks. Matches Claude Code's task management TUI:
 *
 * - Team tasks shown with ○ pending / ● in_progress / ✓ completed status
 * - Task IDs (#1, #2) and owner/assignee
 * - activeForm text shown for in_progress tasks
 * - Background eval/delegate tasks in a separate section
 * - ↑↓ navigation, Enter to view, x to dismiss, c to clear
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
import type { TaskBoardItem } from "../hooks/useTeamState.ts";
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
  buildSectionLabelText,
} from "../utils/display-chrome.ts";

// ============================================================
// Types
// ============================================================

interface BackgroundTasksOverlayProps {
  onClose: () => void;
  /** Team tasks from teamState.taskBoard (Claude Code TaskCreate/TaskUpdate). */
  teamTasks?: TaskBoardItem[];
}

type ViewMode = "list" | "result";

/**
 * Unified task item displayed in the overlay.
 * Wraps both team tasks (TaskBoardItem) and eval/delegate tasks (Task).
 */
export interface UnifiedTaskItem {
  id: string;
  kind: "team" | "eval" | "delegate" | "section";
  label: string;
  status: string;
  statusText: string;
  icon: string;
  iconColor: RGB;
  owner?: string;
  blocked: boolean;
  activeForm?: string;
  /** Original task reference for actions. */
  bgTask?: Task;
  teamTask?: TaskBoardItem;
}

// ============================================================
// Layout Constants
// ============================================================

const PADDING = BACKGROUND_TASKS_OVERLAY_SPEC.padding;

interface TaskSummaryCounts {
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
}

function getTaskSummaryCounts(items: UnifiedTaskItem[]): TaskSummaryCounts {
  return items.reduce<TaskSummaryCounts>(
    (counts, item) => {
      if (item.kind === "section") return counts;
      if (item.status === "pending" || item.status === "blocked") counts.pending++;
      else if (item.status === "in_progress" || item.status === "running") counts.inProgress++;
      else if (item.status === "completed") counts.completed++;
      else if (item.status === "failed") counts.failed++;
      return counts;
    },
    { pending: 0, inProgress: 0, completed: 0, failed: 0 },
  );
}

export function buildBackgroundTasksSummaryRows(
  items: UnifiedTaskItem[],
  {
    viewMode,
    selectedIndex,
    viewingItem,
    resultLines,
  }: {
    viewMode: ViewMode;
    selectedIndex: number;
    viewingItem: UnifiedTaskItem | null;
    resultLines: string[];
  },
  contentWidth: number,
): [string, string] {
  if (viewMode === "result" && viewingItem) {
    const primary = buildBalancedTextRow(
      contentWidth,
      `Status ${viewingItem.statusText}`,
      resultLines.length === 1 ? "1 line" : `${resultLines.length} lines`,
    );
    const secondary = buildBalancedTextRow(
      contentWidth,
      viewingItem.label,
      viewingItem.kind === "team" ? "team task" : "background",
    );
    return [
      primary.leftText + " ".repeat(primary.gapWidth) + primary.rightText,
      secondary.leftText + " ".repeat(secondary.gapWidth) + secondary.rightText,
    ];
  }

  const counts = getTaskSummaryCounts(items);
  const totalReal = items.filter((i) => i.kind !== "section").length;
  const primary = buildBalancedTextRow(
    contentWidth,
    `Pending ${counts.pending} \u00B7 Active ${counts.inProgress} \u00B7 Done ${counts.completed}`,
    counts.failed > 0 ? `Failed ${counts.failed}` : "",
  );
  const secondary = buildBalancedTextRow(
    contentWidth,
    "Task list",
    totalReal > 0 ? `${selectedIndex + 1}/${totalReal}` : "empty",
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
// Unified Item Builder
// ============================================================

function resolveStatusDisplay(
  status: string,
  blocked: boolean,
  colors: { warning: RGB; success: RGB; error: RGB; muted: RGB; accent: RGB },
): { icon: string; iconColor: RGB; statusText: string } {
  if (blocked) {
    return { icon: STATUS_GLYPHS.pending, iconColor: colors.muted, statusText: "blocked" };
  }
  switch (status) {
    case "in_progress":
    case "running":
    case "claimed":
      return { icon: STATUS_GLYPHS.running, iconColor: colors.warning, statusText: "running" };
    case "completed":
      return { icon: STATUS_GLYPHS.success, iconColor: colors.success, statusText: "done" };
    case "failed":
    case "errored":
      return { icon: STATUS_GLYPHS.error, iconColor: colors.error, statusText: "failed" };
    case "cancelled":
      return { icon: STATUS_GLYPHS.cancelled, iconColor: colors.muted, statusText: "cancelled" };
    default:
      return { icon: STATUS_GLYPHS.pending, iconColor: colors.muted, statusText: "pending" };
  }
}

function buildUnifiedItems(
  teamTasks: TaskBoardItem[],
  bgTasks: Task[],
  colors: { warning: RGB; success: RGB; error: RGB; muted: RGB; accent: RGB },
): UnifiedTaskItem[] {
  const items: UnifiedTaskItem[] = [];

  const sectionColor: RGB = [0, 0, 0]; // placeholder for non-rendered sections

  // Team tasks first (Claude Code TaskCreate/TaskUpdate)
  if (teamTasks.length > 0) {
    items.push({
      id: "__section_team__",
      kind: "section",
      label: "Agent Tasks",
      status: "",
      statusText: "",
      icon: "",
      iconColor: sectionColor,
      blocked: false,
    });

    for (const tt of teamTasks) {
      const blocked = tt.blockedBy.length > 0;
      const isActive = tt.status === "in_progress" || tt.status === "claimed";
      const { icon, iconColor, statusText } = resolveStatusDisplay(
        tt.status,
        blocked,
        colors,
      );
      // When in_progress with activeForm, show activeForm as label (Claude Code parity)
      const displayLabel = isActive && tt.activeForm
        ? `#${tt.id} ${tt.activeForm}`
        : `#${tt.id} ${tt.goal}`;
      items.push({
        id: `team:${tt.id}`,
        kind: "team",
        label: displayLabel,
        status: tt.status,
        statusText: tt.assignee ? `@${tt.assignee}` : statusText,
        icon,
        iconColor,
        owner: tt.assignee,
        blocked,
        activeForm: tt.activeForm,
        teamTask: tt,
      });
    }
  }

  // Background eval/delegate tasks
  if (bgTasks.length > 0) {
    if (teamTasks.length > 0) {
      items.push({
        id: "__section_bg__",
        kind: "section",
        label: "Background",
        status: "",
        statusText: "",
        icon: "",
        iconColor: sectionColor,
        blocked: false,
      });
    }

    for (const task of bgTasks) {
      const { icon, iconColor, statusText } = resolveStatusDisplay(
        task.status,
        false,
        colors,
      );
      items.push({
        id: `bg:${task.id}`,
        kind: isEvalTask(task) ? "eval" : "delegate",
        label: isEvalTask(task) ? task.preview : task.label,
        status: task.status,
        statusText,
        icon,
        iconColor,
        blocked: false,
        bgTask: task,
      });
    }
  }

  return items;
}

// ============================================================
// Component
// ============================================================

export function BackgroundTasksOverlay({
  onClose,
  teamTasks = [],
}: BackgroundTasksOverlayProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { stdout } = useStdout();
  const { tasks, cancel, clearCompleted, removeTask } = useTaskManager();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [viewingItemId, setViewingItemId] = useState<string | null>(null);
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

  // Filter and sort background tasks (eval + delegate)
  const bgTasks = useMemo(() => {
    const filtered = tasks.filter((t: Task) =>
      isEvalTask(t) || isDelegateTask(t)
    );
    return filtered.sort((a: Task, b: Task) => {
      const aActive = isTaskActive(a) ? 0 : 1;
      const bActive = isTaskActive(b) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return b.createdAt - a.createdAt;
    });
  }, [tasks]);

  // Build unified item list
  const unifiedItems = useMemo(
    () => buildUnifiedItems(teamTasks, bgTasks, colors),
    [teamTasks, bgTasks, colors],
  );

  // Get the selected unified item (skip sections)
  const selectableItems = useMemo(
    () => unifiedItems.filter((i: UnifiedTaskItem) => i.kind !== "section"),
    [unifiedItems],
  );

  // Get viewing item
  const viewingItem = viewingItemId
    ? unifiedItems.find((i: UnifiedTaskItem) => i.id === viewingItemId)
    : null;

  // Format result for display
  const resultLines = useMemo(() => {
    if (!viewingItem) return [];
    if (viewingItem.bgTask) {
      if (isEvalTask(viewingItem.bgTask)) {
        return formatEvalTaskResultLines(viewingItem.bgTask);
      }
      if (isDelegateTask(viewingItem.bgTask)) {
        const dt = viewingItem.bgTask as DelegateTask;
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
                `  ${ev.success ? "\u2713" : "\u2717"} ${ev.name}: ${
                  ev.summary ?? ev.content ?? ""
                }`,
              );
            }
          }
        }
        return lines;
      }
    }
    if (viewingItem.teamTask) {
      const tt = viewingItem.teamTask;
      const lines: string[] = [];
      lines.push(`Task #${tt.id}: ${tt.goal}`);
      lines.push(`Status: ${tt.status}`);
      if (tt.assignee) lines.push(`Owner: @${tt.assignee}`);
      if (tt.blockedBy.length > 0) {
        lines.push(`Blocked by: ${tt.blockedBy.map((id: string) => `#${id}`).join(", ")}`);
      }
      if (tt.mergeState) lines.push(`Merge: ${tt.mergeState}`);
      if (tt.reviewStatus) lines.push(`Review: ${tt.reviewStatus}`);
      return lines;
    }
    return [];
  }, [viewingItem]);

  // Reset selection if out of bounds
  useEffect(() => {
    if (selectedIndex >= selectableItems.length && selectableItems.length > 0) {
      setSelectedIndex(Math.max(0, selectableItems.length - 1));
    }
  }, [selectableItems.length, selectedIndex]);

  // Map selected index to unified items index
  const selectedUnifiedIndex = useMemo(() => {
    if (selectableItems.length === 0) return -1;
    const target = selectableItems[selectedIndex];
    return target ? unifiedItems.indexOf(target) : -1;
  }, [selectedIndex, selectableItems, unifiedItems]);

  // Draw the overlay
  const drawOverlay = useCallback(() => {
    if (shouldClearOverlay(previousFrameRef.current, overlayFrame)) {
      clearOverlay(previousFrameRef.current!);
    }
    previousFrameRef.current = overlayFrame;

    const bgStyle = colors.bgStyle;
    let output = ansi.cursorSave + ansi.cursorHide;

    const drawRow = (y: number, renderContent: () => number) => {
      output += ansi.cursorTo(overlayFrame.x, y) + bgStyle;
      const visibleLen = renderContent();
      const remaining = overlayFrame.width - visibleLen;
      if (remaining > 0) {
        output += " ".repeat(remaining);
      }
    };

    const drawEmptyRow = (y: number) => {
      drawRow(y, () => 0);
    };

    // === Top padding ===
    for (let i = 0; i < PADDING.top; i++) {
      drawEmptyRow(overlayFrame.y + i);
    }

    const headerY = overlayFrame.y + PADDING.top;
    const title = viewMode === "list" ? "Tasks" : "Details";
    const escHint = viewMode === "list" ? "esc close" : "esc back";

    const [summaryText, hintText] = buildBackgroundTasksSummaryRows(
      unifiedItems,
      {
        viewMode,
        selectedIndex,
        viewingItem,
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
      const window = calculateScrollWindow(
        selectedUnifiedIndex >= 0 ? selectedUnifiedIndex : 0,
        unifiedItems.length,
        visibleRows,
      );
      const visibleItems = unifiedItems.slice(window.start, window.end);

      for (let row = 0; row < visibleRows; row++) {
        const rowY = overlayFrame.y + chromeLayout.contentStart + row;
        const item = visibleItems[row];

        drawRow(rowY, () => {
          if (!item) {
            if (row === 0 && unifiedItems.length === 0) {
              output += " ".repeat(PADDING.left);
              output += fg(colors.muted) + "No tasks" + ansi.reset + bgStyle;
              return PADDING.left + 8;
            }
            return 0;
          }

          // Section headers
          if (item.kind === "section") {
            const sectionLabel = buildSectionLabelText(item.label, contentWidth);
            output += " ".repeat(PADDING.left);
            output += fg(colors.accent) + sectionLabel + ansi.reset + bgStyle;
            return PADDING.left + sectionLabel.length;
          }

          const isSelected = item === selectableItems[selectedIndex];

          if (isSelected) {
            output += bg(colors.warning) + ansi.fg(30, 30, 30);
          }

          let len = 0;

          output += " ".repeat(PADDING.left);
          len += PADDING.left;
          output += isSelected ? "\u25B8 " : "  ";
          len += 2;
          output += fg(item.iconColor) + item.icon + ansi.reset;
          if (isSelected) output += bg(colors.warning) + ansi.fg(30, 30, 30);
          else output += bgStyle;
          output += " ";
          len += 2;

          const statusCol = item.statusText;
          const rowLayout = buildBalancedTextRow(
            Math.max(8, contentWidth - 4),
            item.label,
            statusCol,
            { maxRightWidth: 12 },
          );
          output += rowLayout.leftText;
          output += " ".repeat(rowLayout.gapWidth);
          if (!isSelected) output += fg(colors.muted);
          output += padTo(rowLayout.rightText, 12);
          output += ansi.reset + bgStyle;
          len += rowLayout.leftText.length + rowLayout.gapWidth + 12;

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
            const text = "\u2191 more above...";
            output += " ".repeat(PADDING.left);
            output += fg(colors.muted) + text + ansi.reset + bgStyle;
            return PADDING.left + text.length;
          }
          if (
            row === visibleRows - 1 &&
            resultScrollOffset + maxResultRows < resultLines.length
          ) {
            const text = "\u2193 more below...";
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
          return 0;
        });
      }
    }

    // === Footer row ===
    const footerY = overlayFrame.y + chromeLayout.footerY;
    const selectedItem = selectableItems[selectedIndex];
    const canDismiss = selectedItem?.bgTask != null;
    const listHints = canDismiss
      ? "\u2191\u2193 nav  Enter view  x dismiss  c clear"
      : "\u2191\u2193 nav  Enter view  c clear";
    const footerText = truncate(
      viewMode === "list" ? listHints : "\u2191\u2193 scroll  q/Esc back",
      contentWidth,
    );
    const countText = viewMode === "list" && selectableItems.length > 0
      ? `${selectedIndex + 1}/${selectableItems.length}`
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
    unifiedItems,
    selectableItems,
    selectedIndex,
    selectedUnifiedIndex,
    viewMode,
    viewingItem,
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
      if (key.escape || input === "q") {
        setViewMode("list");
        setViewingItemId(null);
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

    if (selectableItems.length === 0) return;

    if (key.upArrow || input === "k") {
      setSelectedIndex((i: number) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((i: number) =>
        Math.min(selectableItems.length - 1, i + 1)
      );
      return;
    }

    // View details
    if (key.return && selectableItems[selectedIndex]) {
      const item = selectableItems[selectedIndex];
      setViewingItemId(item.id);
      setViewMode("result");
      setResultScrollOffset(0);
      return;
    }

    // Cancel/dismiss (only for eval/delegate tasks)
    if (input === "x" && selectableItems[selectedIndex]) {
      const item = selectableItems[selectedIndex];
      if (item.bgTask) {
        if (isTaskActive(item.bgTask)) {
          cancel(item.bgTask.id);
        } else {
          removeTask(item.bgTask.id);
        }
      }
      return;
    }

    // Clear all completed
    if (input === "c") {
      clearCompleted();
      return;
    }
  });

  return null;
}
