import type { Plan } from "./planning.ts";
import { createTodoState, type TodoState } from "./todo-state.ts";

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
  createdAt: number;
  updatedAt: number;
}

export interface TeamRuntime {
  readonly teamId: string;
  readonly leadMemberId: string;
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
  getPendingShutdown(memberId: string): TeamShutdownRequest | undefined;
  deriveTodoState(): TodoState;
}

function cloneMessage(message: TeamMessage): TeamMessage {
  return {
    ...message,
    readBy: new Set(message.readBy),
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
): TeamRuntime {
  const teamId = crypto.randomUUID();
  const members = new Map<string, TeamMember>();
  const memberByThread = new Map<string, string>();
  const tasks = new Map<string, TeamTask>();
  const taskByThread = new Map<string, string>();
  const messages: TeamMessage[] = [];
  const approvals = new Map<string, TeamPlanApproval>();
  const shutdowns = new Map<string, TeamShutdownRequest>();

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
    if (next.threadId) {
      memberByThread.set(next.threadId, next.id);
    }
    return next;
  };

  const touchTask = (
    current: TeamTask,
    patch: Partial<Omit<TeamTask, "id" | "goal" | "createdAt">>,
  ): TeamTask => {
    const next: TeamTask = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    tasks.set(next.id, next);
    if (next.delegateThreadId) {
      taskByThread.set(next.delegateThreadId, next.id);
    }
    return next;
  };

  const runtime: TeamRuntime = {
    teamId,
    leadMemberId,
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
      const id = input.id ?? crypto.randomUUID();
      const existing = tasks.get(id);
      if (existing) {
        return touchTask(existing, input);
      }
      const created: TeamTask = {
        id,
        goal: input.goal,
        status: input.status ?? "pending",
        assigneeMemberId: input.assigneeMemberId,
        dependencies: [...(input.dependencies ?? [])],
        resultSummary: input.resultSummary,
        artifacts: input.artifacts,
        delegateThreadId: input.delegateThreadId,
        approvalId: input.approvalId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      tasks.set(id, created);
      if (created.delegateThreadId) {
        taskByThread.set(created.delegateThreadId, created.id);
      }
      return created;
    },
    claimTask(taskId, memberId) {
      const task = tasks.get(taskId);
      if (!task) return undefined;
      return touchTask(task, {
        assigneeMemberId: memberId,
        status: "claimed",
      });
    },
    updateTask(taskId, patch) {
      const task = tasks.get(taskId);
      if (!task) return undefined;
      return touchTask(task, patch);
    },
    getTask(taskId) {
      return tasks.get(taskId);
    },
    getTaskByThread(threadId) {
      const taskId = taskByThread.get(threadId);
      return taskId ? tasks.get(taskId) : undefined;
    },
    listTasks() {
      return [...tasks.values()];
    },
    sendMessage(input) {
      const createdAt = Date.now();
      const recipients = input.toMemberId
        ? [input.toMemberId]
        : [...members.values()]
          .filter((member) => member.id !== input.fromMemberId)
          .map((member) => member.id);

      return recipients.map((recipientId) => {
        const message: TeamMessage = {
          id: crypto.randomUUID(),
          fromMemberId: input.fromMemberId,
          toMemberId: input.toMemberId ? recipientId : undefined,
          kind: input.kind ?? (input.toMemberId ? "direct" : "broadcast"),
          content: input.content,
          relatedTaskId: input.relatedTaskId,
          createdAt,
          readBy: new Set<string>([input.fromMemberId]),
        };
        messages.push(message);
        return cloneMessage(message);
      });
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
      }
      return unread.map(cloneMessage);
    },
    requestPlanApproval(input) {
      const approval: TeamPlanApproval = {
        id: crypto.randomUUID(),
        taskId: input.taskId,
        submittedByMemberId: input.submittedByMemberId,
        status: "pending",
        plan: input.plan,
        note: input.note,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      approvals.set(approval.id, approval);
      const task = tasks.get(input.taskId);
      if (task) {
        touchTask(task, { approvalId: approval.id });
      }
      return { ...approval, plan: approval.plan };
    },
    reviewPlan(input) {
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
      return { ...next, plan: next.plan };
    },
    getApproval(approvalId) {
      return approvals.get(approvalId);
    },
    listPendingApprovals() {
      return [...approvals.values()].filter((approval) => approval.status === "pending");
    },
    requestShutdown(input) {
      const member = members.get(input.memberId);
      if (!member) return undefined;
      const request: TeamShutdownRequest = {
        id: crypto.randomUUID(),
        memberId: input.memberId,
        requestedByMemberId: input.requestedByMemberId,
        reason: input.reason,
        status: "requested",
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
        updatedAt: Date.now(),
      };
      shutdowns.set(requestId, next);
      touchMember(member, { status: "shutting_down" });
      return { ...next };
    },
    forceShutdown(requestId, requestedByMemberId) {
      const request = shutdowns.get(requestId);
      if (!request) return undefined;
      const member = members.get(request.memberId);
      const next: TeamShutdownRequest = {
        ...request,
        requestedByMemberId,
        status: "forced",
        updatedAt: Date.now(),
      };
      shutdowns.set(requestId, next);
      if (member) {
        touchMember(member, { status: "terminated" });
      }
      return { ...next };
    },
    getPendingShutdown(memberId) {
      return [...shutdowns.values()].find((request) =>
        request.memberId === memberId && request.status === "requested"
      );
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

  runtime.registerMember({
    id: leadMemberId,
    agent: leadAgent,
    role: "lead",
  });

  return runtime;
}
