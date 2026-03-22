/**
 * Tool execution: single call, batch parallel/sequential, timeout handling.
 * Extracted from orchestrator.ts for modularity.
 */

import {
  getTool,
  normalizeToolName,
  prepareToolArgsForExecution,
  searchTools,
  suggestToolNames,
  type ToolExecutionOptions,
  type ToolFunction,
} from "./registry.ts";
import type { ModelTier } from "./constants.ts";
import { checkToolSafety, isMutatingTool } from "./security/safety.ts";
import { classifyShellCommand } from "./security/shell-classifier.ts";
import { DEFAULT_TIMEOUTS, RATE_LIMITS } from "./constants.ts";
import { withTimeout } from "../../common/timeout-utils.ts";
import { SlidingWindowRateLimiter } from "../../common/rate-limiter.ts";
import {
  getErrorMessage,
  isObjectValue,
  truncate,
} from "../../common/utils.ts";
import { RuntimeError } from "../../common/error.ts";
import { getAgentLogger } from "./logger.ts";
import type { AgentPolicy } from "./policy.ts";
import { isPlanExecutionMode } from "./execution-mode.ts";
import { normalizeToolArgs } from "./validation.ts";
import type { ToolCall } from "./tool-call.ts";
import {
  ensurePlaywrightChromium,
  isPlaywrightMissingError,
} from "./playwright-support.ts";
import type { AgentUIEvent, MemoryActivityEntry, OrchestratorConfig } from "./orchestrator.ts";
import type { ToolExecutionResult } from "./orchestrator-state.ts";
import { createRateLimiter } from "./orchestrator-state.ts";
import {
  buildIsToolAllowed,
  buildToolErrorResult,
  buildToolResultOutputs,
  emitToolSuccess,
  generateArgsSummary,
  isRenderToolName,
  sanitizeArgs,
} from "./orchestrator-tool-formatting.ts";
import { getDelegateTranscriptSnapshot } from "./delegate-transcript.ts";
import {
  cancelThread,
  getThreadForOwner,
  resolveResumableThread,
} from "./delegate-threads.ts";
import { ConcurrencyLimiter } from "./concurrency.ts";
import {
  addBatchSpawnFailure,
  addBatchThread,
  getBatchSnapshot,
  registerBatch,
} from "./delegate-batches.ts";
import { buildEditFileRecovery } from "./error-taxonomy.ts";
import { resolveToolPath } from "./path-utils.ts";
import { getPlatform } from "../../platform/platform.ts";
import {
  createProcessAbortHandler,
  readProcessStream,
} from "../../common/stream-utils.ts";
import { parse as parseCsv } from "jsr:@std/csv/parse";
import { emitDelegateBatchProgress } from "./delegate-batch-progress.ts";
import type { WriteVerificationResult } from "./lsp-diagnostics.ts";
import {
  normalizeWebCapabilitySelectors,
  projectToolSearchResultsForWebCapabilities,
  type ResolvedProviderExecutionPlan,
  resolveProviderExecutionPlan,
} from "./tool-capabilities.ts";

const CHECKPOINT_SUPPORTED_MUTATION_TOOLS = new Set([
  "write_file",
  "edit_file",
  "archive_files",
]);

function supportsAutomaticCheckpoint(toolName: string): boolean {
  return CHECKPOINT_SUPPORTED_MUTATION_TOOLS.has(toolName);
}

function buildPlanReviewCancelledResult(
  toolCall: ToolCall,
  startedAt: number,
  config: OrchestratorConfig,
  message = "Plan review was cancelled before mutation.",
): ToolExecutionResult {
  const result = buildToolErrorResult(
    toolCall.toolName,
    message,
    startedAt,
    config,
    toolCall.id,
  );
  result.stopReason = "plan_review_cancelled";
  return result;
}

export function getToolTimeoutMs(
  toolName: string,
  configuredTimeout?: number,
): number {
  if (toolName === "ask_user") {
    return DEFAULT_TIMEOUTS.userInput;
  }
  return configuredTimeout ?? DEFAULT_TIMEOUTS.tool;
}

function emitTeamTaskUpdated(
  config: OrchestratorConfig,
  task: {
    id: string;
    goal: string;
    status: string;
    assigneeMemberId?: string;
    artifacts?: Record<string, unknown>;
  } | undefined,
): void {
  if (!task) return;
  config.onAgentEvent?.({
    type: "team_task_updated",
    taskId: task.id,
    goal: task.goal,
    status: task.status,
    assigneeMemberId: task.assigneeMemberId,
    artifacts: task.artifacts,
  });
}

function emitTeamMessages(
  config: OrchestratorConfig,
  messages:
    | Array<{
      kind: string;
      fromMemberId: string;
      toMemberId?: string;
      relatedTaskId?: string;
      content: string;
    }>
    | undefined,
): void {
  if (!messages?.length) return;
  for (const message of messages) {
    config.onAgentEvent?.({
      type: "team_message",
      kind: message.kind,
      fromMemberId: message.fromMemberId,
      toMemberId: message.toMemberId,
      relatedTaskId: message.relatedTaskId,
      contentPreview: truncate(message.content, 120),
    });
  }
}

/** DRY: Resolve team member/task IDs for a delegate thread and build delegate args. */
function buildDelegateResumeArgs(
  config: OrchestratorConfig,
  agent: string,
  task: string,
  childSessionId: string,
  threadId: string,
): Record<string, unknown> {
  const resumeMemberId = config.teamRuntime?.getMemberByThread(threadId)?.id;
  const resumeTaskId = resumeMemberId
    ? config.teamRuntime?.getMember(resumeMemberId)?.currentTaskId
    : undefined;
  return {
    agent,
    task,
    _resumeSessionId: childSessionId,
    ...(resumeTaskId ? { _teamTaskId: resumeTaskId } : {}),
    ...(resumeMemberId ? { _teamMemberId: resumeMemberId } : {}),
  };
}

async function coerceBatchRows(
  args: Record<string, unknown>,
  workspace: string,
): Promise<Record<string, unknown>[]> {
  const data = args.data;
  if (Array.isArray(data)) {
    return data.filter((row): row is Record<string, unknown> =>
      !!row && typeof row === "object" && !Array.isArray(row)
    );
  }
  let csvText = "";
  if (typeof data === "string") {
    csvText = data;
  } else if (typeof args.csv_path === "string" && args.csv_path) {
    const platform = getPlatform();
    const csvPath = platform.path.isAbsolute(args.csv_path)
      ? args.csv_path
      : platform.path.join(workspace, args.csv_path);
    csvText = await platform.fs.readTextFile(csvPath);
  }
  if (!csvText.trim()) return [];
  const parsedRows = parseCsv(csvText);
  if (!Array.isArray(parsedRows) || parsedRows.length === 0) return [];
  const [headerRow, ...valueRows] = parsedRows;
  if (!Array.isArray(headerRow)) return [];
  const headers = headerRow.map((value) => String(value));
  return valueRows
    .filter((row): row is string[] => Array.isArray(row))
    .map((row) =>
      Object.fromEntries(
        headers.map((header, index) => [header, row[index] ?? ""]),
      )
    );
}

/**
 * Execute tool with timeout
 */
async function executeToolWithTimeout(
  toolFn: ToolFunction,
  args: unknown,
  workspace: string,
  timeout: number,
  policy?: AgentPolicy | null,
  onInteraction?: OrchestratorConfig["onInteraction"],
  toolOwnerId?: string,
  ensureMcpLoaded?: () => Promise<void>,
  todoState?: OrchestratorConfig["todoState"],
  modelId?: string,
  modelTier?: ModelTier,
  parentSignal?: AbortSignal,
  teamRuntime?: OrchestratorConfig["teamRuntime"],
  teamMemberId?: string,
  teamLeadMemberId?: string,
  delegateOwnerId?: string,
  sessionId?: string,
  currentUserRequest?: string,
  toolAllowlist?: string[],
  toolDenylist?: string[],
  providerExecutionPlan?: ResolvedProviderExecutionPlan,
  hookRuntime?: OrchestratorConfig["hookRuntime"],
  onAgentEvent?: OrchestratorConfig["onAgentEvent"],
  agentProfiles?: OrchestratorConfig["agentProfiles"],
  instructions?: OrchestratorConfig["instructions"],
): Promise<unknown> {
  return await withTimeout(
    async (signal) => {
      const toolOptions: ToolExecutionOptions = {
        signal,
        modelId,
        modelTier,
        policy,
        onInteraction,
        toolOwnerId,
        delegateOwnerId,
        ensureMcpLoaded,
        todoState,
        searchTools: (query, options) =>
          projectToolSearchResultsForWebCapabilities(
            searchTools(query, {
              ...options,
              allowlist: normalizeWebCapabilitySelectors(
                options?.allowlist ?? toolAllowlist,
              ),
              denylist: normalizeWebCapabilitySelectors(
                options?.denylist ?? toolDenylist,
              ),
              ownerId: options?.ownerId ?? toolOwnerId,
            }),
            providerExecutionPlan,
          ),
        teamRuntime,
        teamMemberId,
        teamLeadMemberId,
        sessionId,
        currentUserRequest,
        hookRuntime,
        onAgentEvent,
        agentProfiles,
        instructions,
      };
      const result = await toolFn(args, workspace, toolOptions);
      if (signal.aborted) {
        throw new RuntimeError("Tool execution aborted");
      }
      return result;
    },
    { timeoutMs: timeout, label: "Tool execution", signal: parentSignal },
  );
}

function getStructuredFailureMessage(result: unknown): string | undefined {
  if (!isObjectValue(result) || result.success !== false) return undefined;
  if (typeof result.message === "string" && result.message.trim().length > 0) {
    return result.message;
  }
  if (typeof result.error === "string" && result.error.trim().length > 0) {
    return result.error;
  }
  return undefined;
}

async function maybeBuildEditFileRecoveryResult(
  toolCall: ToolCall,
  args: unknown,
  result: unknown,
  config: OrchestratorConfig,
): Promise<import("./error-taxonomy.ts").EditFileRecovery | undefined> {
  if (toolCall.toolName !== "edit_file") return undefined;

  const errorMessage = getStructuredFailureMessage(result);
  const argRecord = isObjectValue(args) ? args : null;
  const path = typeof argRecord?.path === "string" ? argRecord.path : undefined;
  const find = typeof argRecord?.find === "string" ? argRecord.find : undefined;
  if (!errorMessage || !path || !find) return undefined;

  try {
    const resolvedPath = await resolveToolPath(
      path,
      config.workspace,
      config.policy ?? null,
    );
    const fileContent = await getPlatform().fs.readTextFile(resolvedPath);
    return buildEditFileRecovery({ path, find }, errorMessage, fileContent) ??
      undefined;
  } catch {
    return undefined;
  }
}

function buildEditFileAutoRetryArgs(
  args: unknown,
  recovery: import("./error-taxonomy.ts").EditFileRecovery | undefined,
): Record<string, unknown> | null {
  if (!recovery?.closestCurrentLine || !isObjectValue(args)) return null;

  const find = typeof args.find === "string" ? args.find : undefined;
  const replace = typeof args.replace === "string" ? args.replace : undefined;
  const mode = typeof args.mode === "string" ? args.mode : undefined;
  if (!find || mode === "regex") return null;
  if (find.includes("\n") || find.includes("\r")) return null;

  const nextFind = recovery.closestCurrentLine.trim();
  if (!nextFind || nextFind === find.trim()) return null;
  if (replace && nextFind === replace.trim()) return null;

  return {
    ...args,
    find: recovery.closestCurrentLine,
  };
}

/**
 * Execute single tool call
 */
export async function executeToolCall(
  toolCall: ToolCall,
  config: OrchestratorConfig,
  toolIndex = 0,
  toolTotal = 1,
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  const l1Store = config.l1Confirmations ?? new Map<string, boolean>();

  // Lazy MCP bootstrap: defer MCP connect+registration until a tool call needs it.
  if (
    config.ensureMcpLoaded &&
    (toolCall.toolName.startsWith("mcp_") ||
      toolCall.toolName === "tool_search")
  ) {
    await config.ensureMcpLoaded();
  }

  // Normalize tool name (handle camelCase, casing, separators)
  const resolvedName =
    normalizeToolName(toolCall.toolName, config.toolOwnerId) ??
      toolCall.toolName;
  if (resolvedName !== toolCall.toolName) {
    getAgentLogger().debug(
      `Tool name normalized: ${toolCall.toolName} → ${resolvedName}`,
    );
    toolCall = { ...toolCall, toolName: resolvedName };
  }

  const normalizedArgs = sanitizeArgs(normalizeToolArgs(toolCall.args));
  let preparedArgs: ReturnType<typeof prepareToolArgsForExecution> | undefined;
  try {
    preparedArgs = prepareToolArgsForExecution(
      toolCall.toolName,
      normalizedArgs,
      config.toolOwnerId,
    );
  } catch {
    // Tool not found — handled below
  }
  const toolExists = preparedArgs !== undefined;
  const coercedArgs = preparedArgs?.coercedArgs ?? normalizedArgs;
  await config.hookRuntime?.dispatch("pre_tool", {
    toolName: toolCall.toolName,
    toolCallId: toolCall.id,
    modelId: config.modelId,
    sessionId: config.sessionId,
    args: coercedArgs,
    argsSummary: generateArgsSummary(toolCall.toolName, coercedArgs),
    toolIndex,
    toolTotal,
  });
  // Emit trace event: tool call
  config.onTrace?.({
    type: "tool_call",
    toolName: toolCall.toolName,
    toolCallId: toolCall.id,
    args: coercedArgs,
  });
  config.onAgentEvent?.({
    type: "tool_start",
    name: toolCall.toolName,
    argsSummary: generateArgsSummary(toolCall.toolName, coercedArgs),
    toolIndex,
    toolTotal,
  });

  try {
    // Validate tool exists
    if (!toolExists) {
      const suggestions = suggestToolNames(
        toolCall.toolName,
        config.toolOwnerId,
      );
      const hint = suggestions.length > 0
        ? ` Did you mean: ${suggestions.join(", ")}?`
        : "";
      return buildToolErrorResult(
        toolCall.toolName,
        `Unknown tool: ${toolCall.toolName}.${hint}`,
        startedAt,
        config,
        toolCall.id,
      );
    }

    const isToolAllowed = buildIsToolAllowed(config);
    if (!isToolAllowed(toolCall.toolName)) {
      return buildToolErrorResult(
        toolCall.toolName,
        `Tool not allowed by orchestrator: ${toolCall.toolName}`,
        startedAt,
        config,
        toolCall.id,
      );
    }

    const validation = preparedArgs?.validation ?? { valid: true };
    if (!validation.valid) {
      const details = (validation.errors ?? []).join("; ");
      return buildToolErrorResult(
        toolCall.toolName,
        `Invalid arguments for ${toolCall.toolName}: ${details}`,
        startedAt,
        config,
        toolCall.id,
      );
    }

    if (
      toolCall.toolName === "ask_user" &&
      config.planModeState?.active &&
      config.planModeState.phase === "executing"
    ) {
      return buildToolErrorResult(
        toolCall.toolName,
        "Approved plan execution should not ask new clarifying questions. Continue with best effort, or finish with a concise blocker summary instead.",
        startedAt,
        config,
        toolCall.id,
      );
    }

    const mutatingTool = isMutatingTool(
      toolCall.toolName,
      config.toolOwnerId,
      toolCall.args,
    );
    if (mutatingTool && isPlanExecutionMode(config.permissionMode)) {
      return buildToolErrorResult(
        toolCall.toolName,
        "Plan mode does not allow mutating tools. Inspect the workspace, refine the plan, or ask the user to leave plan mode before editing.",
        startedAt,
        config,
        toolCall.id,
      );
    }
    if (
      mutatingTool &&
      config.planReview?.shouldGateMutatingTools() &&
      config.planReview.getCurrentPlan()
    ) {
      const plan = config.planReview.getCurrentPlan();
      if (plan) {
        try {
          const reviewDecision = await config.planReview.ensureApproved(plan);
          if (reviewDecision !== "approved") {
            return buildPlanReviewCancelledResult(
              toolCall,
              startedAt,
              config,
            );
          }
        } catch (error) {
          return buildPlanReviewCancelledResult(
            toolCall,
            startedAt,
            config,
            `Plan review failed before mutation: ${
              truncate(getErrorMessage(error), 120)
            }`,
          );
        }
      }
    }

    const safetyWarning = mutatingTool &&
        !supportsAutomaticCheckpoint(toolCall.toolName)
      ? "Automatic rollback is not available for this mutation."
      : undefined;

    // Check safety
    const permissionMode = config.permissionMode === "yolo"
      ? "yolo"
      : config.permissionMode === "auto-edit"
      ? "auto-edit"
      : "default";
    const approved = await checkToolSafety(
      toolCall.toolName,
      coercedArgs,
      permissionMode,
      config.policy ?? null,
      l1Store,
      config.toolOwnerId,
      config.onInteraction,
      safetyWarning,
    );

    if (!approved) {
      return buildToolErrorResult(
        toolCall.toolName,
        `Tool execution denied by user: ${toolCall.toolName}`,
        startedAt,
        config,
        toolCall.id,
      );
    }

    if (toolCall.toolName === "delegate_agent" && config.delegate) {
      const delegateArgsRecord = coercedArgs as {
        agent?: unknown;
        task?: unknown;
        background?: unknown;
      };
      const delegateAgent = typeof delegateArgsRecord.agent === "string"
        ? delegateArgsRecord.agent
        : "unknown";
      const delegateTask = typeof delegateArgsRecord.task === "string"
        ? delegateArgsRecord.task
        : "";
      const isBackground = delegateArgsRecord.background === true;

      // Emit delegate_start only for foreground delegates.
      // Background delegates emit delegate_start after handler returns with threadId.
      if (!isBackground) {
        config.onAgentEvent?.({
          type: "delegate_start",
          agent: delegateAgent,
          task: delegateTask,
        });
      }
      try {
        const coordinationId = config.coordinationBoard
          ? crypto.randomUUID()
          : undefined;
        const teamTaskId = config.teamRuntime
          ? (
            typeof (coercedArgs as Record<string, unknown>).task_id === "string"
              ? (coercedArgs as Record<string, unknown>).task_id as string
              : crypto.randomUUID()
          )
          : undefined;
        const teamMemberId = config.teamRuntime
          ? crypto.randomUUID()
          : undefined;
        const delegateArgs = {
          ...(coercedArgs as Record<string, unknown>),
          ...(coordinationId ? { _coordinationId: coordinationId } : {}),
          ...(teamTaskId ? { _teamTaskId: teamTaskId } : {}),
          ...(teamMemberId ? { _teamMemberId: teamMemberId } : {}),
        };
        const result = await config.delegate(delegateArgs, config);
        const { llmContent, summaryDisplay, returnDisplay } =
          buildToolResultOutputs(toolCall.toolName, result, config);

        if (isBackground && result && typeof result === "object") {
          // Background delegate: handler returned immediately with threadId.
          // Emit single delegate_start with thread info for UI.
          // delegate_end will be emitted async when the background promise completes.
          const bgResult = result as Record<string, unknown>;
          const threadId = typeof bgResult.threadId === "string"
            ? bgResult.threadId
            : undefined;
          const nickname = typeof bgResult.nickname === "string"
            ? bgResult.nickname
            : undefined;
          if (threadId) {
            config.onAgentEvent?.({
              type: "delegate_start",
              agent: delegateAgent,
              task: delegateTask,
              threadId,
              nickname,
            });
          }
        } else {
          // Foreground delegate: emit delegate_end immediately
          const snapshot = getDelegateTranscriptSnapshot(result);
          config.onAgentEvent?.({
            type: "delegate_end",
            agent: delegateAgent,
            task: delegateTask,
            success: true,
            summary: summaryDisplay,
            durationMs: Date.now() - startedAt,
            snapshot,
            childSessionId: snapshot?.childSessionId,
          });
        }

        emitToolSuccess(
          config,
          toolCall.toolName,
          toolCall.id,
          llmContent,
          summaryDisplay,
          returnDisplay,
          startedAt,
          coercedArgs,
          result,
        );
        return {
          success: true,
          result,
          llmContent,
          summaryDisplay,
          returnDisplay,
        };
      } catch (error) {
        const errorSnapshot = getDelegateTranscriptSnapshot(error);
        config.onAgentEvent?.({
          type: "delegate_end",
          agent: delegateAgent,
          task: delegateTask,
          success: false,
          error: getErrorMessage(error),
          durationMs: Date.now() - startedAt,
          snapshot: errorSnapshot,
          childSessionId: errorSnapshot?.childSessionId,
        });
        throw error;
      }
    }

    // interrupt_agent: stop the active turn and immediately resume with new instructions
    if (toolCall.toolName === "interrupt_agent" && config.delegate) {
      const interruptArgs = coercedArgs as Record<string, unknown>;
      const interruptThreadId = typeof interruptArgs.thread_id === "string"
        ? interruptArgs.thread_id
        : "";
      const interruptPrompt = typeof interruptArgs.message === "string"
        ? interruptArgs.message
        : "";
      if (!interruptThreadId || !interruptPrompt) {
        return buildToolErrorResult(
          toolCall.toolName,
          "interrupt_agent requires { thread_id, message }",
          startedAt,
          config,
          toolCall.id,
        );
      }
      const thread = getThreadForOwner(
        interruptThreadId,
        config.delegateOwnerId,
      );
      if (!thread) {
        return buildToolErrorResult(
          toolCall.toolName,
          `No thread found with ID "${interruptThreadId}"`,
          startedAt,
          config,
          toolCall.id,
        );
      }
      if (thread.status !== "running") {
        return buildToolErrorResult(
          toolCall.toolName,
          `Thread "${thread.nickname}" is ${thread.status} — only running threads can be interrupted`,
          startedAt,
          config,
          toolCall.id,
        );
      }
      if (!thread.childSessionId) {
        return buildToolErrorResult(
          toolCall.toolName,
          `Thread "${thread.nickname}" does not yet have a resumable child session`,
          startedAt,
          config,
          toolCall.id,
        );
      }
      cancelThread(interruptThreadId);
      try {
        await thread.promise;
      } catch {
        // Cancellation is expected here.
      }
      try {
        const result = await config.delegate(
          buildDelegateResumeArgs(
            config,
            thread.agent,
            interruptPrompt,
            thread.childSessionId,
            interruptThreadId,
          ),
          config,
        );
        const { llmContent, summaryDisplay, returnDisplay } =
          buildToolResultOutputs(toolCall.toolName, result, config);
        emitToolSuccess(
          config,
          toolCall.toolName,
          toolCall.id,
          llmContent,
          summaryDisplay,
          returnDisplay,
          startedAt,
          coercedArgs,
        );
        return {
          success: true,
          result,
          llmContent,
          summaryDisplay,
          returnDisplay,
        };
      } catch (error) {
        return buildToolErrorResult(
          toolCall.toolName,
          getErrorMessage(error),
          startedAt,
          config,
          toolCall.id,
        );
      }
    }

    // resume_agent: validate thread, then route through config.delegate with _resume flag
    if (toolCall.toolName === "resume_agent" && config.delegate) {
      const resumeArgs = coercedArgs as Record<string, unknown>;
      const resumeThreadId = typeof resumeArgs.thread_id === "string"
        ? resumeArgs.thread_id
        : "";
      const resumePrompt = typeof resumeArgs.prompt === "string"
        ? resumeArgs.prompt
        : "";
      if (!resumeThreadId || !resumePrompt) {
        return buildToolErrorResult(
          toolCall.toolName,
          "resume_agent requires { thread_id, prompt }",
          startedAt,
          config,
          toolCall.id,
        );
      }
      const { thread, error } = resolveResumableThread(
        resumeThreadId,
        config.delegateOwnerId,
      );
      if (!thread || error) {
        return buildToolErrorResult(
          toolCall.toolName,
          error ?? `No thread found with ID "${resumeThreadId}"`,
          startedAt,
          config,
          toolCall.id,
        );
      }
      try {
        // Route through delegate handler with _resume marker.
        // The handler detects _resumeSessionId and calls resumeDelegateChild.
        const result = await config.delegate(
          buildDelegateResumeArgs(
            config,
            thread.agent,
            resumePrompt,
            thread.childSessionId!,
            resumeThreadId,
          ),
          config,
        );
        const { llmContent, summaryDisplay, returnDisplay } =
          buildToolResultOutputs(toolCall.toolName, result, config);
        emitToolSuccess(
          config,
          toolCall.toolName,
          toolCall.id,
          llmContent,
          summaryDisplay,
          returnDisplay,
          startedAt,
          coercedArgs,
        );
        return {
          success: true,
          result,
          llmContent,
          summaryDisplay,
          returnDisplay,
        };
      } catch (error) {
        return buildToolErrorResult(
          toolCall.toolName,
          getErrorMessage(error),
          startedAt,
          config,
          toolCall.id,
        );
      }
    }

    // batch_delegate: fan-out delegation to multiple agents
    if (toolCall.toolName === "batch_delegate" && config.delegate) {
      const batchArgs = coercedArgs as Record<string, unknown>;
      const agent = typeof batchArgs.agent === "string" ? batchArgs.agent : "";
      const taskTemplate = typeof batchArgs.task_template === "string"
        ? batchArgs.task_template
        : "";
      const data = await coerceBatchRows(batchArgs, config.workspace);
      const maxConcurrency = typeof batchArgs.max_concurrency === "number"
        ? batchArgs.max_concurrency
        : undefined;

      if (!agent || !taskTemplate || data.length === 0) {
        const errorMsg =
          "batch_delegate requires { agent, task_template, data[] | csv_path | CSV string }";
        return buildToolErrorResult(
          toolCall.toolName,
          errorMsg,
          startedAt,
          config,
          toolCall.id,
        );
      }
      if (
        config.teamRuntime &&
        !config.teamRuntime.getPolicy().allowBatchDelegation
      ) {
        return buildToolErrorResult(
          toolCall.toolName,
          "batch delegation is disabled by the current team policy",
          startedAt,
          config,
          toolCall.id,
        );
      }

      const batchId = crypto.randomUUID();
      const threadIds: string[] = [];
      registerBatch(batchId, agent, data.length);

      // Per-batch concurrency limiter (defaults to 4 if not specified)
      const batchLimiter = maxConcurrency
        ? new ConcurrencyLimiter(maxConcurrency)
        : undefined;

      const spawnOne = async (row: unknown): Promise<void> => {
        const release = batchLimiter
          ? await batchLimiter.acquire(batchId)
          : undefined;
        try {
          let task = taskTemplate;
          if (row && typeof row === "object") {
            for (
              const [key, value] of Object.entries(
                row as Record<string, unknown>,
              )
            ) {
              task = task.replaceAll(`{{${key}}}`, String(value));
            }
          }
          const coordinationId = config.coordinationBoard
            ? crypto.randomUUID()
            : undefined;
          const teamTaskId = config.teamRuntime
            ? crypto.randomUUID()
            : undefined;
          const teamMemberId = config.teamRuntime
            ? crypto.randomUUID()
            : undefined;
          const result = await config.delegate!(
            {
              agent,
              task,
              background: true,
              _batchId: batchId,
              ...(coordinationId ? { _coordinationId: coordinationId } : {}),
              ...(teamTaskId ? { _teamTaskId: teamTaskId } : {}),
              ...(teamMemberId ? { _teamMemberId: teamMemberId } : {}),
            },
            config,
          );
          if (result && typeof result === "object") {
            const bgResult = result as Record<string, unknown>;
            if (typeof bgResult.threadId === "string") {
              threadIds.push(bgResult.threadId);
              addBatchThread(batchId, bgResult.threadId);
            } else {
              addBatchSpawnFailure(batchId);
            }
          }
        } catch {
          // Individual spawn failure — continue with rest
          addBatchSpawnFailure(batchId);
        } finally {
          release?.();
        }
      };

      // Spawn all concurrently, gated by the per-batch limiter
      await Promise.all(data.map((row) => spawnOne(row)));

      const snapshot = getBatchSnapshot(batchId);
      const batchResult = snapshot ? { ...snapshot, threadIds } : {
        batchId,
        totalRows: data.length,
        spawned: threadIds.length,
        threadIds,
        status: "running",
      };
      emitDelegateBatchProgress(config, snapshot);
      const { llmContent, summaryDisplay, returnDisplay } =
        buildToolResultOutputs(toolCall.toolName, batchResult, config);
      emitToolSuccess(
        config,
        toolCall.toolName,
        toolCall.id,
        llmContent,
        summaryDisplay,
        returnDisplay,
        startedAt,
        coercedArgs,
        batchResult,
      );
      return {
        success: true,
        result: batchResult,
        llmContent,
        summaryDisplay,
        returnDisplay,
      };
    }

    // Execute tool (with timeout)
    const tool = getTool(toolCall.toolName, config.toolOwnerId);
    const toolTimeout = getToolTimeoutMs(toolCall.toolName, config.toolTimeout);
    const currentToolAllowlist = config.toolFilterState?.allowlist ??
      config.toolAllowlist;
    const currentToolDenylist = config.toolFilterState?.denylist ??
      config.toolDenylist;
    const providerExecutionPlan = config.providerExecutionPlan ??
      resolveProviderExecutionPlan({
        providerName: "ollama",
        allowlist: currentToolAllowlist,
        denylist: currentToolDenylist,
      });
    const runTool = (args: unknown = coercedArgs) =>
      executeToolWithTimeout(
        tool.fn,
        args,
        config.workspace,
        toolTimeout,
        config.policy ?? null,
        config.onInteraction,
        config.toolOwnerId,
        config.ensureMcpLoaded,
        config.todoState,
        config.modelId,
        config.modelTier,
        config.signal,
        config.teamRuntime,
        config.teamMemberId,
        config.teamLeadMemberId,
        config.delegateOwnerId,
        config.sessionId,
        config.currentUserRequest,
        currentToolAllowlist,
        currentToolDenylist,
        providerExecutionPlan,
        config.hookRuntime,
        config.onAgentEvent,
        config.agentProfiles,
        config.instructions,
      );
    let result: unknown;
    try {
      result = await runTool();
    } catch (error) {
      const message = getErrorMessage(error);
      if (
        !isRenderToolName(toolCall.toolName) ||
        !isPlaywrightMissingError(message) ||
        !await ensurePlaywrightChromium(config)
      ) {
        return buildToolErrorResult(
          toolCall.toolName,
          message,
          startedAt,
          config,
          toolCall.id,
        );
      }
      result = await runTool();
    }

    let executedArgs = coercedArgs;
    let recovery = await maybeBuildEditFileRecoveryResult(
      toolCall,
      executedArgs,
      result,
      config,
    );
    const retryArgs = buildEditFileAutoRetryArgs(executedArgs, recovery);
    if (retryArgs) {
      const retriedResult = await runTool(retryArgs);
      if (isSuccessfulToolPayload(retriedResult)) {
        result = retriedResult;
        executedArgs = retryArgs;
        recovery = undefined;
      }
    }

    if (isFileWriteTool(toolCall.toolName) && isSuccessfulToolPayload(result)) {
      const verification = await maybeVerifyWrite(toolCall, config);
      if (verification) {
        await config.hookRuntime?.dispatch("write_verified", {
          toolName: toolCall.toolName,
          toolCallId: toolCall.id,
          modelId: config.modelId,
          sessionId: config.sessionId,
          path: typeof toolCall.args?.path === "string"
            ? toolCall.args.path
            : undefined,
          ok: verification.ok,
          source: verification.source,
          verifier: verification.verifier,
          summary: verification.summary,
          diagnostics: verification.diagnostics,
        });
        result = attachWriteVerification(result, verification);
      }
    }

    const { llmContent, summaryDisplay, returnDisplay } =
      buildToolResultOutputs(
        toolCall.toolName,
        result,
        config,
      );
    if (
      toolCall.toolName === "report_result" &&
      config.coordinationBoard &&
      config.delegateCoordinationId &&
      result &&
      typeof result === "object"
    ) {
      const report = result as Record<string, unknown>;
      config.coordinationBoard.updateItem(config.delegateCoordinationId, {
        resultSummary: typeof report.summary === "string"
          ? report.summary
          : undefined,
        artifacts: report,
      });
    }

    if (
      toolCall.toolName === "report_result" &&
      config.teamRuntime &&
      config.teamMemberId &&
      result &&
      typeof result === "object"
    ) {
      const currentTaskId = config.teamRuntime.getMember(config.teamMemberId)
        ?.currentTaskId;
      if (currentTaskId) {
        const report = result as Record<string, unknown>;
        const task = config.teamRuntime.updateTask(currentTaskId, {
          resultSummary: typeof report.summary === "string"
            ? report.summary
            : undefined,
          artifacts: report,
        });
        emitTeamTaskUpdated(config, task);
        const reviewForTaskId = task?.artifacts &&
            typeof task.artifacts.reviewForTaskId === "string"
          ? task.artifacts.reviewForTaskId
          : undefined;
        const reportData = report.data && typeof report.data === "object"
          ? report.data as Record<string, unknown>
          : undefined;
        const approved = reportData?.approved === true
          ? "approved"
          : reportData?.approved === false
          ? "rejected"
          : undefined;
        if (reviewForTaskId && approved) {
          const reviewTarget = config.teamRuntime.getTask(reviewForTaskId);
          const nextArtifacts = {
            ...(reviewTarget?.artifacts ?? {}),
            reviewStatus: approved,
            reviewFeedback: typeof report.summary === "string"
              ? report.summary
              : undefined,
          };
          const updatedTarget = config.teamRuntime.updateTask(reviewForTaskId, {
            artifacts: nextArtifacts,
          });
          emitTeamTaskUpdated(config, updatedTarget);
        }
      }
    }

    emitToolSuccess(
      config,
      toolCall.toolName,
      toolCall.id,
      llmContent,
      summaryDisplay,
      returnDisplay,
      startedAt,
      executedArgs,
      result,
    );

    if (toolCall.toolName.startsWith("memory_")) {
      const activity = buildMemoryActivityEvent(toolCall, result);
      if (activity) config.onAgentEvent?.(activity);
    }

    if (toolCall.toolName === "todo_write" && config.todoState) {
      config.onAgentEvent?.({
        type: "todo_updated",
        todoState: {
          items: config.todoState.items.map((item) => ({ ...item })),
        },
        source: "tool",
      });
    }

    if (
      (toolCall.toolName === "team_task_write" ||
        toolCall.toolName === "team_task_claim") &&
      result &&
      typeof result === "object" &&
      "task" in result
    ) {
      const task = (result as {
        task?: {
          id: string;
          goal: string;
          status: string;
          assigneeMemberId?: string;
        };
      }).task;
      emitTeamTaskUpdated(config, task);
    }

    if (
      toolCall.toolName === "team_message_send" && result &&
      typeof result === "object"
    ) {
      emitTeamMessages(
        config,
        (result as {
          messages?: Array<{
            kind: string;
            fromMemberId: string;
            toMemberId?: string;
            relatedTaskId?: string;
            content: string;
          }>;
        }).messages,
      );
    }

    if (
      toolCall.toolName === "submit_team_plan" &&
      config.teamRuntime &&
      result &&
      typeof result === "object" &&
      "approval" in result
    ) {
      const approval = (result as {
        approval?: {
          id: string;
          taskId: string;
          submittedByMemberId: string;
          note?: string;
        };
      }).approval;
      if (approval) {
        const task = config.teamRuntime.updateTask(approval.taskId, {
          approvalId: approval.id,
          status: "blocked",
        });
        emitTeamTaskUpdated(config, task);
        emitTeamMessages(
          config,
          config.teamRuntime.sendMessage({
            fromMemberId: approval.submittedByMemberId,
            toMemberId: config.teamRuntime.leadMemberId,
            kind: "approval_request",
            content: approval.note?.trim().length
              ? approval.note
              : `Plan review requested for task ${approval.taskId}`,
            relatedTaskId: approval.taskId,
          }),
        );
        config.onAgentEvent?.({
          type: "team_plan_review_required",
          approvalId: approval.id,
          taskId: approval.taskId,
          submittedByMemberId: approval.submittedByMemberId,
        });
      }
    }

    if (
      toolCall.toolName === "review_team_plan" &&
      config.teamRuntime &&
      result &&
      typeof result === "object" &&
      "approval" in result
    ) {
      const approval = (result as {
        approval?: {
          id: string;
          taskId: string;
          submittedByMemberId: string;
          reviewedByMemberId?: string;
          approved: boolean;
          status: "approved" | "rejected";
          feedback?: string;
        };
      }).approval;
      if (approval) {
        const approved = approval.status === "approved";
        const task = config.teamRuntime.updateTask(approval.taskId, {
          approvalId: approval.id,
          status: approved ? "in_progress" : "pending",
          resultSummary: approval.feedback,
        });
        emitTeamTaskUpdated(config, task);
        emitTeamMessages(
          config,
          config.teamRuntime.sendMessage({
            fromMemberId: approval.reviewedByMemberId ??
              config.teamRuntime.leadMemberId,
            toMemberId: approval.submittedByMemberId,
            kind: "approval_response",
            content: approval.feedback?.trim().length
              ? approval.feedback
              : approved
              ? `Plan approved for task ${approval.taskId}`
              : `Plan rejected for task ${approval.taskId}`,
            relatedTaskId: approval.taskId,
          }),
        );
        config.onAgentEvent?.({
          type: "team_plan_review_resolved",
          approvalId: approval.id,
          taskId: approval.taskId,
          submittedByMemberId: approval.submittedByMemberId,
          approved,
          reviewedByMemberId: approval.reviewedByMemberId,
        });
      }
    }

    if (
      toolCall.toolName === "request_team_shutdown" &&
      result &&
      typeof result === "object" &&
      "shutdown" in result
    ) {
      const shutdown = (result as {
        shutdown?: {
          id: string;
          memberId: string;
          requestedByMemberId: string;
          reason?: string;
        };
      }).shutdown;
      if (shutdown) {
        config.onAgentEvent?.({
          type: "team_shutdown_requested",
          requestId: shutdown.id,
          memberId: shutdown.memberId,
          requestedByMemberId: shutdown.requestedByMemberId,
          reason: shutdown.reason,
        });
      }
    }

    if (
      toolCall.toolName === "ack_team_shutdown" &&
      config.teamRuntime &&
      result &&
      typeof result === "object" &&
      "shutdown" in result
    ) {
      const shutdown = (result as {
        shutdown?: {
          id: string;
          memberId: string;
          requestedByMemberId: string;
        };
      }).shutdown;
      if (shutdown) {
        emitTeamMessages(
          config,
          config.teamRuntime.sendMessage({
            fromMemberId: shutdown.memberId,
            toMemberId: shutdown.requestedByMemberId,
            kind: "shutdown_ack",
            content: `Shutdown acknowledged by ${shutdown.memberId}`,
          }),
        );
        config.onAgentEvent?.({
          type: "team_shutdown_resolved",
          requestId: shutdown.id,
          memberId: shutdown.memberId,
          requestedByMemberId: shutdown.requestedByMemberId,
          status: "acknowledged",
        });
      }
    }

    return {
      success: true,
      result,
      llmContent,
      summaryDisplay,
      returnDisplay,
      recovery,
    };
  } catch (error) {
    return buildToolErrorResult(
      toolCall.toolName,
      getErrorMessage(error),
      startedAt,
      config,
      toolCall.id,
    );
  }
}

// ============================================================
// Auto-verify: syntax check after file writes
// ============================================================

const FILE_WRITE_TOOLS = new Set(["write_file", "edit_file"]);
const DENO_CONFIG_FILES = ["deno.json", "deno.jsonc"] as const;

export function isFileWriteTool(name: string): boolean {
  return FILE_WRITE_TOOLS.has(name);
}

const SYNTAX_CHECKER_TIMEOUT = 5000; // 5s — syntax checks should be fast

interface SyntaxVerificationResult {
  ok: boolean;
  source: "syntax";
  verifier: string;
  summary: string;
  diagnostics?: string;
}

function isSuccessfulToolPayload(result: unknown): boolean {
  return !isObjectValue(result) || result.success !== false;
}

function appendSentence(base: string, sentence: string): string {
  const normalized = base.trim();
  if (!normalized) return sentence;
  return /[.!?]$/.test(normalized)
    ? `${normalized} ${sentence}`
    : `${normalized}. ${sentence}`;
}

function attachWriteVerification(
  result: unknown,
  verification: WriteVerificationResult,
): unknown {
  if (!isObjectValue(result) || result.success !== true) return result;

  const message = typeof result.message === "string"
    ? result.message
    : "File operation completed";
  return {
    ...result,
    message: appendSentence(message, verification.summary),
    verification: {
      ok: verification.ok,
      source: verification.source,
      verifier: verification.verifier,
      diagnostics: verification.diagnostics,
    },
    ...(verification.source === "syntax"
      ? {
        syntaxCheck: {
          ok: verification.ok,
          command: verification.verifier,
          diagnostics: verification.diagnostics,
        },
      }
      : {}),
  };
}

async function resolveSyntaxCheckCommand(
  filePath: string,
  workspace: string,
): Promise<string[] | null> {
  const platform = getPlatform();
  const ext = platform.path.extname(filePath).toLowerCase();

  if (ext === ".ts" || ext === ".tsx") {
    for (const configName of DENO_CONFIG_FILES) {
      if (await platform.fs.exists(platform.path.join(workspace, configName))) {
        return ["deno", "check", filePath];
      }
    }
    return ["tsc", "--noEmit", "--pretty", "false", filePath];
  }
  if (ext === ".py") {
    return ["python3", "-m", "py_compile", filePath];
  }
  if (ext === ".js" || ext === ".jsx") {
    return ["node", "--check", filePath];
  }
  return null;
}

function describeSyntaxVerifier(cmd: string[]): string {
  if (cmd[0] === "deno" && cmd[1] === "check") return "deno check";
  if (cmd[0] === "tsc" && cmd.includes("--noEmit")) return "tsc --noEmit";
  if (cmd[0] === "node" && cmd[1] === "--check") return "node --check";
  if (
    cmd[0] === "python3" &&
    cmd[1] === "-m" &&
    cmd[2] === "py_compile"
  ) {
    return "python3 -m py_compile";
  }
  return cmd.join(" ");
}

/** Run a quick syntax check after a file write. Returns diagnostic info or null. */
export async function maybeVerifySyntax(
  toolCall: ToolCall,
  config: OrchestratorConfig,
): Promise<SyntaxVerificationResult | null> {
  const filePath = toolCall.args?.path;
  if (typeof filePath !== "string") return null;

  const platform = getPlatform();
  const workspace = config.workspace;
  const cmd = await resolveSyntaxCheckCommand(filePath, workspace);
  if (!cmd) return null;

  const verifier = describeSyntaxVerifier(cmd);
  if (classifyShellCommand(verifier).level === "L2") {
    return null;
  }

  try {
    const process = platform.command.run({
      cmd,
      cwd: workspace,
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    });

    const abortController = new AbortController();
    const streamSignal = config.signal
      ? AbortSignal.any([config.signal, abortController.signal])
      : abortController.signal;
    const abortHandler = createProcessAbortHandler(process, platform.build.os);
    let timedOut = false;

    const abortProcess = (): void => {
      abortController.abort();
      abortHandler.abort();
    };
    if (config.signal) {
      config.signal.addEventListener("abort", abortProcess, { once: true });
    }
    const timeoutId = setTimeout(() => {
      timedOut = true;
      abortProcess();
    }, SYNTAX_CHECKER_TIMEOUT);

    try {
      const [stdoutBytes, stderrBytes, status] = await Promise.all([
        readProcessStream(process.stdout, streamSignal),
        readProcessStream(process.stderr, streamSignal),
        process.status,
      ]);

      if (timedOut || config.signal?.aborted) {
        return null;
      }

      if (status.code !== 0) {
        const diag = new TextDecoder()
          .decode(stderrBytes.length > 0 ? stderrBytes : stdoutBytes)
          .trim();
        return {
          ok: false,
          source: "syntax",
          verifier,
          summary: `Syntax check failed via ${verifier}.`,
          diagnostics: truncate(diag, 500),
        };
      }

      return {
        ok: true,
        source: "syntax",
        verifier,
        summary: `Syntax check passed via ${verifier}.`,
      };
    } finally {
      clearTimeout(timeoutId);
      abortHandler.clear();
      if (config.signal) {
        config.signal.removeEventListener("abort", abortProcess);
      }
    }
  } catch {
    return null; // checker not available or timed out — don't block
  }
}

/** Try LSP diagnostics first, then fall back to one-shot syntax verification. */
export async function maybeVerifyWrite(
  toolCall: ToolCall,
  config: OrchestratorConfig,
): Promise<WriteVerificationResult | null> {
  const filePath = toolCall.args?.path;
  if (typeof filePath !== "string") return null;

  const lspVerification = await config.lspDiagnostics?.verifyFile(
    filePath,
    config.signal,
  );
  if (lspVerification) return lspVerification;

  return await maybeVerifySyntax(toolCall, config);
}

// ============================================================
// Memory tool event builder
// ============================================================

function buildMemoryActivityEvent(
  toolCall: ToolCall,
  result: unknown,
): Extract<AgentUIEvent, { type: "memory_activity" }> | null {
  if (toolCall.toolName === "memory_write" && result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    const text = truncate(String(r.content ?? r.message ?? ""), 120);
    const factId = typeof r.factId === "number" ? r.factId : undefined;
    return { type: "memory_activity", recalled: [], written: [{ text, factId }] };
  }
  if (toolCall.toolName === "memory_search" && result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    const query = String(r.query ?? toolCall.args?.query ?? "");
    const count = typeof r.count === "number" ? r.count : Array.isArray(r.results) ? r.results.length : 0;
    return { type: "memory_activity", recalled: [], written: [], searched: { query, count } };
  }
  return null;
}

/**
 * Execute multiple tool calls
 *
 * Default: parallel execution via Promise.all for better performance.
 * When continueOnError is false, uses sequential execution to stop on first error.
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  config: OrchestratorConfig,
  rateLimiter?: SlidingWindowRateLimiter | null,
): Promise<ToolExecutionResult[]> {
  const continueOnError = config.continueOnError ?? true;
  const toolLimiter = rateLimiter ?? config.toolRateLimiter ??
    createRateLimiter(config.toolRateLimit ?? RATE_LIMITS.toolCalls);

  const checkRateLimit = (): ToolExecutionResult | null => {
    if (!toolLimiter) return null;
    const status = toolLimiter.consume(1);
    if (status.allowed) return null;
    config.onTrace?.({
      type: "rate_limit",
      target: "tool",
      maxCalls: status.maxCalls,
      windowMs: status.windowMs,
      used: status.used,
      remaining: status.remaining,
      resetMs: status.resetMs,
    });
    return {
      success: false,
      error:
        `Tool rate limit exceeded (${status.used}/${status.maxCalls} per ${status.windowMs}ms)`,
    };
  };

  const total = toolCalls.length;

  // Sequential execution: stop on first error
  if (!continueOnError) {
    const results: ToolExecutionResult[] = [];
    for (let i = 0; i < toolCalls.length; i++) {
      const rateLimited = checkRateLimit();
      if (rateLimited) {
        results.push(rateLimited);
        break;
      }
      const result = await executeToolCall(toolCalls[i], config, i, total);
      results.push(result);
      if (!result.success) break;
    }
    return results;
  }

  // Parallel execution (default): run all calls concurrently
  const promises = toolCalls.map((call, i): Promise<ToolExecutionResult> => {
    const rateLimited = checkRateLimit();
    if (rateLimited) return Promise.resolve(rateLimited);
    return executeToolCall(call, config, i, total);
  });
  return Promise.all(promises);
}
