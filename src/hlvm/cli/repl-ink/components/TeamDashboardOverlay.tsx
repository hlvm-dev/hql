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
  clearOverlay,
  drawOverlayFrame,
  fg,
  resolveOverlayChromeLayout,
  resolveOverlayFrame,
  shouldClearOverlay,
  TEAM_DASHBOARD_OVERLAY_SPEC,
  themeToOverlayColors,
  writeToTerminal,
} from "../overlay/index.ts";
import { useTheme } from "../../theme/index.ts";
import { padTo } from "../utils/formatting.ts";
import { STATUS_GLYPHS } from "../ui-constants.ts";
import {
  buildBalancedTextRow,
  buildSectionLabelText,
} from "../utils/display-chrome.ts";

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

const PADDING = TEAM_DASHBOARD_OVERLAY_SPEC.padding;
const WIDE_DASHBOARD_MIN_WIDTH = 88;
const DASHBOARD_COLUMN_GAP = 3;
const DASHBOARD_ITEM_GLYPHS = {
  member: "M",
  task: "T",
  approval: "R",
  shutdown: "S",
  attention: "!",
} as const;

export function buildTeamDashboardSummaryRows(
  teamState: TeamDashboardState,
  contentWidth: number,
  interactionMode?: "permission" | "question",
): [string, string] {
  const primary = buildBalancedTextRow(
    contentWidth,
    `Members ${teamState.members.length} · Workers ${teamState.workers.length}`,
    `Active ${
      (teamState.taskCounts.in_progress ?? 0) +
      (teamState.taskCounts.claimed ?? 0)
    } · Done ${teamState.taskCounts.completed ?? 0}`,
  );
  const secondary = buildBalancedTextRow(
    contentWidth,
    `Reviews ${teamState.pendingApprovals.length} · Attention ${teamState.attentionItems.length}`,
    interactionMode
      ? `Interaction ${interactionMode}`
      : `Shutdowns ${teamState.shutdowns.length} · Errors ${
        teamState.taskCounts.errored ?? 0
      }`,
  );

  return [
    primary.leftText + " ".repeat(primary.gapWidth) + primary.rightText,
    secondary.leftText + " ".repeat(secondary.gapWidth) + secondary.rightText,
  ];
}

function workerStatusIcon(status: WorkerStatus["status"]): {
  icon: string;
  colorKey: "warning" | "success" | "error" | "muted";
} {
  switch (status) {
    case "running":
      return { icon: STATUS_GLYPHS.running, colorKey: "warning" };
    case "completed":
      return { icon: STATUS_GLYPHS.success, colorKey: "success" };
    case "errored":
      return { icon: STATUS_GLYPHS.error, colorKey: "error" };
    case "cancelled":
    default:
      return { icon: STATUS_GLYPHS.pending, colorKey: "muted" };
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
        icon: DASHBOARD_ITEM_GLYPHS.member,
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
      const review = item.data.reviewStatus
        ? ` · review:${item.data.reviewStatus}`
        : "";
      const merge = item.data.mergeState
        ? ` · merge:${item.data.mergeState}`
        : "";
      return {
        icon: DASHBOARD_ITEM_GLYPHS.task,
        iconColor: "accent",
        text: truncate(
          `${item.data.status} ${item.data.goal}${assignee}${review}${merge}`,
          contentWidth,
        ),
      };
    }
    case "approval":
      return {
        icon: DASHBOARD_ITEM_GLYPHS.approval,
        iconColor: "warning",
        text: truncate(
          `${item.data.status} ${
            item.data.taskGoal ?? item.data.taskId
          } · ${item.data.submittedByMemberId}`,
          contentWidth,
        ),
      };
    case "shutdown":
      return {
        icon: DASHBOARD_ITEM_GLYPHS.shutdown,
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
        icon: DASHBOARD_ITEM_GLYPHS.attention,
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
        item.data.currentTaskId
          ? `Current task: ${item.data.currentTaskId}`
          : "",
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
        item.data.delegateThreadId
          ? `Delegate thread: ${item.data.delegateThreadId}`
          : "",
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

function splitDashboardColumns(items: DashboardItem[]): {
  left: DashboardItem[];
  right: DashboardItem[];
} {
  return {
    left: items.filter((item) =>
      item.kind === "member" || item.kind === "worker"
    ),
    right: items.filter((item) =>
      item.kind === "task" || item.kind === "approval" ||
      item.kind === "shutdown" || item.kind === "attention"
    ),
  };
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
      resolveOverlayFrame(
        TEAM_DASHBOARD_OVERLAY_SPEC.width,
        TEAM_DASHBOARD_OVERLAY_SPEC.height,
        {
          minWidth: TEAM_DASHBOARD_OVERLAY_SPEC.minWidth,
          minHeight: TEAM_DASHBOARD_OVERLAY_SPEC.minHeight,
        },
      ),
    [terminalColumns, terminalRows],
  );
  const chromeLayout = useMemo(
    () =>
      resolveOverlayChromeLayout(
        overlayFrame.height,
        TEAM_DASHBOARD_OVERLAY_SPEC,
      ),
    [overlayFrame.height],
  );
  const contentWidth = Math.max(
    20,
    overlayFrame.width - PADDING.left - PADDING.right,
  );
  const visibleRows = Math.max(
    4,
    chromeLayout.visibleRows,
  );
  const previousFrameRef = useRef<typeof overlayFrame | null>(null);

  const colors = useMemo(() => themeToOverlayColors(theme), [theme]);

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
    if (
      !selectedId ||
      !items.some((item: DashboardItem) => item.id === selectedId)
    ) {
      setSelectedId(items[0].id);
    }
    if (
      detailId && !items.some((item: DashboardItem) => item.id === detailId)
    ) {
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

    const [summaryText, secondaryText] = buildTeamDashboardSummaryRows(
      teamState,
      contentWidth,
      interactionMode,
    );
    drawRow(headerY, () => {
      output += " ".repeat(PADDING.left);
      output += fg(colors.accent) + summaryText + ansi.reset + bgStyle;
      return PADDING.left + summaryText.length;
    });

    drawRow(headerY + 1, () => {
      output += " ".repeat(PADDING.left);
      output += fg(colors.muted) + secondaryText + ansi.reset + bgStyle;
      return PADDING.left + secondaryText.length;
    });

    drawEmptyRow(headerY + 2);

    if (viewMode === "dashboard") {
      const drawDashboardCell = (
        item: DashboardItem | undefined,
        cellWidth: number,
        isSelected: boolean,
      ): number => {
        if (!item) {
          output += " ".repeat(cellWidth);
          return cellWidth;
        }

        if (isSelected) {
          output += colors.selectedBgStyle;
        }

        const prefix = formatDashboardRow(item, Math.max(8, cellWidth - 5));
        const iconRgb = colors[prefix.iconColor];
        let len = 0;
        output += isSelected ? "▸ " : "  ";
        len += 2;
        output += fg(iconRgb) + prefix.icon + ansi.reset;
        output += isSelected
          ? colors.selectedBgStyle
          : bgStyle;
        output += " ";
        len += 2;
        const textWidth = Math.max(0, cellWidth - len);
        output += padTo(prefix.text, textWidth);
        len += textWidth;
        output += ansi.reset + bgStyle;
        return len;
      };

      if (items.length === 0) {
        for (let row = 0; row < visibleRows; row++) {
          const rowY = overlayFrame.y + chromeLayout.contentStart + row;
          drawRow(rowY, () => {
            if (row > 0) return 0;
            output += " ".repeat(PADDING.left);
            output += fg(colors.muted) + "No team activity yet" + ansi.reset +
              bgStyle;
            return PADDING.left + 20;
          });
        }
      } else if (overlayFrame.width >= WIDE_DASHBOARD_MIN_WIDTH) {
        const columns = splitDashboardColumns(items);
        const leftSelectedIndex = selectedId
          ? columns.left.findIndex((item) => item.id === selectedId)
          : -1;
        const rightSelectedIndex = selectedId
          ? columns.right.findIndex((item) => item.id === selectedId)
          : -1;
        const columnRowCount = Math.max(0, visibleRows - 1);
        const leftWindow = calculateScrollWindow(
          Math.max(0, leftSelectedIndex),
          columns.left.length,
          columnRowCount,
        );
        const rightWindow = calculateScrollWindow(
          Math.max(0, rightSelectedIndex),
          columns.right.length,
          columnRowCount,
        );
        const leftVisible = columns.left.slice(
          leftWindow.start,
          leftWindow.end,
        );
        const rightVisible = columns.right.slice(
          rightWindow.start,
          rightWindow.end,
        );
        const leftWidth = Math.max(
          16,
          Math.floor((contentWidth - DASHBOARD_COLUMN_GAP) / 2),
        );
        const rightWidth = Math.max(
          16,
          contentWidth - leftWidth - DASHBOARD_COLUMN_GAP,
        );
        const leftLabel = buildSectionLabelText("Members & Workers", leftWidth);
        const rightLabel = buildSectionLabelText("Tasks & Reviews", rightWidth);
        const labelY = overlayFrame.y + chromeLayout.contentStart;

        drawRow(labelY, () => {
          output += " ".repeat(PADDING.left);
          let len = PADDING.left;
          output += fg(colors.accent) + leftLabel + ansi.reset + bgStyle;
          output += " ".repeat(Math.max(0, leftWidth - leftLabel.length));
          len += leftWidth;
          output += " ".repeat(DASHBOARD_COLUMN_GAP);
          len += DASHBOARD_COLUMN_GAP;
          output += fg(colors.accent) + rightLabel + ansi.reset + bgStyle;
          len += rightLabel.length;
          return len;
        });

        for (let row = 0; row < columnRowCount; row++) {
          const rowY = overlayFrame.y + chromeLayout.contentStart + row + 1;
          const leftItem = leftVisible[row];
          const rightItem = rightVisible[row];

          drawRow(rowY, () => {
            output += " ".repeat(PADDING.left);
            let len = PADDING.left;
            len += drawDashboardCell(
              leftItem,
              leftWidth,
              leftItem?.id === selectedId,
            );
            output += " ".repeat(DASHBOARD_COLUMN_GAP);
            len += DASHBOARD_COLUMN_GAP;
            len += drawDashboardCell(
              rightItem,
              rightWidth,
              rightItem?.id === selectedId,
            );
            return len;
          });
        }
      } else {
        const window = calculateScrollWindow(
          Math.max(0, selectedIndex),
          items.length,
          visibleRows,
        );
        const visible = items.slice(window.start, window.end);

        for (let row = 0; row < visibleRows; row++) {
          const rowY = overlayFrame.y + chromeLayout.contentStart + row;
          const item = visible[row];

          drawRow(rowY, () => {
            if (!item) return 0;
            const actualIndex = window.start + row;
            const isSelected = actualIndex === selectedIndex;
            output += " ".repeat(PADDING.left);
            return PADDING.left +
              drawDashboardCell(item, contentWidth, isSelected);
          });
        }
      }
    } else {
      const lines = detailItem ? detailLines(detailItem) : ["No selection"];
      for (let row = 0; row < visibleRows; row++) {
        const rowY = overlayFrame.y + chromeLayout.contentStart + row;
        drawRow(rowY, () => {
          const line = lines[row];
          if (!line) return 0;
          output += " ".repeat(PADDING.left);
          output += truncate(line, contentWidth);
          return PADDING.left + Math.min(line.length, contentWidth);
        });
      }
    }

    const footerY = overlayFrame.y + chromeLayout.footerY;
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

    output += drawOverlayFrame(overlayFrame, {
      borderColor: colors.primary,
      title,
      rightText: closeHint,
    });
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
    chromeLayout.contentStart,
    chromeLayout.footerY,
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
