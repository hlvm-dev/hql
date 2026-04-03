/**
 * Tasks Overlay — Claude Code-Style Task Management
 *
 * True floating overlay showing both agent team tasks (TaskCreate/TaskUpdate)
 * and background eval/delegate tasks. Matches Claude Code's task management TUI:
 *
 * - Shared tasks shown with ○ pending / ● in_progress / ✓ completed status
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
import type {
  TaskBoardItem,
  TeamDashboardState,
  TeamMemberItem,
} from "../hooks/useTeamState.ts";
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
import { cancelThread } from "../../../agent/delegate-threads.ts";
import { loadRecentMessages } from "../../../store/message-utils.ts";
import type { LocalAgentEntry } from "../utils/local-agents.ts";
import { summarizeLocalAgentFleet } from "../utils/local-agents.ts";
import {
  buildTeamDashboardDetailLines,
  type DashboardItem,
} from "./TeamDashboardOverlay.tsx";

// ============================================================
// Types
// ============================================================

interface BackgroundTasksOverlayProps {
  onClose: () => void;
  /** Shared task board from teamState.taskBoard (Claude Code TaskCreate/TaskUpdate). */
  teamTasks?: TaskBoardItem[];
  localAgents?: LocalAgentEntry[];
  teamState?: TeamDashboardState;
  interactionMode?: "permission" | "question";
  interactionSourceMemberId?: string;
  initialSelectedItemId?: string;
  initialViewMode?: ViewMode;
  onForegroundLocalAgent?: (agent: LocalAgentEntry) => boolean;
}

type ViewMode = "list" | "result";

/**
 * Unified task item displayed in the overlay.
 * Wraps both team tasks (TaskBoardItem) and eval/delegate tasks (Task).
 */
export interface UnifiedTaskItem {
  id: string;
  kind: "team" | "eval" | "delegate" | "local_agent" | "section";
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
  teamCount: number;
  evalCount: number;
  localAgents: LocalAgentEntry[];
}

function summarizeTaskItems(items: UnifiedTaskItem[]): TaskSummary {
  const summary: TaskSummary = {
    pending: 0, inProgress: 0, completed: 0, failed: 0,
    totalReal: 0, localAgentCount: 0, teamCount: 0, evalCount: 0,
    localAgents: [],
  };
  for (const item of items) {
    if (item.kind === "section") continue;
    summary.totalReal++;
    if (item.kind === "local_agent") {
      summary.localAgentCount++;
      summary.localAgents.push(item.localAgent ?? {
        id: item.id,
        kind: "delegate" as const,
        name: item.label,
        label: item.label,
        status: item.status as LocalAgentEntry["status"],
        statusLabel: item.statusText,
        interruptible: false,
        overlayTarget: "background-tasks" as const,
        overlayItemId: item.id,
      });
    } else if (item.kind === "team") {
      summary.teamCount++;
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
      viewingItem.kind === "team"
        ? "shared task"
        : viewingItem.kind === "local_agent"
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
      s.teamCount > 0
        ? "Agents above · shared tasks below"
        : s.evalCount > 0
        ? "Agents above · evals below"
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
  teamTasks: TaskBoardItem[],
  bgTasks: Task[],
  colors: { warning: RGB; success: RGB; error: RGB; muted: RGB; accent: RGB },
): UnifiedTaskItem[] {
  const items: UnifiedTaskItem[] = [];
  const delegateTasks = localAgents.length > 0 ? [] : bgTasks.filter(isDelegateTask);
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
        label: `${agent.name} · ${agent.label}`,
        status: agent.status,
        statusText: agent.statusLabel || statusText,
        icon,
        iconColor,
        blocked: false,
        localAgent: agent,
      });
    }
  }

  // Shared task board next (Claude Code TaskCreate/TaskUpdate)
  if (teamTasks.length > 0) {
    items.push({
      id: "__section_team__",
      kind: "section",
      label: "Shared tasks",
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

  if (delegateTasks.length > 0) {
    if (teamTasks.length > 0) {
      items.push({
        id: "__section_agents__",
        kind: "section",
        label: "Local agents",
        status: "",
        statusText: "",
        icon: "",
        iconColor: sectionColor,
        blocked: false,
      });
    }

    for (const task of delegateTasks) {
      const { icon, iconColor, statusText } = resolveStatusDisplay(
        task.status,
        false,
        colors,
      );
      items.push({
        id: `bg:${task.id}`,
        kind: "delegate",
        label: task.task,
        status: task.status,
        statusText,
        icon,
        iconColor,
        blocked: false,
        bgTask: task,
      });
    }
  }

  if (evalTasks.length > 0) {
    if (teamTasks.length > 0 || delegateTasks.length > 0) {
      items.push({
        id: "__section_eval__",
        kind: "section",
        label: "Background evals",
        status: "",
        statusText: "",
        icon: "",
        iconColor: sectionColor,
        blocked: false,
      });
    }

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

interface DelegateSessionMessageLike {
  role: string;
  content: string;
  tool_name?: string | null;
}

function summarizeDelegateMessage(content: string): string {
  return content.split("\n").map((line) => line.trim()).find(Boolean) ??
    content.trim();
}

export function buildDelegateTaskDetailLines(
  task: DelegateTask,
  sessionMessages: DelegateSessionMessageLike[] = [],
): string[] {
  const lines: string[] = [];
  lines.push(`Agent: ${task.nickname} [${task.agent}]`);
  lines.push(`Task: ${task.task}`);
  lines.push(`Status: ${task.status}`);

  const prompt = sessionMessages.find((message) =>
    message.role === "user" && message.content.trim().length > 0
  )?.content.trim();
  if (prompt) {
    lines.push("", "--- Prompt ---", ...prompt.split("\n"));
  }

  const toolMessages = sessionMessages.filter((message) =>
    message.role === "tool" && message.content.trim().length > 0
  );
  if (toolMessages.length > 0) {
    lines.push("", "--- Progress ---");
    for (const message of toolMessages.slice(-8)) {
      lines.push(
        `- ${message.tool_name ?? "tool"}: ${
          summarizeDelegateMessage(message.content)
        }`,
      );
    }
  } else if (task.snapshot?.events.length) {
    lines.push("", "--- Progress ---");
    for (const event of task.snapshot.events) {
      if (event.type === "tool_end") {
        lines.push(
          `- ${event.name}: ${
            event.summary ?? event.content ?? `${event.name} completed`
          }`,
        );
      }
    }
  }

  const finalAssistant = [...sessionMessages].reverse().find((message) =>
    message.role === "assistant" && message.content.trim().length > 0
  )?.content.trim();
  if (finalAssistant) {
    lines.push("", "--- Result ---", ...finalAssistant.split("\n"));
  } else if (task.summary?.trim()) {
    lines.push("", "--- Result ---", ...task.summary.trim().split("\n"));
  }

  if (task.error) {
    lines.push("", "--- Error ---", ...String(task.error).split("\n"));
  }

  return lines;
}

function buildLocalAgentDetailLines(
  agent: LocalAgentEntry,
  teamState: TeamDashboardState | undefined,
  bgTasks: Task[],
  interactionMode?: "permission" | "question",
  interactionSourceMemberId?: string,
): string[] {
  if (agent.kind === "delegate") {
    const delegateTask = bgTasks.find((task) =>
      isDelegateTask(task) && (task.id === agent.taskId || task.threadId === agent.threadId)
    );
    if (delegateTask && isDelegateTask(delegateTask)) {
      const sessionMessages = delegateTask.childSessionId
        ? loadRecentMessages(delegateTask.childSessionId, 32)
        : [];
      return buildDelegateTaskDetailLines(delegateTask, sessionMessages);
    }
    return [
      `Agent: ${agent.name}`,
      `Task: ${agent.label}`,
      `Status: ${agent.statusLabel}`,
    ];
  }

  const member = teamState?.members.find((entry: TeamMemberItem) =>
    entry.id === agent.memberId
  );
  if (!member || !teamState) {
    return [
      `Agent: ${agent.name}`,
      `Task: ${agent.label}`,
      `Status: ${agent.statusLabel}`,
    ];
  }

  const dashboardItem: DashboardItem = {
    id: `member-${member.id}`,
    kind: "member",
    data: member,
  };
  return buildTeamDashboardDetailLines(
    dashboardItem,
    teamState,
    interactionMode,
    interactionSourceMemberId,
  );
}

function resolveInterruptibleThreadId(
  item: UnifiedTaskItem | null | undefined,
): string | undefined {
  if (
    item?.localAgent?.kind !== "teammate" ||
    !item.localAgent.threadId ||
    !item.localAgent.interruptible
  ) {
    return undefined;
  }
  return item.localAgent.threadId;
}

function isForegroundableLocalAgent(
  agent: LocalAgentEntry | undefined,
): agent is LocalAgentEntry {
  return Boolean(
    agent &&
      agent.kind === "teammate" &&
      agent.foregroundable === true,
  );
}

// ============================================================
// Component
// ============================================================

export function BackgroundTasksOverlay({
  onClose,
  teamTasks = [],
  localAgents = [],
  teamState,
  interactionMode,
  interactionSourceMemberId,
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
  const [liveTick, setLiveTick] = useState(0);
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
    () => buildUnifiedItems(localAgents, teamTasks, bgTasks, colors),
    [localAgents, teamTasks, bgTasks, colors],
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
    if (item.localAgent?.kind === "delegate") {
      return bgTasks.find((task: Task) =>
        isDelegateTask(task) &&
        (task.id === item.localAgent?.taskId || task.threadId === item.localAgent?.threadId)
      );
    }
    return undefined;
  }, [bgTasks]);

  // Format result for display
  const resultLines = useMemo(() => {
    if (!viewingItem) return [];
    if (viewingItem.localAgent) {
      return buildLocalAgentDetailLines(
        viewingItem.localAgent,
        teamState,
        bgTasks,
        interactionMode,
        interactionSourceMemberId,
      );
    }
    if (viewingItem.bgTask) {
      if (isEvalTask(viewingItem.bgTask)) {
        return formatEvalTaskResultLines(viewingItem.bgTask);
      }
      if (isDelegateTask(viewingItem.bgTask)) {
        const dt = viewingItem.bgTask as DelegateTask;
        const sessionMessages = dt.childSessionId
          ? loadRecentMessages(dt.childSessionId, 32)
          : [];
        return buildDelegateTaskDetailLines(dt, sessionMessages);
      }
    }
    if (viewingItem.teamTask) {
      const tt = viewingItem.teamTask;
      const lines: string[] = [];
      lines.push(`Shared task #${tt.id}: ${tt.goal}`);
      lines.push(`Status: ${tt.status}`);
      if (tt.assignee) lines.push(`Assignee: @${tt.assignee}`);
      if (tt.blockedBy.length > 0) {
        lines.push(`Blocked by: ${tt.blockedBy.map((id: string) => `#${id}`).join(", ")}`);
      }
      if (tt.mergeState) lines.push(`Merge: ${tt.mergeState}`);
      if (tt.reviewStatus) lines.push(`Review: ${tt.reviewStatus}`);
      return lines;
    }
    return [];
  }, [
    bgTasks,
    interactionMode,
    interactionSourceMemberId,
    liveTick,
    teamState,
    viewingItem,
  ]);

  useEffect(() => {
    const activeDelegateSessionId = viewingItem?.localAgent?.kind === "delegate" &&
        viewingItem.localAgent.childSessionId
      ? viewingItem.localAgent.childSessionId
      : viewingItem?.bgTask &&
          isDelegateTask(viewingItem.bgTask) &&
          viewingItem.bgTask.status === "running" &&
          viewingItem.bgTask.childSessionId
      ? viewingItem.bgTask.childSessionId
      : undefined;
    const activeTeammateThreadId = resolveInterruptibleThreadId(viewingItem);
    if (
      viewMode !== "result" ||
      (!activeDelegateSessionId && !activeTeammateThreadId)
    ) {
      return;
    }
    const timer = setInterval(() => {
      setLiveTick((current: number) => current + 1);
    }, 400);
    return () => clearInterval(timer);
  }, [viewMode, viewingItem]);

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
    const interruptibleThreadId = resolveInterruptibleThreadId(selectedItem);
    const canInterrupt = (managedTask != null &&
        isTaskActive(managedTask)) ||
      Boolean(interruptibleThreadId);
    const canDismiss = managedTask != null && !canInterrupt;
    const canForeground = Boolean(
      onForegroundLocalAgent &&
        isForegroundableLocalAgent(selectedItem?.localAgent),
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
    const detailInterruptibleThreadId = resolveInterruptibleThreadId(
      viewingItem,
    );
    const detailCanForeground = Boolean(
      onForegroundLocalAgent &&
        isForegroundableLocalAgent(viewingItem?.localAgent),
    );
    const detailHints = ((detailManagedTask && isTaskActive(detailManagedTask)) ||
        detailInterruptibleThreadId)
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
      const interruptibleThreadId = resolveInterruptibleThreadId(viewingItem);
      if (
        input === "k" &&
        managedTask &&
        isTaskActive(managedTask)
      ) {
        cancel(managedTask.id);
        return;
      }
      if (input === "k" && interruptibleThreadId) {
        cancelThread(interruptibleThreadId);
        return;
      }
      if (
        input === "f" &&
        isForegroundableLocalAgent(viewingItem?.localAgent) &&
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
      isForegroundableLocalAgent(selectableItems[selectedIndex]?.localAgent) &&
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

    // Cancel/dismiss (only for eval/delegate tasks)
    if ((input === "x" || input === "k") && selectableItems[selectedIndex]) {
      const item = selectableItems[selectedIndex];
      const managedTask = resolveManagedTask(item);
      const interruptibleThreadId = resolveInterruptibleThreadId(item);
      if (managedTask) {
        if (isTaskActive(managedTask)) {
          if (input === "k") {
            cancel(managedTask.id);
          }
        } else if (input === "x") {
          removeTask(managedTask.id);
        }
      } else if (input === "k" && interruptibleThreadId) {
        cancelThread(interruptibleThreadId);
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
