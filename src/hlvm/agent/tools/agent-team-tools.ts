/**
 * Agent Team Tools — Unified Team API
 *
 * Provides the Claude Code-compatible tool signatures for agent teams:
 *   - Teammate (spawnTeam, spawnAgent, cleanup)
 *   - SendMessage (message, broadcast, shutdown_request, shutdown_response, plan_approval_response)
 *   - TaskCreate (subject, description, activeForm)
 *   - TaskGet (taskId)
 *   - TaskUpdate (taskId, status, owner, addBlocks, addBlockedBy, ...)
 *   - TaskList ()
 *   - TeamStatus ()
 *
 * Works in two modes via resolveBackend():
 *   - Store mode: when getActiveTeamStore() returns a store (lead/persistent teammates)
 *   - Runtime mode: when options.teamRuntime is set (delegated workers)
 */

import { ValidationError } from "../../../common/error.ts";
import { truncate } from "../../../common/utils.ts";
import type { ToolExecutionOptions, ToolMetadata } from "../registry.ts";
import { isToolArgsObject } from "../validation.ts";
import {
  createTeamStore,
  getActiveTeamStore,
  setActiveTeamStore,
  type InboxMessage,
  type TeamStore,
} from "../team-store.ts";
import type { TeamRuntime } from "../team-runtime.ts";
import type { Plan } from "../planning.ts";
import type { TeammateIdentity } from "../team-executor.ts";
import {
  registerThread,
  type DelegateThreadResult,
} from "../delegate-threads.ts";

// ── Backend Resolution ──────────────────────────────────────────────

interface TeamBackend {
  store: TeamStore | null;
  runtime: TeamRuntime;
}

/**
 * Resolve the team backend from either the global store singleton or
 * the per-tool-call options.teamRuntime injection.
 */
function resolveBackend(toolName: string, options?: ToolExecutionOptions): TeamBackend {
  const store = getActiveTeamStore();
  if (store) return { store, runtime: store.runtime };
  if (options?.teamRuntime) return { store: null, runtime: options.teamRuntime };
  throw new ValidationError(
    "No active team. Use the Teammate tool with operation 'spawnTeam' first.",
    toolName,
  );
}

/** Require a store (for operations that need file persistence like Teammate). */
function requireStore(toolName: string): TeamStore {
  const store = getActiveTeamStore();
  if (!store) {
    throw new ValidationError(
      "No active team. Use the Teammate tool with operation 'spawnTeam' first.",
      toolName,
    );
  }
  return store;
}

// ── Helpers ───────────────────────────────────────────────────────────

function requireString(
  args: Record<string, unknown>,
  key: string,
  toolName: string,
): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`'${key}' must be a non-empty string`, toolName);
  }
  return value.trim();
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function optionalStringArray(
  args: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value as string[];
  }
  return undefined;
}

function getMemberId(options: ToolExecutionOptions | undefined, runtime: TeamRuntime): string {
  return options?.teamMemberId ?? runtime.leadMemberId;
}

// ── Teammate Tool ─────────────────────────────────────────────────────

export const teammate: ToolMetadata = {
  fn: async (args: unknown, _workspace: string, _options?: ToolExecutionOptions) => {
    if (!isToolArgsObject(args)) {
      throw new ValidationError("args must be an object", "Teammate");
    }
    const operation = requireString(args as Record<string, unknown>, "operation", "Teammate");

    if (operation === "spawnTeam") {
      const teamName = requireString(args as Record<string, unknown>, "team_name", "Teammate");
      const description = optionalString(args as Record<string, unknown>, "description") ?? "";

      // Check if team already active
      const existing = getActiveTeamStore();
      if (existing) {
        throw new ValidationError(
          `A team '${existing.teamName}' is already active. Clean it up first.`,
          "Teammate",
        );
      }

      const store = await createTeamStore(teamName);
      setActiveTeamStore(store);

      return {
        status: "created",
        teamName,
        description,
        message: `Team '${teamName}' created. Use TaskCreate to add tasks and Teammate(spawnAgent) to spawn teammates.`,
      };
    }

    if (operation === "spawnAgent") {
      const store = requireStore("Teammate");
      const a = args as Record<string, unknown>;
      const name = requireString(a, "name", "Teammate");
      const agentType = optionalString(a, "agent_type") ?? "general-purpose";
      const model = optionalString(a, "model");
      const planModeRequired = a.plan_mode_required === true;

      // Validate name unique among active members
      const existingMembers = store.runtime.listMembers();
      const existing = existingMembers.find((m) => m.id === name);
      if (existing && existing.status !== "terminated") {
        throw new ValidationError(
          `A teammate named '${name}' already exists and is ${existing.status}.`,
          "Teammate",
        );
      }

      // Check member limit
      const policy = store.runtime.getPolicy();
      const activeWorkers = existingMembers.filter(
        (m) => m.role === "worker" && m.status !== "terminated",
      ).length;
      if (activeWorkers >= policy.maxMembers) {
        throw new ValidationError(
          `Team member limit reached (${policy.maxMembers}). Shut down existing teammates first.`,
          "Teammate",
        );
      }

      // Register member in runtime
      store.runtime.registerMember({
        id: name,
        agent: agentType,
        role: "worker",
      });

      // Create identity
      const identity: TeammateIdentity = {
        name,
        agentType,
        teamName: store.teamName,
        teamMemberId: name,
        leadMemberId: store.runtime.leadMemberId,
        model,
        planModeRequired,
      };

      // Create abort controller for this teammate
      const controller = new AbortController();

      // Get execution options from tool execution context
      const workspace = _workspace;
      const hookRuntime = _options?.hookRuntime;
      const onAgentEvent = _options?.onAgentEvent;
      const onInteraction = _options?.onInteraction;
      const agentProfiles = _options?.agentProfiles;
      const toolOwnerId = _options?.toolOwnerId;
      const agentPolicy = _options?.policy ?? null;
      const modelId = _options?.modelId;
      const instructions = _options?.instructions;
      const idlePollIntervalMs = _options?.idlePollIntervalMs;
      const maxIdlePolls = _options?.maxIdlePolls;
      const permissionMode = _options?.permissionMode;

      // Launch runTeammateLoop as background promise (dynamic import to break circular dependency)
      const promise: Promise<DelegateThreadResult> = (async () => {
        try {
          const { runTeammateLoop } = await import("../team-executor.ts");
          const result = await runTeammateLoop({
            identity,
            runtime: store.runtime,
            store,
            workspace,
            policy: agentPolicy,
            signal: controller.signal,
            hookRuntime,
            onAgentEvent,
            onInteraction,
            modelId,
            agentProfiles,
            instructions,
            toolOwnerId,
            idlePollIntervalMs,
            maxIdlePolls,
            permissionMode,
          });
          return {
            success: true,
            result: `Teammate "${name}" finished: ${result.tasksCompleted} tasks completed, exit: ${result.exitReason}`,
          };
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : String(error);
          return { success: false, error: message };
        }
      })();

      // Register in thread registry
      const threadId = crypto.randomUUID();
      registerThread({
        threadId,
        agent: agentType,
        nickname: name,
        task: `Teammate "${name}" persistent loop`,
        status: "running",
        controller,
        promise,
        mergeState: "none",
        inputQueue: [],
      });

      // Update member with thread ID
      store.runtime.updateMember(name, { threadId });

      // Persist config
      await store.persistConfig();

      return {
        status: "spawned",
        name,
        threadId,
        agentType,
        message: `Teammate "${name}" spawned and running. It will pick up tasks from the shared task list.`,
      };
    }

    if (operation === "cleanup") {
      const store = requireStore("Teammate");
      const teamName = store.teamName;
      await store.cleanup();
      setActiveTeamStore(null);
      return {
        status: "cleaned_up",
        teamName,
        message: `Team '${teamName}' resources removed.`,
      };
    }

    throw new ValidationError(
      `Unknown operation '${operation}'. Use 'spawnTeam', 'spawnAgent', or 'cleanup'.`,
      "Teammate",
    );
  },
  description:
    "Manage agent teams. Use 'spawnTeam' to create a team, 'spawnAgent' to spawn a persistent teammate, or 'cleanup' to remove team resources.",
  category: "meta",
  args: {
    operation:
      "string (required) - 'spawnTeam' to create a team, 'spawnAgent' to spawn a teammate, 'cleanup' to remove team resources",
    team_name:
      "string (optional) - Name for the new team (required for spawnTeam)",
    description:
      "string (optional) - Team description/purpose (spawnTeam only)",
    name:
      "string (optional) - Unique name for the teammate (required for spawnAgent)",
    agent_type:
      "string (optional) - Agent type: 'general' (default, has file/shell/web tools), 'code', 'file', 'shell', 'web', 'memory' (spawnAgent only)",
    model:
      "string (optional) - Model to use for this teammate (spawnAgent only)",
    plan_mode_required:
      "boolean (optional) - Whether this teammate requires plan approval (spawnAgent only)",
  },
  returns: {
    status: "string - 'created', 'spawned', or 'cleaned_up'",
    teamName: "string - The team name (spawnTeam/cleanup)",
    name: "string - The teammate name (spawnAgent)",
    threadId: "string - Background thread ID (spawnAgent)",
  },
  safetyLevel: "L0",
  safety: "Creates/removes team coordination directories.",
};

// ── SendMessage Tool ──────────────────────────────────────────────────

export const sendMessage: ToolMetadata = {
  fn: async (args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    if (!isToolArgsObject(args)) {
      throw new ValidationError("args must be an object", "SendMessage");
    }
    const a = args as Record<string, unknown>;
    const { store, runtime } = resolveBackend("SendMessage", options);
    const type = requireString(a, "type", "SendMessage");
    const validTypes = [
      "message",
      "broadcast",
      "shutdown_request",
      "shutdown_response",
      "plan_approval_response",
      "submit_plan",
    ];
    if (!validTypes.includes(type)) {
      throw new ValidationError(
        `Invalid type '${type}'. Must be one of: ${validTypes.join(", ")}`,
        "SendMessage",
      );
    }

    const from = getMemberId(options, runtime);
    const content = optionalString(a, "content") ?? "";
    const summary = optionalString(a, "summary") ?? "";
    const recipient = optionalString(a, "recipient");

    // Validate recipient for DM types
    if (type === "message" || type === "shutdown_request" || type === "plan_approval_response") {
      if (!recipient) {
        throw new ValidationError(
          `'recipient' is required for type '${type}'`,
          "SendMessage",
        );
      }
    }

    // Handle shutdown_request via runtime
    if (type === "shutdown_request" && recipient) {
      try {
        runtime.requestShutdown({
          memberId: recipient,
          requestedByMemberId: from,
          reason: content,
        });
      } catch { /* member may not be registered */ }
      options?.onAgentEvent?.({
        type: "team_shutdown_requested",
        requestId: crypto.randomUUID(),
        memberId: recipient,
        requestedByMemberId: from,
        reason: content,
      });
    }

    // Handle submit_plan: worker submits a plan for lead review
    if (type === "submit_plan") {
      const taskId = requireString(a, "task_id", "SendMessage");
      const plan = a.plan;
      if (!plan || typeof plan !== "object") {
        throw new ValidationError("'plan' must be a non-empty object for type 'submit_plan'", "SendMessage");
      }
      const note = optionalString(a, "note");
      const approval = runtime.requestPlanApproval({
        taskId,
        submittedByMemberId: from,
        plan: plan as Plan,
        note,
      });
      options?.onAgentEvent?.({
        type: "team_plan_review_required",
        approvalId: approval.id,
        taskId: approval.taskId,
        submittedByMemberId: approval.submittedByMemberId,
        plan: approval.plan,
        note: approval.note,
      });
      return {
        sent: true,
        type,
        approval: { id: approval.id, taskId: approval.taskId, status: approval.status },
      };
    }

    // Handle shutdown_response
    if (type === "shutdown_response") {
      const requestId = optionalString(a, "request_id");
      const approve = a.approve === true;

      if (approve && requestId) {
        runtime.acknowledgeShutdown(requestId, from);
        // Emit shutdown resolved event + ack message via runtime
        try {
          const msgs = runtime.sendMessage({
            fromMemberId: from,
            toMemberId: runtime.leadMemberId,
            kind: "shutdown_ack",
            content: `Shutdown acknowledged by ${from}`,
          });
          for (const msg of msgs) {
            options?.onAgentEvent?.({
              type: "team_message",
              kind: msg.kind,
              fromMemberId: msg.fromMemberId,
              toMemberId: msg.toMemberId,
              relatedTaskId: msg.relatedTaskId,
              contentPreview: truncate(msg.content, 120),
            });
          }
        } catch { /* ignore */ }
        options?.onAgentEvent?.({
          type: "team_shutdown_resolved",
          requestId,
          memberId: from,
          requestedByMemberId: runtime.leadMemberId,
          status: "acknowledged",
        });
      }
    }

    // Handle plan_approval_response
    if (type === "plan_approval_response" && recipient) {
      const requestId = optionalString(a, "request_id");
      const approve = a.approve === true;

      if (requestId) {
        const approval = runtime.reviewPlan({
          approvalId: requestId,
          reviewedByMemberId: from,
          approved: approve,
          feedback: content,
        });
        if (approval) {
          const task = runtime.updateTask(approval.taskId, {
            approvalId: approval.id,
            status: approve ? "in_progress" : "pending",
            resultSummary: approval.feedback,
          });
          // Emit task update + approval message + plan review resolved events
          if (task) {
            options?.onAgentEvent?.({
              type: "team_task_updated",
              taskId: task.id,
              goal: task.goal,
              status: task.status,
              assigneeMemberId: task.assigneeMemberId,
              artifacts: task.artifacts,
            });
          }
          try {
            const msgs = runtime.sendMessage({
              fromMemberId: from,
              toMemberId: approval.submittedByMemberId,
              kind: "approval_response",
              content: content?.trim().length
                ? content
                : approve
                ? `Plan approved for task ${approval.taskId}`
                : `Plan rejected for task ${approval.taskId}`,
              relatedTaskId: approval.taskId,
            });
            for (const msg of msgs) {
              options?.onAgentEvent?.({
                type: "team_message",
                kind: msg.kind,
                fromMemberId: msg.fromMemberId,
                toMemberId: msg.toMemberId,
                relatedTaskId: msg.relatedTaskId,
                contentPreview: truncate(msg.content, 120),
              });
            }
          } catch { /* ignore */ }
          options?.onAgentEvent?.({
            type: "team_plan_review_resolved",
            approvalId: approval.id,
            taskId: approval.taskId,
            submittedByMemberId: approval.submittedByMemberId,
            approved: approve,
            reviewedByMemberId: from,
          });
        }
      }
    }

    // File-backed inbox delivery (store mode only)
    if (store) {
      const msg: InboxMessage = {
        id: crypto.randomUUID(),
        type: type as InboxMessage["type"],
        from,
        content,
        summary,
        timestamp: Date.now(),
        recipient,
        ...(type === "shutdown_response" ? {
          requestId: optionalString(a, "request_id"),
          approve: a.approve === true,
        } : {}),
      };
      await store.sendMessage(msg);
    } else {
      // Runtime-only mode: direct runtime messaging
      const broadcast = type === "broadcast";
      try {
        const msgs = runtime.sendMessage({
          fromMemberId: from,
          toMemberId: broadcast ? undefined : recipient,
          kind: broadcast ? "broadcast" : "direct",
          content,
        });
        for (const msg of msgs) {
          options?.onAgentEvent?.({
            type: "team_message",
            kind: msg.kind,
            fromMemberId: msg.fromMemberId,
            toMemberId: msg.toMemberId,
            relatedTaskId: msg.relatedTaskId,
            contentPreview: truncate(msg.content, 120),
          });
        }
      } catch { /* member may not be registered */ }
    }

    return {
      sent: true,
      type,
      to: type === "broadcast" ? "all" : recipient,
      summary,
    };
  },
  description:
    "Send messages to agent teammates. Supports direct messages, broadcasts, shutdown requests/responses, plan submissions, and plan approval responses.",
  category: "meta",
  args: {
    type: "string (required) - 'message', 'broadcast', 'shutdown_request', 'shutdown_response', 'plan_approval_response', 'submit_plan'",
    recipient:
      "string (optional) - Agent name of recipient (required for message/shutdown_request/plan_approval_response)",
    content: "string (optional) - Message text or feedback",
    summary:
      "string (optional) - 5-10 word summary shown as preview (required for message/broadcast)",
    request_id:
      "string (optional) - Request ID (required for shutdown_response/plan_approval_response)",
    approve:
      "boolean (optional) - Whether to approve (for shutdown_response/plan_approval_response)",
    task_id:
      "string (optional) - Task ID (required for submit_plan)",
    plan:
      "object (optional) - Plan object with steps (required for submit_plan)",
    note:
      "string (optional) - Note to include with plan submission (for submit_plan)",
  },
  returns: {
    sent: "boolean - Whether the message was sent",
    type: "string - Message type",
    to: "string - Recipient or 'all' for broadcast",
  },
  safetyLevel: "L0",
  safety: "Sends messages between team agents.",
};

// ── TaskCreate Tool ───────────────────────────────────────────────────

export const taskCreate: ToolMetadata = {
  fn: async (args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    if (!isToolArgsObject(args)) {
      throw new ValidationError("args must be an object", "TaskCreate");
    }
    const a = args as Record<string, unknown>;
    const { store, runtime } = resolveBackend("TaskCreate", options);
    const id = optionalString(a, "id");
    const subject = requireString(a, "subject", "TaskCreate");
    const description = requireString(a, "description", "TaskCreate");
    const activeForm = optionalString(a, "activeForm");
    const metadata = typeof a.metadata === "object" && a.metadata !== null
      ? a.metadata as Record<string, unknown>
      : undefined;

    if (store) {
      const task = await store.createTask({
        id,
        subject,
        description,
        activeForm,
        metadata,
      });
      return {
        id: task.id,
        subject: task.subject,
        status: task.status,
        message: `Task #${task.id} created: ${task.subject}`,
      };
    }

    // Runtime-only mode
    const memberId = getMemberId(options, runtime);
    const task = runtime.ensureTask({
      id,
      goal: subject,
      status: "pending",
      assigneeMemberId: memberId,
      artifacts: activeForm ? { activeForm } : undefined,
    });
    options?.onAgentEvent?.({
      type: "team_task_updated",
      taskId: task.id,
      goal: task.goal,
      status: task.status,
      assigneeMemberId: task.assigneeMemberId,
      artifacts: task.artifacts,
    });
    return { task };
  },
  description:
    "Create a task in the team's shared task list. Tasks help track progress and coordinate work across teammates.",
  category: "meta",
  args: {
    id: "string (optional) - Explicit task ID for deterministic workflows",
    subject: "string (required) - Brief, actionable task title",
    description:
      "string (required) - Detailed description of what needs to be done",
    activeForm:
      "string (optional) - Present continuous form shown while in progress (e.g., 'Running tests')",
    metadata: "object (optional) - Arbitrary metadata to attach",
  },
  returns: {
    id: "string - Task ID",
    subject: "string - Task title",
    status: "string - Task status (pending)",
  },
  safetyLevel: "L0",
  safety: "Creates a task entry in the shared task list.",
};

// ── TaskGet Tool ──────────────────────────────────────────────────────

export const taskGet: ToolMetadata = {
  fn: async (args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    if (!isToolArgsObject(args)) {
      throw new ValidationError("args must be an object", "TaskGet");
    }
    const a = args as Record<string, unknown>;
    const { store, runtime } = resolveBackend("TaskGet", options);
    const taskId = requireString(a, "taskId", "TaskGet");

    if (store) {
      const task = await store.getTask(taskId);
      if (!task) throw new ValidationError(`Task '${taskId}' not found`, "TaskGet");
      return task;
    }

    // Runtime-only mode
    const task = runtime.getTask(taskId);
    if (!task) throw new ValidationError(`Task '${taskId}' not found`, "TaskGet");
    return task;
  },
  description: "Retrieve a task by its ID from the shared task list.",
  category: "meta",
  args: {
    taskId: "string (required) - The ID of the task to retrieve",
  },
  returns: {
    id: "string - Task ID",
    subject: "string - Task title",
    description: "string - Full task description",
    status: "string - pending, in_progress, or completed",
    owner: "string - Agent assigned to the task",
    blockedBy: "array - Task IDs blocking this task",
    blocks: "array - Task IDs that this task blocks",
  },
  safetyLevel: "L0",
  safety: "Read-only task retrieval.",
};

// ── TaskUpdate Tool ───────────────────────────────────────────────────

export const taskUpdate: ToolMetadata = {
  fn: async (args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    if (!isToolArgsObject(args)) {
      throw new ValidationError("args must be an object", "TaskUpdate");
    }
    const a = args as Record<string, unknown>;
    const { store, runtime } = resolveBackend("TaskUpdate", options);
    const taskId = requireString(a, "taskId", "TaskUpdate");

    if (store) {
      const patch: Parameters<typeof store.updateTask>[1] = {};
      const status = optionalString(a, "status");
      if (status) {
        const valid = ["pending", "in_progress", "completed", "deleted"];
        if (!valid.includes(status)) {
          throw new ValidationError(
            `Invalid status '${status}'. Must be one of: ${valid.join(", ")}`,
            "TaskUpdate",
          );
        }
        patch.status = status as typeof patch.status;
      }
      if (a.subject !== undefined) patch.subject = String(a.subject);
      if (a.description !== undefined) patch.description = String(a.description);
      if (a.activeForm !== undefined) patch.activeForm = String(a.activeForm);
      if (a.owner !== undefined) patch.owner = String(a.owner);
      patch.addBlocks = optionalStringArray(a, "addBlocks");
      patch.addBlockedBy = optionalStringArray(a, "addBlockedBy");
      if (typeof a.metadata === "object" && a.metadata !== null) {
        patch.metadata = a.metadata as Record<string, unknown>;
      }

      const result = await store.updateTask(taskId, patch);
      if (patch.status === "deleted") {
        return { deleted: true, taskId };
      }
      if (!result) {
        throw new ValidationError(`Task '${taskId}' not found`, "TaskUpdate");
      }
      return {
        id: result.id,
        subject: result.subject,
        status: result.status,
        owner: result.owner,
        message: `Task #${result.id} updated`,
      };
    }

    // Runtime-only mode: update via runtime
    const existing = runtime.getTask(taskId);
    if (!existing) {
      throw new ValidationError(`Task '${taskId}' not found`, "TaskUpdate");
    }
    const patch: Partial<{ status: string; assigneeMemberId: string; dependencies: string[]; resultSummary: string; artifacts: Record<string, unknown> }> = {};
    if (a.status !== undefined) patch.status = String(a.status);
    if (a.owner !== undefined) patch.assigneeMemberId = String(a.owner);
    if (a.addBlockedBy !== undefined) {
      patch.dependencies = [
        ...existing.dependencies,
        ...(optionalStringArray(a, "addBlockedBy") ?? []),
      ];
    }
    const task = runtime.updateTask(taskId, patch as Record<string, unknown>);
    if (task) {
      options?.onAgentEvent?.({
        type: "team_task_updated",
        taskId: task.id,
        goal: task.goal,
        status: task.status,
        assigneeMemberId: task.assigneeMemberId,
        artifacts: task.artifacts,
      });
    }
    return { task };
  },
  description:
    "Update a task in the shared task list. Can change status, ownership, dependencies, and other fields.",
  category: "meta",
  args: {
    taskId: "string (required) - The task ID to update",
    status:
      "string (optional) - 'pending', 'in_progress', 'completed', or 'deleted'",
    subject: "string (optional) - New task title",
    description: "string (optional) - New task description",
    activeForm: "string (optional) - Present continuous form for spinner",
    owner: "string (optional) - Agent name to assign",
    addBlocks: "array (optional) - Task IDs that cannot start until this one completes",
    addBlockedBy: "array (optional) - Task IDs that must complete before this one",
    metadata: "object (optional) - Metadata keys to merge (null values delete keys)",
  },
  returns: {
    id: "string - Task ID",
    status: "string - Updated status",
    owner: "string - Assigned agent",
  },
  safetyLevel: "L0",
  safety: "Mutates task state in the shared task list.",
};

// ── TaskList Tool ─────────────────────────────────────────────────────

export const taskList: ToolMetadata = {
  fn: async (_args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    const { store, runtime } = resolveBackend("TaskList", options);

    if (store) {
      const tasks = await store.listTasks();
      const taskById = new Map(tasks.map((t) => [t.id, t]));
      return {
        tasks: tasks.map((t) => ({
          id: t.id,
          subject: t.subject,
          status: t.status,
          owner: t.owner ?? "",
          blockedBy: t.blockedBy.filter((id) => {
            const blocker = taskById.get(id);
            return blocker && blocker.status !== "completed";
          }),
        })),
      };
    }

    // Runtime-only mode
    const tasks = runtime.listTasks();
    return {
      tasks: tasks.map((t) => ({
        id: t.id,
        goal: t.goal,
        status: t.status,
        assigneeMemberId: t.assigneeMemberId ?? "",
        dependencies: t.dependencies,
      })),
    };
  },
  description:
    "List all tasks in the team's shared task list with summary information.",
  category: "meta",
  args: {},
  returns: {
    tasks:
      "array - Task summaries with id, subject, status, owner, blockedBy",
  },
  safetyLevel: "L0",
  safety: "Read-only task list.",
};

// ── TeamStatus Tool ──────────────────────────────────────────────────

export const teamStatus: ToolMetadata = {
  fn: async (_args: unknown, _workspace: string, options?: ToolExecutionOptions) => {
    const { runtime } = resolveBackend("TeamStatus", options);
    const memberId = getMemberId(options, runtime);
    const currentMember = runtime.getMember(memberId);
    const summary = runtime.deriveSummary(memberId);
    const pendingApprovals = runtime.listPendingApprovals().map((approval) => ({
      id: approval.id,
      taskId: approval.taskId,
      submittedByMemberId: approval.submittedByMemberId,
      note: approval.note,
      createdAt: approval.createdAt,
    }));
    const pendingShutdowns = runtime.listShutdowns().filter(
      (shutdown) =>
        shutdown.status === "requested" || shutdown.status === "acknowledged",
    ).map((shutdown) => ({
      id: shutdown.id,
      memberId: shutdown.memberId,
      requestedByMemberId: shutdown.requestedByMemberId,
      status: shutdown.status,
      reason: shutdown.reason,
      escalateAt: shutdown.escalateAt,
    }));
    const unreadMessages = runtime.readMessages(memberId, { markRead: false });
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

// ── Tool Registry ─────────────────────────────────────────────────────

/** Tool names available to teammates (excludes Teammate itself — managed by lead only). */
export const TEAMMATE_AVAILABLE_TOOL_NAMES = [
  "SendMessage",
  "TaskCreate",
  "TaskGet",
  "TaskUpdate",
  "TaskList",
] as const;

export const AGENT_TEAM_TOOLS: Record<string, ToolMetadata> = {
  Teammate: teammate,
  SendMessage: sendMessage,
  TaskCreate: taskCreate,
  TaskGet: taskGet,
  TaskUpdate: taskUpdate,
  TaskList: taskList,
  TeamStatus: teamStatus,
};
