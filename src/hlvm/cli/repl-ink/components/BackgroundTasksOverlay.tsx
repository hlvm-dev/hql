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
  useState,
} from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useSemanticColors, useTheme } from "../../theme/index.ts";
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
  BACKGROUND_TASKS_OVERLAY_SPEC,
  resolveOverlayChromeLayout,
  resolveOverlayFrame,
  type RGB,
  themeToOverlayColors,
} from "../overlay/index.ts";
import { truncate } from "../../../../common/utils.ts";
import { STATUS_GLYPHS } from "../ui-constants.ts";
import {
  buildBalancedTextRow,
  buildSectionLabelText,
} from "../utils/display-chrome.ts";
import type { LocalAgentEntry } from "../utils/local-agents.ts";
import { summarizeLocalAgentFleet } from "../utils/local-agents.ts";
import { OverlayBalancedRow, OverlayModal } from "./OverlayModal.tsx";
import { formatDurationMs } from "../utils/formatting.ts";

// ============================================================
// Types
// ============================================================

interface BackgroundTasksOverlayProps {
  onClose: () => void;
  localAgents?: LocalAgentEntry[];
  initialSelectedItemId?: string;
  initialViewMode?: ViewMode;
  onInterruptLocalAgent?: (agent: LocalAgentEntry) => boolean;
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

function isFinishedLocalAgentStatus(status: LocalAgentEntry["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
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
    const activeLocalAgentCount = s.localAgents.filter((entry) =>
      !isFinishedLocalAgentStatus(entry.status)
    ).length;
    const activeLabel = activeLocalAgentCount > 0
      ? activeLocalAgentCount === 1
        ? "1 active agent"
        : `${activeLocalAgentCount} active agents`
      : s.localAgentCount === 1
      ? "1 local agent"
      : `${s.localAgentCount} local agents`;
    const primary = buildBalancedTextRow(
      contentWidth,
      activeLabel,
      s.failed > 0 ? `Failed ${s.failed}` : "",
    );
    const secondary = buildBalancedTextRow(
      contentWidth,
      s.evalCount > 0
        ? "Local agents above \u00B7 evals below"
        : summarizeLocalAgentFleet(s.localAgents) || "Background tasks",
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
      label: `Local agents (${localAgents.length})`,
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
        label: agent.name,
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
  const lines: string[] = [
    `${agent.label} \u203a ${agent.name}`,
  ];
  const metricParts: string[] = [];
  if (agent.progress?.durationMs != null && agent.progress.durationMs >= 1000) {
    metricParts.push(formatDurationMs(agent.progress.durationMs));
  }
  if (agent.progress?.tokenCount) {
    metricParts.push(`${agent.progress.tokenCount.toLocaleString("en-US")} tokens`);
  }
  if (agent.progress?.toolUseCount) {
    const toolUseCount = agent.progress.toolUseCount;
    metricParts.push(`${toolUseCount} tool ${toolUseCount === 1 ? "use" : "uses"}`);
  }
  if (metricParts.length > 0) {
    lines.push(metricParts.join(" \u00B7 "));
  }
  lines.push("");
  lines.push("Progress");
  const previewLines = agent.progress?.previewLines ?? [];
  if (previewLines.length > 0) {
    lines.push(...previewLines);
  } else if (agent.progress?.activityText?.trim()) {
    lines.push(agent.progress.activityText.trim());
  } else if (agent.detail?.trim()) {
    lines.push(agent.detail.trim());
  } else {
    lines.push(agent.statusLabel);
  }
  return lines;
}


// ============================================================
// Component
// ============================================================

export function BackgroundTasksOverlay({
  onClose,
  localAgents = [],
  initialSelectedItemId,
  initialViewMode = "list",
  onInterruptLocalAgent,
}: BackgroundTasksOverlayProps): React.ReactElement | null {
  const { theme } = useTheme();
  const sc = useSemanticColors();
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
    overlayFrame.width - PADDING.left - PADDING.right - 2,
  );
  const visibleRows = Math.max(
    3,
    chromeLayout.visibleRows,
  );

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
  const [summaryText, hintText] = useMemo(
    () =>
      buildBackgroundTasksSummaryRows(
        unifiedItems,
        {
          viewMode,
          selectedIndex,
          viewingItem,
          resultLines,
        },
        contentWidth,
      ),
    [contentWidth, resultLines, selectedIndex, unifiedItems, viewMode, viewingItem],
  );
  const visibleItems = useMemo(() => {
    if (viewMode !== "list") return [];
    const window = calculateScrollWindow(
      selectedUnifiedIndex >= 0 ? selectedUnifiedIndex : 0,
      unifiedItems.length,
      visibleRows,
    );
    return unifiedItems.slice(window.start, window.end);
  }, [selectedUnifiedIndex, unifiedItems, viewMode, visibleRows]);
  const visibleResultLines = useMemo(
    () =>
      resultLines.slice(
        resultScrollOffset,
        resultScrollOffset + visibleRows,
      ),
    [resultLines, resultScrollOffset, visibleRows],
  );
  const selectedItem = selectableItems[selectedIndex];
  const managedTask = resolveManagedTask(
    viewMode === "list" ? selectedItem : viewingItem,
  );
  const selectedLocalAgent = (viewMode === "list" ? selectedItem : viewingItem)
    ?.localAgent;
  const canInterrupt = selectedLocalAgent?.interruptible === true ||
    (managedTask != null && isTaskActive(managedTask));
  const canDismiss = managedTask != null && !canInterrupt;
  const listHints = canInterrupt
    ? "\u2191/\u2193 select  Enter/Space view  x stop  Esc close"
    : canDismiss
    ? "\u2191/\u2193 select  Enter/Space view  x dismiss  Esc close"
    : "\u2191/\u2193 select  Enter/Space view  Esc close";
  const detailHints = canInterrupt
    ? "\u2191/\u2193 scroll  x stop  Enter/Space/Esc close"
    : "\u2191/\u2193 scroll  Enter/Space/Esc close";
  const footerText = truncate(
    viewMode === "list" ? listHints : detailHints,
    contentWidth,
  );
  const countText = viewMode === "list" && selectableItems.length > 0
    ? `${selectedIndex + 1}/${selectableItems.length}`
    : "";

  // Keyboard handling
  useInput((input, key) => {
    if (viewMode === "result") {
      const managedTask = resolveManagedTask(viewingItem);
      if (
        input === "x" &&
        viewingItem?.localAgent &&
        viewingItem.localAgent.interruptible
      ) {
        onInterruptLocalAgent?.(viewingItem.localAgent);
        return;
      }
      if (input === "x" && managedTask && isTaskActive(managedTask)) {
        cancel(managedTask.id);
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
    if (input === "x" && selectableItems[selectedIndex]) {
      const item = selectableItems[selectedIndex];
      if (
        item.localAgent &&
        item.localAgent.interruptible
      ) {
        onInterruptLocalAgent?.(item.localAgent);
        return;
      }
      const managedTask = resolveManagedTask(item);
      if (managedTask) {
        if (isTaskActive(managedTask)) {
          cancel(managedTask.id);
        } else {
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

  return (
    <OverlayModal
      title="Background tasks"
      rightText={viewMode === "list" ? "esc close" : "esc back"}
      width={overlayFrame.width}
      minHeight={overlayFrame.height}
    >
      <Box paddingLeft={PADDING.left} flexDirection="column">
        <Text color={sc.text.primary} wrap="truncate-end">
          {summaryText}
        </Text>
        <Text color={sc.text.muted} wrap="truncate-end">
          {hintText}
        </Text>
      </Box>

      {viewMode === "list"
        ? (
          <Box paddingLeft={PADDING.left} marginTop={1} flexDirection="column">
            {visibleItems.length === 0
              ? (
                <Text color={sc.text.muted}>No background tasks</Text>
              )
              : visibleItems.map((item: UnifiedTaskItem) => {
                if (item.kind === "section") {
                  return (
                    <Box key={item.id}>
                      <Text color={sc.chrome.sectionLabel}>
                        {buildSectionLabelText(item.label, contentWidth)}
                      </Text>
                    </Box>
                  );
                }

                const isSelected = item === selectableItems[selectedIndex];
                const rowLayout = buildBalancedTextRow(
                  Math.max(8, contentWidth - 4),
                  item.label,
                  item.statusText,
                  { maxRightWidth: 12 },
                );

                return (
                  <Box key={item.id}>
                    <Text color={isSelected ? sc.footer.status.active : sc.text.muted}>
                      {isSelected ? "\u25B8 " : "  "}
                    </Text>
                    <Text color={rgbToHex(item.iconColor)}>{item.icon}</Text>
                    <Text> </Text>
                    <Text color={isSelected ? sc.text.primary : sc.text.primary}>
                      {rowLayout.leftText}
                    </Text>
                    {rowLayout.gapWidth > 0 && (
                      <Text>{" ".repeat(rowLayout.gapWidth)}</Text>
                    )}
                    <Text color={sc.text.muted}>{rowLayout.rightText}</Text>
                  </Box>
                );
              })}
          </Box>
        )
        : (
          <Box paddingLeft={PADDING.left} marginTop={1} flexDirection="column">
            {resultScrollOffset > 0 && (
              <Text color={sc.text.muted} wrap="truncate-end">
                {"\u2191 more above..."}
              </Text>
            )}
            {visibleResultLines.map((line: string, index: number) => {
              const isSection = /^---\s+(.+?)\s+---$/.test(line.trim());
              return (
                <Box key={`${index}:${line}`}>
                  <Text
                    color={isSection ? sc.chrome.sectionLabel : sc.text.primary}
                    wrap="truncate-end"
                  >
                    {formatBackgroundTaskResultLine(line, contentWidth)}
                  </Text>
                </Box>
              );
            })}
            {resultScrollOffset + visibleRows < resultLines.length && (
              <Text color={sc.text.muted} wrap="truncate-end">
                {"\u2193 more below..."}
              </Text>
            )}
          </Box>
        )}

      <Box paddingLeft={PADDING.left} marginTop={1}>
        <OverlayBalancedRow
          leftText={footerText}
          rightText={countText}
          width={contentWidth}
          leftColor={sc.text.muted}
          rightColor={sc.text.muted}
        />
      </Box>
    </OverlayModal>
  );
}

function rgbToHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}
