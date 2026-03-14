import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useInput, useStdout } from "ink";
import { truncate } from "../../../../common/utils.ts";
import { calculateScrollWindow } from "../completion/navigation.ts";
import type {
  AttentionItem,
  PendingApprovalItem,
  ShutdownItem,
  TaskBoardItem,
  TeamDashboardState,
  TeamMemberItem,
  WorkerStatus,
} from "../hooks/useTeamState.ts";
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
import { useTheme } from "../../theme/index.ts";
import { padTo } from "../utils/formatting.ts";

interface TeamDashboardOverlayProps {
  onClose: () => void;
  teamState: TeamDashboardState;
  interactionMode?: "permission" | "question";
}

type ViewMode = "dashboard" | "details";

type DashboardItem =
  | { id: string; kind: "member"; data: TeamMemberItem }
  | { id: string; kind: "worker"; data: WorkerStatus }
  | { id: string; kind: "task"; data: TaskBoardItem }
  | { id: string; kind: "approval"; data: PendingApprovalItem }
  | { id: string; kind: "shutdown"; data: ShutdownItem }
  | { id: string; kind: "attention"; data: AttentionItem };

const OVERLAY_WIDTH = 76;
const OVERLAY_HEIGHT = 26;
const PADDING = { top: 1, bottom: 1, left: 2, right: 2 };
const HEADER_ROWS = 4;
const CONTENT_START = PADDING.top + HEADER_ROWS;
const MIN_OVERLAY_WIDTH = 48;
const MIN_OVERLAY_HEIGHT = 14;

function workerStatusIcon(status: WorkerStatus["status"]): {
  icon: string;
  colorKey: "warning" | "success" | "error" | "muted";
} {
  switch (status) {
    case "running":
      return { icon: "●", colorKey: "warning" };
    case "completed":
      return { icon: "✓", colorKey: "success" };
    case "errored":
      return { icon: "✗", colorKey: "error" };
    case "cancelled":
    default:
      return { icon: "○", colorKey: "muted" };
  }
}

function formatDashboardRow(item: DashboardItem, contentWidth: number): {
  icon: string;
  iconColor: "warning" | "success" | "error" | "muted" | "accent";
  text: string;
} {
  switch (item.kind) {
    case "member":
      return {
        icon: "M",
        iconColor: "accent",
        text: truncate(
          `${item.data.id} [${item.data.role}] ${item.data.status}${
            item.data.currentTaskGoal ? ` · ${item.data.currentTaskGoal}` : ""
          }`,
          contentWidth,
        ),
      };
    case "worker": {
      const icon = workerStatusIcon(item.data.status);
      return {
        icon: icon.icon,
        iconColor: icon.colorKey,
        text: truncate(
          `${item.data.nickname} [${item.data.agent}] ${item.data.task} · ${
            Math.round(item.data.durationMs / 1000)
          }s`,
          contentWidth,
        ),
      };
    }
    case "task": {
      const assignee = item.data.assignee ? ` · ${item.data.assignee}` : "";
      const review = item.data.reviewStatus ? ` · review:${item.data.reviewStatus}` : "";
      const merge = item.data.mergeState ? ` · merge:${item.data.mergeState}` : "";
      return {
        icon: "T",
        iconColor: "accent",
        text: truncate(
          `${item.data.status} ${item.data.goal}${assignee}${review}${merge}`,
          contentWidth,
        ),
      };
    }
    case "approval":
      return {
        icon: "R",
        iconColor: "warning",
        text: truncate(
          `${item.data.status} ${item.data.taskGoal ?? item.data.taskId} · ${item.data.submittedByMemberId}`,
          contentWidth,
        ),
      };
    case "shutdown":
      return {
        icon: "S",
        iconColor: item.data.status === "forced" ? "error" : "warning",
        text: truncate(
          `${item.data.status} ${item.data.memberId}${
            item.data.reason ? ` · ${item.data.reason}` : ""
          }`,
          contentWidth,
        ),
      };
    case "attention":
      return {
        icon: "!",
        iconColor: "error",
        text: truncate(item.data.label, contentWidth),
      };
  }
}

function detailLines(item: DashboardItem): string[] {
  switch (item.kind) {
    case "member":
      return [
        `Member: ${item.data.id}`,
        `Agent: ${item.data.agent}`,
        `Role: ${item.data.role}`,
        `Status: ${item.data.status}`,
        item.data.currentTaskId ? `Current task: ${item.data.currentTaskId}` : "",
        item.data.currentTaskGoal ? `Goal: ${item.data.currentTaskGoal}` : "",
      ].filter(Boolean);
    case "worker":
      return [
        `Worker: ${item.data.nickname}`,
        `Agent: ${item.data.agent}`,
        `Status: ${item.data.status}`,
        `Task: ${item.data.task}`,
        `Duration: ${Math.round(item.data.durationMs / 1000)}s`,
        item.data.threadId ? `Thread: ${item.data.threadId}` : "",
      ].filter(Boolean);
    case "task":
      return [
        `Task: ${item.data.id}`,
        `Goal: ${item.data.goal}`,
        `Status: ${item.data.status}`,
        item.data.assignee ? `Assignee: ${item.data.assignee}` : "",
        item.data.blockedBy.length > 0
          ? `Blocked by: ${item.data.blockedBy.join(", ")}`
          : "",
        item.data.reviewStatus ? `Review: ${item.data.reviewStatus}` : "",
        item.data.mergeState ? `Merge: ${item.data.mergeState}` : "",
        item.data.delegateThreadId ? `Delegate thread: ${item.data.delegateThreadId}` : "",
      ].filter(Boolean);
    case "approval":
      return [
        `Approval: ${item.data.id}`,
        `Task: ${item.data.taskGoal ?? item.data.taskId}`,
        `Submitted by: ${item.data.submittedByMemberId}`,
        `Status: ${item.data.status}`,
        item.data.reviewedByMemberId
          ? `Reviewed by: ${item.data.reviewedByMemberId}`
          : "",
      ].filter(Boolean);
    case "shutdown":
      return [
        `Shutdown: ${item.data.id}`,
        `Member: ${item.data.memberId}`,
        `Requested by: ${item.data.requestedByMemberId}`,
        `Status: ${item.data.status}`,
        item.data.reason ? `Reason: ${item.data.reason}` : "",
      ].filter(Boolean);
    case "attention":
      return [
        `Attention: ${item.data.kind}`,
        item.data.label,
      ];
  }
}

export function TeamDashboardOverlay({
  onClose,
  teamState,
  interactionMode,
}: TeamDashboardOverlayProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { stdout } = useStdout();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  const [detailId, setDetailId] = useState<string | null>(null);
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
    20,
    overlayFrame.width - PADDING.left - PADDING.right,
  );
  const visibleRows = Math.max(
    4,
    overlayFrame.height - CONTENT_START - PADDING.bottom - 1,
  );
  const previousFrameRef = useRef<typeof overlayFrame | null>(null);

  const colors = useMemo(() => ({
    ...themeToOverlayColors(theme),
    bgStyle: bg(OVERLAY_BG_COLOR),
  }), [theme]);

  const items = useMemo<DashboardItem[]>(() => {
    return [
      ...teamState.members.map((member) => ({
        id: `member-${member.id}`,
        kind: "member" as const,
        data: member,
      })),
      ...teamState.workers.map((worker) => ({
        id: `worker-${worker.id}`,
        kind: "worker" as const,
        data: worker,
      })),
      ...teamState.taskBoard.map((task) => ({
        id: `task-${task.id}`,
        kind: "task" as const,
        data: task,
      })),
      ...teamState.pendingApprovals.map((approval) => ({
        id: `approval-${approval.id}`,
        kind: "approval" as const,
        data: approval,
      })),
      ...teamState.shutdowns.map((shutdown) => ({
        id: `shutdown-${shutdown.id}`,
        kind: "shutdown" as const,
        data: shutdown,
      })),
      ...teamState.attentionItems.map((attention) => ({
        id: `attention-${attention.id}`,
        kind: "attention" as const,
        data: attention,
      })),
    ];
  }, [
    teamState.attentionItems,
    teamState.members,
    teamState.pendingApprovals,
    teamState.shutdowns,
    teamState.taskBoard,
    teamState.workers,
  ]);

  const selectedIndex = selectedId
    ? items.findIndex((item: DashboardItem) => item.id === selectedId)
    : -1;
  const detailItem = detailId
    ? items.find((item: DashboardItem) => item.id === detailId) ?? null
    : null;

  useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null);
      if (viewMode === "details") {
        setViewMode("dashboard");
        setDetailId(null);
      }
      return;
    }
    if (!selectedId || !items.some((item: DashboardItem) => item.id === selectedId)) {
      setSelectedId(items[0].id);
    }
    if (detailId && !items.some((item: DashboardItem) => item.id === detailId)) {
      setViewMode("dashboard");
      setDetailId(null);
    }
  }, [detailId, items, selectedId, viewMode]);

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
      if (remaining > 0) output += " ".repeat(remaining);
    };
    const drawEmptyRow = (y: number) => {
      drawRow(y, () => 0);
    };

    for (let i = 0; i < PADDING.top; i++) {
      drawEmptyRow(overlayFrame.y + i);
    }

    const headerY = overlayFrame.y + PADDING.top;
    const title = "Team Dashboard";
    const closeHint = viewMode === "details" ? "esc/q back" : "esc/q close";
    drawRow(headerY, () => {
      output += " ".repeat(PADDING.left);
      output += fg(colors.primary) + ansi.bold + title + ansi.reset + bgStyle;
      const midPad = contentWidth - title.length - closeHint.length;
      output += " ".repeat(Math.max(1, midPad));
      output += fg(colors.muted) + closeHint + ansi.reset + bgStyle;
      return overlayFrame.width;
    });

    const members = teamState.members.length;
    const running = teamState.taskCounts.in_progress ?? 0;
    const claimed = teamState.taskCounts.claimed ?? 0;
    const completed = teamState.taskCounts.completed ?? 0;
    const errored = teamState.taskCounts.errored ?? 0;
    const summaryText = truncate(
      `${members} members · ${running + claimed} active tasks · ${completed} done · ${errored} errored`,
      contentWidth,
    );
    drawRow(headerY + 1, () => {
      output += " ".repeat(PADDING.left);
      output += fg(colors.muted) + summaryText + ansi.reset + bgStyle;
      return PADDING.left + summaryText.length;
    });

    const secondaryText = truncate(
      interactionMode
        ? `Interaction pending: ${interactionMode}`
        : `${teamState.pendingApprovals.length} reviews · ${teamState.attentionItems.length} attention`,
      contentWidth,
    );
    drawRow(headerY + 2, () => {
      output += " ".repeat(PADDING.left);
      output += fg(colors.muted) + secondaryText + ansi.reset + bgStyle;
      return PADDING.left + secondaryText.length;
    });

    drawEmptyRow(headerY + 3);

    if (viewMode === "dashboard") {
      const window = calculateScrollWindow(
        Math.max(0, selectedIndex),
        items.length,
        visibleRows,
      );
      const visible = items.slice(window.start, window.end);

      for (let row = 0; row < visibleRows; row++) {
        const rowY = overlayFrame.y + CONTENT_START + row;
        const item = visible[row];

        drawRow(rowY, () => {
          if (!item) {
            if (row === 0 && items.length === 0) {
              output += " ".repeat(PADDING.left);
              output += fg(colors.muted) + "No team activity yet" +
                ansi.reset + bgStyle;
              return PADDING.left + 20;
            }
            return 0;
          }

          const actualIndex = window.start + row;
          const isSelected = actualIndex === selectedIndex;
          if (isSelected) {
            output += bg(colors.warning) + ansi.fg(30, 30, 30);
          }

          const prefix = formatDashboardRow(item, Math.max(8, contentWidth - 6));
          const iconRgb = colors[prefix.iconColor];
          let len = 0;
          output += isSelected ? " ▸ " : "   ";
          len += 3;
          output += fg(iconRgb) + prefix.icon + ansi.reset;
          output += isSelected
            ? bg(colors.warning) + ansi.fg(30, 30, 30)
            : bgStyle;
          output += " ";
          len += 2;
          output += padTo(prefix.text, Math.max(0, contentWidth - len));
          len += Math.max(0, contentWidth - len);
          output += ansi.reset + bgStyle;
          return len + PADDING.left;
        });
      }
    } else {
      const lines = detailItem ? detailLines(detailItem) : ["No selection"];
      for (let row = 0; row < visibleRows; row++) {
        const rowY = overlayFrame.y + CONTENT_START + row;
        drawRow(rowY, () => {
          const line = lines[row];
          if (!line) return 0;
          output += " ".repeat(PADDING.left);
          output += truncate(line, contentWidth);
          return PADDING.left + Math.min(line.length, contentWidth);
        });
      }
    }

    const footerY = overlayFrame.y + overlayFrame.height - PADDING.bottom - 1;
    const footerText = truncate(
      interactionMode
        ? "Esc/q close"
        : viewMode === "dashboard"
        ? "j/k nav · Enter details · esc/q close"
        : "q/Esc back",
      contentWidth,
    );
    const countText = viewMode === "dashboard" && selectedIndex >= 0
      ? `${selectedIndex + 1}/${items.length}`
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

    for (let i = 0; i < PADDING.bottom; i++) {
      drawEmptyRow(overlayFrame.y + overlayFrame.height - PADDING.bottom + i);
    }

    output += ansi.reset + ansi.cursorRestore + ansi.cursorShow;
    writeToTerminal(output);
  }, [
    colors,
    detailItem,
    interactionMode,
    items,
    selectedIndex,
    teamState,
    viewMode,
    contentWidth,
    overlayFrame,
    visibleRows,
  ]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  useInput((input, key) => {
    if (viewMode === "details") {
      if (key.escape || input === "q") {
        setViewMode("dashboard");
        setDetailId(null);
      }
      return;
    }

    if (key.escape || input === "q") {
      onClose();
      return;
    }

    if (items.length === 0) return;

    if (key.upArrow || input === "k") {
      setSelectedId((current: string | null) => {
        const index = current
          ? items.findIndex((item: DashboardItem) => item.id === current)
          : 0;
        return items[Math.max(0, index - 1)]?.id ?? current;
      });
      return;
    }

    if (key.downArrow || input === "j") {
      setSelectedId((current: string | null) => {
        const index = current
          ? items.findIndex((item: DashboardItem) => item.id === current)
          : -1;
        return items[Math.min(items.length - 1, index + 1)]?.id ?? current;
      });
      return;
    }

    if (key.return && selectedIndex >= 0) {
      const selected = items[selectedIndex];
      if (!selected) return;
      setDetailId(selected.id);
      setViewMode("details");
    }
  });

  return null;
}
