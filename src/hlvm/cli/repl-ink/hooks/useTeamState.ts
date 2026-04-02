import { useMemo, useRef } from "react";
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
  activeForm?: string;
}

export interface TeamMemberItem {
  id: string;
  agent: string;
  role: "lead" | "worker";
  status: string;
  threadId?: string;
  currentTaskId?: string;
  currentTaskGoal?: string;
}

export interface MemberActivityItem {
  id: string;
  summary: string;
  status: "active" | "success" | "error";
  activityKind:
    | "message"
    | "task"
    | "review"
    | "shutdown"
    | "reasoning"
    | "planning"
    | "plan_created"
    | "plan_step"
    | "tool_start"
    | "tool_end"
    | "turn_stats";
  ts: number;
  threadId?: string;
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
  memberActivity: Record<string, MemberActivityItem[]>;
  taskBoard: TaskBoardItem[];
  pendingApprovals: PendingApprovalItem[];
  shutdowns: ShutdownItem[];
  taskCounts: Record<string, number>;
  attentionItems: AttentionItem[];
  focusedWorkerIndex: number;
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

/** In-place upsert: find by `key`, update if exists, otherwise push. Returns the item. */
function upsertByField<T>(
  arr: T[],
  key: keyof T,
  value: unknown,
  build: (existing: T | undefined) => T,
): T {
  const index = arr.findIndex((item) => item[key] === value);
  const next = build(index >= 0 ? arr[index] : undefined);
  if (index >= 0) {
    arr[index] = next;
  } else {
    arr.push(next);
  }
  return next;
}

/** Ensures member exists in snapshot, returns the member reference for O(1) access. */
function ensureMember(
  snapshot: TeamRuntimeSnapshot,
  memberId: string,
  ts: number,
): TeamRuntimeSnapshot["members"][number] {
  return upsertByField(snapshot.members, "id", memberId, (existing) =>
    existing
      ? { ...existing, updatedAt: Math.max(existing.updatedAt, ts) }
      : {
        id: memberId,
        agent: memberId,
        role: (memberId === snapshot.leadMemberId ? "lead" : "worker") as "lead" | "worker",
        status: "active" as const,
        createdAt: ts,
        updatedAt: ts,
      });
}

/** Build O(1) member lookup index from snapshot.members array */
function buildMemberIndex(snapshot: TeamRuntimeSnapshot): Map<string, TeamRuntimeSnapshot["members"][number]> {
  return new Map(snapshot.members.map((m) => [m.id, m]));
}

function syncMemberTask(
  snapshot: TeamRuntimeSnapshot,
  task: TeamTask,
  memberIndex: Map<string, TeamRuntimeSnapshot["members"][number]>,
): void {
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
    const member = memberIndex.get(task.assigneeMemberId);
    if (member) {
      member.currentTaskId = task.id;
      member.updatedAt = Math.max(member.updatedAt, task.updatedAt);
    }
  } else if (task.assigneeMemberId) {
    const member = memberIndex.get(task.assigneeMemberId);
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
        if (item.assigneeMemberId) {
          ensureMember(snapshot, item.assigneeMemberId, ts);
        }
        const nextTask = upsertByField(snapshot.tasks, "id", item.taskId, (existing) =>
          existing
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
            });
        syncMemberTask(snapshot, nextTask, buildMemberIndex(snapshot));
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
      case "team_member_activity": {
        const member = ensureMember(snapshot, item.memberId, ts);
        if (item.threadId) member.threadId = item.threadId;
        break;
      }
      case "team_plan_review": {
        ensureMember(snapshot, item.submittedByMemberId, ts);
        if (item.reviewedByMemberId) {
          ensureMember(snapshot, item.reviewedByMemberId, ts);
        }
        upsertByField(snapshot.approvals, "id", item.approvalId, (existing) =>
          existing
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
            });
        break;
      }
      case "team_shutdown": {
        const shutdownMember = ensureMember(snapshot, item.memberId, ts);
        ensureMember(snapshot, item.requestedByMemberId, ts);
        upsertByField(snapshot.shutdowns, "id", item.requestId, (existing) =>
          existing
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
            });

        shutdownMember.status = item.status === "requested"
          ? "shutdown_requested"
          : item.status === "acknowledged"
          ? "shutting_down"
          : "terminated";
        shutdownMember.updatedAt = Math.max(shutdownMember.updatedAt, ts);
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
  memberActivity: {},
  taskBoard: [],
  pendingApprovals: [],
  shutdowns: [],
  taskCounts: { pending: 0, claimed: 0, in_progress: 0, blocked: 0, completed: 0, cancelled: 0, errored: 0, running: 0 },
  attentionItems: [],
  focusedWorkerIndex: -1,
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
  const memberActivity: Record<string, MemberActivityItem[]> = {};

  const appendMemberActivity = (
    memberId: string | undefined,
    entry: MemberActivityItem,
  ): void => {
    if (!memberId) return;
    if (!memberActivity[memberId]) memberActivity[memberId] = [];
    memberActivity[memberId]!.unshift(entry);
    if (memberActivity[memberId]!.length > 6) {
      memberActivity[memberId] = memberActivity[memberId]!.slice(0, 6);
    }
  };

  for (const item of items) {
    if (!isStructuredTeamInfoItem(item)) continue;
    const ts = item.ts ?? Date.now();
    switch (item.teamEventType) {
      case "team_member_activity":
        appendMemberActivity(item.memberId, {
          id: item.id,
          summary: item.summary,
          status: item.status,
          activityKind: item.activityKind,
          ts,
          threadId: item.threadId,
        });
        break;
      case "team_message":
        appendMemberActivity(item.fromMemberId, {
          id: item.id,
          summary: item.toMemberId
            ? `Message to ${item.toMemberId}: ${item.contentPreview}`
            : `Broadcast: ${item.contentPreview}`,
          status: "active",
          activityKind: "message",
          ts,
        });
        break;
      case "team_task_updated":
        appendMemberActivity(item.assigneeMemberId, {
          id: item.id,
          summary: `Task ${item.status}: ${item.goal}`,
          status: item.status === "completed"
            ? "success"
            : item.status === "errored"
            ? "error"
            : "active",
          activityKind: "task",
          ts,
          threadId: typeof item.artifacts?.threadId === "string"
            ? item.artifacts.threadId
            : undefined,
        });
        break;
      case "team_plan_review":
        appendMemberActivity(item.submittedByMemberId, {
          id: item.id,
          summary: `Plan review ${item.status} for task ${item.taskId}`,
          status: item.status === "approved"
            ? "success"
            : item.status === "rejected"
            ? "error"
            : "active",
          activityKind: "review",
          ts,
        });
        break;
      case "team_shutdown":
        appendMemberActivity(item.memberId, {
          id: item.id,
          summary: item.reason
            ? `Shutdown ${item.status}: ${item.reason}`
            : `Shutdown ${item.status}`,
          status: item.status === "forced" ? "error" : "active",
          activityKind: "shutdown",
          ts,
        });
        break;
      case "team_runtime_snapshot":
        break;
    }
  }

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
      const activeForm = typeof task.artifacts?.activeForm === "string"
        ? task.artifacts.activeForm
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
        activeForm,
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

  /** O(1) task goal lookup for approvals and member current-task display */
  const taskGoalIndex = new Map(
    (snapshot?.tasks ?? []).map((task) => [task.id, task.goal]),
  );

  const pendingApprovals = (snapshot?.approvals ?? [])
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((approval) => {
      const taskGoal = taskGoalIndex.get(approval.taskId);
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
        ? taskGoalIndex.get(member.currentTaskId)
        : undefined;
      return {
        id: member.id,
        agent: member.agent,
        role: member.role,
        status: member.status,
        threadId: member.threadId,
        currentTaskId: member.currentTaskId,
        currentTaskGoal,
      };
    });

  const messageCount = snapshot?.messages.length ?? 0;

  return {
    active: workers.length > 0 ||
      Object.keys(memberActivity).length > 0 ||
      taskBoard.length > 0 ||
      messageCount > 0 ||
      pendingApprovals.length > 0 ||
      shutdowns.length > 0,
    workers,
    members,
    memberActivity,
    taskBoard,
    pendingApprovals,
    shutdowns,
    taskCounts,
    attentionItems,
    focusedWorkerIndex: -1,
  };
}

export function useTeamState(items: ConversationItem[]): TeamDashboardState {
  // Cache: skip full derivation when items grew but no new team-related items were added.
  // During streaming, items changes on every token — but team events are rare, so the
  // O(n) .some() scan in deriveTeamDashboardState is wasted work for non-team conversations.
  const cacheRef = useRef<{
    length: number;
    hadTeamItems: boolean;
    result: TeamDashboardState;
  }>({ length: 0, hadTeamItems: false, result: EMPTY_TEAM_STATE });

  return useMemo(() => {
    const cache = cacheRef.current;

    // Items shrunk or reset → full recompute (conversation cleared)
    if (items.length < cache.length) {
      const result = deriveTeamDashboardState(items);
      cacheRef.current = {
        length: items.length,
        hadTeamItems: result !== EMPTY_TEAM_STATE,
        result,
      };
      return result;
    }

    // Items grew — check only the new items for team relevance
    if (!cache.hadTeamItems && items.length > cache.length) {
      const newItems = items.slice(cache.length);
      const hasNewTeamItem = newItems.some((i) =>
        isStructuredTeamInfoItem(i) || i.type === "delegate"
      );
      if (!hasNewTeamItem) {
        // No team items anywhere — return cached EMPTY_TEAM_STATE
        cache.length = items.length;
        return cache.result;
      }
    }

    // Full derivation (team items exist, or first render)
    const result = deriveTeamDashboardState(items);
    cacheRef.current = {
      length: items.length,
      hadTeamItems: result !== EMPTY_TEAM_STATE,
      result,
    };
    return result;
  }, [items]);
}
