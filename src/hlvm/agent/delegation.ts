/**
 * Delegation - run specialist sub-agents
 */

import { ContextManager } from "./context.ts";
import { generateSystemPrompt } from "./llm-integration.ts";
import {
  type AgentUIEvent,
  type LLMFunction,
  type OrchestratorConfig,
  runReActLoop,
} from "./orchestrator.ts";
import { getAgentProfile, listAgentProfiles } from "./agent-registry.ts";
import { DEFAULT_MAX_TOOL_CALLS, isGroundingMode } from "./constants.ts";
import { ValidationError } from "../../common/error.ts";
import { hasTool } from "./registry.ts";
import { createTodoState } from "./todo-state.ts";
import {
  type DelegateTranscriptEvent,
  type DelegateTranscriptSnapshot,
  getDelegateTranscriptSnapshot,
  withDelegateTranscriptSnapshot,
} from "./delegate-transcript.ts";
import {
  appendPersistedAgentToolResult,
  completePersistedAgentTurn,
  createPersistedAgentChildSession,
  loadPersistedAgentHistory,
  persistAgentTodos,
  type PersistedAgentTurn,
} from "./persisted-transcript.ts";
import { allocateNickname, getDelegateLimiter } from "./concurrency.ts";
import {
  cleanupCompletedThreads,
  type DelegateThreadResult,
  getActiveNicknames,
  registerThread,
  updateThreadBatchId,
  updateThreadChildSession,
  updateThreadDiff,
  updateThreadParentSnapshots,
  updateThreadSnapshot,
  updateThreadStatus,
  updateThreadWorkspace,
} from "./delegate-threads.ts";
import {
  createDelegateInbox,
  type BackgroundDelegateUpdate,
} from "./delegate-inbox.ts";
import { getAgentLogger } from "./logger.ts";
import { getPlatform } from "../../platform/platform.ts";
import { getAgentEngine } from "./engine.ts";

function queueBackgroundDelegateUpdate(
  config: OrchestratorConfig,
  update: BackgroundDelegateUpdate,
): void {
  config.delegateInbox?.push(update);
}

/** Tools denied to child agents (prevent recursion + parent-only tools). */
const CHILD_TOOL_DENYLIST = [
  "delegate_agent",
  "wait_agent",
  "list_agents",
  "close_agent",
  "send_input",
  "resume_agent",
  "batch_delegate",
];

function buildAgentSystemNote(
  profileName: string,
  tools: string[],
  options: { canDelegate: boolean },
): string {
  return [
    `Specialist agent: ${profileName}`,
    `Allowed tools: ${tools.join(", ") || "none"}`,
    options.canDelegate
      ? "Call delegate_agent only when a clearly separable subtask materially advances the parent task."
      : "Do not call delegate_agent.",
    "Return a concise, factual result that a supervisor can use directly.",
  ].join("\n");
}

function resolveAllowedTools(
  profileName: string,
  toolOwnerId?: string,
): string[] {
  const profile = getAgentProfile(profileName);
  if (!profile) return [];
  return profile.tools.filter((tool) => hasTool(tool, toolOwnerId));
}

/** Validate delegate_agent args and return parsed fields. */
function validateDelegateArgs(args: unknown): {
  agent: string;
  task: string;
  record: Record<string, unknown>;
} {
  if (!args || typeof args !== "object") {
    throw new ValidationError(
      `delegate_agent requires { agent, task }. Got: ${typeof args}`,
      "delegate_agent",
    );
  }
  const record = args as Record<string, unknown>;
  const agent = typeof record.agent === "string" ? record.agent : "";
  const task = typeof record.task === "string" ? record.task : "";
  if (!agent || !task) {
    throw new ValidationError(
      `delegate_agent requires { agent, task }. Available agents: ${
        listAgentProfiles().map((p) => p.name).join(", ")
      }`,
      "delegate_agent",
    );
  }
  const profile = getAgentProfile(agent);
  if (!profile) {
    throw new ValidationError(
      `Unknown agent "${agent}". Available: ${
        listAgentProfiles().map((p) => p.name).join(", ")
      }`,
      "delegate_agent",
    );
  }
  return { agent: profile.name, task, record };
}

/** Run the delegate child loop (shared by sync and background paths). */

export interface WorkspaceLease {
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * Create an isolated workspace directory for a child agent.
 * The directory is created inside the parent workspace for easier merging.
 */
export async function createChildWorkspace(
  parentWorkspace: string,
  threadId: string,
): Promise<WorkspaceLease> {
  const platform = getPlatform();
  const childDir = platform.path.join(
    parentWorkspace,
    `.hlvm-child-${threadId.slice(0, 8)}`,
  );
  await platform.fs.mkdir(childDir, { recursive: true });
  return {
    path: childDir,
    cleanup: async () => {
      try {
        await platform.fs.remove(childDir, { recursive: true });
      } catch { /* ignore - may already be cleaned up */ }
    },
  };
}

/**
 * Generate a unified diff of changes between child and parent workspace.
 * Walks the child workspace and compares files against parent.
 */
export async function generateChildDiff(
  parentWorkspace: string,
  childWorkspace: string,
): Promise<{ diff: string; filesModified: string[] } | null> {
  const platform = getPlatform();
  const modified: string[] = [];
  const diffLines: string[] = [];

  async function walkDir(dir: string, rel: string): Promise<void> {
    for await (const entry of platform.fs.readDir(dir)) {
      const childPath = platform.path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;

      if (entry.isDirectory) {
        // Skip nested .hlvm-child dirs
        if (entry.name.startsWith(".hlvm-child-")) continue;
        await walkDir(childPath, relPath);
      } else if (entry.isFile) {
        const parentPath = platform.path.join(parentWorkspace, relPath);
        try {
          const childContent = await platform.fs.readTextFile(childPath);
          let parentContent: string;
          try {
            parentContent = await platform.fs.readTextFile(parentPath);
          } catch {
            // New file in child
            parentContent = "";
          }
          if (childContent !== parentContent) {
            modified.push(relPath);
            diffLines.push(`--- a/${relPath}`);
            diffLines.push(`+++ b/${relPath}`);
            if (!parentContent) {
              diffLines.push("@@ new file @@");
              for (const line of childContent.split("\n")) {
                diffLines.push(`+${line}`);
              }
            } else {
              // Simple line-by-line diff
              const parentLines = parentContent.split("\n");
              const childLines = childContent.split("\n");
              diffLines.push(
                `@@ -1,${parentLines.length} +1,${childLines.length} @@`,
              );
              for (const line of parentLines) diffLines.push(`-${line}`);
              for (const line of childLines) diffLines.push(`+${line}`);
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walkDir(childWorkspace, "");
  if (modified.length === 0) return null;
  return { diff: diffLines.join("\n"), filesModified: modified };
}

/**
 * Apply non-conflicting child changes to the parent workspace.
 * Returns list of files that had conflicts (parent changed since spawn).
 */
export async function applyChildChanges(
  parentWorkspace: string,
  childWorkspace: string,
  filesModified: string[],
  parentSnapshots?: Map<string, string>,
): Promise<{ applied: string[]; conflicts: string[] }> {
  const platform = getPlatform();
  const applied: string[] = [];
  const conflicts: string[] = [];

  for (const relPath of filesModified) {
    const childPath = platform.path.join(childWorkspace, relPath);
    const parentPath = platform.path.join(parentWorkspace, relPath);

    try {
      const childContent = await platform.fs.readTextFile(childPath);

      // Real conflict detection: if we have a snapshot of the parent at spawn
      // time, compare current parent to that snapshot. If parent changed since
      // spawn, it's a true conflict (someone else modified the same file).
      if (parentSnapshots) {
        const spawnContent = parentSnapshots.get(relPath);
        try {
          const currentParent = await platform.fs.readTextFile(parentPath);
          if (
            (spawnContent === undefined && currentParent.length >= 0) ||
            (spawnContent !== undefined && currentParent !== spawnContent)
          ) {
            // Parent file changed since child was spawned — conflict
            conflicts.push(relPath);
            continue;
          }
        } catch {
          // Parent file didn't exist at read time — new file from child is fine
        }
      }

      // Ensure parent directory exists
      const parentDir = platform.path.dirname(parentPath);
      await platform.fs.mkdir(parentDir, { recursive: true });

      await platform.fs.writeTextFile(parentPath, childContent);
      applied.push(relPath);
    } catch {
      conflicts.push(relPath);
    }
  }

  return { applied, conflicts };
}

/**
 * Snapshot the content of every parent file at child spawn time.
 * This is the live conflict-detection baseline for background delegates.
 */
export async function snapshotWorkspaceFiles(
  parentWorkspace: string,
): Promise<Map<string, string>> {
  const platform = getPlatform();
  const snapshots = new Map<string, string>();

  async function walkDir(dir: string, rel: string): Promise<void> {
    for await (const entry of platform.fs.readDir(dir)) {
      const childPath = platform.path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        if (entry.name.startsWith(".hlvm-child-")) continue;
        await walkDir(childPath, relPath);
        continue;
      }
      if (!entry.isFile) continue;
      try {
        snapshots.set(relPath, await platform.fs.readTextFile(childPath));
      } catch {
        // Best-effort snapshot only
      }
    }
  }

  await walkDir(parentWorkspace, "");
  return snapshots;
}

/**
 * Snapshot the content of files in the parent workspace for later conflict detection.
 * Called at child spawn time so we can detect if parent changed during child execution.
 */
export async function snapshotParentFiles(
  parentWorkspace: string,
  childWorkspace: string,
  filesModified: string[],
): Promise<Map<string, string>> {
  const platform = getPlatform();
  const snapshots = new Map<string, string>();
  for (const relPath of filesModified) {
    const parentPath = platform.path.join(parentWorkspace, relPath);
    try {
      const content = await platform.fs.readTextFile(parentPath);
      snapshots.set(relPath, content);
    } catch {
      // File doesn't exist in parent — no snapshot needed
    }
  }
  return snapshots;
}

async function runDelegateChild(
  llm: LLMFunction,
  baseConfig: Pick<OrchestratorConfig, "policy"> & {
    sessionId?: string | null;
    modelId?: string;
    currentDepth?: number;
    maxDepth?: number;
  },
  config: OrchestratorConfig,
  agent: string,
  task: string,
  record: Record<string, unknown>,
  signal?: AbortSignal,
  workspaceOverride?: string,
  inputQueue?: string[],
): Promise<{
  result: unknown;
  snapshot: DelegateTranscriptSnapshot;
  childSessionId?: string;
}> {
  const currentDepth = baseConfig.currentDepth ?? 0;
  const maxDepth = baseConfig.maxDepth ?? 1;
  const atMaxDepth = currentDepth >= maxDepth;

  // Depth-aware denylist: allow delegate_agent for children if not at max depth
  const childDenylist = atMaxDepth
    ? CHILD_TOOL_DENYLIST
    : CHILD_TOOL_DENYLIST.filter((t) => t !== "delegate_agent");

  const allowedTools = resolveAllowedTools(agent, config.toolOwnerId);
  const profile = getAgentProfile(agent);

  // Wire profile.model and profile.temperature overrides: create child-specific LLM
  const hasProfileOverrides = profile?.model || profile?.temperature !== undefined;
  let childLlm = llm;
  if (hasProfileOverrides) {
    try {
      childLlm = getAgentEngine().createLLM({
        model: profile?.model,
        options: {
          temperature: profile?.temperature,
        },
        toolAllowlist: allowedTools,
      });
    } catch {
      // Engine not initialized (e.g., in tests) — fall back to parent LLM
    }
  }

  const parentCtxConfig = config.context.getConfig();
  const childMaxTokens = profile?.maxTokens ?? config.context.getMaxTokens();
  const context = new ContextManager({
    ...parentCtxConfig,
    maxTokens: childMaxTokens,
  });
  context.addMessage({
    role: "system",
    content: generateSystemPrompt({
      toolAllowlist: allowedTools,
      toolOwnerId: config.toolOwnerId,
    }),
  });
  context.addMessage({
    role: "system",
    content: buildAgentSystemNote(agent, allowedTools, {
      canDelegate: !atMaxDepth,
    }),
  });
  const childTodoState = createTodoState();

  const childEvents: DelegateTranscriptEvent[] = [];
  const childTurn: PersistedAgentTurn | null = baseConfig.sessionId
    ? createPersistedAgentChildSession({
      parentSessionId: baseConfig.sessionId,
      agent,
      task,
    })
    : null;
  const startedAt = Date.now();
  const pushChildEvent = (event: AgentUIEvent): void => {
    const snapshotEvent = toDelegateTranscriptEvent(event);
    if (snapshotEvent) {
      childEvents.push(snapshotEvent);
    }
    if (childTurn && event.type === "tool_end") {
      appendPersistedAgentToolResult(
        childTurn,
        event.name,
        event.content ?? event.summary ?? "",
        {
          argsSummary: event.argsSummary,
          success: event.success,
        },
      );
    }
    if (childTurn && event.type === "todo_updated") {
      persistAgentTodos(
        childTurn.sessionId,
        event.todoState.items,
        event.source,
      );
    }
  };
  const buildSnapshot = (
    options: { success: boolean; finalResponse?: string; error?: string },
  ): DelegateTranscriptSnapshot => ({
    agent,
    task,
    childSessionId: childTurn?.sessionId,
    success: options.success,
    durationMs: Date.now() - startedAt,
    toolCount:
      childEvents.filter((event) => event.type === "tool_end").length,
    finalResponse: options.finalResponse,
    error: options.error,
    events: [...childEvents],
  });

  const childWorkspace = workspaceOverride ?? config.workspace;

  try {
    const result = await runReActLoop(
      task,
      {
        workspace: childWorkspace,
        context,
        permissionMode: config.permissionMode,
        maxToolCalls: typeof record.maxToolCalls === "number"
          ? Math.min(
            record.maxToolCalls,
            config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
          )
          : config.maxToolCalls,
        groundingMode: isGroundingMode(record.groundingMode)
          ? record.groundingMode
          : config.groundingMode,
        policy: baseConfig.policy ?? null,
        toolAllowlist: allowedTools,
        toolDenylist: childDenylist,
        l1Confirmations: new Map<string, boolean>(),
        toolOwnerId: config.toolOwnerId,
        onInteraction: config.onInteraction,
        onAgentEvent: pushChildEvent,
        delegateInbox: createDelegateInbox(),
        planning: { mode: "off" },
      todoState: childTodoState,
      signal,
      inputQueue,
      coordinationBoard: config.coordinationBoard,
      delegateCoordinationId: config.delegateCoordinationId,
      teamRuntime: config.teamRuntime,
      teamMemberId: config.teamMemberId,
      teamLeadMemberId: config.teamLeadMemberId,
      // If not at max depth, wire child delegate handler for nested delegation
      ...(!atMaxDepth
        ? {
            delegate: createDelegateHandler(childLlm, {
              ...baseConfig,
              currentDepth: currentDepth + 1,
            }),
          }
          : {}),
      },
      childLlm,
    );

    if (childTurn) {
      persistAgentTodos(
        childTurn.sessionId,
        childTodoState.items.map((item) => ({ ...item })),
        "tool",
      );
      completePersistedAgentTurn(
        childTurn,
        baseConfig.modelId ?? "delegate_agent",
        result,
      );
    }

    const snapshot = buildSnapshot({ success: true, finalResponse: result });
    return {
      result: withDelegateTranscriptSnapshot({
        agent,
        result,
        stats: context.getStats(),
        childSessionId: childTurn?.sessionId,
      }, snapshot),
      snapshot,
      childSessionId: childTurn?.sessionId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (childTurn) {
      persistAgentTodos(
        childTurn.sessionId,
        childTodoState.items.map((item) => ({ ...item })),
        "tool",
      );
      completePersistedAgentTurn(
        childTurn,
        baseConfig.modelId ?? "delegate_agent",
        `Delegation failed: ${message}`,
      );
    }
    const snapshot = buildSnapshot({ success: false, error: message });
    throw withDelegateTranscriptSnapshot(error, snapshot);
  }
}

/**
 * Resume a completed delegate child by rehydrating its persisted session transcript,
 * appending a new user prompt, and running a fresh ReAct loop with restored context.
 */
export async function resumeDelegateChild(
  llm: LLMFunction,
  config: OrchestratorConfig,
  agent: string,
  childSessionId: string,
  newPrompt: string,
  modelId?: string,
): Promise<unknown> {
  const profile = getAgentProfile(agent);
  const allowedTools = resolveAllowedTools(agent, config.toolOwnerId);
  const childMaxTokens = profile?.maxTokens ?? config.context.getMaxTokens();
  const parentCtxConfig = config.context.getConfig();
  const context = new ContextManager({
    ...parentCtxConfig,
    maxTokens: childMaxTokens,
  });

  // Load persisted history from child session
  const { history } = await loadPersistedAgentHistory({
    sessionId: childSessionId,
    model: modelId ?? "delegate_agent",
    maxGroups: 50,
  });

  // Replay history into new context
  for (const msg of history) {
    context.addMessage(msg);
  }

  // Add new prompt as user message
  context.addMessage({
    role: "user",
    content: newPrompt,
  });

  const result = await runReActLoop(
    newPrompt,
    {
      workspace: config.workspace,
      context,
      permissionMode: config.permissionMode,
      maxToolCalls: config.maxToolCalls,
      groundingMode: config.groundingMode,
      policy: config.policy ?? null,
      toolAllowlist: allowedTools,
      toolDenylist: CHILD_TOOL_DENYLIST,
      l1Confirmations: new Map<string, boolean>(),
      toolOwnerId: config.toolOwnerId,
      onInteraction: config.onInteraction,
      delegateInbox: createDelegateInbox(),
      planning: { mode: "off" },
      todoState: createTodoState(),
      signal: config.signal,
      teamRuntime: config.teamRuntime,
      teamMemberId: config.teamMemberId,
      teamLeadMemberId: config.teamLeadMemberId,
    },
    llm,
  );

  return {
    agent,
    result,
    resumed: true,
    childSessionId,
  };
}

export function createDelegateHandler(
  llm: LLMFunction,
  baseConfig: Pick<OrchestratorConfig, "policy"> & {
    sessionId?: string | null;
    modelId?: string;
    currentDepth?: number;
    maxDepth?: number;
  },
): (args: unknown, config: OrchestratorConfig) => Promise<unknown> {
  return async (
    args: unknown,
    config: OrchestratorConfig,
  ): Promise<unknown> => {
    const { agent, task, record } = validateDelegateArgs(args);
    const coordinationId = typeof record._coordinationId === "string"
      ? record._coordinationId
      : undefined;
    const batchId = typeof record._batchId === "string"
      ? record._batchId
      : undefined;
    const teamTaskId = typeof record._teamTaskId === "string"
      ? record._teamTaskId
      : (config.teamRuntime ? crypto.randomUUID() : undefined);
    const teamMemberId = typeof record._teamMemberId === "string"
      ? record._teamMemberId
      : (config.teamRuntime ? crypto.randomUUID() : undefined);

    const emitTeamTaskUpdated = (status: string): void => {
      if (!config.teamRuntime || !teamTaskId) return;
      const teamTask = config.teamRuntime.getTask(teamTaskId);
      if (!teamTask) return;
      config.onAgentEvent?.({
        type: "team_task_updated",
        taskId: teamTask.id,
        goal: teamTask.goal,
        status,
        assigneeMemberId: teamTask.assigneeMemberId,
      });
    };

    // Handle resume from persisted session (routed from resume_agent orchestrator special-case)
    const resumeSessionId = typeof record._resumeSessionId === "string"
      ? record._resumeSessionId
      : undefined;
    if (resumeSessionId) {
      return await resumeDelegateChild(
        llm,
        config,
        agent,
        resumeSessionId,
        task,
        baseConfig.modelId,
      );
    }

    const background = record.background === true;

    if (config.teamRuntime && teamMemberId) {
      config.teamRuntime.registerMember({
        id: teamMemberId,
        agent,
        role: "worker",
        currentTaskId: teamTaskId,
      });
    }
    if (config.teamRuntime && teamTaskId) {
      config.teamRuntime.ensureTask({
        id: teamTaskId,
        goal: task,
        status: background ? "pending" : "in_progress",
        assigneeMemberId: teamMemberId,
      });
      emitTeamTaskUpdated(background ? "pending" : "in_progress");
    }

    // Synchronous (foreground) path — existing behavior, zero regression risk
    if (!background) {
      if (coordinationId && config.coordinationBoard) {
        config.coordinationBoard.ensureItem({
          id: coordinationId,
          goal: task,
          assignedAgent: agent,
          status: "running",
          batchId,
          inputs: { task },
        });
      }
      try {
        const { result, childSessionId, snapshot } = await runDelegateChild(
          llm,
          baseConfig,
          {
            ...config,
            delegateCoordinationId: coordinationId,
            teamMemberId,
          },
          agent,
          task,
          record,
        );
        if (config.teamRuntime && teamTaskId) {
          config.teamRuntime.updateTask(teamTaskId, {
            status: "completed",
            resultSummary: snapshot.finalResponse,
            artifacts: snapshot.finalResponse
              ? { summary: snapshot.finalResponse }
              : undefined,
          });
          emitTeamTaskUpdated("completed");
        }
        if (config.teamRuntime && teamMemberId) {
          config.teamRuntime.updateMember(teamMemberId, {
            childSessionId,
            currentTaskId: undefined,
          });
        }
        if (coordinationId && config.coordinationBoard) {
          config.coordinationBoard.updateItem(coordinationId, {
            status: "completed",
            resultSummary: snapshot.finalResponse,
            childSessionId,
          });
        }
        return result;
      } catch (error) {
        if (config.teamRuntime && teamTaskId) {
          config.teamRuntime.updateTask(teamTaskId, {
            status: "errored",
            resultSummary: error instanceof Error ? error.message : String(error),
          });
          emitTeamTaskUpdated("errored");
        }
        if (coordinationId && config.coordinationBoard) {
          const message = error instanceof Error ? error.message : String(error);
          config.coordinationBoard.updateItem(coordinationId, {
            status: "errored",
            error: message,
          });
        }
        throw error;
      }
    }

    // Background path: fire-and-forget with concurrency limiting
    cleanupCompletedThreads(); // lazy GC of old terminal threads
    const threadId = crypto.randomUUID();
    const nickname = allocateNickname(getActiveNicknames());
    const controller = new AbortController();
    const limiter = getDelegateLimiter();
    // Shared input queue: thread.inputQueue and child config.inputQueue are the same array
    const sharedInputQueue: string[] = [];

    // Create the background promise (acquires concurrency slot, then runs child)
    const promise = (async (): Promise<DelegateThreadResult> => {
      // Acquire concurrency slot (may queue if at capacity)
      const release = await limiter.acquire(threadId);
      updateThreadStatus(threadId, "running");
      config.onAgentEvent?.({ type: "delegate_running", threadId });
      if (coordinationId && config.coordinationBoard) {
        config.coordinationBoard.updateItem(coordinationId, { status: "running" });
      }
      if (config.teamRuntime && teamTaskId) {
        config.teamRuntime.updateTask(teamTaskId, {
          status: "in_progress",
          delegateThreadId: threadId,
        });
        emitTeamTaskUpdated("in_progress");
      }

      // Create isolated workspace for this child agent
      let lease: WorkspaceLease | undefined;
      try {
        lease = await createChildWorkspace(config.workspace, threadId);
        updateThreadWorkspace(threadId, lease.path, lease.cleanup);
      } catch {
        // Fall back to parent workspace if isolation fails
        lease = undefined;
      }

      if (lease) {
        try {
          updateThreadParentSnapshots(
            threadId,
            await snapshotWorkspaceFiles(config.workspace),
          );
        } catch {
          // Best-effort snapshotting only
        }
      }

      try {
        const { result, snapshot, childSessionId } = await runDelegateChild(
          llm,
          baseConfig,
          {
            ...config,
            delegateCoordinationId: coordinationId,
            teamMemberId,
          },
          agent,
          task,
          record,
          controller.signal,
          lease?.path,
          sharedInputQueue,
        );
        updateThreadStatus(threadId, "completed");
        if (snapshot) updateThreadSnapshot(threadId, snapshot);
        if (childSessionId) updateThreadChildSession(threadId, childSessionId);

        // Generate diff of child changes for merge/apply
        if (lease) {
          try {
            const diffResult = await generateChildDiff(
              config.workspace,
              lease.path,
            );
            if (diffResult) {
              updateThreadDiff(
                threadId,
                diffResult.diff,
                diffResult.filesModified,
              );
            }
          } catch {
            // Diff generation is best-effort
          }
        }
        if (config.teamRuntime && teamTaskId) {
          config.teamRuntime.updateTask(teamTaskId, {
            status: "completed",
            delegateThreadId: threadId,
            resultSummary: snapshot.finalResponse,
            artifacts: snapshot.finalResponse
              ? { summary: snapshot.finalResponse }
              : undefined,
          });
          emitTeamTaskUpdated("completed");
        }
        if (config.teamRuntime && teamMemberId) {
          config.teamRuntime.updateMember(teamMemberId, {
            childSessionId,
            currentTaskId: undefined,
          });
        }

        if (coordinationId && config.coordinationBoard) {
          config.coordinationBoard.updateItem(coordinationId, {
            status: "completed",
            resultSummary: snapshot.finalResponse,
            childSessionId,
          });
        }

        // Emit delegate_end for UI
        config.onAgentEvent?.({
          type: "delegate_end",
          agent,
          task,
          success: true,
          summary: snapshot.finalResponse,
          durationMs: snapshot.durationMs,
          snapshot,
          childSessionId,
          threadId,
        });
        queueBackgroundDelegateUpdate(config, {
          threadId,
          nickname,
          agent,
          task,
          success: true,
          summary: snapshot.finalResponse,
          snapshot,
          childSessionId,
        });

        return { success: true, result, snapshot };
      } catch (error) {
        const isAbort = controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError");
        const status = isAbort ? "cancelled" : "errored";
        updateThreadStatus(threadId, status);
        const message = error instanceof Error ? error.message : String(error);
        if (config.teamRuntime && teamTaskId) {
          config.teamRuntime.updateTask(teamTaskId, {
            status: isAbort ? "cancelled" : "errored",
            delegateThreadId: threadId,
            resultSummary: message,
          });
          emitTeamTaskUpdated(isAbort ? "cancelled" : "errored");
        }
        if (coordinationId && config.coordinationBoard) {
          config.coordinationBoard.updateItem(coordinationId, {
            status,
            error: message,
          });
        }

        // Try to get snapshot from error
        const snapshot = getDelegateTranscriptSnapshot(error);
        if (snapshot) updateThreadSnapshot(threadId, snapshot);

        // Emit delegate_end for UI
        config.onAgentEvent?.({
          type: "delegate_end",
          agent,
          task,
          success: false,
          error: message,
          durationMs: snapshot?.durationMs ?? 0,
          snapshot,
          threadId,
        });
        queueBackgroundDelegateUpdate(config, {
          threadId,
          nickname,
          agent,
          task,
          success: false,
          error: message,
          snapshot,
        });

        return { success: false, error: message, snapshot };
      } finally {
        release();
        // Don't cleanup workspace yet — parent needs to merge first (Stage 4)
        // Cleanup happens on thread GC (cleanupCompletedThreads)
      }
    })();

    // Register thread as queued (will transition to running when slot acquired)
    registerThread({
      threadId,
      agent,
      nickname,
      task,
      status: "queued",
      controller,
      promise,
      inputQueue: sharedInputQueue,
      batchId,
      mergeState: "none",
    });
    if (config.teamRuntime && teamMemberId) {
      config.teamRuntime.updateMember(teamMemberId, {
        threadId,
        currentTaskId: teamTaskId,
      });
    }
    if (config.teamRuntime && teamTaskId) {
      config.teamRuntime.updateTask(teamTaskId, {
        status: "pending",
        assigneeMemberId: teamMemberId,
        delegateThreadId: threadId,
      });
      emitTeamTaskUpdated("pending");
    }
    if (batchId) {
      updateThreadBatchId(threadId, batchId);
    }
    if (coordinationId && config.coordinationBoard) {
      config.coordinationBoard.ensureItem({
        id: coordinationId,
        goal: task,
        assignedAgent: agent,
        status: "queued",
        threadId,
        batchId,
        inputs: { task },
      });
    }

    getAgentLogger().debug(
      `[Delegation] Background thread ${nickname} (${threadId}) queued for ${agent}: ${task}`,
    );

    // Return immediately with thread info
    return {
      threadId,
      nickname,
      agent,
      task,
      status: "queued",
      message: `Background agent "${nickname}" queued.`,
    };
  };
}

function toDelegateTranscriptEvent(
  event: AgentUIEvent,
): DelegateTranscriptEvent | null {
  switch (event.type) {
    case "thinking":
      return { type: "thinking", iteration: event.iteration };
    case "thinking_update":
      return {
        type: "thinking",
        iteration: event.iteration,
        summary: event.summary,
      };
    case "plan_created":
      return { type: "plan_created", stepCount: event.plan.steps.length };
    case "plan_step":
      return {
        type: "plan_step",
        stepId: event.stepId,
        index: event.index,
        completed: event.completed,
      };
    case "tool_start":
      return {
        type: "tool_start",
        name: event.name,
        argsSummary: event.argsSummary,
        toolIndex: event.toolIndex,
        toolTotal: event.toolTotal,
      };
    case "tool_end":
      return {
        type: "tool_end",
        name: event.name,
        success: event.success,
        content: event.content,
        summary: event.summary,
        durationMs: event.durationMs,
        argsSummary: event.argsSummary,
      };
    case "turn_stats":
      return {
        type: "turn_stats",
        iteration: event.iteration,
        toolCount: event.toolCount,
        durationMs: event.durationMs,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      };
    case "delegate_start":
    case "delegate_running":
    case "delegate_end":
    case "todo_updated":
    case "plan_review_required":
    case "plan_review_resolved":
    case "checkpoint_created":
    case "checkpoint_restored":
    case "interaction_request":
    case "team_task_updated":
    case "team_message":
    case "team_plan_review_required":
    case "team_plan_review_resolved":
    case "team_shutdown_requested":
    case "team_shutdown_resolved":
      return null;
  }
  return null;
}
