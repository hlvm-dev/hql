/**
 * Tool execution: single call, batch parallel/sequential, timeout handling.
 * Extracted from orchestrator.ts for modularity.
 */

import {
  getTool,
  hasTool,
  normalizeToolName,
  prepareToolArgsForExecution,
  suggestToolNames,
  type ToolFunction,
} from "./registry.ts";
import { checkToolSafety } from "./security/safety.ts";
import { DEFAULT_TIMEOUTS, RATE_LIMITS } from "./constants.ts";
import { withTimeout } from "../../common/timeout-utils.ts";
import { SlidingWindowRateLimiter } from "../../common/rate-limiter.ts";
import { getErrorMessage } from "../../common/utils.ts";
import { RuntimeError } from "../../common/error.ts";
import { getAgentLogger } from "./logger.ts";
import type { AgentPolicy } from "./policy.ts";
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
  parentSignal?: AbortSignal,
): Promise<unknown> {
  return await withTimeout(
    async (signal) => {
      const result = await toolFn(args, workspace, {
        signal,
        policy,
        onInteraction,
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
  const toolExists = hasTool(toolCall.toolName, config.toolOwnerId);
  const preparedArgs = toolExists
    ? prepareToolArgsForExecution(
      toolCall.toolName,
      normalizedArgs,
      config.toolOwnerId,
    )
    : undefined;
  const coercedArgs = preparedArgs?.coercedArgs ?? normalizedArgs;
  // Emit trace event: tool call
  config.onTrace?.({
    type: "tool_call",
    toolName: toolCall.toolName,
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
      );
    }

    const isToolAllowed = buildIsToolAllowed(config);
    if (!isToolAllowed(toolCall.toolName)) {
      return buildToolErrorResult(
        toolCall.toolName,
        `Tool not allowed by orchestrator: ${toolCall.toolName}`,
        startedAt,
        config,
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
      );
    }

    // Check safety
    const autoApprove = config.autoApprove ?? false;
    const approved = await checkToolSafety(
      toolCall.toolName,
      coercedArgs,
      autoApprove,
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
      );
    }

    if (toolCall.toolName === "delegate_agent" && config.delegate) {
      const result = await config.delegate(coercedArgs, config);
      const { llmContent, returnDisplay } = buildToolResultOutputs(
        toolCall.toolName,
        result,
        config,
      );
      emitToolSuccess(
        config,
        toolCall.toolName,
        llmContent,
        returnDisplay,
        startedAt,
        coercedArgs,
      );
      return {
        success: true,
        result,
        llmContent,
        returnDisplay,
      };
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
            config.signal,
          );
        } else {
          return buildToolErrorResult(
            toolCall.toolName,
            message,
            startedAt,
            config,
          );
        }
      } else {
        return buildToolErrorResult(
          toolCall.toolName,
          message,
          startedAt,
          config,
        );
      }
    }

    const { llmContent, returnDisplay } = buildToolResultOutputs(
      toolCall.toolName,
      result,
      config,
    );

    emitToolSuccess(
      config,
      toolCall.toolName,
      llmContent,
      returnDisplay,
      startedAt,
      coercedArgs,
    );

    return {
      success: true,
      result,
      llmContent,
      returnDisplay,
    };
  } catch (error) {
    return buildToolErrorResult(
      toolCall.toolName,
      getErrorMessage(error),
      startedAt,
      config,
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
