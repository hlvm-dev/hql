import { ValidationError } from "../../common/error.ts";
import type { Plan } from "./planning.ts";
import { createTodoState, type TodoState } from "./todo-state.ts";

export interface TeamPolicy {
  maxMembers: number;
  reviewRequired: boolean;
  allowBatchDelegation: boolean;
  autoApplyCleanChanges: boolean;
  implementationProfile: string;
  reviewProfile: string;
  researchProfile: string;
  synthesisProfile: string;
}

export function createDefaultTeamPolicy(): TeamPolicy {
  return {
    maxMembers: 4,
    reviewRequired: false,
    allowBatchDelegation: true,
    autoApplyCleanChanges: true,
    implementationProfile: "code",
    reviewProfile: "code",
    researchProfile: "web",
    synthesisProfile: "general",
  };
}

export type TeamMemberStatus =
  | "active"
  | "shutdown_requested"
  | "shutting_down"
  | "terminated";

export interface TeamMember {
  id: string;
  agent: string;
  role: "lead" | "worker";
  status: TeamMemberStatus;
  threadId?: string;
  childSessionId?: string;
  currentTaskId?: string;
  createdAt: number;
  updatedAt: number;
}

export type TeamTaskStatus =
  | "pending"
  | "claimed"
  | "in_progress"
  | "blocked"
  | "completed"
  | "cancelled"
  | "errored";

export interface TeamTask {
  id: string;
  goal: string;
  status: TeamTaskStatus;
  assigneeMemberId?: string;
  dependencies: string[];
  resultSummary?: string;
  artifacts?: Record<string, unknown>;
  delegateThreadId?: string;
  approvalId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TeamTaskBlocker {
  taskId: string;
  goal: string;
  status: TeamTaskStatus;
}

export type TeamMessageKind =
  | "direct"
  | "broadcast"
  | "task_update"
  | "approval_request"
  | "approval_response"
  | "shutdown_request"
  | "shutdown_ack";

export interface TeamMessage {
  id: string;
  fromMemberId: string;
  kind: TeamMessageKind;
  content: string;
  toMemberId?: string;
  relatedTaskId?: string;
  createdAt: number;
  readBy: Set<string>;
}

export interface TeamMessageSnapshot
  extends Omit<TeamMessage, "readBy"> {
  readBy: string[];
}

export type TeamApprovalStatus = "pending" | "approved" | "rejected";

export interface TeamPlanApproval {
  id: string;
  taskId: string;
  submittedByMemberId: string;
  status: TeamApprovalStatus;
  plan: Plan;
  note?: string;
  feedback?: string;
  reviewedByMemberId?: string;
  createdAt: number;
  updatedAt: number;
}

export type TeamShutdownStatus =
  | "requested"
  | "acknowledged"
  | "forced"
  | "terminated";

export interface TeamShutdownRequest {
  id: string;
  memberId: string;
  requestedByMemberId: string;
  status: TeamShutdownStatus;
  reason?: string;
  escalateAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface TeamRuntimeSnapshot {
  teamId: string;
  leadMemberId: string;
  policy: TeamPolicy;
  members: TeamMember[];
  tasks: TeamTask[];
  messages: TeamMessageSnapshot[];
  approvals: TeamPlanApproval[];
  shutdowns: TeamShutdownRequest[];
}

export interface TeamSummary {
  teamId: string;
  leadMemberId: string;
  policy: TeamPolicy;
  memberCount: number;
  activeMembers: number;
  pendingApprovals: number;
  unreadMessages: number;
  taskCounts: Record<TeamTaskStatus, number>;
  blockedTasks: Array<{
    id: string;
    goal: string;
    dependencies: string[];
  }>;
  members: Array<{
    id: string;
    agent: string;
    role: "lead" | "worker";
    status: TeamMemberStatus;
    currentTaskId?: string;
  }>;
}

export interface TeamRuntime {
  readonly teamId: string;
  readonly leadMemberId: string;
  getPolicy(): TeamPolicy;
  registerMember(input: {
    id?: string;
    agent: string;
    role?: "lead" | "worker";
    threadId?: string;
    childSessionId?: string;
    currentTaskId?: string;
  }): TeamMember;
  updateMember(
    memberId: string,
    patch: Partial<Omit<TeamMember, "id" | "createdAt">>,
  ): TeamMember | undefined;
  getMember(memberId: string): TeamMember | undefined;
  getMemberByThread(threadId: string): TeamMember | undefined;
  listMembers(): TeamMember[];
  ensureTask(input: {
    id?: string;
    goal: string;
    status?: TeamTaskStatus;
    assigneeMemberId?: string;
    dependencies?: string[];
    resultSummary?: string;
    artifacts?: Record<string, unknown>;
    delegateThreadId?: string;
    approvalId?: string;
  }): TeamTask;
  claimTask(taskId: string, memberId: string): TeamTask | undefined;
  updateTask(
    taskId: string,
    patch: Partial<Omit<TeamTask, "id" | "goal" | "createdAt">>,
  ): TeamTask | undefined;
  getTask(taskId: string): TeamTask | undefined;
  getTaskByThread(threadId: string): TeamTask | undefined;
  getBlockingDependencies(taskId: string): TeamTaskBlocker[];
  listTasks(): TeamTask[];
  sendMessage(input: {
    fromMemberId: string;
    toMemberId?: string;
    kind?: TeamMessageKind;
    content: string;
    relatedTaskId?: string;
  }): TeamMessage[];
  readMessages(
    memberId: string,
    options?: { markRead?: boolean },
  ): TeamMessage[];
  requestPlanApproval(input: {
    taskId: string;
    submittedByMemberId: string;
    plan: Plan;
    note?: string;
  }): TeamPlanApproval;
  reviewPlan(input: {
    approvalId: string;
    reviewedByMemberId: string;
    approved: boolean;
    feedback?: string;
  }): TeamPlanApproval | undefined;
  getApproval(approvalId: string): TeamPlanApproval | undefined;
  listApprovals(): TeamPlanApproval[];
  listPendingApprovals(): TeamPlanApproval[];
  requestShutdown(input: {
    memberId: string;
    requestedByMemberId: string;
    reason?: string;
  }): TeamShutdownRequest | undefined;
  acknowledgeShutdown(
    requestId: string,
    memberId: string,
  ): TeamShutdownRequest | undefined;
  forceShutdown(
    requestId: string,
    requestedByMemberId: string,
  ): TeamShutdownRequest | undefined;
  forceExpiredShutdowns(
    requestedByMemberId?: string,
    now?: number,
  ): TeamShutdownRequest[];
  getPendingShutdown(memberId: string): TeamShutdownRequest | undefined;
  listShutdowns(): TeamShutdownRequest[];
  snapshot(): TeamRuntimeSnapshot;
  deriveSummary(viewerMemberId?: string): TeamSummary;
  deriveTodoState(): TodoState;
}

function cloneMessage(message: TeamMessage): TeamMessage {
  return {
    ...message,
    readBy: new Set(message.readBy),
  };
}

function clonePlan(plan: Plan): Plan {
  return {
    goal: plan.goal,
    steps: plan.steps.map((step) => ({ ...step })),
  };
}

function toMessageSnapshot(message: TeamMessage): TeamMessageSnapshot {
  return {
    ...message,
    readBy: [...message.readBy].sort(),
  };
}

export function cloneTeamRuntimeSnapshot(
  snapshot: TeamRuntimeSnapshot,
): TeamRuntimeSnapshot {
  const defaultPolicy = createDefaultTeamPolicy();
  return {
    teamId: snapshot.teamId,
    leadMemberId: snapshot.leadMemberId,
    policy: { ...defaultPolicy, ...(snapshot.policy ?? {}) },
    members: snapshot.members.map((member) => ({ ...member })),
    tasks: snapshot.tasks.map((task) => ({
      ...task,
      dependencies: [...task.dependencies],
      ...(task.artifacts ? { artifacts: { ...task.artifacts } } : {}),
    })),
    messages: snapshot.messages.map((message) => ({
      ...message,
      readBy: [...message.readBy],
    })),
    approvals: snapshot.approvals.map((approval) => ({
      ...approval,
      plan: clonePlan(approval.plan),
    })),
    shutdowns: snapshot.shutdowns.map((shutdown) => ({ ...shutdown })),
  };
}

function toTodoStatus(status: TeamTaskStatus): "pending" | "in_progress" | "completed" {
  switch (status) {
    case "claimed":
    case "in_progress":
      return "in_progress";
    case "completed":
      return "completed";
    case "cancelled":
    case "errored":
      return "completed";
    case "blocked":
    case "pending":
    default:
      return "pending";
  }
}

function decorateTaskContent(task: TeamTask): string {
  switch (task.status) {
    case "blocked":
      return `[blocked] ${task.goal}`;
    case "cancelled":
      return `[cancelled] ${task.goal}`;
    case "errored":
      return `[errored] ${task.goal}`;
    default:
      return task.goal;
  }
}

export function createTeamRuntime(
  leadAgent = "lead",
  leadMemberId = "lead",
  options?: {
    snapshot?: TeamRuntimeSnapshot;
    onChange?: (snapshot: TeamRuntimeSnapshot, summary: TeamSummary) => void;
    shutdownEscalationMs?: number;
  },
): TeamRuntime {
  const teamId = options?.snapshot?.teamId ?? crypto.randomUUID();
  const shutdownEscalationMs = options?.shutdownEscalationMs ?? 30_000;
  const defaultPolicy = createDefaultTeamPolicy();
  let policy: TeamPolicy = options?.snapshot?.policy
    ? { ...defaultPolicy, ...options.snapshot.policy }
    : defaultPolicy;
  const members = new Map<string, TeamMember>();
  const memberByThread = new Map<string, string>();
  const tasks = new Map<string, TeamTask>();
  const taskByThread = new Map<string, string>();
  const messages: TeamMessage[] = [];
  const approvals = new Map<string, TeamPlanApproval>();
  const shutdowns = new Map<string, TeamShutdownRequest>();

  const requireMember = (memberId: string, toolName: string): TeamMember => {
    const member = members.get(memberId);
    if (!member) {
      throw new ValidationError(`member '${memberId}' not found`, toolName);
    }
    return member;
  };

  const validateAssignee = (
    assigneeMemberId: string | undefined,
    toolName: string,
  ): void => {
    if (assigneeMemberId !== undefined) {
      requireMember(assigneeMemberId, toolName);
    }
  };

  const validateRelatedTask = (
    taskId: string | undefined,
    toolName: string,
  ): void => {
    if (taskId !== undefined && !tasks.has(taskId)) {
      throw new ValidationError(`task '${taskId}' not found`, toolName);
    }
  };

  const getBlockingDependencies = (task: TeamTask): TeamTaskBlocker[] =>
    task.dependencies.flatMap((dependencyId) => {
      const dependency = tasks.get(dependencyId);
      if (!dependency || dependency.status === "completed") {
        return [];
      }
      return [{
        taskId: dependency.id,
        goal: dependency.goal,
        status: dependency.status,
      }];
    });

  const syncBlockedTasks = (): void => {
    for (const task of tasks.values()) {
      const blockers = getBlockingDependencies(task);
      const hasPendingApproval = !!task.approvalId &&
        approvals.get(task.approvalId)?.status === "pending";
      if (
        (blockers.length > 0 || hasPendingApproval) &&
        task.status !== "completed" &&
        task.status !== "cancelled" &&
        task.status !== "errored"
      ) {
        if (task.status !== "blocked") {
          task.status = "blocked";
          task.updatedAt = Date.now();
        }
        continue;
      }
      if (blockers.length === 0 && !hasPendingApproval && task.status === "blocked") {
        task.status = "pending";
        task.updatedAt = Date.now();
      }
    }
  };

  const buildSummary = (viewerMemberId = leadMemberId): TeamSummary => {
    const taskCounts: Record<TeamTaskStatus, number> = {
      pending: 0,
      claimed: 0,
      in_progress: 0,
      blocked: 0,
      completed: 0,
      cancelled: 0,
      errored: 0,
    };
    for (const task of tasks.values()) {
      taskCounts[task.status] += 1;
    }
    return {
      teamId,
      leadMemberId,
      policy: { ...policy },
      memberCount: members.size,
      activeMembers: [...members.values()].filter((member) =>
        member.status === "active" || member.status === "shutdown_requested" ||
        member.status === "shutting_down"
      ).length,
      pendingApprovals: [...approvals.values()].filter((approval) =>
        approval.status === "pending"
      ).length,
      unreadMessages: messages.filter((message) =>
        (!message.toMemberId || message.toMemberId === viewerMemberId) &&
        !message.readBy.has(viewerMemberId)
      ).length,
      taskCounts,
      blockedTasks: [...tasks.values()]
        .filter((task) => task.status === "blocked")
        .map((task) => ({
          id: task.id,
          goal: task.goal,
          dependencies: getBlockingDependencies(task).map((dep) => dep.taskId),
        })),
      members: [...members.values()].map((member) => ({
        id: member.id,
        agent: member.agent,
        role: member.role,
        status: member.status,
        currentTaskId: member.currentTaskId,
      })),
    };
  };

  const buildSnapshot = (): TeamRuntimeSnapshot => ({
    teamId,
    leadMemberId,
    policy: { ...policy },
    members: [...members.values()].map((member) => ({ ...member })),
    tasks: [...tasks.values()].map((task) => ({
      ...task,
      dependencies: [...task.dependencies],
      ...(task.artifacts ? { artifacts: { ...task.artifacts } } : {}),
    })),
    messages: messages.map(toMessageSnapshot),
    approvals: [...approvals.values()].map((approval) => ({
      ...approval,
      plan: clonePlan(approval.plan),
    })),
    shutdowns: [...shutdowns.values()].map((shutdown) => ({ ...shutdown })),
  });

  const notifyChange = (): void => {
    options?.onChange?.(buildSnapshot(), buildSummary(leadMemberId));
  };

  const syncMemberCurrentTask = (
    memberId: string,
    currentTaskId: string | undefined,
  ): void => {
    const current = members.get(memberId);
    if (!current || current.currentTaskId === currentTaskId) {
      return;
    }
    members.set(memberId, {
      ...current,
      currentTaskId,
      updatedAt: Date.now(),
    });
  };

  const syncTaskAssignment = (
    current: TeamTask,
    next: TeamTask,
  ): void => {
    const isTerminal = next.status === "completed" || next.status === "cancelled" ||
      next.status === "errored";
    if (
      current.assigneeMemberId &&
      current.assigneeMemberId !== next.assigneeMemberId
    ) {
      const previousMember = members.get(current.assigneeMemberId);
      if (previousMember?.currentTaskId === current.id) {
        syncMemberCurrentTask(current.assigneeMemberId, undefined);
      }
    }
    if (isTerminal && next.assigneeMemberId) {
      const currentMember = members.get(next.assigneeMemberId);
      if (currentMember?.currentTaskId === next.id) {
        syncMemberCurrentTask(next.assigneeMemberId, undefined);
      }
      return;
    }
    if (next.assigneeMemberId) {
      syncMemberCurrentTask(next.assigneeMemberId, next.id);
    }
  };

  const touchMember = (
    current: TeamMember,
    patch: Partial<Omit<TeamMember, "id" | "createdAt">>,
  ): TeamMember => {
    const next: TeamMember = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    members.set(next.id, next);
    if (current.threadId && current.threadId !== next.threadId) {
      memberByThread.delete(current.threadId);
    }
    if (next.threadId) {
      memberByThread.set(next.threadId, next.id);
    }
    notifyChange();
    return next;
  };

  const touchTask = (
    current: TeamTask,
    patch: Partial<Omit<TeamTask, "id" | "goal" | "createdAt">>,
  ): TeamTask => {
    const next: TeamTask = {
      ...current,
      ...patch,
      ...(patch.dependencies ? { dependencies: [...patch.dependencies] } : {}),
      ...(patch.artifacts ? { artifacts: { ...patch.artifacts } } : {}),
      updatedAt: Date.now(),
    };
    tasks.set(next.id, next);
    if (current.delegateThreadId && current.delegateThreadId !== next.delegateThreadId) {
      taskByThread.delete(current.delegateThreadId);
    }
    if (next.delegateThreadId) {
      taskByThread.set(next.delegateThreadId, next.id);
    }
    syncTaskAssignment(current, next);
    syncBlockedTasks();
    notifyChange();
    return next;
  };

  const runtime: TeamRuntime = {
    teamId,
    leadMemberId,
    getPolicy() {
      return { ...policy };
    },
    registerMember(input) {
      const id = input.id ?? crypto.randomUUID();
      const existing = members.get(id);
      if (existing) {
        return touchMember(existing, input);
      }
      const created: TeamMember = {
        id,
        agent: input.agent,
        role: input.role ?? "worker",
        status: "active",
        threadId: input.threadId,
        childSessionId: input.childSessionId,
        currentTaskId: input.currentTaskId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      members.set(id, created);
      if (created.threadId) {
        memberByThread.set(created.threadId, created.id);
      }
      notifyChange();
      return created;
    },
    updateMember(memberId, patch) {
      const current = members.get(memberId);
      if (!current) return undefined;
      return touchMember(current, patch);
    },
    getMember(memberId) {
      return members.get(memberId);
    },
    getMemberByThread(threadId) {
      const memberId = memberByThread.get(threadId);
      return memberId ? members.get(memberId) : undefined;
    },
    listMembers() {
      return [...members.values()];
    },
    ensureTask(input) {
      validateAssignee(input.assigneeMemberId, "team_task_write");
      const id = input.id ?? crypto.randomUUID();
      const existing = tasks.get(id);
      if (existing) {
        const patch: Partial<Omit<TeamTask, "id" | "goal" | "createdAt">> = {};
        if (input.status !== undefined) {
          patch.status = input.status;
        }
        if (input.assigneeMemberId !== undefined) {
          patch.assigneeMemberId = input.assigneeMemberId;
        }
        if (input.dependencies !== undefined) {
          patch.dependencies = [...input.dependencies];
        }
        if (input.resultSummary !== undefined) {
          patch.resultSummary = input.resultSummary;
        }
        if (input.artifacts !== undefined) {
          patch.artifacts = { ...input.artifacts };
        }
        if (input.delegateThreadId !== undefined) {
          patch.delegateThreadId = input.delegateThreadId;
        }
        if (input.approvalId !== undefined) {
          patch.approvalId = input.approvalId;
        }
        return touchTask(existing, patch);
      }
      const created: TeamTask = {
        id,
        goal: input.goal,
        status: input.status ?? "pending",
        assigneeMemberId: input.assigneeMemberId,
        dependencies: [...(input.dependencies ?? [])],
        resultSummary: input.resultSummary,
        artifacts: input.artifacts ? { ...input.artifacts } : undefined,
        delegateThreadId: input.delegateThreadId,
        approvalId: input.approvalId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      tasks.set(id, created);
      if (created.delegateThreadId) {
        taskByThread.set(created.delegateThreadId, created.id);
      }
      syncTaskAssignment(created, created);
      syncBlockedTasks();
      notifyChange();
      return created;
    },
    claimTask(taskId, memberId) {
      requireMember(memberId, "team_task_claim");
      const task = tasks.get(taskId);
      if (!task) return undefined;
      if (getBlockingDependencies(task).length > 0) {
        if (task.status !== "blocked") {
          return touchTask(task, { status: "blocked" });
        }
        return task;
      }
      return touchTask(task, {
        assigneeMemberId: memberId,
        status: "claimed",
      });
    },
    updateTask(taskId, patch) {
      const task = tasks.get(taskId);
      if (!task) return undefined;
      validateAssignee(patch.assigneeMemberId, "team_task_write");
      return touchTask(task, patch);
    },
    getTask(taskId) {
      return tasks.get(taskId);
    },
    getTaskByThread(threadId) {
      const taskId = taskByThread.get(threadId);
      return taskId ? tasks.get(taskId) : undefined;
    },
    getBlockingDependencies(taskId) {
      const task = tasks.get(taskId);
      return task ? getBlockingDependencies(task) : [];
    },
    listTasks() {
      return [...tasks.values()];
    },
    sendMessage(input) {
      const createdAt = Date.now();
      requireMember(input.fromMemberId, "team_message_send");
      if (input.toMemberId && !members.has(input.toMemberId)) {
        throw new ValidationError(
          `member '${input.toMemberId}' not found`,
          "team_message_send",
        );
      }
      validateRelatedTask(input.relatedTaskId, "team_message_send");
      const recipients = input.toMemberId
        ? [input.toMemberId]
        : [...members.values()]
          .filter((member) => member.id !== input.fromMemberId)
          .map((member) => member.id);
      const created = recipients.map((recipientId) => {
        const message: TeamMessage = {
          id: crypto.randomUUID(),
          fromMemberId: input.fromMemberId,
          toMemberId: recipientId,
          kind: input.kind ?? (input.toMemberId ? "direct" : "broadcast"),
          content: input.content,
          relatedTaskId: input.relatedTaskId,
          createdAt,
          readBy: new Set<string>([input.fromMemberId]),
        };
        messages.push(message);
        return cloneMessage(message);
      });
      if (created.length > 0) {
        notifyChange();
      }
      return created;
    },
    readMessages(memberId, options) {
      const markRead = options?.markRead !== false;
      const unread = messages.filter((message) => {
        const visible = !message.toMemberId || message.toMemberId === memberId;
        return visible && !message.readBy.has(memberId);
      });
      if (markRead) {
        for (const message of unread) {
          message.readBy.add(memberId);
        }
        if (unread.length > 0) {
          notifyChange();
        }
      }
      return unread.map(cloneMessage);
    },
    requestPlanApproval(input) {
      requireMember(input.submittedByMemberId, "submit_team_plan");
      const task = tasks.get(input.taskId);
      if (!task) {
        throw new ValidationError(
          `task '${input.taskId}' not found`,
          "submit_team_plan",
        );
      }
      const existingPending = [...approvals.values()].find((approval) =>
        approval.taskId === input.taskId && approval.status === "pending"
      );
      if (existingPending) {
        const next: TeamPlanApproval = {
          ...existingPending,
          submittedByMemberId: input.submittedByMemberId,
          plan: clonePlan(input.plan),
          note: input.note,
          updatedAt: Date.now(),
        };
        approvals.set(next.id, next);
        touchTask(task, { approvalId: next.id });
        return { ...next, plan: clonePlan(next.plan) };
      }
      const approval: TeamPlanApproval = {
        id: crypto.randomUUID(),
        taskId: input.taskId,
        submittedByMemberId: input.submittedByMemberId,
        status: "pending",
        plan: clonePlan(input.plan),
        note: input.note,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      approvals.set(approval.id, approval);
      touchTask(task, { approvalId: approval.id });
      return { ...approval, plan: clonePlan(approval.plan) };
    },
    reviewPlan(input) {
      requireMember(input.reviewedByMemberId, "review_team_plan");
      if (input.reviewedByMemberId !== leadMemberId) {
        throw new ValidationError(
          "only the lead can review team plans",
          "review_team_plan",
        );
      }
      const approval = approvals.get(input.approvalId);
      if (!approval) return undefined;
      const next: TeamPlanApproval = {
        ...approval,
        status: input.approved ? "approved" : "rejected",
        feedback: input.feedback,
        reviewedByMemberId: input.reviewedByMemberId,
        updatedAt: Date.now(),
      };
      approvals.set(next.id, next);
      syncBlockedTasks();
      notifyChange();
      return { ...next, plan: clonePlan(next.plan) };
    },
    getApproval(approvalId) {
      return approvals.get(approvalId);
    },
    listApprovals() {
      return [...approvals.values()];
    },
    listPendingApprovals() {
      return [...approvals.values()].filter((approval) => approval.status === "pending");
    },
    requestShutdown(input) {
      if (input.requestedByMemberId !== leadMemberId) {
        throw new ValidationError(
          "only the lead can request teammate shutdown",
          "request_team_shutdown",
        );
      }
      const member = requireMember(input.memberId, "request_team_shutdown");
      requireMember(input.requestedByMemberId, "request_team_shutdown");
      const existing = [...shutdowns.values()].find((request) =>
        request.memberId === input.memberId && request.status === "requested"
      );
      if (existing) {
        const next: TeamShutdownRequest = {
          ...existing,
          requestedByMemberId: input.requestedByMemberId,
          reason: input.reason,
          escalateAt: Date.now() + shutdownEscalationMs,
          updatedAt: Date.now(),
        };
        shutdowns.set(next.id, next);
        if (member.status !== "shutdown_requested") {
          touchMember(member, { status: "shutdown_requested" });
        } else {
          notifyChange();
        }
        return { ...next };
      }
      const request: TeamShutdownRequest = {
        id: crypto.randomUUID(),
        memberId: input.memberId,
        requestedByMemberId: input.requestedByMemberId,
        reason: input.reason,
        status: "requested",
        escalateAt: Date.now() + shutdownEscalationMs,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      shutdowns.set(request.id, request);
      touchMember(member, { status: "shutdown_requested" });
      return { ...request };
    },
    acknowledgeShutdown(requestId, memberId) {
      const request = shutdowns.get(requestId);
      const member = members.get(memberId);
      if (!request || !member || request.memberId !== memberId) return undefined;
      const next: TeamShutdownRequest = {
        ...request,
        status: "acknowledged",
        escalateAt: undefined,
        updatedAt: Date.now(),
      };
      shutdowns.set(requestId, next);
      notifyChange();
      touchMember(member, { status: "shutting_down" });
      return { ...next };
    },
    forceShutdown(requestId, requestedByMemberId) {
      requireMember(requestedByMemberId, "request_team_shutdown");
      const request = shutdowns.get(requestId);
      if (!request) return undefined;
      const member = members.get(request.memberId);
      const next: TeamShutdownRequest = {
        ...request,
        requestedByMemberId,
        status: "forced",
        escalateAt: undefined,
        updatedAt: Date.now(),
      };
      shutdowns.set(requestId, next);
      if (member) {
        if (member.currentTaskId) {
          const task = tasks.get(member.currentTaskId);
          if (
            task && task.status !== "completed" && task.status !== "cancelled" &&
            task.status !== "errored"
          ) {
            touchTask(task, { status: "cancelled" });
          }
        }
        touchMember(member, {
          status: "terminated",
          currentTaskId: undefined,
        });
      } else {
        notifyChange();
      }
      return { ...next };
    },
    forceExpiredShutdowns(requestedByMemberId, now = Date.now()) {
      const forced: TeamShutdownRequest[] = [];
      for (const request of shutdowns.values()) {
        if (
          request.status === "requested" &&
          typeof request.escalateAt === "number" &&
          request.escalateAt <= now
        ) {
          const next = runtime.forceShutdown(
            request.id,
            requestedByMemberId ?? leadMemberId,
          );
          if (next) forced.push(next);
        }
      }
      return forced;
    },
    getPendingShutdown(memberId) {
      return [...shutdowns.values()].find((request) =>
        request.memberId === memberId && request.status === "requested"
      );
    },
    listShutdowns() {
      return [...shutdowns.values()];
    },
    snapshot() {
      return buildSnapshot();
    },
    deriveSummary(viewerMemberId) {
      return buildSummary(viewerMemberId);
    },
    deriveTodoState() {
      const sortedTasks = [...tasks.values()].sort((a, b) => a.createdAt - b.createdAt);
      return createTodoState(sortedTasks.map((task) => ({
        id: task.id,
        content: decorateTaskContent(task),
        status: toTodoStatus(task.status),
      })));
    },
  };

  const snapshot = options?.snapshot ? cloneTeamRuntimeSnapshot(options.snapshot) : undefined;
  if (snapshot) {
    for (const member of snapshot.members) {
      members.set(member.id, { ...member });
      if (member.threadId) {
        memberByThread.set(member.threadId, member.id);
      }
    }
    for (const task of snapshot.tasks) {
      tasks.set(task.id, {
        ...task,
        dependencies: [...task.dependencies],
        ...(task.artifacts ? { artifacts: { ...task.artifacts } } : {}),
      });
      if (task.delegateThreadId) {
        taskByThread.set(task.delegateThreadId, task.id);
      }
    }
    for (const message of snapshot.messages) {
      messages.push({
        ...message,
        readBy: new Set(message.readBy),
      });
    }
    for (const approval of snapshot.approvals) {
      approvals.set(approval.id, {
        ...approval,
        plan: clonePlan(approval.plan),
      });
    }
    for (const shutdown of snapshot.shutdowns) {
      shutdowns.set(shutdown.id, { ...shutdown });
    }
    syncBlockedTasks();
  } else {
    runtime.registerMember({
      id: leadMemberId,
      agent: leadAgent,
      role: "lead",
    });
  }

  return runtime;
}
