/**
 * Agent Team Tools — Claude Code-Compatible API
 *
 * Provides the exact same tool signatures as Claude Code's agent teams:
 *   - Teammate (spawnTeam, cleanup)
 *   - SendMessage (message, broadcast, shutdown_request, shutdown_response, plan_approval_response)
 *   - TaskCreate (subject, description, activeForm)
 *   - TaskGet (taskId)
 *   - TaskUpdate (taskId, status, owner, addBlocks, addBlockedBy, ...)
 *   - TaskList ()
 *
 * These tools wrap the file-backed TeamStore for persistent coordination.
 */

import { ValidationError } from "../../../common/error.ts";
import type { ToolExecutionOptions, ToolMetadata } from "../registry.ts";
import { isToolArgsObject } from "../validation.ts";
import {
  createTeamStore,
  getActiveTeamStore,
  setActiveTeamStore,
  type InboxMessage,
  type TaskFile,
} from "../team-store.ts";
import type { TeammateIdentity } from "../team-executor.ts";
import {
  registerThread,
  type DelegateThreadResult,
} from "../delegate-threads.ts";

// ── Helpers ───────────────────────────────────────────────────────────

function requireStore(toolName: string): ReturnType<typeof getActiveTeamStore> & {} {
  const store = getActiveTeamStore();
  if (!store) {
    throw new ValidationError(
      "No active team. Use the Teammate tool with operation 'spawnTeam' first.",
      toolName,
    );
  }
  return store;
}

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
      const member = store.runtime.registerMember({
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
      const agentProfiles = _options?.agentProfiles;
      const toolOwnerId = _options?.toolOwnerId;
      const agentPolicy = _options?.policy ?? null;
      const modelId = _options?.modelId;
      const instructions = _options?.instructions;
      const idlePollIntervalMs = _options?.idlePollIntervalMs;
      const maxIdlePolls = _options?.maxIdlePolls;

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
            modelId,
            agentProfiles,
            instructions,
            toolOwnerId,
            idlePollIntervalMs,
            maxIdlePolls,
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
      "string (required for spawnTeam) - Name for the new team",
    description:
      "string (optional) - Team description/purpose",
    name:
      "string (required for spawnAgent) - Unique name for the teammate",
    agent_type:
      "string (optional for spawnAgent) - Agent type/profile (default: 'general-purpose')",
    model:
      "string (optional for spawnAgent) - Model to use for this teammate",
    plan_mode_required:
      "boolean (optional for spawnAgent) - Whether this teammate requires plan approval",
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
    const store = requireStore("SendMessage");
    const type = requireString(a, "type", "SendMessage") as InboxMessage["type"];
    const validTypes = [
      "message",
      "broadcast",
      "shutdown_request",
      "shutdown_response",
      "plan_approval_response",
    ];
    if (!validTypes.includes(type)) {
      throw new ValidationError(
        `Invalid type '${type}'. Must be one of: ${validTypes.join(", ")}`,
        "SendMessage",
      );
    }

    const from = options?.teamMemberId ?? store.runtime.leadMemberId;
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

    const msg: InboxMessage = {
      id: crypto.randomUUID(),
      type,
      from,
      content,
      summary,
      timestamp: Date.now(),
      recipient,
    };

    // Handle shutdown_request via runtime
    if (type === "shutdown_request" && recipient) {
      try {
        store.runtime.requestShutdown({
          memberId: recipient,
          requestedByMemberId: from,
          reason: content,
        });
      } catch { /* member may not be registered */ }
    }

    // Handle shutdown_response
    if (type === "shutdown_response") {
      const requestId = optionalString(a, "request_id");
      const approve = a.approve === true;
      msg.requestId = requestId;
      msg.approve = approve;

      if (approve && requestId) {
        store.runtime.acknowledgeShutdown(requestId, from);
      }
    }

    // Handle plan_approval_response
    if (type === "plan_approval_response" && recipient) {
      const requestId = optionalString(a, "request_id");
      const approve = a.approve === true;
      msg.requestId = requestId;
      msg.approve = approve;

      if (requestId) {
        store.runtime.reviewPlan({
          approvalId: requestId,
          reviewedByMemberId: from,
          approved: approve,
          feedback: content,
        });
      }
    }

    await store.sendMessage(msg);

    return {
      sent: true,
      type,
      to: type === "broadcast" ? "all" : recipient,
      summary,
    };
  },
  description:
    "Send messages to agent teammates. Supports direct messages, broadcasts, shutdown requests/responses, and plan approval responses.",
  category: "meta",
  args: {
    type: "string (required) - 'message', 'broadcast', 'shutdown_request', 'shutdown_response', 'plan_approval_response'",
    recipient:
      "string (required for message/shutdown_request/plan_approval_response) - Agent name of recipient",
    content: "string - Message text or feedback",
    summary:
      "string - 5-10 word summary shown as preview (required for message/broadcast)",
    request_id:
      "string - Request ID for shutdown_response/plan_approval_response",
    approve:
      "boolean - Whether to approve (for shutdown_response/plan_approval_response)",
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
  fn: async (args: unknown, _workspace: string, _options?: ToolExecutionOptions) => {
    if (!isToolArgsObject(args)) {
      throw new ValidationError("args must be an object", "TaskCreate");
    }
    const a = args as Record<string, unknown>;
    const store = requireStore("TaskCreate");
    const subject = requireString(a, "subject", "TaskCreate");
    const description = requireString(a, "description", "TaskCreate");
    const activeForm = optionalString(a, "activeForm");
    const metadata = typeof a.metadata === "object" && a.metadata !== null
      ? a.metadata as Record<string, unknown>
      : undefined;

    const task = await store.createTask({
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
  },
  description:
    "Create a task in the team's shared task list. Tasks help track progress and coordinate work across teammates.",
  category: "meta",
  args: {
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
  fn: async (args: unknown, _workspace: string, _options?: ToolExecutionOptions) => {
    if (!isToolArgsObject(args)) {
      throw new ValidationError("args must be an object", "TaskGet");
    }
    const a = args as Record<string, unknown>;
    const store = requireStore("TaskGet");
    const taskId = requireString(a, "taskId", "TaskGet");
    const task = await store.getTask(taskId);
    if (!task) {
      throw new ValidationError(`Task '${taskId}' not found`, "TaskGet");
    }
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
  fn: async (args: unknown, _workspace: string, _options?: ToolExecutionOptions) => {
    if (!isToolArgsObject(args)) {
      throw new ValidationError("args must be an object", "TaskUpdate");
    }
    const a = args as Record<string, unknown>;
    const store = requireStore("TaskUpdate");
    const taskId = requireString(a, "taskId", "TaskUpdate");

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
  fn: async (_args: unknown, _workspace: string, _options?: ToolExecutionOptions) => {
    const store = requireStore("TaskList");
    const tasks = await store.listTasks();
    return {
      tasks: tasks.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        owner: t.owner ?? "",
        blockedBy: t.blockedBy.filter((id) => {
          // Only show open blockers
          const blocker = tasks.find((bt) => bt.id === id);
          return blocker && blocker.status !== "completed";
        }),
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

// ── Tool Registry ─────────────────────────────────────────────────────

export const AGENT_TEAM_TOOLS: Record<string, ToolMetadata> = {
  Teammate: teammate,
  SendMessage: sendMessage,
  TaskCreate: taskCreate,
  TaskGet: taskGet,
  TaskUpdate: taskUpdate,
  TaskList: taskList,
};
