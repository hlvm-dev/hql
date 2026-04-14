/**
 * Tasks Overlay — Claude Code-Style Task Management
 *
 * True floating overlay showing background eval tasks and local agents.
 *
 * - Tasks shown with ○ pending / ● in_progress / ✓ completed status
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
  type EvalTask,
  isEvalTask,
  isTaskActive,
  type Task,
} from "../../repl/task-manager/types.ts";
import { calculateScrollWindow } from "../completion/navigation.ts";
import { formatEvalTaskResultLines } from "../utils/eval-task-results.ts";
import {
  ansi,
  BACKGROUND_TASKS_OVERLAY_SPEC,
  clearOverlay,
  drawOverlayFrame,
  fg,
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
import type { LocalAgentEntry } from "../utils/local-agents.ts";
import { summarizeLocalAgentFleet } from "../utils/local-agents.ts";

// ============================================================
// Types
// ============================================================

interface BackgroundTasksOverlayProps {
  onClose: () => void;
  localAgents?: LocalAgentEntry[];
  initialSelectedItemId?: string;
  initialViewMode?: ViewMode;
  onForegroundLocalAgent?: (agent: LocalAgentEntry) => boolean;
}

type ViewMode = "list" | "result";

/**
 * Unified task item displayed in the overlay.
 * Wraps both eval tasks (Task) and local agents.
 */
export interface UnifiedTaskItem {
  id: string;
  kind: "eval" | "local_agent" | "section";
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
  localAgent?: LocalAgentEntry;
}

// ============================================================
// Layout Constants
// ============================================================

const PADDING = BACKGROUND_TASKS_OVERLAY_SPEC.padding;

interface TaskSummary {
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  totalReal: number;
  localAgentCount: number;
  evalCount: number;
  localAgents: LocalAgentEntry[];
}

function summarizeTaskItems(items: UnifiedTaskItem[]): TaskSummary {
  const summary: TaskSummary = {
    pending: 0, inProgress: 0, completed: 0, failed: 0,
    totalReal: 0, localAgentCount: 0, evalCount: 0,
    localAgents: [],
  };
  for (const item of items) {
    if (item.kind === "section") continue;
    summary.totalReal++;
    if (item.kind === "local_agent") {
      summary.localAgentCount++;
      summary.localAgents.push(item.localAgent ?? {
        id: item.id,
        kind: "agent" as const,
        name: item.label,
        label: item.label,
        status: item.status as LocalAgentEntry["status"],
        statusLabel: item.statusText,
        interruptible: false,
        overlayTarget: "background-tasks" as const,
        overlayItemId: item.id,
      });
    } else if (item.kind === "eval") {
      summary.evalCount++;
    }
    if (item.status === "pending" || item.status === "blocked") summary.pending++;
    else if (item.status === "in_progress" || item.status === "running") summary.inProgress++;
    else if (item.status === "completed") summary.completed++;
    else if (item.status === "failed") summary.failed++;
  }
  return summary;
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
      viewingItem.kind === "local_agent"
        ? "local agent"
        : "background",
    );
    return [
      primary.leftText + " ".repeat(primary.gapWidth) + primary.rightText,
      secondary.leftText + " ".repeat(secondary.gapWidth) + secondary.rightText,
    ];
  }

  const s = summarizeTaskItems(items);
  if (s.localAgentCount > 0) {
    const primary = buildBalancedTextRow(
      contentWidth,
      s.localAgentCount === 1 ? "1 local agent" : `${s.localAgentCount} local agents`,
      summarizeLocalAgentFleet(s.localAgents),
    );
    const secondary = buildBalancedTextRow(
      contentWidth,
      s.evalCount > 0
        ? "Agents above \u00B7 evals below"
        : "Task manager",
      s.totalReal > 0 ? `${selectedIndex + 1}/${s.totalReal}` : "empty",
    );
    return [
      primary.leftText + " ".repeat(primary.gapWidth) + primary.rightText,
      secondary.leftText + " ".repeat(secondary.gapWidth) + secondary.rightText,
    ];
  }
  const primary = buildBalancedTextRow(
    contentWidth,
    `Pending ${s.pending} \u00B7 Active ${s.inProgress} \u00B7 Done ${s.completed}`,
    s.failed > 0 ? `Failed ${s.failed}` : "",
  );
  const secondary = buildBalancedTextRow(
    contentWidth,
    "Task list",
    s.totalReal > 0 ? `${selectedIndex + 1}/${s.totalReal}` : "empty",
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
    case "waiting":
      return { icon: STATUS_GLYPHS.pending, iconColor: colors.warning, statusText: "waiting" };
    case "blocked":
      return { icon: STATUS_GLYPHS.pending, iconColor: colors.muted, statusText: "blocked" };
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
  localAgents: LocalAgentEntry[],
  bgTasks: Task[],
  colors: { warning: RGB; success: RGB; error: RGB; muted: RGB; accent: RGB },
): UnifiedTaskItem[] {
  const items: UnifiedTaskItem[] = [];
  const evalTasks = bgTasks.filter(isEvalTask);

  const sectionColor: RGB = [0, 0, 0]; // placeholder for non-rendered sections

  if (localAgents.length > 0) {
    items.push({
      id: "__section_local_agents__",
      kind: "section",
      label: "Local agents",
      status: "",
      statusText: "",
      icon: "",
      iconColor: sectionColor,
      blocked: false,
    });

    for (const agent of localAgents) {
      const { icon, iconColor, statusText } = resolveStatusDisplay(
        agent.status,
        false,
        colors,
      );
      items.push({
        id: agent.id,
        kind: "local_agent",
        label: `${agent.name} \u00B7 ${agent.label}`,
        status: agent.status,
        statusText: agent.statusLabel || statusText,
        icon,
        iconColor,
        blocked: false,
        localAgent: agent,
      });
    }
  }

  if (evalTasks.length > 0) {
    for (const task of evalTasks) {
      const { icon, iconColor, statusText } = resolveStatusDisplay(
        task.status,
        false,
        colors,
      );
      items.push({
        id: `bg:${task.id}`,
        kind: "eval",
        label: task.preview,
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

function buildLocalAgentDetailLines(
  agent: LocalAgentEntry,
): string[] {
  return [
    `Agent: ${agent.name}`,
    `Task: ${agent.label}`,
    `Status: ${agent.statusLabel}`,
  ];
}


// ============================================================
// Component
// ============================================================

export function BackgroundTasksOverlay({
  onClose,
  localAgents = [],
  initialSelectedItemId,
  initialViewMode = "list",
  onForegroundLocalAgent,
}: BackgroundTasksOverlayProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { stdout } = useStdout();
  const { tasks, cancel, clearCompleted, removeTask } = useTaskManager();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [viewingItemId, setViewingItemId] = useState<string | null>(
    initialViewMode === "result" ? initialSelectedItemId ?? null : null,
  );
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
  const colors = useMemo(() => themeToOverlayColors(theme), [theme]);

  // Filter and sort background eval tasks
  const bgTasks = useMemo(() => {
    const filtered = tasks.filter((t: Task) => isEvalTask(t));
    return filtered.sort((a: Task, b: Task) => {
      const aActive = isTaskActive(a) ? 0 : 1;
      const bActive = isTaskActive(b) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return b.createdAt - a.createdAt;
    });
  }, [tasks]);

  // Build unified item list
  const unifiedItems = useMemo(
    () => buildUnifiedItems(localAgents, bgTasks, colors),
    [localAgents, bgTasks, colors],
  );

  // Get the selected unified item (skip sections)
  const selectableItems = useMemo(
    () => unifiedItems.filter((i: UnifiedTaskItem) => i.kind !== "section"),
    [unifiedItems],
  );

  useEffect(() => {
    if (!initialSelectedItemId) return;
    const nextIndex = selectableItems.findIndex((item: UnifiedTaskItem) =>
      item.id === initialSelectedItemId
    );
    if (nextIndex >= 0) {
      setSelectedIndex(nextIndex);
    }
  }, [initialSelectedItemId, selectableItems]);

  // Get viewing item
  const viewingItem = viewingItemId
    ? unifiedItems.find((i: UnifiedTaskItem) => i.id === viewingItemId)
    : null;
  const resolveManagedTask = useCallback((item: UnifiedTaskItem | null | undefined) => {
    if (!item) return undefined;
    if (item.bgTask) return item.bgTask;
    return undefined;
  }, []);

  // Format result for display
  const resultLines = useMemo(() => {
    if (!viewingItem) return [];
    if (viewingItem.localAgent) {
      return buildLocalAgentDetailLines(viewingItem.localAgent);
    }
    if (viewingItem.bgTask) {
      if (isEvalTask(viewingItem.bgTask)) {
        return formatEvalTaskResultLines(viewingItem.bgTask);
      }
    }
    return [];
  }, [
    bgTasks,
    viewingItem,
  ]);

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
    const title = viewMode === "list" ? "Task Manager" : "Details";
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
      output += fg(colors.primary) + summaryText + ansi.reset + bgStyle;
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
            output += fg(colors.primary) + sectionLabel + ansi.reset + bgStyle;
            return PADDING.left + sectionLabel.length;
          }

          const isSelected = item === selectableItems[selectedIndex];

          if (isSelected) {
            output += colors.selectedBgStyle + fg(colors.primary);
          }

          let len = 0;

          output += " ".repeat(PADDING.left);
          len += PADDING.left;
          output += isSelected ? "\u25B8 " : "  ";
          len += 2;
          output += fg(item.iconColor) + item.icon + ansi.reset;
          if (isSelected) output += colors.selectedBgStyle + fg(colors.primary);
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
    const managedTask = resolveManagedTask(selectedItem);
    const canInterrupt = managedTask != null && isTaskActive(managedTask);
    const canDismiss = managedTask != null && !canInterrupt;
    const canForeground = Boolean(
      onForegroundLocalAgent &&
        false,
    );
    const listHints = canInterrupt && canForeground
      ? "\u2191/\u2193 select  Enter/Space view  f foreground  k interrupt  Esc close"
      : canInterrupt
      ? "\u2191/\u2193 select  Enter/Space view  k interrupt  Esc close"
      : canDismiss && canForeground
      ? "\u2191/\u2193 select  Enter/Space view  f foreground  x dismiss  Esc close"
      : canDismiss
      ? "\u2191/\u2193 select  Enter/Space view  x dismiss  Esc close"
      : canForeground
      ? "\u2191/\u2193 select  Enter/Space view  f foreground  Esc close"
      : "\u2191/\u2193 select  Enter/Space view  Esc close";
    const detailManagedTask = resolveManagedTask(viewingItem);
    const detailCanForeground = Boolean(
      onForegroundLocalAgent &&
        false,
    );
    const detailHints = (detailManagedTask && isTaskActive(detailManagedTask))
      ? detailCanForeground
        ? "\u2191/\u2193 scroll  f foreground  k interrupt  Enter/Space/Esc close"
        : "\u2191/\u2193 scroll  k interrupt  Enter/Space/Esc close"
      : detailCanForeground
      ? "\u2191/\u2193 scroll  f foreground  Enter/Space/Esc close"
      : "\u2191/\u2193 scroll  Enter/Space/Esc close";
    const footerText = truncate(
      viewMode === "list" ? listHints : detailHints,
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
      borderColor: colors.primary,
      backgroundColor: colors.background,
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
    resolveManagedTask,
    contentWidth,
    chromeLayout.contentStart,
    chromeLayout.footerY,
    overlayFrame,
    visibleRows,
  ]);

  // Draw overlay on changes
  useEffect(() => {
    drawOverlay();
    const timer = setTimeout(drawOverlay, 0);
    return () => clearTimeout(timer);
  }, [drawOverlay]);

  useEffect(() => () => {
    if (previousFrameRef.current) {
      clearOverlay(previousFrameRef.current);
    }
  }, []);

  // Keyboard handling
  useInput((input, key) => {
    if (viewMode === "result") {
      const managedTask = resolveManagedTask(viewingItem);
      if (
        input === "k" &&
        managedTask &&
        isTaskActive(managedTask)
      ) {
        cancel(managedTask.id);
        return;
      }
      if (
        input === "f" &&
        false &&
        onForegroundLocalAgent?.(viewingItem.localAgent)
      ) {
        return;
      }
      if (key.escape || key.return || input === "q" || input === " ") {
        setViewMode("list");
        setViewingItemId(null);
        setResultScrollOffset(0);
        return;
      }
      if (key.upArrow) {
        setResultScrollOffset((o: number) => Math.max(0, o - 1));
        return;
      }
      if (key.downArrow) {
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

    if (
      input === "f" &&
      false &&
      onForegroundLocalAgent?.(selectableItems[selectedIndex].localAgent)
    ) {
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i: number) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i: number) =>
        Math.min(selectableItems.length - 1, i + 1)
      );
      return;
    }

    // View details
    if ((key.return || input === " ") && selectableItems[selectedIndex]) {
      const item = selectableItems[selectedIndex];
      setViewingItemId(item.id);
      setViewMode("result");
      setResultScrollOffset(0);
      return;
    }

    // Cancel/dismiss (only for eval tasks)
    if ((input === "x" || input === "k") && selectableItems[selectedIndex]) {
      const item = selectableItems[selectedIndex];
      const managedTask = resolveManagedTask(item);
      if (managedTask) {
        if (isTaskActive(managedTask)) {
          if (input === "k") {
            cancel(managedTask.id);
          }
        } else if (input === "x") {
          removeTask(managedTask.id);
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
