import { getHlvmTasksDir } from "../../../common/paths.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { invalidateReplLiveAgentSession } from "../repl-live-session-cache.ts";
import type {
  ToolExecutionOptions,
  ToolFunction,
  ToolMetadata,
} from "../registry.ts";
// getAllTools is dynamic-imported below to break the registry → agent-tool → registry cycle.
import type {
  AgentAsyncResult,
  AgentDefinition,
  AgentMcpServerSpec,
  AgentToolInput,
  AgentToolOutput,
  AgentToolResult,
  AgentToolUsage,
  BackgroundAgent,
  BackgroundAgentSnapshot,
} from "./agent-types.ts";
import { getAgentToolResultText, makeAgentTextBlocks } from "./agent-types.ts";
import { loadAgentDefinitions } from "./agent-definitions.ts";
import { loadMcpTools } from "../mcp/tools.ts";
import type { McpLoadResult, McpServerConfig } from "../mcp/types.ts";
import { type InheritedAgentConfig, runAgent } from "./run-agent.ts";
import { applyParentPermissions } from "./agent-tool-utils.ts";
import { TOOL_CATEGORY, ToolError } from "../error-taxonomy.ts";
import { TOOL_NAMES } from "../tool-names.ts";
import { insertMessage } from "../../store/conversation-store.ts";
import { pushSSEEvent } from "../../store/sse-store.ts";
import {
  cleanupWorktree,
  createAgentWorktree,
  type WorktreeInfo,
} from "./agent-worktree.ts";
import { getAgentLogger } from "../logger.ts";

const log = getAgentLogger();

interface AgentToolRuntimeState {
  backgroundAgents: Map<string, BackgroundAgent>;
  agentCounter: number;
  completionQueue: string[];
}

function getAgentToolRuntimeState(): AgentToolRuntimeState {
  const globalState = globalThis as typeof globalThis & {
    __hlvmAgentToolRuntimeState__?: AgentToolRuntimeState;
  };
  if (!globalState.__hlvmAgentToolRuntimeState__) {
    globalState.__hlvmAgentToolRuntimeState__ = {
      backgroundAgents: new Map<string, BackgroundAgent>(),
      agentCounter: 0,
      completionQueue: [],
    };
  }
  return globalState.__hlvmAgentToolRuntimeState__;
}

function buildAgentToolUsage(
  result: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens: number;
  },
): AgentToolUsage {
  const input = result.promptTokens ?? 0;
  const output = result.completionTokens ??
    Math.max(0, result.totalTokens - input);
  return {
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    server_tool_use: null,
    service_tier: null,
    cache_creation: null,
  };
}

function generateAgentId(): string {
  const state = getAgentToolRuntimeState();
  state.agentCounter += 1;
  return `agent-${state.agentCounter}-${Date.now().toString(36)}`;
}

function getInlineMcpServers(
  specs: readonly AgentMcpServerSpec[] | undefined,
): McpServerConfig[] {
  if (!specs?.length) return [];
  const inlineConfigs: McpServerConfig[] = [];
  for (const spec of specs) {
    if (typeof spec === "string") continue;
    const entries = Object.entries(spec);
    if (entries.length !== 1) continue;
    const [name, config] = entries[0]!;
    inlineConfigs.push({ name, ...config });
  }
  return inlineConfigs;
}

async function prepareAgentMcpRuntime(opts: {
  agentId: string;
  workspace: string;
  selectedAgent: AgentDefinition;
  options?: ToolExecutionOptions;
  inheritedConfig: InheritedAgentConfig;
}): Promise<{
  allTools: Record<string, ToolMetadata>;
  inheritedConfig: InheritedAgentConfig;
  cleanup: () => Promise<void>;
}> {
  const { agentId, workspace, selectedAgent, options, inheritedConfig } = opts;
  const { getAllTools } = await import("../registry.ts");

  if (!selectedAgent.mcpServers?.length) {
    return {
      allTools: getAllTools(options?.toolOwnerId),
      inheritedConfig,
      cleanup: async () => {},
    };
  }

  const inlineServers = getInlineMcpServers(selectedAgent.mcpServers);

  if (
    inlineServers.length === 0 && options?.ensureMcpLoaded &&
    options.toolOwnerId
  ) {
    await options.ensureMcpLoaded(options.signal);
    return {
      allTools: getAllTools(options.toolOwnerId),
      inheritedConfig: {
        ...inheritedConfig,
        toolOwnerId: options.toolOwnerId,
        ensureMcpLoaded: options.ensureMcpLoaded,
      },
      cleanup: async () => {},
    };
  }

  const ownerId = `agent:${agentId}`;
  const loadResult: McpLoadResult = await loadMcpTools(
    workspace,
    inlineServers.length > 0 ? inlineServers : undefined,
    ownerId,
    options?.signal,
  );

  return {
    allTools: getAllTools(loadResult.ownerId),
    inheritedConfig: {
      ...inheritedConfig,
      toolOwnerId: loadResult.ownerId,
      ensureMcpLoaded: async () => false,
    },
    cleanup: loadResult.dispose,
  };
}

export function getBackgroundAgentSnapshots(): BackgroundAgentSnapshot[] {
  return Array.from(getAgentToolRuntimeState().backgroundAgents.values()).map(
    (agent) => {
      const durationMs = agent.result?.totalDurationMs ??
        Math.max(0, Date.now() - agent.startTime);
      const previewLines = agent.result
        ? getAgentToolResultText(agent.result)
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .slice(0, 3)
        : agent.transcriptTail ?? [];
      return {
        agentId: agent.agentId,
        agentType: agent.agentType,
        description: agent.description,
        status: agent.status,
        cancelled: agent.cancelled,
        durationMs,
        toolUseCount: agent.result?.totalToolUseCount ?? agent.toolUseCount,
        tokenCount: agent.result?.totalTokens ?? agent.tokenCount,
        lastToolInfo: agent.lastToolInfo,
        previewLines,
        resultPreview: agent.result
          ? getAgentToolResultText(agent.result).slice(0, 200)
          : undefined,
        error: agent.error,
      };
    },
  );
}

export function cancelBackgroundAgent(agentId: string): boolean {
  const agent = getAgentToolRuntimeState().backgroundAgents.get(agentId);
  if (!agent || agent.status !== "running") return false;
  agent.cancelled = true;
  agent.lastToolInfo = "Cancelled by user";
  agent.transcriptTail = ["Cancelled by user"];
  agent.abortController.abort();
  agent.status = "errored";
  agent.error = "Cancelled by user";
  agent.onAgentEvent?.({
    type: "agent_complete",
    agentId,
    agentType: agent.agentType,
    success: false,
    cancelled: true,
    durationMs: Math.max(0, Date.now() - agent.startTime),
    toolUseCount: 0,
    resultPreview: "Cancelled by user",
  });
  return true;
}

export function drainCompletionNotifications(): string[] {
  const { completionQueue } = getAgentToolRuntimeState();
  if (completionQueue.length === 0) return [];
  const drained = [...completionQueue];
  completionQueue.length = 0;
  return drained;
}

function buildCompletionNotification(
  agentId: string,
  agentType: string,
  description: string,
  status: "completed" | "failed" | "killed",
  result?: string,
  error?: string,
): string {
  const summary = status === "completed"
    ? `Agent "${description}" completed`
    : status === "failed"
    ? `Agent "${description}" failed: ${error ?? "Unknown error"}`
    : `Agent "${description}" was stopped`;

  const resultSection = result ? `\n<result>${result}</result>` : "";
  return `A background agent completed a task:
<task-notification>
<agent-id>${agentId}</agent-id>
<agent-type>${agentType}</agent-type>
<status>${status}</status>
<summary>${summary}</summary>${resultSection}
</task-notification>`;
}

async function enqueueCompletionNotification(
  notification: string,
  sessionId?: string,
): Promise<void> {
  if (!sessionId) {
    getAgentToolRuntimeState().completionQueue.push(notification);
    return;
  }

  try {
    const message = insertMessage({
      session_id: sessionId,
      role: "user",
      content: notification,
      sender_type: "system",
      sender_detail: "task-notification",
    });
    invalidateReplLiveAgentSession(sessionId);
    pushSSEEvent(sessionId, "message_added", { message });
    pushSSEEvent(sessionId, "conversation_updated", { session_id: sessionId });
  } catch (error) {
    log.warn(
      `[Agent] Failed to persist background notification for session ${sessionId}: ${error}`,
    );
    getAgentToolRuntimeState().completionQueue.push(notification);
  }
}

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
    cwd,
  } = input;
  // LLMs sometimes emit boolean args as the string "true" — coerce at the boundary.
  const rawBackground: unknown = input.run_in_background;
  const run_in_background = rawBackground === true || rawBackground === "true";

  if (!prompt || typeof prompt !== "string") {
    throw new ToolError(
      "Agent tool requires a 'prompt' parameter",
      TOOL_NAMES.AGENT,
      TOOL_CATEGORY.VALIDATION,
    );
  }

  // Step 1: Load agent definitions
  const { activeAgents } = await loadAgentDefinitions();

  const effectiveType = subagent_type ?? "general-purpose";
  const selectedAgent = activeAgents.find(
    (a) => a.agentType === effectiveType,
  );

  if (!selectedAgent) {
    const available = activeAgents.map((a) => a.agentType).join(", ");
    throw new ToolError(
      `Agent type '${effectiveType}' not found. Available agents: ${available}`,
      TOOL_NAMES.AGENT,
      TOOL_CATEGORY.VALIDATION,
    );
  }

  // Step 3: Get LLM function from parent config
  // The LLM function is passed through ToolExecutionOptions
  const llmFunction = options?.llmFunction;
  if (!llmFunction) {
    throw new ToolError(
      "Agent tool requires llmFunction in ToolExecutionOptions. " +
        "This is an internal error — the orchestrator should provide it.",
      TOOL_NAMES.AGENT,
      TOOL_CATEGORY.INTERNAL,
    );
  }

  const agentId = generateAgentId();
  const baseInheritedConfig: InheritedAgentConfig = {
    contextBudget: options?.contextBudget,
    modelCapability: options?.modelCapability,
    onTrace: options?.onTrace,
    llmTimeout: options?.llmTimeout,
    toolTimeout: options?.toolTimeout,
    totalTimeout: options?.totalTimeout,
    permissionMode: selectedAgent.permissionMode ?? options?.permissionMode,
    agentProfiles: options?.agentProfiles,
    querySource: options?.querySource,
    thinkingCapable: options?.thinkingCapable,
    toolOwnerId: options?.toolOwnerId,
    ensureMcpLoaded: options?.ensureMcpLoaded,
    modelId: options?.modelId,
  };

  const trimmedCwd = typeof cwd === "string" && cwd.trim().length > 0
    ? cwd.trim()
    : undefined;

  const effectiveIsolation = isolation ?? selectedAgent.isolation;
  if (effectiveIsolation === "worktree" && trimmedCwd) {
    throw new ToolError(
      "cwd and isolation='worktree' are mutually exclusive",
      TOOL_NAMES.AGENT,
      TOOL_CATEGORY.VALIDATION,
    );
  }
  if (
    trimmedCwd &&
    !getPlatform().path.isAbsolute(trimmedCwd)
  ) {
    throw new ToolError(
      "Agent tool cwd must be an absolute path",
      TOOL_NAMES.AGENT,
      TOOL_CATEGORY.VALIDATION,
    );
  }
  let worktreeInfo: WorktreeInfo | null = null;

  if (effectiveIsolation === "worktree") {
    const slug = `agent-${agentId.slice(0, 16)}`;
    worktreeInfo = await createAgentWorktree(slug, workspace);
  }

  // Use worktree path as workspace override (CC: cwdOverridePath)
  const effectiveWorkspace = worktreeInfo?.worktreePath ?? trimmedCwd ??
    workspace;

  let allTools: Record<string, ToolMetadata> = {};
  let inheritedConfig: InheritedAgentConfig = baseInheritedConfig;
  let agentMcpCleanup: () => Promise<void> = async () => {};
  try {
    ({
      allTools,
      inheritedConfig,
      cleanup: agentMcpCleanup,
    } = await prepareAgentMcpRuntime({
      agentId,
      workspace: effectiveWorkspace,
      selectedAgent,
      options,
      inheritedConfig: baseInheritedConfig,
    }));
  } catch (error) {
    await cleanupWorktree(worktreeInfo);
    throw error;
  }

  allTools = applyParentPermissions(
    allTools,
    options?.toolAllowlist,
    options?.toolDenylist,
  );

  // Step 6: Route sync vs async (CC: shouldRunAsync logic)
  const shouldRunAsync = run_in_background === true ||
    selectedAgent.background === true;

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
      agentMcpCleanup,
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
    agentMcpCleanup,
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
  agentMcpCleanup?: () => Promise<void>;
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
    agentMcpCleanup,
  } = opts;

  log.info(
    `[Agent:${selectedAgent.agentType}] Sync spawn: "${description}"${
      worktreeInfo ? ` (worktree: ${worktreeInfo.worktreePath})` : ""
    }`,
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

    // Cleanup worktree / agent-scoped MCP on completion
    const worktreeResult = await cleanupWorktree(worktreeInfo ?? null);
    await agentMcpCleanup?.();

    return {
      status: "completed",
      agentId,
      agentType: result.agentType,
      prompt,
      content: makeAgentTextBlocks(result.text),
      totalDurationMs: result.durationMs,
      totalToolUseCount: result.toolUseCount,
      totalTokens: result.totalTokens,
      usage: buildAgentToolUsage(result),
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
    await agentMcpCleanup?.();
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
  agentMcpCleanup?: () => Promise<void>;
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
    agentMcpCleanup,
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
  const platform = getPlatform();
  const outputDir = getHlvmTasksDir();
  const outputFile = platform.path.join(outputDir, `${agentId}.output`);
  await platform.fs.ensureDir(outputDir);
  await platform.fs.writeTextFile(
    outputFile,
    `Agent "${description}" started.\nagentId: ${agentId}\nagentType: ${selectedAgent.agentType}\n\n`,
    { create: true },
  );
  let outputWriteChain = Promise.resolve();
  const appendOutput = (chunk: string): void => {
    outputWriteChain = outputWriteChain
      .then(() =>
        platform.fs.writeTextFile(outputFile, chunk, {
          append: true,
          create: true,
        })
      )
      .catch((error) => {
        log.warn(
          `[Agent:${selectedAgent.agentType}] Failed to append async output: ${error}`,
        );
      });
  };

  let resolvePromise!: (result: AgentToolResult) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<AgentToolResult>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const emitAgentEvent = (event: unknown): void => {
    const bg = getAgentToolRuntimeState().backgroundAgents.get(agentId);
    if (bg && typeof event === "object" && event !== null && "type" in event) {
      const typedEvent = event as {
        type: string;
        toolUseCount?: number;
        tokenCount?: number;
        lastToolInfo?: string;
      };
      if (typedEvent.type === "agent_progress") {
        bg.toolUseCount = typedEvent.toolUseCount;
        bg.tokenCount = typedEvent.tokenCount;
        bg.lastToolInfo = typedEvent.lastToolInfo;
      }
    }
    options?.onAgentEvent?.(event);
  };
  const appendTranscriptLine = (line: string): void => {
    appendOutput(`${line}\n`);
    const bg = getAgentToolRuntimeState().backgroundAgents.get(agentId);
    if (!bg) return;
    bg.transcriptTail = [...(bg.transcriptTail ?? []), line.trim()]
      .filter((entry) => entry.length > 0)
      .slice(-3);
  };

  const executeBackgroundAgent = async (): Promise<void> => {
    try {
      const result = await runAgent({
        agentDefinition: selectedAgent,
        prompt,
        workspace,
        llmFunction: llmFunction!,
        allTools,
        isAsync: true,
        modelOverride,
        agentId,
        signal: abortController.signal,
        onAgentEvent: emitAgentEvent,
        inheritedConfig,
        onTranscriptLine: (line) => {
          appendTranscriptLine(line);
        },
      });

      emitAgentEvent({
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
      appendOutput(
        `\nFinal response:\n${result.text}\n\n<usage>total_tokens: ${result.totalTokens}\ntool_uses: ${result.toolUseCount}\nduration_ms: ${result.durationMs}</usage>\n`,
      );
      await outputWriteChain;
      await cleanupWorktree(worktreeInfo ?? null);
      await agentMcpCleanup?.();

      const completedResult: AgentToolResult = {
        status: "completed",
        agentId,
        agentType: result.agentType,
        prompt,
        content: makeAgentTextBlocks(result.text),
        totalDurationMs: result.durationMs,
        totalToolUseCount: result.toolUseCount,
        totalTokens: result.totalTokens,
        usage: buildAgentToolUsage(result),
      };
      const bg = getAgentToolRuntimeState().backgroundAgents.get(agentId);
      if (bg) {
        bg.status = "completed";
        bg.result = completedResult;
      }

      await enqueueCompletionNotification(
        buildCompletionNotification(
          agentId,
          result.agentType,
          description,
          "completed",
          result.text,
        ),
        options?.sessionId,
      );

      resolvePromise(completedResult);
    } catch (err) {
      const bg = getAgentToolRuntimeState().backgroundAgents.get(agentId);
      const wasCancelled = bg?.cancelled === true;
      if (!wasCancelled) {
        emitAgentEvent({
          type: "agent_complete",
          agentId,
          agentType: selectedAgent.agentType,
          success: false,
          durationMs: 0,
          toolUseCount: 0,
          resultPreview: err instanceof Error ? err.message : String(err),
        });
      }
      appendOutput(
        wasCancelled
          ? "\nAgent stopped by user.\n"
          : `\nAgent failed: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
      );
      await outputWriteChain;
      await cleanupWorktree(worktreeInfo ?? null);
      await agentMcpCleanup?.();

      const errMsg = err instanceof Error ? err.message : String(err);
      if (bg) {
        bg.status = "errored";
        bg.error = errMsg;
      }

      await enqueueCompletionNotification(
        buildCompletionNotification(
          agentId,
          selectedAgent.agentType,
          description,
          wasCancelled ? "killed" : "failed",
          undefined,
          wasCancelled ? "Cancelled by user" : errMsg,
        ),
        options?.sessionId,
      );

      rejectPromise(err);
    }
  };

  // Register in background tracking (CC: registerAsyncAgent)
  getAgentToolRuntimeState().backgroundAgents.set(agentId, {
    agentId,
    agentType: selectedAgent.agentType,
    description,
    prompt,
    status: "running",
    startTime: Date.now(),
    promise,
    abortController,
    transcriptTail: [],
    cancelled: false,
    onAgentEvent: emitAgentEvent,
  });
  // Mark the promise as observed so failures don't become unhandled rejections
  // when the caller launches and moves on.
  void promise.catch(() => {});
  // Run on the next task tick so the background child is detached from the
  // parent request's tool call and any provider/runtime teardown tied to it.
  setTimeout(() => {
    void executeBackgroundAgent();
  }, 0);

  const canReadOutputFile = "read_file" in allTools ||
    "shell_exec" in allTools;

  return {
    status: "async_launched",
    agentId,
    description,
    prompt,
    outputFile,
    canReadOutputFile,
  };
}

// Tool metadata for registry is exported from agent-tool-metadata.ts
// (single source of truth to avoid a circular dep through registry.ts).
