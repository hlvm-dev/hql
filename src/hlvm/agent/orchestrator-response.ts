/**
 * Agent response processing: tool execution dispatch, final response handling.
 * Extracted from orchestrator.ts for modularity.
 */

import {
  ContextOverflowError,
  type Message,
} from "./context.ts";
import { DEFAULT_MAX_TOOL_CALLS } from "./constants.ts";
import { SlidingWindowRateLimiter } from "../../common/rate-limiter.ts";
import { TEXT_ENCODER } from "../../common/utils.ts";
import { checkGrounding } from "./grounding.ts";
import type { LLMResponse, ToolCall } from "./tool-call.ts";
import {
  looksLikeToolCallJsonAnywhere,
  responseAsksQuestion,
} from "./model-compat.ts";
import {
  advancePlanState,
  extractStepDoneId,
  formatPlanForContext,
  stripStepMarkers,
} from "./planning.ts";
import type { OrchestratorConfig } from "./orchestrator.ts";
import type {
  LoopConfig,
  LoopDirective,
  LoopState,
  ToolExecutionResult,
} from "./orchestrator-state.ts";
import { checkToolResultBytesLimit } from "./orchestrator-state.ts";
import {
  buildToolObservation,
  buildToolRequiredMessage,
  buildToolSignature,
  deduplicateToolCalls,
  stringifyToolResult,
} from "./orchestrator-tool-formatting.ts";
import {
  executeToolCalls,
} from "./orchestrator-tool-execution.ts";
import { callLLMWithRetry, type LLMFunction } from "./orchestrator-llm.ts";
import type { ToolUse } from "./grounding.ts";

/** Add a message to context, translating overflow to trace event */
export function addContextMessage(
  config: OrchestratorConfig,
  message: Message,
): void {
  try {
    config.context.addMessage(message);
  } catch (error) {
    if (error instanceof ContextOverflowError) {
      config.onTrace?.({
        type: "context_overflow",
        maxTokens: error.maxTokens,
        estimatedTokens: error.estimatedTokens,
      });
    }
    throw error;
  }
}

/**
 * Process agent response and execute tool calls
 */
export async function processAgentResponse(
  agentResponse: LLMResponse,
  config: OrchestratorConfig,
  toolRateLimiter?: SlidingWindowRateLimiter | null,
): Promise<{
  toolCallsMade: number;
  results: ToolExecutionResult[];
  toolCalls: ToolCall[];
  toolUses: ToolUse[];
  toolBytes: number;
  shouldContinue: boolean;
  finalResponse?: string;
}> {
  const content = (agentResponse.content ?? "").trim();
  const maxCalls = config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const rawToolCalls = Array.isArray(agentResponse.toolCalls)
    ? agentResponse.toolCalls
    : [];

  // Deduplicate identical tool calls (same name + same args) within a turn.
  const toolCalls = deduplicateToolCalls(rawToolCalls);

  if (toolCalls.length === 0) {
    if (content) {
      addContextMessage(config, {
        role: "assistant",
        content,
      });
    }
    return {
      toolCallsMade: 0,
      results: [],
      toolCalls: [],
      toolUses: [],
      toolBytes: 0,
      shouldContinue: false,
      finalResponse: content,
    };
  }

  let limitedCalls = toolCalls.slice(0, maxCalls);
  if (toolCalls.length > maxCalls) {
    addContextMessage(config, {
      role: "user",
      content:
        `Too many tool calls (${toolCalls.length}). Only the first ${maxCalls} will be executed.`,
    });
  }

  // complete_task preempts other tool calls
  const completeTaskPreemptIndex = limitedCalls.findIndex((c) =>
    c.toolName === "complete_task"
  );
  if (completeTaskPreemptIndex >= 0) {
    limitedCalls = [limitedCalls[completeTaskPreemptIndex]];
  }

  addContextMessage(config, {
    role: "assistant",
    content: content || "",
    toolCalls: limitedCalls.map((tc) => ({
      id: tc.id,
      function: { name: tc.toolName, arguments: tc.args },
    })),
  });

  const results = await executeToolCalls(limitedCalls, config, toolRateLimiter);

  const toolUses: ToolUse[] = [];
  let toolBytes = 0;
  for (let i = 0; i < results.length; i++) {
    const call = limitedCalls[i];
    const result = results[i];
    const { observation, resultText, toolName } = buildToolObservation(
      call,
      result,
    );

    addContextMessage(config, {
      role: "tool",
      content: observation,
      toolName,
      toolCallId: call.id,
    });
    toolUses.push({
      toolName: call.toolName,
      result: resultText ?? "",
    });
    toolBytes += TEXT_ENCODER.encode(resultText ?? "").length;
  }

  let finalResponse: string | undefined;
  const completeIndex = limitedCalls.findIndex((call) =>
    call.toolName === "complete_task"
  );
  if (completeIndex >= 0) {
    const completeResult = results[completeIndex];
    if (completeResult?.success) {
      finalResponse = completeResult.returnDisplay ??
        completeResult.llmContent ??
        stringifyToolResult(completeResult.result);
    } else if (completeResult?.error) {
      finalResponse = `complete_task failed: ${completeResult.error}`;
    }
  }

  return {
    toolCallsMade: results.length,
    results,
    toolCalls: limitedCalls,
    toolUses,
    toolBytes,
    shouldContinue: completeIndex < 0,
    finalResponse,
  };
}

/**
 * Handle empty responses and weak-model text repair.
 */
export function handleTextOnlyResponse(
  response: LLMResponse,
  responseText: string,
  state: LoopState,
  lc: LoopConfig,
  config: OrchestratorConfig,
): LoopDirective {
  if ((response.toolCalls?.length ?? 0) === 0 && !responseText.trim()) {
    if (!state.emptyResponseRetried) {
      state.emptyResponseRetried = true;
      return { action: "continue" };
    }
    return {
      action: "return",
      value: "The model returned an empty response. Please try again.",
    };
  }

  if (
    !lc.skipCompensation &&
    (response.toolCalls?.length ?? 0) === 0 &&
    looksLikeToolCallJsonAnywhere(responseText)
  ) {
    if (state.midLoopFormatRetries < lc.maxToolCallRetries) {
      state.midLoopFormatRetries++;
      const hasPriorTools = state.toolUses.length > 0;
      addContextMessage(config, {
        role: "user",
        content: hasPriorTools
          ? "Do not output tool call JSON. Provide a final answer based on the tool results."
          : "Native tool calling required. Do not output tool call JSON in text. Retry using structured tool calls.",
      });
      return { action: "continue" };
    }
    return state.toolUses.length === 0
      ? {
        action: "return",
        value:
          "Native tool calling required. Tool call JSON in text is not accepted.",
      }
      : {
        action: "return",
        value:
          "Tool-call JSON in text is not accepted. Provide a final answer based on available tool results.",
      };
  }

  return { action: "proceed" };
}

/**
 * Handle the "no tool calls" branch: plan advancement, no-input guard,
 * grounding checks, and format cleanup.
 */
export function handleFinalResponse(
  responseText: string,
  result: { toolCallsMade: number; finalResponse?: string },
  state: LoopState,
  lc: LoopConfig,
  config: OrchestratorConfig,
): LoopDirective {
  if (
    lc.requireToolCalls &&
    result.toolCallsMade === 0 &&
    state.toolUses.length === 0
  ) {
    state.toolCallRetries += 1;
    if (state.toolCallRetries > lc.maxToolCallRetries) {
      return {
        action: "return",
        value: "Tool call required but none provided. Task incomplete.",
      };
    }
    addContextMessage(config, {
      role: "user",
      content: buildToolRequiredMessage(config.toolAllowlist),
    });
    return { action: "continue" };
  }

  let finalResponse = result.finalResponse ?? responseText;

  // Plan state advancement
  if (state.planState) {
    const stepDoneId = extractStepDoneId(responseText);
    const requireMarkers = lc.planningConfig.requireStepMarkers ?? false;
    if (requireMarkers && !stepDoneId) {
      const currentStep =
        state.planState.plan.steps[state.planState.currentIndex];
      const id = currentStep?.id ?? "unknown";
      addContextMessage(config, {
        role: "user",
        content:
          `Plan tracking required. End your response with STEP_DONE ${id} when the step is complete.`,
      });
      return { action: "continue" };
    }

    finalResponse = stripStepMarkers(responseText);

    const advance = advancePlanState(state.planState, stepDoneId);
    state.planState = advance.state;
    const completedIndex = state.planState.currentIndex - 1;
    const completedStep = state.planState.plan.steps[completedIndex];
    if (completedStep) {
      config.onTrace?.({
        type: "plan_step",
        stepId: completedStep.id,
        index: completedIndex,
        completed: true,
      });
    }

    if (!advance.finished && advance.nextStep) {
      addContextMessage(config, {
        role: "user",
        content:
          `Plan step completed. Next step: [${advance.nextStep.id}] ${advance.nextStep.title}. Continue.`,
      });
      return { action: "continue" };
    }
  }

  // Weak-model compensation: suppress questions in no-input mode
  if (
    !lc.skipCompensation &&
    lc.noInputEnabled &&
    state.noInputRetries < lc.maxNoInputRetries &&
    responseAsksQuestion(finalResponse)
  ) {
    state.noInputRetries++;
    addContextMessage(config, {
      role: "user",
      content:
        "No-input mode: Do not ask questions. Provide a best-effort answer based on available tool results and reasonable assumptions.",
    });
    return { action: "continue" };
  }

  // Weak-model compensation: detect JSON in final answer
  if (
    !lc.skipCompensation &&
    state.toolUses.length > 0 &&
    looksLikeToolCallJsonAnywhere(finalResponse)
  ) {
    if (state.finalResponseFormatRetries < lc.maxToolCallRetries) {
      state.finalResponseFormatRetries++;
      addContextMessage(config, {
        role: "user",
        content:
          "Provide a final answer based on the tool results. Do not output tool call JSON.",
      });
      return { action: "continue" };
    }
    return { action: "return", value: finalResponse };
  }

  // Grounding checks
  if (lc.groundingMode !== "off" && state.toolUses.length > 0) {
    const grounding = checkGrounding(finalResponse, state.toolUses);
    config.onTrace?.({
      type: "grounding_check",
      mode: lc.groundingMode,
      grounded: grounding.grounded,
      warnings: grounding.warnings,
      retry: state.groundingRetries,
      maxRetry: lc.maxGroundingRetries,
    });

    if (!grounding.grounded) {
      if (
        lc.groundingMode === "strict" &&
        state.groundingRetries < lc.maxGroundingRetries
      ) {
        state.groundingRetries++;
        const warningText =
          `Grounding required. Revise your answer to cite tool results using tool names or "Based on ...".\n- ${
            grounding.warnings.join("\n- ")
          }`;
        addContextMessage(config, { role: "user", content: warningText });
        return { action: "continue" };
      }
      const warningText = `\n\n[Grounding warnings]\n- ${
        grounding.warnings.join("\n- ")
      }`;
      return { action: "return", value: `${finalResponse}${warningText}` };
    }
  }
  return { action: "return", value: finalResponse };
}

/**
 * Handle post-tool-execution: denial tracking, loop detection,
 * tool accumulation, and consecutive failure tracking.
 */
export async function handlePostToolExecution(
  result: {
    toolCallsMade: number;
    results: ToolExecutionResult[];
    toolCalls: ToolCall[];
    toolUses: ToolUse[];
    toolBytes: number;
  },
  state: LoopState,
  lc: LoopConfig,
  config: OrchestratorConfig,
  llmFunction: LLMFunction,
): Promise<LoopDirective> {
  // --- Denial tracking (per-tool) ---
  let anyDeniedThisTurn = false;

  for (let i = 0; i < result.results.length; i++) {
    const toolCall = result.toolCalls[i];
    if (!toolCall) break;
    const toolName = toolCall.toolName;
    const toolResult = result.results[i];

    if (!toolResult.success && toolResult.error?.includes("denied")) {
      anyDeniedThisTurn = true;
      const currentCount = state.denialCountByTool.get(toolName) || 0;
      state.denialCountByTool.set(toolName, currentCount + 1);

      if (currentCount + 1 >= lc.maxDenials) {
        addContextMessage(config, {
          role: "user",
          content:
            `Maximum denials (${lc.maxDenials}) reached for tool '${toolName}'. Consider using ask_user tool to clarify requirements or try a different approach.`,
        });
      }
    }
  }

  if (!anyDeniedThisTurn) {
    for (const call of result.toolCalls) {
      state.denialCountByTool.delete(call.toolName);
    }
  }

  const executedCalls = result.toolCalls.slice(0, result.results.length);
  const allToolsBlocked = executedCalls.length > 0 &&
    executedCalls.every((call) => {
      const count = state.denialCountByTool.get(call.toolName) || 0;
      return count >= lc.maxDenials;
    });

  if (anyDeniedThisTurn && allToolsBlocked && result.toolCalls.length > 0) {
    const finalResponse = await callLLMWithRetry(
      llmFunction,
      config.context.getMessages(),
      {
        timeout: lc.llmTimeout,
        maxRetries: lc.maxRetries,
        signal: config.signal,
      },
      config.onTrace,
      config.context,
    );
    return { action: "return", value: finalResponse.content ?? "" };
  }

  // --- Loop detection (weak-model compensation) ---
  if (!lc.skipCompensation) {
    if (!anyDeniedThisTurn && result.toolCallsMade > 0) {
      const signature = buildToolSignature(result.toolCalls);
      if (signature && signature === state.lastToolSignature) {
        state.repeatToolCount += 1;
      } else {
        state.repeatToolCount = 1;
        state.lastToolSignature = signature;
      }

      if (state.repeatToolCount >= lc.maxRepeatToolCalls) {
        config.onTrace?.({
          type: "loop_detected",
          signature,
          count: state.repeatToolCount,
        });
        return {
          action: "return",
          value: [
            "Tool call loop detected.",
            "The same tool calls were repeated multiple times without progress.",
            "Please clarify the request or provide additional guidance.",
          ].join("\n"),
        };
      }
    } else {
      state.lastToolSignature = "";
      state.repeatToolCount = 0;
    }
  }

  // --- Tool uses accumulation ---
  const MAX_TOOL_USES_FOR_GROUNDING = 50;
  if (result.toolUses.length > 0) {
    state.toolUses.push(...result.toolUses);
    if (state.toolUses.length > MAX_TOOL_USES_FOR_GROUNDING) {
      state.toolUses = state.toolUses.slice(-MAX_TOOL_USES_FOR_GROUNDING);
    }
    if (result.toolBytes > 0) {
      checkToolResultBytesLimit(state, lc, config, result.toolBytes);
    }
  }
  if (result.toolCallsMade > 0) {
    state.groundingRetries = 0;
  }

  // --- Web tool tracking (for mid-conversation reminders) ---
  const WEB_TOOL_NAMES = new Set(["web_fetch", "search_web", "web_browse"]);
  state.lastToolsIncludedWeb = result.toolCalls.some(
    (tc) => WEB_TOOL_NAMES.has(tc.toolName),
  );

  // --- Consecutive failure tracking ---
  const allFailed = result.results.length > 0 &&
    result.results.every((r) => !r.success);
  if (allFailed) {
    state.consecutiveToolFailures++;
  } else {
    state.consecutiveToolFailures = 0;
  }
  if (state.consecutiveToolFailures >= 3) {
    const failedTools = result.results
      .filter((r) => !r.success)
      .map((r) => r.error ?? "unknown error");
    return {
      action: "return",
      value:
        `Tool execution failed after ${state.consecutiveToolFailures} consecutive failures:\n${
          failedTools.join("\n")
        }`,
    };
  }

  return { action: "proceed" };
}
