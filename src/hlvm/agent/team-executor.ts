/**
 * Team Executor — Persistent Teammate Event Loop
 *
 * Each teammate runs runTeammateLoop() as a background async task.
 * The loop picks up tasks, executes them via runReActLoop(), and
 * sends notifications back to the team lead.
 *
 * Reuses existing infrastructure:
 *   - runReActLoop() for task execution (same as delegation.ts)
 *   - ContextManager for child context
 *   - generateSystemPrompt() for system prompt
 *   - delegate-threads.ts for thread lifecycle
 *   - getAgentEngine().createLLM() for child LLM
 */

import { ContextManager } from "./context.ts";
import { generateSystemPrompt } from "./llm-integration.ts";
import {
  type AgentUIEvent,
  type LLMFunction,
  type OrchestratorConfig,
  runReActLoop,
} from "./orchestrator.ts";
import { getAgentProfile, type AgentProfile } from "./agent-registry.ts";
import {
  DELEGATE_MAX_ITERATIONS,
  DELEGATE_TOTAL_TIMEOUT,
} from "./constants.ts";
import { CHILD_TOOL_DENYLIST } from "./delegation.ts";
import { hasTool } from "./registry.ts";
import { createTodoState } from "./todo-state.ts";
import { createDelegateInbox } from "./delegate-inbox.ts";
import { delay } from "@std/async";
import { getAgentLogger } from "./logger.ts";
import { getAgentEngine } from "./engine.ts";
import type { AgentHookRuntime } from "./hooks.ts";
import type { AgentPolicy } from "./policy.ts";
import type {
  InteractionRequestEvent,
  InteractionResponse,
} from "./registry.ts";
import type { TeamRuntime } from "./team-runtime.ts";
import type { TeamStore } from "./team-store.ts";
import { TEAMMATE_AVAILABLE_TOOL_NAMES } from "./tools/agent-team-tools.ts";
import { getThread } from "./delegate-threads.ts";

// ── Types ────────────────────────────────────────────────────────────

export interface TeammateIdentity {
  name: string;
  agentType: string;
  teamName: string;
  teamMemberId: string;
  leadMemberId: string;
  model?: string;
  planModeRequired?: boolean;
}

export interface TeammateLoopOptions {
  identity: TeammateIdentity;
  runtime: TeamRuntime;
  store: TeamStore;
  workspace: string;
  policy: AgentPolicy | null;
  signal: AbortSignal;
  hookRuntime?: AgentHookRuntime;
  onAgentEvent?: (event: AgentUIEvent) => void;
  modelId?: string;
  agentProfiles?: readonly AgentProfile[];
  /** Resolved instruction hierarchy to pass to child agent prompts. */
  instructions?: import("../prompt/types.ts").InstructionHierarchy;
  toolOwnerId?: string;
  /** Override idle poll interval in ms (default 3000). For testing. */
  idlePollIntervalMs?: number;
  /** Override max idle polls before exit (default 30). For testing. */
  maxIdlePolls?: number;
  /** Inherited permission mode from parent (default inherits lead's mode). */
  permissionMode?: import("../../common/config/types.ts").PermissionMode;
  /** Bubble teammate permission/question interactions up through the lead UI. */
  onInteraction?: (
    event: InteractionRequestEvent,
  ) => Promise<InteractionResponse>;
}

export interface TeammateLoopResult {
  tasksCompleted: number;
  exitReason: "shutdown" | "signal" | "no_work" | "error";
}

// ── Constants ────────────────────────────────────────────────────────

const IDLE_POLL_INTERVAL_MS = 3_000;
const MAX_IDLE_POLLS = 30;

/** Tools denied to teammate agents (child denylist + team management). */
const TEAMMATE_TOOL_DENYLIST = [
  ...CHILD_TOOL_DENYLIST,
  "Teammate",
];

// ── Helpers ──────────────────────────────────────────────────────────

function buildTeammateSystemNote(identity: TeammateIdentity): string {
  return [
    `You are teammate "${identity.name}" (type: ${identity.agentType}) in team "${identity.teamName}".`,
    `Your member ID is "${identity.teamMemberId}". The team lead's member ID is "${identity.leadMemberId}".`,
    "",
    "Your responsibilities:",
    "- Execute the task you have been assigned",
    "- Use TaskUpdate to mark tasks completed when done",
    "- Use SendMessage to communicate findings to the lead or other teammates",
    "- Respond to shutdown requests with SendMessage(type=shutdown_response)",
    "- After completing a task, check TaskList for more available work",
    "",
    "Return a concise, factual result that describes what you accomplished.",
  ].join("\n");
}

function resolveTeammateTools(
  agentType: string,
  agentProfiles?: readonly AgentProfile[],
  toolOwnerId?: string,
): string[] {
  const profile = getAgentProfile(agentType, agentProfiles);
  if (!profile) return [];
  return profile.tools.filter((tool) =>
    hasTool(tool, toolOwnerId) && !TEAMMATE_TOOL_DENYLIST.includes(tool)
  );
}

/** Signal-aware sleep using @std/async/delay. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return delay(ms, { signal });
}

// ── Main Loop ────────────────────────────────────────────────────────

/**
 * Run the persistent teammate event loop.
 * Returns when the teammate shuts down, is aborted, or runs out of work.
 */
export async function runTeammateLoop(
  options: TeammateLoopOptions,
): Promise<TeammateLoopResult> {
  const {
    identity,
    runtime,
    store,
    workspace,
    policy,
    signal,
    hookRuntime,
    onAgentEvent,
    agentProfiles,
    instructions,
    toolOwnerId,
    onInteraction,
  } = options;

  const log = getAgentLogger();
  const idlePollIntervalMs = options.idlePollIntervalMs ?? IDLE_POLL_INTERVAL_MS;
  const maxIdlePolls = options.maxIdlePolls ?? MAX_IDLE_POLLS;
  let tasksCompleted = 0;
  let idlePolls = 0;

  const allowedTools = resolveTeammateTools(
    identity.agentType,
    agentProfiles,
    toolOwnerId,
  );
  // Also include team tools that teammates can use (derived from registry SSOT)
  const fullToolAllowlist = [
    ...allowedTools,
    ...TEAMMATE_AVAILABLE_TOOL_NAMES.filter((t) => hasTool(t, toolOwnerId)),
  ];

  log.info(
    `[TeamExecutor] Teammate "${identity.name}" starting loop (tools: ${fullToolAllowlist.length})`,
  );

  const sendNotification = (
    kind: "idle_notification" | "task_completed",
    content: string,
  ): void => {
    try {
      runtime.sendMessage({
        fromMemberId: identity.teamMemberId,
        toMemberId: identity.leadMemberId,
        kind,
        content,
      });
    } catch {
      // Member may have been removed
    }
  };

  const forwardInteraction = onInteraction
    ? (event: InteractionRequestEvent) => {
      const threadId = runtime.getMember(identity.teamMemberId)?.threadId;
      return onInteraction({
        ...event,
        sourceLabel: event.sourceLabel ?? identity.name,
        sourceMemberId: event.sourceMemberId ?? identity.teamMemberId,
        sourceThreadId: event.sourceThreadId ?? threadId,
        sourceTeamName: event.sourceTeamName ?? identity.teamName,
      });
    }
    : undefined;

  /** Send idle notification + dispatch hook in one call. */
  const notifyIdle = (reason: string, tc?: number): void => {
    sendNotification(
      "idle_notification",
      JSON.stringify({
        type: "idle_notification",
        name: identity.name,
        reason,
        ...(tc !== undefined ? { tasksCompleted: tc } : {}),
      }),
    );
    hookRuntime?.dispatchDetached("teammate_idle", {
      teamName: identity.teamName,
      memberName: identity.name,
      reason,
    });
  };

  /** Send task completion/error notification + UI event + optional hook. */
  const notifyTaskOutcome = (
    taskId: string,
    subject: string,
    kind: "task_completed" | "task_error",
    detail: string,
  ): void => {
    sendNotification(
      "task_completed",
      JSON.stringify({
        type: kind,
        name: identity.name,
        taskId,
        subject,
        ...(kind === "task_completed" ? { summary: detail } : { error: detail }),
      }),
    );
    onAgentEvent?.({
      type: "team_message",
      kind,
      fromMemberId: identity.name,
      toMemberId: identity.leadMemberId,
      relatedTaskId: taskId,
      contentPreview: detail.slice(0, 120),
    });
  };

  while (!signal.aborted) {
    // 1. Check for shutdown request
    const shutdownReq = runtime.getPendingShutdown(identity.teamMemberId);
    if (shutdownReq) {
      log.info(
        `[TeamExecutor] Teammate "${identity.name}" acknowledging shutdown`,
      );
      runtime.acknowledgeShutdown(shutdownReq.id, identity.teamMemberId);
      runtime.updateMember(identity.teamMemberId, { status: "terminated" });
      return { tasksCompleted, exitReason: "shutdown" };
    }

    // 2. Drain file inbox → inject into runtime messages
    try {
      const inboxMessages = await store.readInbox(identity.name);
      for (const msg of inboxMessages) {
        // Check if this is a shutdown request in the inbox
        if (msg.type === "shutdown_request") {
          log.info(
            `[TeamExecutor] Teammate "${identity.name}" received shutdown via inbox`,
          );
          if (msg.requestId) {
            runtime.acknowledgeShutdown(msg.requestId, identity.teamMemberId);
          }
          runtime.updateMember(identity.teamMemberId, {
            status: "terminated",
          });
          return { tasksCompleted, exitReason: "shutdown" };
        }
      }
    } catch {
      // Inbox read failure is non-fatal
    }

    // 3. Find claimable task: pending + unblocked + unowned, sorted by ID
    const allTasks = await store.listTasks();
    const taskById = new Map(allTasks.map((t) => [t.id, t]));
    const claimable = allTasks.filter((t) =>
      t.status === "pending" &&
      !t.owner &&
      t.blockedBy.every((blockerId) => {
        const blocker = taskById.get(blockerId);
        return blocker && blocker.status === "completed";
      })
    ).sort((a, b) => parseInt(a.id) - parseInt(b.id));

    // 4. If no claimable task, idle and wait
    if (claimable.length === 0) {
      idlePolls++;
      if (idlePolls >= maxIdlePolls) {
        log.info(
          `[TeamExecutor] Teammate "${identity.name}" idle limit reached (${maxIdlePolls} polls)`,
        );
        notifyIdle("no_work", tasksCompleted);
        runtime.updateMember(identity.teamMemberId, { status: "terminated" });
        return { tasksCompleted, exitReason: "no_work" };
      }

      if (idlePolls === 1) {
        notifyIdle("waiting_for_tasks");
      }

      try {
        await sleep(idlePollIntervalMs, signal);
      } catch {
        // Abort during sleep
        runtime.updateMember(identity.teamMemberId, { status: "terminated" });
        return { tasksCompleted, exitReason: "signal" };
      }
      continue;
    }

    // Reset idle counter when we find work
    idlePolls = 0;
    const task = claimable[0];

    // 5. Claim task
    await store.updateTask(task.id, {
      status: "in_progress",
      owner: identity.name,
    });
    runtime.updateMember(identity.teamMemberId, {
      currentTaskId: task.id,
    });
    onAgentEvent?.({
      type: "team_task_updated",
      taskId: task.id,
      goal: task.subject,
      status: "in_progress",
      assigneeMemberId: identity.name,
    });

    log.info(
      `[TeamExecutor] Teammate "${identity.name}" executing task #${task.id}: ${task.subject}`,
    );

    // 6. Execute task via runReActLoop
    try {
      const profile = getAgentProfile(identity.agentType, agentProfiles);
      const modelId = identity.model ?? profile?.model ?? options.modelId;

      let childLlm: LLMFunction;
      try {
        childLlm = getAgentEngine().createLLM({
          model: modelId,
          options: { temperature: profile?.temperature },
          toolAllowlist: fullToolAllowlist,
        });
      } catch {
        // Engine not initialized (e.g., in tests) — skip this task
        throw new Error("LLM engine not available");
      }

      const childMaxTokens = profile?.maxTokens ?? 8192;
      const context = new ContextManager({ maxTokens: childMaxTokens });
      context.addMessage({
        role: "system",
        content: generateSystemPrompt({
          toolAllowlist: fullToolAllowlist,
          toolOwnerId,
          agentProfiles,
          instructions,
        }),
      });
      context.addMessage({
        role: "system",
        content: buildTeammateSystemNote(identity),
      });

      const taskPrompt = `Task #${task.id}: ${task.subject}\n\n${task.description}`;
      const threadId = runtime.getMember(identity.teamMemberId)?.threadId;
      const sharedInputQueue = threadId
        ? getThread(threadId)?.inputQueue
        : undefined;

      const result = await runReActLoop(
        taskPrompt,
        {
          workspace,
          context,
          permissionMode: options.permissionMode ?? "acceptEdits",
          maxIterations: DELEGATE_MAX_ITERATIONS,
          totalTimeout: DELEGATE_TOTAL_TIMEOUT,
          policy: policy ?? null,
          toolAllowlist: fullToolAllowlist,
          toolDenylist: TEAMMATE_TOOL_DENYLIST,
          l1Confirmations: new Map<string, boolean>(),
          toolOwnerId,
          onAgentEvent,
          delegateInbox: createDelegateInbox(),
          planning: { mode: "off" },
          todoState: createTodoState(),
          signal,
          teamRuntime: runtime,
          teamMemberId: identity.teamMemberId,
          teamLeadMemberId: identity.leadMemberId,
          agentProfiles,
          inputQueue: sharedInputQueue,
          onInteraction: forwardInteraction,
        },
        childLlm,
      );

      // 7. Mark task completed
      await store.updateTask(task.id, { status: "completed" });
      runtime.updateMember(identity.teamMemberId, {
        currentTaskId: undefined,
      });
      tasksCompleted++;
      onAgentEvent?.({
        type: "team_task_updated",
        taskId: task.id,
        goal: task.subject,
        status: "completed",
        assigneeMemberId: identity.name,
      });

      const summary = typeof result === "string"
        ? result.slice(0, 500)
        : "Task completed";

      notifyTaskOutcome(task.id, task.subject, "task_completed", summary);
      hookRuntime?.dispatchDetached("task_completed", {
        teamName: identity.teamName,
        memberName: identity.name,
        taskId: task.id,
        subject: task.subject,
      });

      log.info(
        `[TeamExecutor] Teammate "${identity.name}" completed task #${task.id}`,
      );
    } catch (error) {
      // 8. On error, leave task in_progress for potential retry, send error msg
      const message = error instanceof Error ? error.message : String(error);
      log.error(
        `[TeamExecutor] Teammate "${identity.name}" error on task #${task.id}: ${message}`,
      );

      runtime.updateMember(identity.teamMemberId, {
        currentTaskId: undefined,
      });

      notifyTaskOutcome(task.id, task.subject, "task_error", message);

      // Check if this was an abort
      if (signal.aborted) {
        runtime.updateMember(identity.teamMemberId, {
          status: "terminated",
        });
        return { tasksCompleted, exitReason: "signal" };
      }
    }

    // 9. Send idle notification after task
    notifyIdle("between_tasks", tasksCompleted);
  }

  // Signal was aborted outside the loop
  runtime.updateMember(identity.teamMemberId, { status: "terminated" });
  return { tasksCompleted, exitReason: "signal" };
}
