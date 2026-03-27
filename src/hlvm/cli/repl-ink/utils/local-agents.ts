import type {
  MemberActivityItem,
  TeamMemberItem,
} from "../hooks/useTeamState.ts";
import {
  isDelegateTask,
  type Task,
} from "../../repl/task-manager/index.ts";

export type LocalAgentKind = "teammate" | "delegate";
export type LocalAgentStatus =
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
  interruptible: boolean;
  overlayTarget: "team-dashboard" | "background-tasks";
  overlayItemId: string;
}

function statusPriority(status: LocalAgentStatus): number {
  switch (status) {
    case "running":
      return 0;
    case "idle":
      return 1;
    case "completed":
      return 2;
    case "failed":
      return 3;
    case "cancelled":
      return 4;
  }
}

function summarizeRecentActivity(
  activities: MemberActivityItem[] | undefined,
): string | undefined {
  return activities?.find((activity) => activity.summary.trim().length > 0)
    ?.summary;
}

function deriveTeammateStatus(
  member: TeamMemberItem,
  recentActivity?: string,
): { label: string; status: LocalAgentStatus } {
  if (member.status === "terminated") {
    return {
      label: recentActivity ?? member.currentTaskGoal ?? member.id,
      status: "completed",
    };
  }
  if (member.status === "shutdown_requested") {
    return {
      label: recentActivity ?? member.currentTaskGoal ?? member.id,
      status: "running",
    };
  }
  if (member.status === "shutting_down") {
    return {
      label: recentActivity ?? member.currentTaskGoal ?? member.id,
      status: "running",
    };
  }
  if (member.currentTaskGoal?.trim()) {
    return { label: member.currentTaskGoal, status: "running" };
  }
  if (recentActivity?.trim()) {
    return { label: recentActivity, status: "running" };
  }
  return { label: member.id, status: "idle" };
}

function delegateStatusLabel(status: Task["status"]): LocalAgentStatus {
  switch (status) {
    case "pending":
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

export function buildLocalAgentEntries(
  members: TeamMemberItem[],
  memberActivity: Record<string, MemberActivityItem[]>,
  tasks: Task[],
): LocalAgentEntry[] {
  const teammateEntries = members
    .filter((member) => member.role === "worker" && member.status !== "terminated")
    .map((member) => {
      const recentActivity = summarizeRecentActivity(memberActivity[member.id]);
      const derived = deriveTeammateStatus(member, recentActivity);
      return {
        id: `teammate:${member.id}`,
        kind: "teammate" as const,
        name: member.id,
        memberId: member.id,
        threadId: member.threadId,
        label: derived.label,
        status: derived.status,
        statusLabel: derived.status,
        interruptible: Boolean(member.threadId),
        overlayTarget: "team-dashboard" as const,
        overlayItemId: `member-${member.id}`,
      };
    });

  const delegateEntries = tasks
    .filter(isDelegateTask)
    .filter((task) => task.status === "pending" || task.status === "running")
    .map((task) => {
      const status = delegateStatusLabel(task.status);
      return {
        id: `delegate:${task.id}`,
        kind: "delegate" as const,
        name: task.nickname,
        taskId: task.id,
        threadId: task.threadId,
        childSessionId: task.childSessionId,
        label: task.task,
        status,
        statusLabel: status,
        interruptible: status === "running",
        overlayTarget: "background-tasks" as const,
        overlayItemId: `bg:${task.id}`,
      };
    });

  return [...teammateEntries, ...delegateEntries].sort((a, b) => {
    const statusOrder = statusPriority(a.status) - statusPriority(b.status);
    if (statusOrder !== 0) return statusOrder;
    return a.label.localeCompare(b.label);
  });
}
