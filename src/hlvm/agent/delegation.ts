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
import {
  type AgentProfile,
  getAgentProfile,
} from "./agent-registry.ts";
import {
  CHILD_WORKSPACE_PREFIX,
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_TIMEOUTS,
  DELEGATE_MAX_ITERATIONS,
  DELEGATE_TOTAL_TIMEOUT,
  isGroundingMode,
} from "./constants.ts";
import { ValidationError } from "../../common/error.ts";
import { hasTool } from "./registry.ts";
import { isMutatingTool } from "./security/safety.ts";
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
  enqueueThreadCompletion,
  getActiveNicknames,
  registerThread,
  updateThreadBatchId,
  updateThreadChildSession,
  updateThreadDiff,
  updateThreadParentSnapshots,
  updateThreadResult,
  updateThreadSnapshot,
  updateThreadStatus,
  updateThreadWorkspace,
} from "./delegate-threads.ts";
import {
  type BackgroundDelegateUpdate,
  createDelegateInbox,
} from "./delegate-inbox.ts";
import { getAgentLogger } from "./logger.ts";
import { getPlatform } from "../../platform/platform.ts";
import { getAgentEngine } from "./engine.ts";
import { emitDelegateBatchProgress } from "./delegate-batch-progress.ts";
import {
  createWorkspaceLease,
  type WorkspaceLease,
} from "./workspace-leases.ts";
import { createFixtureLLM, loadLlmFixture } from "./llm-fixtures.ts";
import { createDelegateTokenBudget } from "./delegate-token-budget.ts";
import { createAbortError } from "../../common/timeout-utils.ts";
import { getErrorMessage, truncate } from "../../common/utils.ts";

function queueBackgroundDelegateUpdate(
  config: OrchestratorConfig,
  update: BackgroundDelegateUpdate,
): void {
  config.delegateInbox?.push(update);
}

const BACKGROUND_DELEGATE_WATCHDOG_MS = DEFAULT_TIMEOUTS.total +
  DEFAULT_TIMEOUTS.tool;


/** Tools denied to child agents (prevent recursion + parent-only tools).
 * @internal Exported for regression testing. */
export const CHILD_TOOL_DENYLIST = [
  "delegate_agent",
  "wait_agent",
  "list_agents",
  "close_agent",
  "send_input",
  "resume_agent",
  "batch_delegate",
  "memory_write", // Memory is singleton DB, not workspace-scoped
  "memory_edit", // Memory is singleton DB, not workspace-scoped
];

function buildAgentSystemNote(
  profile: AgentProfile,
  tools: string[],
  options: { canDelegate: boolean; isolatedWorkspace: boolean },
): string {
  const hasTeamTools = tools.includes("team_task_claim") &&
    tools.includes("team_status_read");

  return [
    `Specialist agent: ${profile.name}`,
    `Allowed tools: ${tools.join(", ") || "none"}`,
    options.isolatedWorkspace
      ? "Workspace mode: isolated child workspace. File changes may be merged later by the parent."
      : "Workspace mode: shared parent workspace without isolation. Stay read-only: inspect, analyze, and report only.",
    options.canDelegate
      ? "Call delegate_agent only when a clearly separable subtask materially advances the parent task."
      : "Do not call delegate_agent.",
    ...(hasTeamTools
      ? [
        "Team worker: Use team_task_claim to claim tasks, team_message_send to report progress or ask questions, team_status_read to check team state. Acknowledge shutdown requests promptly via ack_team_shutdown.",
      ]
      : []),
    ...(profile.instructions?.trim()
      ? [`Profile instructions:\n${profile.instructions.trim()}`]
      : []),
    "Return a concise, factual result that a supervisor can use directly.",
  ].join("\n");
}

function resolveAllowedTools(
  profileName: string,
  agentProfiles: readonly AgentProfile[] | undefined,
  toolOwnerId?: string,
  options?: { allowMutation?: boolean },
): string[] {
  const profile = getAgentProfile(profileName, agentProfiles);
  if (!profile) return [];
  const allowed = profile.tools.filter((tool) => hasTool(tool, toolOwnerId));
  if (options?.allowMutation === false) {
    return allowed.filter((tool) => !isMutatingTool(tool, toolOwnerId));
  }
  return allowed;
}

/** Validate delegate_agent args and return parsed fields. */
function validateDelegateArgs(
  args: unknown,
  agentProfiles?: readonly AgentProfile[],
): {
  agent: string;
  task: string;
  record: Record<string, unknown>;
} & { profile: AgentProfile } {
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
        (agentProfiles ?? []).map((p) => p.name).join(", ")
      }`,
      "delegate_agent",
    );
  }
  const profile = getAgentProfile(agent, agentProfiles);
  if (!profile) {
    throw new ValidationError(
      `Unknown agent "${agent}". Available: ${
        (agentProfiles ?? []).map((p) => p.name).join(", ")
      }`,
      "delegate_agent",
    );
  }
  return { agent: profile.name, task, record, profile };
}

/** Run the delegate child loop (shared by sync and background paths). */

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
        if (
          entry.name.startsWith(CHILD_WORKSPACE_PREFIX) || entry.name === ".git"
        ) {
          continue;
        }
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

/** SHA-256 hash a string for lightweight conflict detection (avoids storing full file contents). */
export async function hashContent(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0"))
    .join("");
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

      // Real conflict detection: if we have a snapshot (hash) of the parent at
      // spawn time, hash the current parent and compare. If parent changed
      // since spawn, it's a true conflict (someone else modified the same file).
      if (parentSnapshots) {
        const spawnHash = parentSnapshots.get(relPath);
        try {
          const currentParent = await platform.fs.readTextFile(parentPath);
          const currentHash = await hashContent(currentParent);
          if (
            (spawnHash === undefined && currentParent.length >= 0) ||
            (spawnHash !== undefined && currentHash !== spawnHash)
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
        if (
          entry.name.startsWith(CHILD_WORKSPACE_PREFIX) || entry.name === ".git"
        ) {
          continue;
        }
        await walkDir(childPath, relPath);
        continue;
      }
      if (!entry.isFile) continue;
      try {
        const content = await platform.fs.readTextFile(childPath);
        snapshots.set(relPath, await hashContent(content));
      } catch {
        // Best-effort snapshot only
      }
    }
  }

  await walkDir(parentWorkspace, "");
  return snapshots;
}

async function runDelegateChild(
  llm: LLMFunction,
  baseConfig: Pick<OrchestratorConfig, "policy"> & {
    ownerId?: string;
    sessionId?: string | null;
    modelId?: string;
    fixturePath?: string;
    currentDepth?: number;
    maxDepth?: number;
    agentProfiles?: readonly AgentProfile[];
  },
  config: OrchestratorConfig,
  agent: string,
  task: string,
  record: Record<string, unknown>,
  signal?: AbortSignal,
  workspaceOverride?: string,
  inputQueue?: string[],
  onChildSessionId?: (childSessionId: string) => void,
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

  const isolatedWorkspace = workspaceOverride !== undefined;
  const allowedTools = resolveAllowedTools(
    agent,
    config.agentProfiles ?? baseConfig.agentProfiles,
    config.toolOwnerId,
    { allowMutation: isolatedWorkspace },
  );
  const profile = getAgentProfile(
    agent,
    config.agentProfiles ?? baseConfig.agentProfiles,
  );

  // ALWAYS create a fresh LLM for children — the parent LLM has onToken baked
  // in, which would leak child tokens into the parent's NDJSON response stream
  // and cause concurrent writes to the HTTP stream controller.
  let childLlm = llm;
  if (baseConfig.fixturePath) {
    childLlm = createFixtureLLM(await loadLlmFixture(baseConfig.fixturePath));
  } else {
    try {
      childLlm = getAgentEngine().createLLM({
        model: profile?.model ?? config.modelId ?? baseConfig.modelId,
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
      agentProfiles: config.agentProfiles ?? baseConfig.agentProfiles,
    }),
  });
  context.addMessage({
    role: "system",
    content: buildAgentSystemNote(
      profile ?? {
        name: agent,
        description: "",
        tools: allowedTools,
      },
      allowedTools,
      {
        canDelegate: !atMaxDepth,
        isolatedWorkspace,
      },
    ),
  });
  // Fork-with-history: copy parent non-system messages into child context
  if (record.fork_with_history === true) {
    for (const msg of config.context.getMessages()) {
      if (msg.role !== "system") {
        context.addMessage(msg);
      }
    }
  }
  const childTodoState = createTodoState();

  const childEvents: DelegateTranscriptEvent[] = [];
  const childTurn: PersistedAgentTurn | null = baseConfig.sessionId
    ? createPersistedAgentChildSession({
      parentSessionId: baseConfig.sessionId,
      agent,
      task,
    })
    : null;
  if (childTurn?.sessionId) {
    onChildSessionId?.(childTurn.sessionId);
  }
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
    toolCount: childEvents.filter((event) => event.type === "tool_end").length,
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
        permissionMode: config.permissionMode === "yolo"
          ? "default"
          : config.permissionMode,
        maxIterations: DELEGATE_MAX_ITERATIONS,
        totalTimeout: DELEGATE_TOTAL_TIMEOUT,
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
        sessionId: childTurn?.sessionId ?? undefined,
        toolAllowlist: allowedTools,
        toolDenylist: childDenylist,
        l1Confirmations: new Map<string, boolean>(),
        toolOwnerId: config.toolOwnerId,
        delegateOwnerId: baseConfig.ownerId,
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
        agentProfiles: config.agentProfiles ?? baseConfig.agentProfiles,
        delegateTokenBudget: profile?.maxTokenBudget
          ? createDelegateTokenBudget(profile.maxTokenBudget)
          : undefined,
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
    const message = getErrorMessage(error);
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
  const profile = getAgentProfile(agent, config.agentProfiles);
  const allowedTools = resolveAllowedTools(
    agent,
    config.agentProfiles,
    config.toolOwnerId,
    { allowMutation: false },
  );
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
      maxIterations: DELEGATE_MAX_ITERATIONS,
      totalTimeout: DELEGATE_TOTAL_TIMEOUT,
      maxToolCalls: config.maxToolCalls,
      groundingMode: config.groundingMode,
      policy: config.policy ?? null,
      sessionId: childSessionId,
      toolAllowlist: allowedTools,
      toolDenylist: CHILD_TOOL_DENYLIST,
      l1Confirmations: new Map<string, boolean>(),
      toolOwnerId: config.toolOwnerId,
      delegateOwnerId: config.delegateOwnerId,
      onInteraction: config.onInteraction,
      delegateInbox: createDelegateInbox(),
      planning: { mode: "off" },
      todoState: createTodoState(),
      signal: config.signal,
      teamRuntime: config.teamRuntime,
      teamMemberId: config.teamMemberId,
      teamLeadMemberId: config.teamLeadMemberId,
      agentProfiles: config.agentProfiles,
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
    ownerId?: string;
    sessionId?: string | null;
    modelId?: string;
    fixturePath?: string;
    currentDepth?: number;
    maxDepth?: number;
    agentProfiles?: readonly AgentProfile[];
    backgroundWatchdogMs?: number;
  },
): (args: unknown, config: OrchestratorConfig) => Promise<unknown> {
  return async (
    args: unknown,
    config: OrchestratorConfig,
  ): Promise<unknown> => {
    const { agent, task, record } = validateDelegateArgs(
      args,
      config.agentProfiles ?? baseConfig.agentProfiles,
    );
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
        artifacts: teamTask.artifacts,
      });
    };

    const buildTeamArtifacts = (input: {
      threadId?: string;
      childSessionId?: string;
      mergeState?: string;
      filesModified?: string[];
      workspaceKind?: string;
      sandboxCapability?: string;
      reviewTaskId?: string;
      reviewStatus?: "pending" | "approved" | "rejected";
      preferredProfile?: string;
      summary?: string;
    }): Record<string, unknown> => ({
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.childSessionId ? { childSessionId: input.childSessionId } : {}),
      ...(batchId ? { batchId } : {}),
      ...(input.mergeState ? { mergeState: input.mergeState } : {}),
      ...(input.filesModified?.length
        ? { filesModified: input.filesModified }
        : {}),
      ...(input.workspaceKind ? { workspaceKind: input.workspaceKind } : {}),
      ...(input.sandboxCapability
        ? { sandboxCapability: input.sandboxCapability }
        : {}),
      ...(input.reviewTaskId ? { reviewTaskId: input.reviewTaskId } : {}),
      ...(input.reviewStatus ? { reviewStatus: input.reviewStatus } : {}),
      ...(input.preferredProfile
        ? { preferredProfile: input.preferredProfile }
        : {}),
    });

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

    if (
      config.teamRuntime && teamMemberId &&
      !config.teamRuntime.getMember(teamMemberId)
    ) {
      const policy = config.teamRuntime.getPolicy();
      const activeWorkers = config.teamRuntime.listMembers().filter((member) =>
        member.role === "worker" && member.status !== "terminated"
      ).length;
      if (activeWorkers >= policy.maxMembers) {
        throw new ValidationError(
          `team member limit reached (${policy.maxMembers})`,
          "delegate_agent",
        );
      }
    }

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

    // Synchronous (foreground) path — child mutates the parent workspace directly.
    // ACCEPTED TRADEOFF: The parent's ReAct loop is blocked (awaiting) while the
    // foreground child runs, so no concurrent workspace mutations can occur.
    // This assumption breaks if the orchestrator is ever made concurrent or if
    // foreground delegates are fired in parallel (e.g., via Promise.all).
    // Background delegates MUST use workspace isolation (enforced above).
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
            artifacts: buildTeamArtifacts({
              childSessionId,
              preferredProfile: agent,
              summary: snapshot.finalResponse,
            }),
          });
          emitTeamTaskUpdated("completed");
        }
        if (config.teamRuntime && teamMemberId) {
          config.teamRuntime.updateMember(teamMemberId, {
            childSessionId,
            currentTaskId: undefined,
            status: "terminated",
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
            resultSummary: error instanceof Error
              ? error.message
              : String(error),
          });
          emitTeamTaskUpdated("errored");
        }
        if (config.teamRuntime && teamMemberId) {
          config.teamRuntime.updateMember(teamMemberId, {
            currentTaskId: undefined,
            status: "terminated",
          });
        }
        if (coordinationId && config.coordinationBoard) {
          const message = error instanceof Error
            ? error.message
            : String(error);
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
      // Start watchdog BEFORE acquire so it covers both queue wait + execution time.
      // Without this, queued delegates waiting for a slot have no timeout protection.
      let abortReason: string | undefined;
      const watchdogMs = baseConfig.backgroundWatchdogMs ??
        BACKGROUND_DELEGATE_WATCHDOG_MS;
      const watchdog = watchdogMs > 0
        ? setTimeout(() => {
          abortReason =
            `Background delegate lifetime exceeded after ${watchdogMs}ms`;
          controller.abort(abortReason);
        }, watchdogMs)
        : undefined;

      // release may be undefined if acquire rejects (e.g., watchdog aborts while queued)
      let release: (() => void) | undefined;
      let lease: WorkspaceLease | undefined;
      try {
        // Acquire concurrency slot (may queue if at capacity; watchdog aborts if stalled)
        release = await limiter.acquire(threadId, controller.signal);
        updateThreadStatus(threadId, "running");
        config.onAgentEvent?.({ type: "delegate_running", threadId });
        if (coordinationId && config.coordinationBoard) {
          config.coordinationBoard.updateItem(coordinationId, {
            status: "running",
          });
        }
        if (config.teamRuntime && teamTaskId) {
          config.teamRuntime.updateTask(teamTaskId, {
            status: "in_progress",
            delegateThreadId: threadId,
          });
          emitTeamTaskUpdated("in_progress");
        }

        // Create isolated workspace for this child agent
        lease = await createWorkspaceLease(config.workspace, threadId);
        updateThreadWorkspace(
          threadId,
          lease.path,
          lease.kind,
          lease.sandboxCapability,
          lease.cleanup,
        );

        try {
          updateThreadParentSnapshots(
            threadId,
            await snapshotWorkspaceFiles(config.workspace),
          );
        } catch {
          // Best-effort snapshotting only
        }
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
          (childSessionId) =>
            updateThreadChildSession(threadId, childSessionId),
        );
        if (controller.signal.aborted) {
          throw createAbortError(
            abortReason ?? "Tool execution aborted",
          );
        }
        // NOTE: updateThreadStatus("completed") is deferred to AFTER all side
        // effects (snapshot, diff, inbox push, result) so poll-based waiters
        // see a fully-populated thread when they detect the terminal status.
        if (snapshot) updateThreadSnapshot(threadId, snapshot);
        if (childSessionId) updateThreadChildSession(threadId, childSessionId);

        let diffResult:
          | { diff: string; filesModified: string[] }
          | null
          | undefined;

        // Generate diff of child changes for merge/apply
        if (lease) {
          try {
            diffResult = await generateChildDiff(
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
          const policy = config.teamRuntime.getPolicy();
          let reviewTaskId: string | undefined;
          let reviewStatus: "pending" | undefined;
          if (policy.reviewRequired && diffResult?.filesModified.length) {
            const reviewTask = config.teamRuntime.ensureTask({
              goal: `Review delegated changes: ${task}`,
              status: "pending",
              dependencies: [teamTaskId],
              artifacts: {
                reviewForTaskId: teamTaskId,
                delegateThreadId: threadId,
                preferredProfile: policy.reviewProfile,
              },
            });
            reviewTaskId = reviewTask.id;
            reviewStatus = "pending";
            config.onAgentEvent?.({
              type: "team_task_updated",
              taskId: reviewTask.id,
              goal: reviewTask.goal,
              status: reviewTask.status,
              assigneeMemberId: reviewTask.assigneeMemberId,
              artifacts: reviewTask.artifacts,
            });
          }
          config.teamRuntime.updateTask(teamTaskId, {
            status: "completed",
            delegateThreadId: threadId,
            resultSummary: snapshot.finalResponse,
            artifacts: buildTeamArtifacts({
              threadId,
              childSessionId,
              mergeState: diffResult?.filesModified.length ? "pending" : "none",
              filesModified: diffResult?.filesModified,
              workspaceKind: lease?.kind,
              sandboxCapability: lease?.sandboxCapability,
              reviewTaskId,
              reviewStatus,
              preferredProfile: agent,
              summary: snapshot.finalResponse,
            }),
          });
          emitTeamTaskUpdated("completed");
        }
        if (config.teamRuntime && teamMemberId) {
          config.teamRuntime.updateMember(teamMemberId, {
            childSessionId,
            currentTaskId: undefined,
            status: "terminated",
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
        updateThreadResult(threadId, { success: true, result, snapshot });
        updateThreadStatus(threadId, "completed");
        enqueueThreadCompletion(threadId);
        emitDelegateBatchProgress(config, batchId);

        return { success: true, result, snapshot };
      } catch (error) {
        const isAbort = controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError");
        const status = isAbort ? "cancelled" : "errored";
        // NOTE: updateThreadStatus deferred to after side effects (same as success path)
        const message = isAbort
          ? abortReason ?? getErrorMessage(error)
          : getErrorMessage(error);
        if (config.teamRuntime && teamTaskId) {
          config.teamRuntime.updateTask(teamTaskId, {
            status: isAbort ? "cancelled" : "errored",
            delegateThreadId: threadId,
            resultSummary: message,
          });
          emitTeamTaskUpdated(isAbort ? "cancelled" : "errored");
        }
        if (config.teamRuntime && teamMemberId) {
          config.teamRuntime.updateMember(teamMemberId, {
            currentTaskId: undefined,
            status: "terminated",
          });
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
          attentionRequired: true,
          attentionReason: `Worker "${nickname}" failed: ${
            truncate(message, 100)
          }`,
        });
        updateThreadResult(threadId, {
          success: false,
          error: message,
          snapshot,
        });
        updateThreadStatus(threadId, status);
        enqueueThreadCompletion(threadId);
        emitDelegateBatchProgress(config, batchId);

        return { success: false, error: message, snapshot };
      } finally {
        if (watchdog !== undefined) {
          clearTimeout(watchdog);
        }
        release?.();
        // Don't cleanup workspace yet — parent needs to merge first (Stage 4)
        // Cleanup happens on thread GC (cleanupCompletedThreads)
      }
    })();

    // Register thread as queued (will transition to running when slot acquired)
    registerThread({
      threadId,
      ownerId: baseConfig.ownerId,
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
    if (batchId) {
      config.onAgentEvent?.({
        type: "delegate_start",
        agent,
        task,
        threadId,
        nickname,
      });
    }
    emitDelegateBatchProgress(config, batchId);
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
      return null;
    case "reasoning_update":
      return {
        type: "reasoning",
        iteration: event.iteration,
        summary: event.summary,
      };
    case "planning_update":
      return {
        type: "planning",
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
