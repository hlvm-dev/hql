/**
 * Agent response processing: tool execution dispatch, final response handling.
 * Extracted from orchestrator.ts for modularity.
 */

import { ContextOverflowError, type Message } from "./context.ts";
import { DEFAULT_MAX_TOOL_CALLS, TOOL_RESULT_LIMITS } from "./constants.ts";
import { SlidingWindowRateLimiter } from "../../common/rate-limiter.ts";
import {
  areListsEqual,
  isObjectValue,
  TEXT_ENCODER,
} from "../../common/utils.ts";
import { checkGrounding } from "./grounding.ts";
import {
  attributeCitationSpans,
  buildCitationSourceIndex,
  buildRetrievalCitations,
  mapLlmSourcesToCitations,
} from "./tools/web/citation-spans.ts";
import type { Citation } from "./tools/web/search-provider.ts";
import {
  ensureToolCallIds,
  type LLMResponse,
  type LLMSource,
  type ToolCall,
} from "./tool-call.ts";
import { getTool, hasTool } from "./registry.ts";
import {
  AGENT_ORCHESTRATOR_FAILURE_MESSAGES,
  looksLikeToolCallJsonAnywhere,
  responseAsksQuestion,
} from "./model-compat.ts";
import {
  advancePlanState,
  extractStepDoneId,
  stripStepMarkers,
} from "./planning.ts";
import { type OrchestratorConfig, WEB_TOOL_NAMES } from "./orchestrator.ts";
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
import { executeToolCalls } from "./orchestrator-tool-execution.ts";
import { callLLMWithRetry, type LLMFunction } from "./orchestrator-llm.ts";
import type { ToolUse } from "./grounding.ts";

const TOOL_SEARCH_BASELINE_ALLOWLIST = [
  "tool_search",
  "ask_user",
  "complete_task",
  "list_files",
  "search_code",
  "read_file",
  "write_file",
  "edit_file",
  "shell_exec",
] as const;

function parseToolSearchAllowlist(result: unknown): string[] {
  if (!isObjectValue(result)) return [];
  const payload = result as Record<string, unknown>;

  const suggested = Array.isArray(payload.suggested_allowlist)
    ? payload.suggested_allowlist.filter((v): v is string =>
      typeof v === "string"
    )
    : [];
  if (suggested.length > 0) return suggested;

  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  const names: string[] = [];
  for (const match of matches) {
    if (!isObjectValue(match)) continue;
    if (typeof match.name === "string") {
      names.push(match.name);
    }
  }
  return names;
}

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
  nativeSources?: LLMSource[];
  providerMetadata?: Record<string, unknown>;
  latestCitationSourceIndex?:
    import("./tools/web/citation-spans.ts").CitationSourceEntry[];
}> {
  const content = (agentResponse.content ?? "").trim();
  const maxCalls = config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const rawToolCalls = Array.isArray(agentResponse.toolCalls)
    ? agentResponse.toolCalls
    : [];

  const toolCalls = ensureToolCallIds(deduplicateToolCalls(rawToolCalls));

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
      nativeSources: agentResponse.sources,
      providerMetadata: agentResponse.providerMetadata,
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

  const latestCitationSourceIndex = buildCitationSourceIndex(
    results.map((execution, i) => ({
      toolName: limitedCalls[i]?.toolName ?? "",
      result: execution.result,
    })).filter((item) => item.toolName.length > 0),
  );

  const terminalToolFinalResponse = resolveTerminalToolFinalResponse(
    limitedCalls,
    results,
    config,
  );
  if (terminalToolFinalResponse) {
    finalResponse = terminalToolFinalResponse;
  }

  return {
    toolCallsMade: results.length,
    results,
    toolCalls: limitedCalls,
    toolUses,
    toolBytes,
    shouldContinue: completeIndex < 0 && !terminalToolFinalResponse,
    finalResponse,
    nativeSources: agentResponse.sources,
    providerMetadata: agentResponse.providerMetadata,
    latestCitationSourceIndex,
  };
}

function resolveTerminalToolFinalResponse(
  toolCalls: readonly ToolCall[],
  results: readonly ToolExecutionResult[],
  config: OrchestratorConfig,
): string | undefined {
  if (toolCalls.length !== 1 || results.length !== 1) return undefined;

  const [toolCall] = toolCalls;
  const [result] = results;
  if (!toolCall || !result?.success) return undefined;
  if (!hasTool(toolCall.toolName, config.toolOwnerId)) return undefined;

  const tool = getTool(toolCall.toolName, config.toolOwnerId);
  if (!tool.terminalOnSuccess) return undefined;

  return result.returnDisplay ??
    result.summaryDisplay ??
    result.llmContent ??
    (typeof result.result === "string" ? result.result : undefined);
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
      value: AGENT_ORCHESTRATOR_FAILURE_MESSAGES.emptyResponse,
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
        value: AGENT_ORCHESTRATOR_FAILURE_MESSAGES.nativeToolCallingRequired,
      }
      : {
        action: "return",
        value: AGENT_ORCHESTRATOR_FAILURE_MESSAGES.toolCallJsonRejected,
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
  result: {
    toolCallsMade: number;
    finalResponse?: string;
    nativeSources?: LLMSource[];
    providerMetadata?: Record<string, unknown>;
    latestCitationSourceIndex?:
      import("./tools/web/citation-spans.ts").CitationSourceEntry[];
  },
  state: LoopState,
  lc: LoopConfig,
  config: OrchestratorConfig,
): LoopDirective {
  const emitFinalResponseMeta = (citations: Citation[] = []): void => {
    config.onFinalResponseMeta?.({
      citationSpans: citations,
      providerMetadata: result.providerMetadata,
    });
  };

  if (
    lc.requireToolCalls &&
    result.toolCallsMade === 0 &&
    state.toolUses.length === 0
  ) {
    state.toolCallRetries += 1;
    if (state.toolCallRetries > lc.maxToolCallRetries) {
      return {
        action: "return",
        value: AGENT_ORCHESTRATOR_FAILURE_MESSAGES.toolCallRequired,
      };
    }
    addContextMessage(config, {
      role: "user",
      content: buildToolRequiredMessage(
        config.toolFilterState?.allowlist ?? config.toolAllowlist,
      ),
    });
    return { action: "continue" };
  }

  let finalResponse = result.finalResponse ?? responseText;

  if ((result.latestCitationSourceIndex?.length ?? 0) > 0) {
    state.passageIndex = [
      ...(state.passageIndex ?? []),
      ...result.latestCitationSourceIndex!,
    ].slice(-TOOL_RESULT_LIMITS.maxPassageIndexEntries);
  }

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
      config.onAgentEvent?.({
        type: "plan_step",
        stepId: completedStep.id,
        index: completedIndex,
        completed: true,
      });
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
    emitFinalResponseMeta();
    return { action: "return", value: finalResponse };
  }

  const citationSpans = (state.passageIndex?.length ?? 0) > 0
    ? attributeCitationSpans(finalResponse, state.passageIndex ?? [])
    : [];
  const groundingCitations = citationSpans.map((span) => ({
    ...span.citation,
    provenance: "inferred" as const,
    startIndex: span.startIndex,
    endIndex: span.endIndex,
    confidence: span.confidence,
    spanText: span.spanText,
    sourceKind: span.sourceKind,
  }));
  const providerCitations = mapLlmSourcesToCitations(result.nativeSources);
  const retrievalCitations = buildRetrievalCitations(state.passageIndex);
  const emittedCitations = providerCitations.length > 0
    ? providerCitations
    : retrievalCitations.length > 0
    ? retrievalCitations
    : groundingCitations;

  // Grounding checks
  if (lc.groundingMode !== "off" && state.toolUses.length > 0) {
    const grounding = checkGrounding(
      finalResponse,
      state.toolUses,
      groundingCitations,
    );
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
      emitFinalResponseMeta(emittedCitations);
      return { action: "return", value: `${finalResponse}${warningText}` };
    }
  }
  emitFinalResponseMeta(emittedCitations);
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
  if (
    result.results.some((toolResult) =>
      toolResult.stopReason === "plan_review_cancelled"
    )
  ) {
    return {
      action: "return",
      value: "Plan review was cancelled. No changes were made.",
    };
  }

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

  // tool_search can narrow the runtime tool schema set for subsequent iterations.
  for (let i = 0; i < result.results.length; i++) {
    const toolCall = result.toolCalls[i];
    const toolResult = result.results[i];
    if (toolCall?.toolName !== "tool_search" || !toolResult?.success) continue;

    const rawAllowlist = parseToolSearchAllowlist(toolResult.result);
    if (rawAllowlist.length === 0) continue;

    const currentAllowlist = config.toolFilterState?.allowlist ??
      config.toolAllowlist;
    const allowedUniverse = currentAllowlist?.length
      ? new Set(currentAllowlist)
      : null;
    const unique = Array.from(
      new Set([
        ...TOOL_SEARCH_BASELINE_ALLOWLIST,
        ...rawAllowlist,
      ]),
    );
    const nextAllowlist = allowedUniverse
      ? unique.filter((name) => allowedUniverse.has(name))
      : unique;
    if (
      nextAllowlist.length === 0 ||
      areListsEqual(currentAllowlist, nextAllowlist)
    ) {
      continue;
    }

    if (config.toolFilterState) {
      config.toolFilterState.allowlist = nextAllowlist;
    }
    config.toolAllowlist = nextAllowlist;

    const preview = nextAllowlist.slice(0, 12).join(", ");
    const extra = nextAllowlist.length > 12
      ? ` (+${nextAllowlist.length - 12} more)`
      : "";
    addContextMessage(config, {
      role: "user",
      content:
        `Tool context narrowed to: ${preview}${extra}. Continue using this focused tool set unless another tool_search changes it.`,
    });
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
  if (result.toolUses.length > 0) {
    state.toolUses.push(...result.toolUses);
    if (state.toolUses.length > TOOL_RESULT_LIMITS.maxToolUsesForGrounding) {
      state.toolUses = state.toolUses.slice(
        -TOOL_RESULT_LIMITS.maxToolUsesForGrounding,
      );
    }
    if (result.toolBytes > 0) {
      checkToolResultBytesLimit(state, lc, config, result.toolBytes);
    }
  }
  if (result.toolCallsMade > 0) {
    state.groundingRetries = 0;
  }

  // Build citation source index from raw web tool payloads (for span attribution).
  const citationSources = buildCitationSourceIndex(
    result.results.map((execution, i) => ({
      toolName: result.toolCalls[i]?.toolName ?? "",
      result: execution.result,
    })).filter((item) => item.toolName.length > 0),
  );
  if (citationSources.length > 0) {
    state.passageIndex = [...(state.passageIndex ?? []), ...citationSources]
      .slice(-TOOL_RESULT_LIMITS.maxPassageIndexEntries);
  }

  // --- Web tool tracking (for mid-conversation reminders) ---
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
