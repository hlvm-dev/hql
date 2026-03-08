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
  type ToolFunction,
} from "./registry.ts";
import { checkToolSafety } from "./security/safety.ts";
import { DEFAULT_TIMEOUTS, RATE_LIMITS } from "./constants.ts";
import { withTimeout } from "../../common/timeout-utils.ts";
import { SlidingWindowRateLimiter } from "../../common/rate-limiter.ts";
import { getErrorMessage } from "../../common/utils.ts";
import { RuntimeError } from "../../common/error.ts";
import {
  getUnsafeReason,
  isSafeCommand,
  parseShellCommand,
} from "../../common/shell-parser.ts";
import { getAgentLogger } from "./logger.ts";
import type { AgentPolicy } from "./policy.ts";
import type { PermissionMode } from "../../common/config/types.ts";
import { normalizeToolArgs } from "./validation.ts";
import type { ToolCall } from "./tool-call.ts";
import {
  ensurePlaywrightChromium,
  isPlaywrightMissingError,
} from "./playwright-support.ts";
import type { OrchestratorConfig } from "./orchestrator.ts";
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

/**
 * Execute tool with timeout
 */
export async function executeToolWithTimeout(
  toolFn: ToolFunction,
  args: unknown,
  workspace: string,
  timeout: number,
  policy?: AgentPolicy | null,
  onInteraction?: OrchestratorConfig["onInteraction"],
  toolOwnerId?: string,
  ensureMcpLoaded?: () => Promise<void>,
  todoState?: OrchestratorConfig["todoState"],
  parentSignal?: AbortSignal,
): Promise<unknown> {
  return await withTimeout(
    async (signal) => {
      const result = await toolFn(args, workspace, {
        signal,
        policy,
        onInteraction,
        toolOwnerId,
        ensureMcpLoaded,
        todoState,
        searchTools: (query, options) =>
          searchTools(query, {
            ...options,
            ownerId: options?.ownerId ?? toolOwnerId,
          }),
      });
      if (signal.aborted) {
        throw new RuntimeError("Tool execution aborted");
      }
      return result;
    },
    { timeoutMs: timeout, label: "Tool execution", signal: parentSignal },
  );
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
    (toolCall.toolName.startsWith("mcp_") || toolCall.toolName === "tool_search")
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

    // Preflight: reject shell_exec commands that executor will refuse
    if (toolCall.toolName === "shell_exec") {
      const cmd = (coercedArgs as Record<string, unknown>)?.command;
      if (typeof cmd === "string") {
        try {
          const parsed = parseShellCommand(cmd);
          if (!isSafeCommand(parsed)) {
            return buildToolErrorResult(
              toolCall.toolName,
              `shell_exec does not support ${getUnsafeReason(parsed)}. Use shell_script for complex commands.`,
              startedAt,
              config,
              toolCall.id,
            );
          }
        } catch { /* parse errors handled later by executor */ }
      }
    }

    // Check safety
    const permissionMode: PermissionMode = config.permissionMode ?? "default";
    const approved = await checkToolSafety(
      toolCall.toolName,
      coercedArgs,
      permissionMode,
      config.policy ?? null,
      l1Store,
      config.toolOwnerId,
      config.onInteraction,
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
      const delegateArgs = coercedArgs as { agent?: unknown; task?: unknown };
      const delegateAgent = typeof delegateArgs.agent === "string"
        ? delegateArgs.agent
        : "unknown";
      const delegateTask = typeof delegateArgs.task === "string"
        ? delegateArgs.task
        : "";
      config.onAgentEvent?.({
        type: "delegate_start",
        agent: delegateAgent,
        task: delegateTask,
      });
      try {
        const result = await config.delegate(coercedArgs, config);
        const { llmContent, summaryDisplay, returnDisplay } = buildToolResultOutputs(
          toolCall.toolName,
          result,
          config,
        );
        config.onAgentEvent?.({
          type: "delegate_end",
          agent: delegateAgent,
          task: delegateTask,
          success: true,
          summary: summaryDisplay,
          durationMs: Date.now() - startedAt,
          snapshot: getDelegateTranscriptSnapshot(result),
        });
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
        config.onAgentEvent?.({
          type: "delegate_end",
          agent: delegateAgent,
          task: delegateTask,
          success: false,
          error: getErrorMessage(error),
          durationMs: Date.now() - startedAt,
          snapshot: getDelegateTranscriptSnapshot(error),
        });
        throw error;
      }
    }

    // Execute tool (with timeout)
    const tool = getTool(toolCall.toolName, config.toolOwnerId);
    const toolTimeout = config.toolTimeout ?? DEFAULT_TIMEOUTS.tool;
    let result: unknown;
    try {
      result = await executeToolWithTimeout(
        tool.fn,
        coercedArgs,
        config.workspace,
        toolTimeout,
        config.policy ?? null,
        config.onInteraction,
        config.toolOwnerId,
        config.ensureMcpLoaded,
        config.todoState,
        config.signal,
      );
    } catch (error) {
      const message = getErrorMessage(error);
      if (
        isRenderToolName(toolCall.toolName) && isPlaywrightMissingError(message)
      ) {
        const installed = await ensurePlaywrightChromium(config);
        if (installed) {
          result = await executeToolWithTimeout(
            tool.fn,
            coercedArgs,
            config.workspace,
            toolTimeout,
            config.policy ?? null,
            config.onInteraction,
            config.toolOwnerId,
            config.ensureMcpLoaded,
            config.todoState,
            config.signal,
          );
        } else {
          return buildToolErrorResult(
            toolCall.toolName,
            message,
            startedAt,
            config,
            toolCall.id,
          );
        }
      } else {
        return buildToolErrorResult(
          toolCall.toolName,
          message,
          startedAt,
          config,
          toolCall.id,
        );
      }
    }

    const { llmContent, summaryDisplay, returnDisplay } = buildToolResultOutputs(
      toolCall.toolName,
      result,
      config,
    );

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
    return buildToolErrorResult(
      toolCall.toolName,
      getErrorMessage(error),
      startedAt,
      config,
      toolCall.id,
    );
  }
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
