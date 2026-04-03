import type {
  MemberActivityItem,
  PendingApprovalItem,
  TaskBoardItem,
  TeamMemberItem,
} from "../hooks/useTeamState.ts";
import {
  deriveMemberActivityProgress,
  findRecentActivityItem,
} from "./team-activity.ts";
import {
  isDelegateTask,
  type Task,
} from "../../repl/task-manager/index.ts";
import { listDelegatePreviewLines } from "../../../agent/delegate-transcript.ts";

export type LocalAgentKind = "teammate" | "delegate";
export type LocalAgentStatus =
  | "waiting"
  | "blocked"
  | "running"
  | "idle"
  | "completed"
  | "failed"
  | "cancelled";

export interface LocalAgentEntry {
  id: string;
  kind: LocalAgentKind;
  name: string;
  memberId?: string;
  taskId?: string;
  threadId?: string;
  childSessionId?: string;
  label: string;
  status: LocalAgentStatus;
  statusLabel: string;
  detail?: string;
  interruptible: boolean;
  foregroundable?: boolean;
  overlayTarget: "background-tasks";
  overlayItemId: string;
  progress?: LocalAgentProgress;
}

export interface LocalAgentProgress {
  activityText?: string;
  previewLines: string[];
  toolUseCount?: number;
  tokenCount?: number;
  durationMs?: number;
}

const LOCAL_AGENT_STATUS_ORDER: LocalAgentStatus[] = [
  "waiting",
  "blocked",
  "running",
  "idle",
  "failed",
  "completed",
  "cancelled",
];

/** O(1) priority lookup for status sorting (avoids indexOf per comparison) */
const LOCAL_AGENT_STATUS_PRIORITY: ReadonlyMap<string, number> = new Map(
  LOCAL_AGENT_STATUS_ORDER.map((v, i) => [v, i]),
);

const LOCAL_AGENT_STATUS_SUMMARY_LABEL: Record<LocalAgentStatus, string> = {
  waiting: "waiting",
  blocked: "blocked",
  running: "working",
  idle: "idle",
  completed: "done",
  failed: "failed",
  cancelled: "cancelled",
};

export function statusPriority(status: LocalAgentStatus): number {
  return LOCAL_AGENT_STATUS_PRIORITY.get(status) ?? LOCAL_AGENT_STATUS_ORDER.length;
}

function summarizeBlockedDependencies(task: TaskBoardItem): string {
  if (task.blockedBy.length === 0) return "Blocked by dependencies";
  const blockers = task.blockedBy.slice(0, 2).map((id) => `#${id}`);
  const more = task.blockedBy.length - blockers.length;
  return more > 0
    ? `Blocked by ${blockers.join(", ")} +${more} more`
    : `Blocked by ${blockers.join(", ")}`;
}

function deriveTerminalTeammateStatus(
  latestTask: TaskBoardItem | undefined,
  recentActivity: MemberActivityItem | undefined,
): Pick<LocalAgentEntry, "status" | "statusLabel" | "detail"> {
  if (latestTask?.status === "errored") {
    return {
      status: "failed",
      statusLabel: "failed",
      detail: recentActivity?.summary || "Failed",
    };
  }
  if (latestTask?.status === "cancelled") {
    return {
      status: "cancelled",
      statusLabel: "cancelled",
      detail: recentActivity?.summary || "Cancelled",
    };
  }
  if (recentActivity?.status === "error") {
    return {
      status: "failed",
      statusLabel: "failed",
      detail: recentActivity.summary,
    };
  }
  return {
    status: "completed",
    statusLabel: "done",
    detail: recentActivity?.summary || "Completed",
  };
}

function deriveTeammateStatus(
  member: TeamMemberItem,
  recentActivity: MemberActivityItem | undefined,
  latestTask: TaskBoardItem | undefined,
  pendingApproval: PendingApprovalItem | undefined,
  pendingInteraction:
    | { sourceMemberId?: string; mode?: "permission" | "question" }
    | undefined,
): Pick<LocalAgentEntry, "label" | "status" | "statusLabel" | "detail"> {
  const currentGoal = member.currentTaskGoal?.trim();
  const latestGoal = latestTask?.goal?.trim();
  const fallbackLabel = currentGoal || latestGoal || recentActivity?.summary || member.id;

  if (
    pendingInteraction?.sourceMemberId === member.id && pendingInteraction.mode
  ) {
    return {
      label: currentGoal || latestGoal || member.id,
      status: "waiting",
      statusLabel: pendingInteraction.mode === "permission"
        ? "awaiting approval"
        : "awaiting reply",
      detail: pendingInteraction.mode === "permission"
        ? "Waiting for your approval"
        : "Waiting for your answer",
    };
  }

  if (pendingApproval) {
    return {
      label: pendingApproval.taskGoal?.trim() || latestGoal || fallbackLabel,
      status: "waiting",
      statusLabel: "awaiting approval",
      detail: pendingApproval.taskGoal?.trim()
        ? `Plan review pending: ${pendingApproval.taskGoal.trim()}`
        : "Plan review pending",
    };
  }

  if (latestTask?.status === "blocked") {
    return {
      label: latestGoal || fallbackLabel,
      status: "blocked",
      statusLabel: "blocked",
      detail: summarizeBlockedDependencies(latestTask),
    };
  }

  if (member.status === "terminated") {
    return {
      label: latestGoal || fallbackLabel,
      ...deriveTerminalTeammateStatus(latestTask, recentActivity),
    };
  }

  if (
    member.status === "shutdown_requested" || member.status === "shutting_down"
  ) {
    return {
      label: latestGoal || fallbackLabel,
      status: "running",
      statusLabel: "shutting down",
      detail: member.status === "shutdown_requested"
        ? "Shutdown requested"
        : "Shutting down",
    };
  }

  if (latestTask?.status === "claimed" || latestTask?.status === "in_progress") {
    return {
      label: latestGoal || fallbackLabel,
      status: "running",
      statusLabel: "running",
      detail: recentActivity?.summary ||
        "Working in the background",
    };
  }

  if (latestTask?.status === "pending") {
    return {
      label: latestGoal || fallbackLabel,
      status: "running",
      statusLabel: "queued",
      detail: recentActivity?.summary ||
        "Queued in the background",
    };
  }

  if (currentGoal) {
    return {
      label: currentGoal,
      status: "running",
      statusLabel: "running",
      detail: recentActivity?.summary ||
        "Working in the background",
    };
  }

  if (recentActivity?.summary.trim()) {
    return {
      label: latestGoal || member.id,
      status: "idle",
      statusLabel: "idle",
      detail: recentActivity.summary,
    };
  }

  return {
    label: member.id,
    status: "idle",
    statusLabel: "idle",
    detail: "Waiting for the next task",
  };
}

function summarizeDelegateDetail(task: Task): string {
  if (!isDelegateTask(task)) {
    return task.status === "completed"
      ? "Completed"
      : task.status === "failed"
      ? "Failed"
      : task.status === "cancelled"
      ? "Cancelled"
      : "Running in the background";
  }

  const latestSnapshotLine = listDelegatePreviewLines(task.snapshot).at(-1);
  if (task.status === "pending") {
    return latestSnapshotLine || "Queued in the background";
  }
  if (task.status === "running") {
    return latestSnapshotLine || "Working in the background";
  }
  if (task.status === "completed") {
    return task.summary?.trim() || latestSnapshotLine || "Completed";
  }
  if (task.status === "failed") {
    return task.error instanceof Error
      ? task.error.message
      : latestSnapshotLine || "Failed";
  }
  return "Cancelled";
}

function dedupePreviewLines(
  lines: readonly string[],
  activityText?: string,
  limit = 3,
): string[] {
  const seen = new Set<string>();
  const normalizedActivity = activityText?.trim();
  const next: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (normalizedActivity && line === normalizedActivity) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    next.push(line);
    if (next.length >= limit) break;
  }
  return next;
}

function getDelegateTokenCount(task: Task): number | undefined {
  if (!isDelegateTask(task) || !task.snapshot) return undefined;
  const latestTurnStats = [...task.snapshot.events].reverse().find((event) =>
    event.type === "turn_stats" &&
    (event.inputTokens != null || event.outputTokens != null)
  );
  if (!latestTurnStats || latestTurnStats.type !== "turn_stats") {
    return undefined;
  }
  const tokenCount = (latestTurnStats.inputTokens ?? 0) +
    (latestTurnStats.outputTokens ?? 0);
  return tokenCount > 0 ? tokenCount : undefined;
}

function getTaskDurationMs(task: Task): number | undefined {
  if (isDelegateTask(task) && task.snapshot?.durationMs != null) {
    return task.snapshot.durationMs;
  }
  if (task.status === "running" && task.startedAt != null) {
    return Math.max(0, Date.now() - task.startedAt);
  }
  if (task.completedAt != null && task.startedAt != null) {
    return Math.max(0, task.completedAt - task.startedAt);
  }
  return undefined;
}

function buildDelegateProgress(task: Task): LocalAgentProgress {
  const activityText = summarizeDelegateDetail(task);
  const transcriptLines = isDelegateTask(task)
    ? listDelegatePreviewLines(task.snapshot)
    : [];
  return {
    activityText,
    previewLines: dedupePreviewLines(transcriptLines.slice(-4), activityText),
    toolUseCount: isDelegateTask(task) && task.snapshot?.toolCount &&
        task.snapshot.toolCount > 0
      ? task.snapshot.toolCount
      : undefined,
    tokenCount: getDelegateTokenCount(task),
    durationMs: getTaskDurationMs(task),
  };
}

function buildTeammateProgress(
  activities: MemberActivityItem[] | undefined,
  preferredActivityText?: string,
): LocalAgentProgress {
  const derived = deriveMemberActivityProgress(activities);
  const activityText = preferredActivityText?.trim() || derived.activityText;
  return {
    activityText,
    previewLines: dedupePreviewLines(derived.previewLines, activityText),
    toolUseCount: derived.toolUseCount,
    tokenCount: derived.tokenCount,
    durationMs: derived.durationMs,
  };
}

function delegateStatusMeta(task: Task): {
  status: LocalAgentStatus;
  statusLabel: string;
} {
  switch (task.status) {
    case "pending":
      return { status: "running", statusLabel: "queued" };
    case "running":
      return { status: "running", statusLabel: "running" };
    case "completed":
      return { status: "completed", statusLabel: "done" };
    case "failed":
      return { status: "failed", statusLabel: "failed" };
    case "cancelled":
      return { status: "cancelled", statusLabel: "cancelled" };
  }
}

export function summarizeLocalAgentFleet(entries: LocalAgentEntry[]): string {
  const counts: Record<LocalAgentStatus, number> = {
    waiting: 0,
    blocked: 0,
    running: 0,
    idle: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const entry of entries) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  }

  return LOCAL_AGENT_STATUS_ORDER
    .filter((status) => counts[status] > 0)
    .map((status) =>
      `${counts[status]} ${LOCAL_AGENT_STATUS_SUMMARY_LABEL[status]}`
    )
    .slice(0, 3)
    .join(" · ");
}

interface LocalAgentBuildOptions {
  taskBoard?: TaskBoardItem[];
  pendingApprovals?: PendingApprovalItem[];
  pendingInteraction?: {
    sourceMemberId?: string;
    mode?: "permission" | "question";
  };
}

function findLatestMemberTask(
  member: TeamMemberItem,
  taskBoard: TaskBoardItem[],
): TaskBoardItem | undefined {
  if (member.currentTaskId) {
    const currentTask = taskBoard.find((task) => task.id === member.currentTaskId);
    if (currentTask) return currentTask;
  }
  return taskBoard.find((task) => task.assignee === member.id);
}

export function buildLocalAgentEntries(
  members: TeamMemberItem[],
  memberActivity: Record<string, MemberActivityItem[]>,
  tasks: Task[],
  options: LocalAgentBuildOptions = {},
): LocalAgentEntry[] {
  const taskBoard = options.taskBoard ?? [];
  const pendingApprovals = options.pendingApprovals ?? [];
  const pendingInteraction = options.pendingInteraction;

  const teammateEntries = members
    .filter((member) => member.role === "worker")
    .flatMap((member) => {
      const activities = memberActivity[member.id];
      const recentActivity = findRecentActivityItem(activities);
      const latestTask = findLatestMemberTask(member, taskBoard);
      const pendingApproval = pendingApprovals.find((approval) =>
        approval.status === "pending" && approval.submittedByMemberId === member.id
      );

      if (
        member.status === "terminated" &&
        !latestTask &&
        !recentActivity &&
        !pendingApproval
      ) {
        return [];
      }

      const derived = deriveTeammateStatus(
        member,
        recentActivity,
        latestTask,
        pendingApproval,
        pendingInteraction,
      );
      const progress = buildTeammateProgress(activities, derived.detail);

      return [{
        id: `teammate:${member.id}`,
        kind: "teammate" as const,
        name: member.id,
        memberId: member.id,
        threadId: member.threadId,
        label: derived.label,
        status: derived.status,
        statusLabel: derived.statusLabel,
        detail: derived.detail,
        interruptible: (derived.status === "running" ||
            derived.status === "waiting") &&
          Boolean(member.threadId),
        foregroundable: member.status !== "terminated" &&
          Boolean(member.threadId),
        overlayTarget: "background-tasks" as const,
        overlayItemId: `teammate:${member.id}`,
        progress,
      }];
    });

  const delegateEntries = tasks
    .filter(isDelegateTask)
    .map((task) => {
      const { status, statusLabel } = delegateStatusMeta(task);
      const progress = buildDelegateProgress(task);
      return {
        id: `delegate:${task.id}`,
        kind: "delegate" as const,
        name: task.nickname,
        taskId: task.id,
        threadId: task.threadId,
        childSessionId: task.childSessionId,
        label: task.task,
        status,
        statusLabel,
        detail: progress.activityText,
        interruptible: status === "running",
        foregroundable: false,
        overlayTarget: "background-tasks" as const,
        overlayItemId: `bg:${task.id}`,
        progress,
      };
    });

  return [...teammateEntries, ...delegateEntries].sort((a, b) => {
    const statusOrder = statusPriority(a.status) - statusPriority(b.status);
    if (statusOrder !== 0) return statusOrder;
    return a.label.localeCompare(b.label);
  });
}
