import { useMemo } from "react";
import {
  cloneTeamRuntimeSnapshot,
  createDefaultTeamPolicy,
  type TeamMessageKind,
  type TeamRuntimeSnapshot,
  type TeamTask,
} from "../../../agent/team-runtime.ts";
import {
  type ConversationItem,
  type DelegateItem,
  isStructuredTeamInfoItem,
} from "../types.ts";

export interface WorkerStatus {
  id: string;
  nickname: string;
  agent: string;
  status: "running" | "completed" | "errored" | "cancelled";
  task: string;
  durationMs: number;
  threadId?: string;
}

export interface AttentionItem {
  id: string;
  kind:
    | "worker_failed"
    | "review_pending"
    | "merge_pending"
    | "shutdown_requested";
  label: string;
  timestamp: number;
}

export interface TaskBoardItem {
  id: string;
  goal: string;
  status: string;
  assignee?: string;
  blockedBy: string[];
  mergeState?: string;
  reviewStatus?: string;
  delegateThreadId?: string;
}

export interface TeamMemberItem {
  id: string;
  agent: string;
  role: "lead" | "worker";
  status: string;
  currentTaskId?: string;
  currentTaskGoal?: string;
}

export interface PendingApprovalItem {
  id: string;
  taskId: string;
  taskGoal?: string;
  submittedByMemberId: string;
  status: string;
  reviewedByMemberId?: string;
}

export interface ShutdownItem {
  id: string;
  memberId: string;
  requestedByMemberId: string;
  status: string;
  reason?: string;
}

export interface TeamDashboardState {
  active: boolean;
  workers: WorkerStatus[];
  members: TeamMemberItem[];
  taskBoard: TaskBoardItem[];
  pendingApprovals: PendingApprovalItem[];
  shutdowns: ShutdownItem[];
  taskCounts: Record<string, number>;
  attentionItems: AttentionItem[];
}

function createEmptySnapshot(): TeamRuntimeSnapshot {
  return {
    teamId: "team",
    leadMemberId: "lead",
    policy: createDefaultTeamPolicy(),
    members: [{
      id: "lead",
      agent: "lead",
      role: "lead",
      status: "active",
      createdAt: 0,
      updatedAt: 0,
    }],
    tasks: [],
    messages: [],
    approvals: [],
    shutdowns: [],
  };
}

function ensureSnapshot(
  snapshot: TeamRuntimeSnapshot | undefined,
): TeamRuntimeSnapshot {
  return snapshot ? snapshot : createEmptySnapshot();
}

function ensureMember(
  snapshot: TeamRuntimeSnapshot,
  memberId: string,
  ts: number,
): void {
  const existing = snapshot.members.find((member) => member.id === memberId);
  if (existing) {
    existing.updatedAt = Math.max(existing.updatedAt, ts);
    return;
  }
  snapshot.members.push({
    id: memberId,
    agent: memberId,
    role: memberId === snapshot.leadMemberId ? "lead" : "worker",
    status: "active",
    createdAt: ts,
    updatedAt: ts,
  });
}

function syncMemberTask(snapshot: TeamRuntimeSnapshot, task: TeamTask): void {
  for (const member of snapshot.members) {
    if (member.currentTaskId === task.id && member.id !== task.assigneeMemberId) {
      member.currentTaskId = undefined;
    }
  }
  if (
    task.assigneeMemberId &&
    task.status !== "completed" &&
    task.status !== "cancelled" &&
    task.status !== "errored"
  ) {
    const member = snapshot.members.find((entry) => entry.id === task.assigneeMemberId);
    if (member) {
      member.currentTaskId = task.id;
      member.updatedAt = Math.max(member.updatedAt, task.updatedAt);
    }
  } else if (task.assigneeMemberId) {
    const member = snapshot.members.find((entry) => entry.id === task.assigneeMemberId);
    if (member?.currentTaskId === task.id) {
      member.currentTaskId = undefined;
    }
  }
}

function applyStructuredTeamItems(items: ConversationItem[]): TeamRuntimeSnapshot | undefined {
  const latestSnapshotIndex = items.findLastIndex((item) =>
    isStructuredTeamInfoItem(item) && item.teamEventType === "team_runtime_snapshot"
  );
  let snapshot = latestSnapshotIndex >= 0 &&
      items[latestSnapshotIndex]?.type === "info" &&
      "snapshot" in items[latestSnapshotIndex]
    ? cloneTeamRuntimeSnapshot(items[latestSnapshotIndex].snapshot)
    : undefined;

  for (const item of items.slice(Math.max(0, latestSnapshotIndex + 1))) {
    if (!isStructuredTeamInfoItem(item) || item.teamEventType === "team_runtime_snapshot") {
      continue;
    }
    const ts = item.ts ?? Date.now();
    snapshot = ensureSnapshot(snapshot);

    switch (item.teamEventType) {
      case "team_task_updated": {
        const existingIndex = snapshot.tasks.findIndex((task) => task.id === item.taskId);
        const existing = existingIndex >= 0 ? snapshot.tasks[existingIndex] : undefined;
        if (item.assigneeMemberId) {
          ensureMember(snapshot, item.assigneeMemberId, ts);
        }
        const nextTask: TeamTask = existing
          ? {
            ...existing,
            goal: item.goal,
            status: item.status as TeamTask["status"],
            assigneeMemberId: item.assigneeMemberId,
            updatedAt: ts,
            artifacts: item.artifacts
              ? { ...(existing.artifacts ?? {}), ...item.artifacts }
              : existing.artifacts,
          }
          : {
            id: item.taskId,
            goal: item.goal,
            status: item.status as TeamTask["status"],
            assigneeMemberId: item.assigneeMemberId,
            dependencies: [],
            artifacts: item.artifacts ? { ...item.artifacts } : undefined,
            createdAt: ts,
            updatedAt: ts,
          };
        if (existingIndex >= 0) {
          snapshot.tasks[existingIndex] = nextTask;
        } else {
          snapshot.tasks.push(nextTask);
        }
        syncMemberTask(snapshot, nextTask);
        break;
      }
      case "team_message":
        ensureMember(snapshot, item.fromMemberId, ts);
        if (item.toMemberId) {
          ensureMember(snapshot, item.toMemberId, ts);
        }
        snapshot.messages.push({
          id: item.id,
          fromMemberId: item.fromMemberId,
          toMemberId: item.toMemberId,
          kind: item.kind as TeamMessageKind,
          content: item.contentPreview,
          relatedTaskId: item.relatedTaskId,
          createdAt: ts,
          readBy: [item.fromMemberId],
        });
        break;
      case "team_plan_review": {
        ensureMember(snapshot, item.submittedByMemberId, ts);
        if (item.reviewedByMemberId) {
          ensureMember(snapshot, item.reviewedByMemberId, ts);
        }
        const existingIndex = snapshot.approvals.findIndex((approval) => approval.id === item.approvalId);
        const existing = existingIndex >= 0 ? snapshot.approvals[existingIndex] : undefined;
        const nextApproval = existing
          ? {
            ...existing,
            status: item.status,
            reviewedByMemberId: item.reviewedByMemberId,
            updatedAt: ts,
          }
          : {
            id: item.approvalId,
            taskId: item.taskId,
            submittedByMemberId: item.submittedByMemberId,
            status: item.status,
            plan: { goal: `Task ${item.taskId}`, steps: [] },
            createdAt: ts,
            updatedAt: ts,
            reviewedByMemberId: item.reviewedByMemberId,
          };
        if (existingIndex >= 0) {
          snapshot.approvals[existingIndex] = nextApproval;
        } else {
          snapshot.approvals.push(nextApproval);
        }
        break;
      }
      case "team_shutdown": {
        ensureMember(snapshot, item.memberId, ts);
        ensureMember(snapshot, item.requestedByMemberId, ts);
        const existingIndex = snapshot.shutdowns.findIndex((shutdown) => shutdown.id === item.requestId);
        const existing = existingIndex >= 0 ? snapshot.shutdowns[existingIndex] : undefined;
        const nextShutdown = existing
          ? {
            ...existing,
            status: item.status,
            reason: item.reason ?? existing.reason,
            updatedAt: ts,
          }
          : {
            id: item.requestId,
            memberId: item.memberId,
            requestedByMemberId: item.requestedByMemberId,
            status: item.status,
            reason: item.reason,
            createdAt: ts,
            updatedAt: ts,
          };
        if (existingIndex >= 0) {
          snapshot.shutdowns[existingIndex] = nextShutdown;
        } else {
          snapshot.shutdowns.push(nextShutdown);
        }

        const member = snapshot.members.find((entry) => entry.id === item.memberId);
        if (member) {
          member.status = item.status === "requested"
            ? "shutdown_requested"
            : item.status === "acknowledged"
            ? "shutting_down"
            : "terminated";
          member.updatedAt = Math.max(member.updatedAt, ts);
        }
        break;
      }
    }
  }

  return snapshot;
}

const EMPTY_TEAM_STATE: TeamDashboardState = Object.freeze({
  active: false,
  workers: [],
  members: [],
  taskBoard: [],
  pendingApprovals: [],
  shutdowns: [],
  taskCounts: { pending: 0, claimed: 0, in_progress: 0, blocked: 0, completed: 0, cancelled: 0, errored: 0, running: 0 },
  attentionItems: [],
}) as TeamDashboardState;

export function deriveTeamDashboardState(items: ConversationItem[]): TeamDashboardState {
  // Fast path: no team-related items → return stable empty state (avoids all derivation work)
  const hasTeamItems = items.some((i) =>
    isStructuredTeamInfoItem(i) || i.type === "delegate"
  );
  if (!hasTeamItems) return EMPTY_TEAM_STATE;

  const workers: WorkerStatus[] = [];
  const attentionItems: AttentionItem[] = [];
  const snapshot = applyStructuredTeamItems(items);

  const delegateItems = items.filter(
    (item): item is DelegateItem => item.type === "delegate",
  );

  const workerMap = new Map<string, WorkerStatus>();
  const statusMap: Record<string, WorkerStatus["status"]> = {
    queued: "running",
    running: "running",
    success: "completed",
    error: "errored",
    cancelled: "cancelled",
  };

  for (const item of delegateItems) {
    const key = item.threadId ?? item.id;
    workerMap.set(key, {
      id: key,
      nickname: item.nickname ?? item.agent,
      agent: item.agent,
      status: statusMap[item.status] ?? "running",
      task: item.task,
      durationMs: item.durationMs ?? 0,
      threadId: item.threadId,
    });

    if (item.status === "error") {
      attentionItems.push({
        id: `fail-${key}`,
        kind: "worker_failed",
        label: `${item.nickname ?? item.agent} failed: ${item.error ?? "unknown error"}`,
        timestamp: item.ts,
      });
    }
  }

  workers.push(...workerMap.values());

  const taskCounts: Record<string, number> = {
    pending: 0,
    claimed: 0,
    in_progress: 0,
    blocked: 0,
    completed: 0,
    cancelled: 0,
    errored: 0,
    running: 0,
  };
  const taskBoard = (snapshot?.tasks ?? [])
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((task) => {
      taskCounts[task.status] = (taskCounts[task.status] ?? 0) + 1;
      const mergeState = typeof task.artifacts?.mergeState === "string"
        ? task.artifacts.mergeState
        : undefined;
      const reviewStatus = typeof task.artifacts?.reviewStatus === "string"
        ? task.artifacts.reviewStatus
        : undefined;
      const delegateThreadId = typeof task.artifacts?.threadId === "string"
        ? task.artifacts.threadId
        : undefined;
      if (mergeState === "pending" || mergeState === "conflicted") {
        attentionItems.push({
          id: `merge-${task.id}`,
          kind: "merge_pending",
          label: `${mergeState === "conflicted" ? "Conflicts" : "Merge pending"}: ${task.goal}`,
          timestamp: task.updatedAt,
        });
      }
      return {
        id: task.id,
        goal: task.goal,
        status: task.status,
        assignee: task.assigneeMemberId,
        blockedBy: [...task.dependencies],
        mergeState,
        reviewStatus,
        delegateThreadId,
      };
    });

  if (taskBoard.length === 0) {
    for (const worker of workers) {
      const taskLikeStatus = worker.status === "running"
        ? "in_progress"
        : worker.status;
      taskCounts[taskLikeStatus] = (taskCounts[taskLikeStatus] ?? 0) + 1;
    }
  }

  const pendingApprovals = (snapshot?.approvals ?? [])
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((approval) => {
      const taskGoal = snapshot?.tasks.find((task) => task.id === approval.taskId)?.goal;
      if (approval.status === "pending") {
        attentionItems.push({
          id: `approval-${approval.id}`,
          kind: "review_pending",
          label: `Plan review pending: ${taskGoal ?? approval.taskId}`,
          timestamp: approval.updatedAt,
        });
      }
      return {
        id: approval.id,
        taskId: approval.taskId,
        taskGoal,
        submittedByMemberId: approval.submittedByMemberId,
        status: approval.status,
        reviewedByMemberId: approval.reviewedByMemberId,
      };
    });

  const shutdowns = (snapshot?.shutdowns ?? [])
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((shutdown) => {
      if (shutdown.status === "requested" || shutdown.status === "forced") {
        attentionItems.push({
          id: `shutdown-${shutdown.id}`,
          kind: "shutdown_requested",
          label: shutdown.reason
            ? `Shutdown ${shutdown.status}: ${shutdown.memberId} (${shutdown.reason})`
            : `Shutdown ${shutdown.status}: ${shutdown.memberId}`,
          timestamp: shutdown.updatedAt,
        });
      }
      return {
        id: shutdown.id,
        memberId: shutdown.memberId,
        requestedByMemberId: shutdown.requestedByMemberId,
        status: shutdown.status,
        reason: shutdown.reason,
      };
    });

  const members = (snapshot?.members ?? [])
    .slice()
    .sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id))
    .map((member) => {
      const currentTaskGoal = member.currentTaskId
        ? snapshot?.tasks.find((task) => task.id === member.currentTaskId)?.goal
        : undefined;
      return {
        id: member.id,
        agent: member.agent,
        role: member.role,
        status: member.status,
        currentTaskId: member.currentTaskId,
        currentTaskGoal,
      };
    });

  const messageCount = snapshot?.messages.length ?? 0;

  return {
    active: workers.length > 0 ||
      taskBoard.length > 0 ||
      messageCount > 0 ||
      pendingApprovals.length > 0 ||
      shutdowns.length > 0,
    workers,
    members,
    taskBoard,
    pendingApprovals,
    shutdowns,
    taskCounts,
    attentionItems,
  };
}

export function useTeamState(items: ConversationItem[]): TeamDashboardState {
  return useMemo(() => deriveTeamDashboardState(items), [items]);
}
