/**
 * Agent Tool — Main Dispatcher
 *
 * CC source: tools/AgentTool/AgentTool.tsx
 * The single entry point for spawning sub-agents.
 *
 * Flow (CC-faithful):
 * 1. Parse input (prompt, subagent_type, run_in_background, isolation)
 * 2. Resolve agent definition (built-in or custom .md)
 * 3. Build system prompt
 * 4. Assemble tool pool for child
 * 5. Route to sync or async execution
 * 6. Return result
 */

import type { ToolMetadata, ToolFunction, ToolExecutionOptions } from "../registry.ts";
// NOTE: getAllTools is imported dynamically to break circular dep
// (registry.ts → agent-tool.ts → registry.ts)
import type {
  AgentDefinition,
  AgentToolInput,
  AgentToolOutput,
  AgentToolResult,
  AgentAsyncResult,
  BackgroundAgent,
} from "./agent-types.ts";
import { loadAgentDefinitions } from "./agent-definitions.ts";
import { AGENT_TOOL_NAME } from "./agent-constants.ts";
import {
  getAgentToolFallbackDescription,
  AGENT_TOOL_ARGS,
  resolveAgentToolDescription,
} from "./agent-tool-spec.ts";
import { runAgent, type InheritedAgentConfig } from "./run-agent.ts";
import {
  createAgentWorktree,
  cleanupWorktree,
  type WorktreeInfo,
  type WorktreeResult,
} from "./agent-worktree.ts";
import { getAgentLogger } from "../logger.ts";
// Side-effect: registers getBackgroundAgentEntries on globalThis for TUI access
import "./agent-local-agents.ts";

const log = getAgentLogger();

// ============================================================
// Background Agent Registry (CC: LocalAgentTask)
// ============================================================

const backgroundAgents = new Map<string, BackgroundAgent>();
let agentCounter = 0;

/**
 * Completion notification queue.
 * CC: enqueuePendingNotification → commandQueue → drained by query loop.
 * HLVM: simpler — queue of notification strings, drained by orchestrator.
 */
const completionQueue: string[] = [];

function generateAgentId(): string {
  return `agent-${++agentCounter}-${Date.now().toString(36)}`;
}

/** Get a background agent by ID */
export function getBackgroundAgent(agentId: string): BackgroundAgent | undefined {
  return backgroundAgents.get(agentId);
}

/** Get all background agents */
export function getAllBackgroundAgents(): BackgroundAgent[] {
  return Array.from(backgroundAgents.values());
}

/** Cancel a background agent */
export function cancelBackgroundAgent(agentId: string): boolean {
  const agent = backgroundAgents.get(agentId);
  if (!agent || agent.status !== "running") return false;
  agent.abortController.abort();
  agent.status = "errored";
  agent.error = "Cancelled by user";
  return true;
}

/**
 * Drain all pending completion notifications.
 * CC: query.ts drains commandQueue each turn, filters by 'task-notification' mode.
 * HLVM: orchestrator calls this before each LLM call.
 *
 * Returns notification messages to inject into parent context.
 * Each is a user-role message: "A background agent completed a task:\n<result>..."
 */
export function drainCompletionNotifications(): string[] {
  if (completionQueue.length === 0) return [];
  const drained = [...completionQueue];
  completionQueue.length = 0;
  return drained;
}

/**
 * Build a completion notification message.
 * CC: enqueueAgentNotification wraps result in <task-notification> XML.
 * HLVM: simpler format, same content.
 */
function buildCompletionNotification(
  agentId: string,
  agentType: string,
  description: string,
  status: "completed" | "failed" | "killed",
  result?: string,
  error?: string,
): string {
  const summary =
    status === "completed"
      ? `Agent "${description}" completed`
      : status === "failed"
        ? `Agent "${description}" failed: ${error ?? "Unknown error"}`
        : `Agent "${description}" was stopped`;

  // CC format: <task-notification> XML
  const resultSection = result ? `\n<result>${result}</result>` : "";
  return `A background agent completed a task:
<task-notification>
<agent-id>${agentId}</agent-id>
<agent-type>${agentType}</agent-type>
<status>${status}</status>
<summary>${summary}</summary>${resultSection}
</task-notification>`;
}

// ============================================================
// Agent Tool Function (CC: AgentTool.call())
// ============================================================

/**
 * The main Agent tool function.
 * CC: AgentTool.call() — stripped of React, fork, coordinator, remote.
 *
 * Sync path: blocks parent, returns result directly
 * Async path: fire-and-forget, returns agentId immediately
 */
/**
 * Entry point called by agent-tool-metadata.ts via dynamic import.
 * This is the actual implementation; the metadata file holds the tool schema.
 */
export async function executeAgentTool(
  args: unknown,
  workspace: string,
  options?: unknown,
): Promise<unknown> {
  return agentToolFn(args, workspace, options as ToolExecutionOptions);
}

const agentToolFn: ToolFunction = async (
  args: unknown,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<AgentToolOutput> => {
  const input = args as AgentToolInput;
  const {
    description = "Agent task",
    prompt,
    subagent_type,
    model,
    isolation,
  } = input;
  // LLM may send run_in_background as string "true" — coerce to boolean
  const run_in_background = input.run_in_background === true ||
    input.run_in_background === "true" as unknown as boolean;

  if (!prompt || typeof prompt !== "string") {
    throw new Error("Agent tool requires a 'prompt' parameter");
  }

  // Step 1: Load agent definitions
  const { activeAgents } = await loadAgentDefinitions(workspace);

  // Step 2: Resolve agent definition (CC: agent lookup logic)
  const effectiveType = subagent_type ?? "general-purpose";
  const selectedAgent = activeAgents.find(
    (a) => a.agentType === effectiveType,
  );

  if (!selectedAgent) {
    const available = activeAgents.map((a) => a.agentType).join(", ");
    throw new Error(
      `Agent type '${effectiveType}' not found. Available agents: ${available}`,
    );
  }

  // Step 3: Get all tools for the child agent
  // Dynamic import to break circular dep (CC: same pattern in AgentTool.tsx)
  const { getAllTools } = await import("../registry.ts");
  const allTools = getAllTools();

  // Step 4: Get LLM function from parent config
  // The LLM function is passed through ToolExecutionOptions
  const llmFunction = options?.llmFunction;
  if (!llmFunction) {
    throw new Error(
      "Agent tool requires llmFunction in ToolExecutionOptions. " +
        "This is an internal error — the orchestrator should provide it.",
    );
  }

  const agentId = generateAgentId();
  const inheritedConfig: InheritedAgentConfig = {
    contextBudget: options?.contextBudget,
    policy: options?.policy ?? null,
    modelTier: options?.modelTier,
    onTrace: options?.onTrace,
    llmTimeout: options?.llmTimeout,
    toolTimeout: options?.toolTimeout,
    totalTimeout: options?.totalTimeout,
    permissionMode: selectedAgent.permissionMode ?? options?.permissionMode,
    instructions: options?.instructions,
    hookRuntime: options?.hookRuntime,
    agentProfiles: options?.agentProfiles,
    querySource: options?.querySource,
    thinkingCapable: options?.thinkingCapable,
    toolOwnerId: options?.toolOwnerId,
    ensureMcpLoaded: options?.ensureMcpLoaded,
    modelId: options?.modelId,
  };

  // Step 5: Create worktree if isolation requested (CC: effectiveIsolation)
  const effectiveIsolation = isolation ?? selectedAgent.isolation;
  let worktreeInfo: WorktreeInfo | null = null;

  if (effectiveIsolation === "worktree") {
    const slug = `agent-${agentId.slice(0, 16)}`;
    worktreeInfo = await createAgentWorktree(slug, workspace);
  }

  // Use worktree path as workspace override (CC: cwdOverridePath)
  const effectiveWorkspace = worktreeInfo?.worktreePath ?? workspace;

  // Step 6: Route sync vs async (CC: shouldRunAsync logic)
  const shouldRunAsync =
    run_in_background === true || selectedAgent.background === true;

  if (shouldRunAsync) {
    return runAsyncAgent({
      agentId,
      selectedAgent,
      prompt,
      description,
      workspace: effectiveWorkspace,
      allTools,
      llmFunction,
      options,
      worktreeInfo,
      modelOverride: model,
      inheritedConfig,
    });
  }

  return runSyncAgent({
    agentId,
    selectedAgent,
    prompt,
    description,
    workspace: effectiveWorkspace,
    allTools,
    llmFunction,
    options,
    worktreeInfo,
    modelOverride: model,
    inheritedConfig,
  });
};

// ============================================================
// Sync Execution (CC: sync path in call())
// ============================================================

async function runSyncAgent(opts: {
  agentId: string;
  selectedAgent: AgentDefinition;
  prompt: string;
  description: string;
  workspace: string;
  allTools: Record<string, ToolMetadata>;
  llmFunction: ToolExecutionOptions["llmFunction"];
  options?: ToolExecutionOptions;
  worktreeInfo?: WorktreeInfo | null;
  modelOverride?: string;
  inheritedConfig?: InheritedAgentConfig;
}): Promise<AgentToolResult> {
  const {
    agentId,
    selectedAgent,
    prompt,
    description,
    workspace,
    allTools,
    llmFunction,
    options,
    worktreeInfo,
    modelOverride,
    inheritedConfig,
  } = opts;

  log.info(
    `[Agent:${selectedAgent.agentType}] Sync spawn: "${description}"${worktreeInfo ? ` (worktree: ${worktreeInfo.worktreePath})` : ""}`,
  );

  // CC: emit agent_spawn event for TUI rendering
  options?.onAgentEvent?.({
    type: "agent_spawn",
    agentId,
    agentType: selectedAgent.agentType,
    description,
    isAsync: false,
  });

  try {
    const result = await runAgent({
      agentDefinition: selectedAgent,
      prompt,
      workspace,
      llmFunction: llmFunction!,
      allTools,
      isAsync: false,
      modelOverride,
      agentId,
      signal: options?.signal,
      onAgentEvent: options?.onAgentEvent,
      inheritedConfig,
    });

    // CC: emit agent_complete event for TUI rendering
    options?.onAgentEvent?.({
      type: "agent_complete",
      agentId,
      agentType: result.agentType,
      success: true,
      durationMs: result.durationMs,
      toolUseCount: result.toolUseCount,
      totalTokens: result.totalTokens,
      resultPreview: result.text.slice(0, 200),
      transcript: result.transcript,
    });

    // Cleanup worktree (CC: cleanupWorktreeIfNeeded in finally block)
    const worktreeResult = await cleanupWorktree(worktreeInfo ?? null);

    return {
      status: "completed",
      agentId,
      agentType: result.agentType,
      content: result.text,
      totalDurationMs: result.durationMs,
      totalToolUseCount: result.toolUseCount,
      ...worktreeResult,
    };
  } catch (err) {
    options?.onAgentEvent?.({
      type: "agent_complete",
      agentId,
      agentType: selectedAgent.agentType,
      success: false,
      durationMs: 0,
      toolUseCount: 0,
      resultPreview: err instanceof Error ? err.message : String(err),
    });
    // Cleanup on error too
    await cleanupWorktree(worktreeInfo ?? null);
    throw err;
  }
}

// ============================================================
// Async Execution (CC: async path in call())
// ============================================================

async function runAsyncAgent(opts: {
  agentId: string;
  selectedAgent: AgentDefinition;
  prompt: string;
  description: string;
  workspace: string;
  allTools: Record<string, ToolMetadata>;
  llmFunction: ToolExecutionOptions["llmFunction"];
  options?: ToolExecutionOptions;
  worktreeInfo?: WorktreeInfo | null;
  modelOverride?: string;
  inheritedConfig?: InheritedAgentConfig;
}): Promise<AgentAsyncResult> {
  const {
    agentId,
    selectedAgent,
    prompt,
    description,
    workspace,
    allTools,
    llmFunction,
    options,
    worktreeInfo,
    modelOverride,
    inheritedConfig,
  } = opts;

  log.info(
    `[Agent:${selectedAgent.agentType}] Async spawn: "${description}"`,
  );

  // CC: emit agent_spawn event for TUI rendering
  options?.onAgentEvent?.({
    type: "agent_spawn",
    agentId,
    agentType: selectedAgent.agentType,
    description,
    isAsync: true,
  });

  const abortController = new AbortController();

  // Fire-and-forget (CC: void runAsyncAgentLifecycle)
  const promise = runAgent({
    agentDefinition: selectedAgent,
    prompt,
    workspace,
    llmFunction: llmFunction!,
    allTools,
    isAsync: true,
    modelOverride,
    agentId,
    signal: abortController.signal,
    onAgentEvent: options?.onAgentEvent,
    inheritedConfig,
  }).then(async (result) => {
    options?.onAgentEvent?.({
      type: "agent_complete",
      agentId,
      agentType: result.agentType,
      success: true,
      durationMs: result.durationMs,
      toolUseCount: result.toolUseCount,
      totalTokens: result.totalTokens,
      resultPreview: result.text.slice(0, 200),
      transcript: result.transcript,
    });
    // Cleanup worktree on completion (CC: getWorktreeResult in runAsyncAgentLifecycle)
    await cleanupWorktree(worktreeInfo ?? null);

    // Update background agent status on completion
    const bg = backgroundAgents.get(agentId);
    if (bg) {
      bg.status = "completed";
      bg.result = {
        status: "completed",
        agentId,
        agentType: result.agentType,
        content: result.text,
        totalDurationMs: result.durationMs,
        totalToolUseCount: result.toolUseCount,
      };
    }

    // CC: enqueueAgentNotification → parent sees result on next turn
    completionQueue.push(
      buildCompletionNotification(
        agentId,
        result.agentType,
        description,
        "completed",
        result.text,
      ),
    );

    return bg?.result ?? {
      status: "completed" as const,
      agentId,
      agentType: result.agentType,
      content: result.text,
      totalDurationMs: result.durationMs,
      totalToolUseCount: result.toolUseCount,
    };
  }).catch(async (err) => {
    options?.onAgentEvent?.({
      type: "agent_complete",
      agentId,
      agentType: selectedAgent.agentType,
      success: false,
      durationMs: 0,
      toolUseCount: 0,
      resultPreview: err instanceof Error ? err.message : String(err),
    });
    // Cleanup worktree on error too
    await cleanupWorktree(worktreeInfo ?? null);

    const errMsg = err instanceof Error ? err.message : String(err);
    const bg = backgroundAgents.get(agentId);
    if (bg) {
      bg.status = "errored";
      bg.error = errMsg;
    }

    // CC: enqueueAgentNotification on error too
    completionQueue.push(
      buildCompletionNotification(
        agentId,
        selectedAgent.agentType,
        description,
        "failed",
        undefined,
        errMsg,
      ),
    );

    throw err;
  });

  // Register in background tracking (CC: registerAsyncAgent)
  backgroundAgents.set(agentId, {
    agentId,
    agentType: selectedAgent.agentType,
    description,
    prompt,
    status: "running",
    startTime: Date.now(),
    promise,
    abortController,
  });

  // Return immediately (CC: async_launched)
  return {
    status: "async_launched",
    agentId,
    description,
    prompt,
  };
}

// ============================================================
// Tool Metadata Export (for registry.ts)
// ============================================================

/**
 * The Agent tool metadata for registration in the tool registry.
 * This is the HLVM equivalent of CC's AgentTool class.
 */
export const AGENT_TOOL: Record<string, ToolMetadata> = {
  [AGENT_TOOL_NAME]: {
    fn: agentToolFn,
    description: getAgentToolFallbackDescription(),
    resolveDescription: ({ workspace } = {}) =>
      resolveAgentToolDescription(workspace),
    args: AGENT_TOOL_ARGS,
    safetyLevel: "L0",
    category: "meta",
    loading: { exposure: "eager" },
    presentation: { kind: "meta" },
  },
};
