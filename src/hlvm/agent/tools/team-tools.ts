import { ValidationError } from "../../../common/error.ts";
import type { Plan } from "../planning.ts";
import type { ToolExecutionOptions, ToolMetadata } from "../registry.ts";
import { isToolArgsObject } from "../validation.ts";
import type {
  TeamPlanApproval,
  TeamShutdownRequest,
  TeamTaskStatus,
} from "../team-runtime.ts";

function requireTeamContext(
  toolName: string,
  options?: ToolExecutionOptions,
): { teamMemberId: string; leadMemberId: string } {
  if (!options?.teamRuntime || !options.teamMemberId || !options.teamLeadMemberId) {
    throw new ValidationError("team runtime is not configured", toolName);
  }
  return {
    teamMemberId: options.teamMemberId,
    leadMemberId: options.teamLeadMemberId,
  };
}

function parseDependencies(value: unknown, toolName: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ValidationError("dependencies must be an array of strings", toolName);
  }
  return [...value];
}

function parseTaskStatus(value: unknown, toolName: string): TeamTaskStatus | undefined {
  if (value === undefined) return undefined;
  if (
    value === "pending" || value === "claimed" || value === "in_progress" ||
    value === "blocked" || value === "completed" || value === "cancelled" ||
    value === "errored"
  ) {
    return value;
  }
  throw new ValidationError("invalid task status", toolName);
}

const teamTaskRead: ToolMetadata = {
  fn: async (args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    requireTeamContext("team_task_read", options);
    if (!options?.teamRuntime) {
      throw new ValidationError("team runtime is not configured", "team_task_read");
    }
    if (!isToolArgsObject(args) && args !== undefined) {
      throw new ValidationError("args must be an object", "team_task_read");
    }
    const record = (args as Record<string, unknown> | undefined) ?? {};
    const status = parseTaskStatus(record.status, "team_task_read");
    const assigneeMemberId = typeof record.assignee_member_id === "string"
      ? record.assignee_member_id
      : undefined;
    const tasks = options.teamRuntime.listTasks().filter((task) =>
      (!status || task.status === status) &&
      (!assigneeMemberId || task.assigneeMemberId === assigneeMemberId)
    );
    return { tasks };
  },
  description: "Read the shared team task board.",
  category: "meta",
  args: {
    status: "string (optional) - Filter by task status",
    assignee_member_id: "string (optional) - Filter by assignee member ID",
  },
  returns: {
    tasks: "array - Team task items",
  },
  safetyLevel: "L0",
  safety: "Read-only observation of team task state.",
};

const teamStatusRead: ToolMetadata = {
  fn: async (_args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    const { teamMemberId } = requireTeamContext("team_status_read", options);
    if (!options?.teamRuntime) {
      throw new ValidationError("team runtime is not configured", "team_status_read");
    }
    const currentMember = options.teamRuntime.getMember(teamMemberId);
    const summary = options.teamRuntime.deriveSummary(teamMemberId);
    const pendingApprovals = options.teamRuntime.listPendingApprovals().map(
      (approval: TeamPlanApproval) => ({
        id: approval.id,
        taskId: approval.taskId,
        submittedByMemberId: approval.submittedByMemberId,
        note: approval.note,
        createdAt: approval.createdAt,
      }),
    );
    const pendingShutdowns = options.teamRuntime.listShutdowns().filter(
      (shutdown: TeamShutdownRequest) =>
        shutdown.status === "requested" || shutdown.status === "acknowledged",
    ).map((shutdown) => ({
      id: shutdown.id,
      memberId: shutdown.memberId,
      requestedByMemberId: shutdown.requestedByMemberId,
      status: shutdown.status,
      reason: shutdown.reason,
      escalateAt: shutdown.escalateAt,
    }));
    const unreadMessages = options.teamRuntime.readMessages(teamMemberId, {
      markRead: false,
    });
    return {
      summary,
      current_member: currentMember,
      pending_approvals: pendingApprovals,
      pending_shutdowns: pendingShutdowns,
      unread_messages: unreadMessages,
    };
  },
  description:
    "Read the current team summary, your member state, pending approvals, pending shutdowns, and unread messages.",
  category: "meta",
  args: {},
  returns: {
    summary: "object - Team summary including policy, members, task counts, blocked tasks, and unread counts",
    current_member: "object (optional) - Current team member record",
    pending_approvals: "array - Pending approval records",
    pending_shutdowns: "array - Active shutdown requests",
    unread_messages: "array - Unread team messages for the current member",
  },
  safetyLevel: "L0",
  safety: "Read-only observation of aggregate team state.",
};

const teamTaskWrite: ToolMetadata = {
  fn: async (args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    const { teamMemberId } = requireTeamContext("team_task_write", options);
    if (!options?.teamRuntime || !isToolArgsObject(args)) {
      throw new ValidationError("args must be an object", "team_task_write");
    }
    const taskId = typeof args.id === "string" ? args.id : undefined;
    const goal = typeof args.goal === "string" ? args.goal : "";
    const existingTask = taskId ? options.teamRuntime.getTask(taskId) : undefined;
    if (!existingTask && !goal) {
      throw new ValidationError("goal must be a non-empty string", "team_task_write");
    }
    if (existingTask && goal && goal !== existingTask.goal) {
      throw new ValidationError(
        "team_task_write cannot change the goal of an existing task",
        "team_task_write",
      );
    }
    const hasDependencies = "dependencies" in args;
    const hasResultSummary = "result_summary" in args;
    const hasArtifacts = "artifacts" in args;
    const task = options.teamRuntime.ensureTask({
      id: taskId,
      goal: goal || existingTask?.goal || "",
      status: parseTaskStatus(args.status, "team_task_write") ??
        existingTask?.status ??
        "pending",
      assigneeMemberId: typeof args.assignee_member_id === "string"
        ? args.assignee_member_id
        : existingTask?.assigneeMemberId ?? teamMemberId,
      dependencies: hasDependencies
        ? parseDependencies(args.dependencies, "team_task_write")
        : existingTask?.dependencies,
      resultSummary: hasResultSummary
        ? (typeof args.result_summary === "string" ? args.result_summary : undefined)
        : existingTask?.resultSummary,
      artifacts: hasArtifacts && args.artifacts && typeof args.artifacts === "object"
        ? args.artifacts as Record<string, unknown>
        : hasArtifacts
        ? undefined
        : existingTask?.artifacts,
    });
    return { task };
  },
  description: "Create or update a shared team task.",
  category: "meta",
  args: {
    id: "string (optional) - Existing task ID to update",
    goal: "string (required for create, immutable for update) - Task goal",
    status: "string (optional) - pending|claimed|in_progress|blocked|completed|cancelled|errored",
    assignee_member_id: "string (optional) - Assignee member ID",
    dependencies: "array (optional) - Dependency task IDs",
    result_summary: "string (optional) - Latest result summary",
    artifacts: "object (optional) - Structured task artifacts",
  },
  returns: {
    task: "object - The created or updated task",
  },
  safetyLevel: "L0",
  safety: "Mutates team task board state.",
};

const teamTaskClaim: ToolMetadata = {
  fn: async (args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    const { teamMemberId } = requireTeamContext("team_task_claim", options);
    if (!options?.teamRuntime || !isToolArgsObject(args)) {
      throw new ValidationError("args must be an object", "team_task_claim");
    }
    const taskId = typeof args.task_id === "string" ? args.task_id : "";
    if (!taskId) {
      throw new ValidationError("task_id is required", "team_task_claim");
    }
    const existing = options.teamRuntime.getTask(taskId);
    if (!existing) {
      throw new ValidationError(`task '${taskId}' not found`, "team_task_claim");
    }
    const blockers = options.teamRuntime.getBlockingDependencies(taskId);
    if (blockers.length > 0) {
      throw new ValidationError(
        `task '${taskId}' is blocked by dependencies: ${
          blockers.map((blocker) => blocker.taskId).join(", ")
        }`,
        "team_task_claim",
      );
    }
    const task = options.teamRuntime.claimTask(taskId, teamMemberId);
    if (!task) {
      throw new ValidationError(`task '${taskId}' could not be claimed`, "team_task_claim");
    }
    return { task };
  },
  description: "Claim a team task for the current member.",
  category: "meta",
  args: {
    task_id: "string - Task ID to claim",
  },
  returns: {
    task: "object - The updated task",
  },
  safetyLevel: "L0",
  safety: "Mutates team task ownership.",
};

const teamMessageSend: ToolMetadata = {
  fn: async (args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    const { teamMemberId, leadMemberId } = requireTeamContext("team_message_send", options);
    if (!options?.teamRuntime || !isToolArgsObject(args)) {
      throw new ValidationError("args must be an object", "team_message_send");
    }
    const content = typeof args.content === "string" ? args.content : "";
    if (!content) {
      throw new ValidationError("content must be a non-empty string", "team_message_send");
    }
    const broadcast = args.broadcast === true;
    if (broadcast && teamMemberId !== leadMemberId) {
      throw new ValidationError("only the lead can broadcast", "team_message_send");
    }
    const toMemberId = typeof args.to_member_id === "string"
      ? args.to_member_id
      : undefined;
    if (!broadcast && !toMemberId) {
      throw new ValidationError(
        "to_member_id is required unless broadcast is true",
        "team_message_send",
      );
    }
    const messages = options.teamRuntime.sendMessage({
      fromMemberId: teamMemberId,
      toMemberId: broadcast ? undefined : toMemberId,
      kind: broadcast ? "broadcast" : "direct",
      content,
      relatedTaskId: typeof args.related_task_id === "string"
        ? args.related_task_id
        : undefined,
    });
    return {
      messages,
      sent: messages.length,
    };
  },
  description: "Send a team message to one teammate or broadcast from the lead.",
  category: "meta",
  args: {
    to_member_id: "string (optional) - Recipient member ID",
    broadcast: "boolean (optional) - Broadcast to all teammates (lead only)",
    content: "string - Message content",
    related_task_id: "string (optional) - Related task ID",
  },
  returns: {
    messages: "array - Sent team messages",
    sent: "number - Number of recipients",
  },
  safetyLevel: "L0",
  safety: "Queues internal team messages.",
};

const teamMessageRead: ToolMetadata = {
  fn: async (args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    const { teamMemberId } = requireTeamContext("team_message_read", options);
    if (!options?.teamRuntime || (!isToolArgsObject(args) && args !== undefined)) {
      throw new ValidationError("args must be an object", "team_message_read");
    }
    const record = (args as Record<string, unknown> | undefined) ?? {};
    const messages = options.teamRuntime.readMessages(teamMemberId, {
      markRead: record.mark_read !== false,
    });
    return { messages };
  },
  description: "Read unread team messages for the current member.",
  category: "meta",
  args: {
    mark_read: "boolean (optional) - Mark returned messages as read (default: true)",
  },
  returns: {
    messages: "array - Unread team messages",
  },
  safetyLevel: "L0",
  safety: "Read-only observation of queued team messages.",
};

const submitTeamPlan: ToolMetadata = {
  fn: async (args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    const { teamMemberId } = requireTeamContext("submit_team_plan", options);
    if (!options?.teamRuntime || !isToolArgsObject(args)) {
      throw new ValidationError("args must be an object", "submit_team_plan");
    }
    const taskId = typeof args.task_id === "string" ? args.task_id : "";
    if (!taskId) {
      throw new ValidationError("task_id is required", "submit_team_plan");
    }
    if (!args.plan || typeof args.plan !== "object") {
      throw new ValidationError("plan must be an object", "submit_team_plan");
    }
    const approval = options.teamRuntime.requestPlanApproval({
      taskId,
      submittedByMemberId: teamMemberId,
      plan: args.plan as Plan,
      note: typeof args.note === "string" ? args.note : undefined,
    });
    return { approval };
  },
  description: "Submit a task plan for lead review.",
  category: "meta",
  args: {
    task_id: "string - Task ID the plan belongs to",
    plan: "object - Plan payload",
    note: "string (optional) - Short note to the lead",
  },
  returns: {
    approval: "object - Pending approval record",
  },
  safetyLevel: "L0",
  safety: "Queues a lead-reviewed team plan approval.",
};

const reviewTeamPlan: ToolMetadata = {
  fn: async (args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    const { teamMemberId, leadMemberId } = requireTeamContext("review_team_plan", options);
    if (teamMemberId !== leadMemberId) {
      throw new ValidationError("only the lead can review team plans", "review_team_plan");
    }
    if (!options?.teamRuntime || !isToolArgsObject(args)) {
      throw new ValidationError("args must be an object", "review_team_plan");
    }
    const approvalId = typeof args.approval_id === "string" ? args.approval_id : "";
    const approved = args.approved === true;
    const rejected = args.approved === false;
    if (!approvalId || (!approved && !rejected)) {
      throw new ValidationError(
        "approval_id and approved(boolean) are required",
        "review_team_plan",
      );
    }
    const approval = options.teamRuntime.reviewPlan({
      approvalId,
      reviewedByMemberId: teamMemberId,
      approved,
      feedback: typeof args.feedback === "string" ? args.feedback : undefined,
    });
    if (!approval) {
      throw new ValidationError("approval not found", "review_team_plan");
    }
    return { approval };
  },
  description: "Approve or reject a teammate plan as the lead.",
  category: "meta",
  args: {
    approval_id: "string - Approval request ID",
    approved: "boolean - Whether the plan is approved",
    feedback: "string (optional) - Review feedback",
  },
  returns: {
    approval: "object - Updated approval record",
  },
  safetyLevel: "L0",
  safety: "Mutates lead-reviewed plan approval state.",
};

const requestTeamShutdown: ToolMetadata = {
  fn: async (args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    const { teamMemberId, leadMemberId } = requireTeamContext("request_team_shutdown", options);
    if (teamMemberId !== leadMemberId) {
      throw new ValidationError(
        "only the lead can request teammate shutdown",
        "request_team_shutdown",
      );
    }
    if (!options?.teamRuntime || !isToolArgsObject(args)) {
      throw new ValidationError("args must be an object", "request_team_shutdown");
    }
    const memberId = typeof args.member_id === "string" ? args.member_id : "";
    if (!memberId) {
      throw new ValidationError("member_id is required", "request_team_shutdown");
    }
    const request = options.teamRuntime.requestShutdown({
      memberId,
      requestedByMemberId: teamMemberId,
      reason: typeof args.reason === "string" ? args.reason : undefined,
    });
    if (!request) {
      throw new ValidationError("member not found", "request_team_shutdown");
    }
    return { shutdown: request };
  },
  description: "Request graceful shutdown of a teammate.",
  category: "meta",
  args: {
    member_id: "string - Member to shut down",
    reason: "string (optional) - Shutdown reason",
  },
  returns: {
    shutdown: "object - Shutdown request state",
  },
  safetyLevel: "L1",
  safety: "Requests graceful team-member shutdown.",
};

const ackTeamShutdown: ToolMetadata = {
  fn: async (args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    const { teamMemberId } = requireTeamContext("ack_team_shutdown", options);
    if (!options?.teamRuntime || !isToolArgsObject(args)) {
      throw new ValidationError("args must be an object", "ack_team_shutdown");
    }
    const requestId = typeof args.request_id === "string" ? args.request_id : "";
    if (!requestId) {
      throw new ValidationError("request_id is required", "ack_team_shutdown");
    }
    const request = options.teamRuntime.acknowledgeShutdown(requestId, teamMemberId);
    if (!request) {
      throw new ValidationError("shutdown request not found", "ack_team_shutdown");
    }
    return { shutdown: request };
  },
  description: "Acknowledge a graceful shutdown request for the current member.",
  category: "meta",
  args: {
    request_id: "string - Shutdown request ID",
  },
  returns: {
    shutdown: "object - Updated shutdown request state",
  },
  safetyLevel: "L1",
  safety: "Acknowledges current member shutdown intent.",
};

export const TEAM_TOOLS: Record<string, ToolMetadata> = {
  team_task_read: teamTaskRead,
  team_status_read: teamStatusRead,
  team_task_write: teamTaskWrite,
  team_task_claim: teamTaskClaim,
  team_message_send: teamMessageSend,
  team_message_read: teamMessageRead,
  submit_team_plan: submitTeamPlan,
  review_team_plan: reviewTeamPlan,
  request_team_shutdown: requestTeamShutdown,
  ack_team_shutdown: ackTeamShutdown,
};
