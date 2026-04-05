/**
 * Agent response processing: tool execution dispatch, final response handling.
 * Extracted from orchestrator.ts for modularity.
 */

import { ContextOverflowError, type Message } from "./context.ts";
import {
  DEFAULT_MAX_TOOL_CALLS,
  RESOURCE_LIMITS,
  TOOL_RESULT_LIMITS,
} from "./constants.ts";
import { SlidingWindowRateLimiter } from "../../common/rate-limiter.ts";
import {
  areListsEqual,
  generateUUID,
  getErrorMessage,
  isObjectValue,
  TEXT_ENCODER,
} from "../../common/utils.ts";
import { checkGrounding } from "./grounding.ts";
import {
  attributeCitationSpans,
  buildCitationSourceIndex,
  buildRetrievalCitations,
  mapLlmSourcesToCitations,
  mapProviderMetadataToCitations,
} from "./tools/web/citation-spans.ts";
import type { Citation } from "./tools/web/search-provider.ts";
import {
  ensureToolCallIds,
  type LLMResponse,
  type LLMSource,
  type ToolCall,
} from "./tool-call.ts";
import { getTool, hasTool, resolveTools } from "./registry.ts";
import type { InteractionOption } from "./registry.ts";
import {
  AGENT_ORCHESTRATOR_FAILURE_MESSAGES,
  looksLikeToolCallJsonAnywhere,
  parseToolCallTextEnvelope,
  looksLikeToolCallTextEnvelope,
  responseAsksQuestion,
} from "./model-compat.ts";
import { renderEditFileRecoveryPrompt } from "./error-taxonomy.ts";
import {
  advancePlanState,
  createPlanState,
  derivePlanExecutionAllowlist,
  extractStepDoneId,
  getPlanResearchIterationBudget,
  parsePlanResponse,
  requestPlan,
  stripStepMarkers,
} from "./planning.ts";
import type { OrchestratorConfig } from "./orchestrator.ts";
import {
  checkToolResultBytesLimit,
  cloneToolList,
  effectiveAllowlist,
  type LoopConfig,
  type LoopDirective,
  type LoopState,
  type ToolExecutionResult,
} from "./orchestrator-state.ts";
import {
  buildToolObservation,
  buildToolRequiredMessage,
  buildToolSignature,
  generateArgsSummary,
  stringifyToolResult,
} from "./orchestrator-tool-formatting.ts";
import { executeToolCalls } from "./orchestrator-tool-execution.ts";
import { callLLMWithRetry, type LLMFunction } from "./orchestrator-llm.ts";
import type { ToolUse } from "./grounding.ts";
import { isMutatingTool } from "./security/safety.ts";

const WEB_TOOL_NAMES = new Set(["search_web", "web_fetch", "fetch_url"]);

function isWebToolName(toolName: string): boolean {
  return WEB_TOOL_NAMES.has(toolName);
}

/** DRY: Append citation sources to the passage index with bounded size. */
function mergePassageIndex(
  state: LoopState,
  entries: import("./tools/web/citation-spans.ts").CitationSourceEntry[],
): void {
  if (entries.length === 0) return;
  state.passageIndex = [
    ...(state.passageIndex ?? []),
    ...entries,
  ].slice(-TOOL_RESULT_LIMITS.maxPassageIndexEntries);
}

/** DRY: Build citation source items from tool execution results + calls. */
function buildCitationSourceItems(
  toolCalls: readonly ToolCall[],
  results: readonly ToolExecutionResult[],
): Array<{ toolName: string; result: unknown }> {
  const items: Array<{ toolName: string; result: unknown }> = [];
  for (let i = 0; i < results.length; i++) {
    const toolName = toolCalls[i]?.toolName ?? "";
    if (toolName.length > 0) {
      items.push({ toolName, result: results[i].result });
    }
  }
  return items;
}

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

function canDegradeObservationToSummary(
  toolCall: ToolCall,
  toolResult: ToolExecutionResult,
  ownerId?: string,
): boolean {
  if (!toolResult.success) return false;
  if (
    isMutatingTool(
      toolCall.toolName,
      ownerId,
      isObjectValue(toolCall.args) ? toolCall.args : undefined,
    )
  ) {
    return false;
  }
  return toolResult.presentationKind !== "edit";
}

function resolveContextObservation(
  toolCall: ToolCall,
  toolResult: ToolExecutionResult,
  remainingObservationBytes: number,
  ownerId?: string,
): {
  observation: string;
  resultText: string;
  toolName: string;
  observationBytes: number;
  observationMode: "full" | "summary";
} {
  const fullObservation = toolResult.llmContent ??
    stringifyToolResult(toolResult.result);
  const summaryObservation = toolResult.summaryDisplay ?? fullObservation;
  const fullBytes = TEXT_ENCODER.encode(fullObservation).length;
  const summaryBytes = TEXT_ENCODER.encode(summaryObservation).length;
  const shouldUseSummary = canDegradeObservationToSummary(
      toolCall,
      toolResult,
      ownerId,
    ) &&
    (
      remainingObservationBytes <= 0 ||
      (fullBytes > remainingObservationBytes && summaryBytes < fullBytes)
    );
  const built = buildToolObservation(
    toolCall,
    toolResult,
    shouldUseSummary ? summaryObservation : fullObservation,
  );
  const observationBytes = TEXT_ENCODER.encode(built.observation).length;
  return {
    observation: built.observation,
    resultText: built.resultText,
    toolName: built.toolName,
    observationBytes,
    observationMode:
      shouldUseSummary && built.usedRequestedObservation ? "summary" : "full",
  };
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

  const toolCalls = ensureToolCallIds(rawToolCalls);

  if (toolCalls.length === 0) {
    if (content) {
      addContextMessage(config, {
        role: "assistant",
        content,
        _sdkResponseMessages: agentResponse.sdkResponseMessages,
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
  const roundId = `round:${generateUUID()}`;

  addContextMessage(config, {
    role: "assistant",
    content: content || "",
    roundId,
    toolCalls: limitedCalls.map((tc) => ({
      id: tc.id,
      function: { name: tc.toolName, arguments: tc.args },
    })),
    _sdkResponseMessages: agentResponse.sdkResponseMessages,
  });

  const results = await executeToolCalls(limitedCalls, config, toolRateLimiter);

  const toolUses: ToolUse[] = [];
  let toolBytes = 0;
  let remainingObservationBytes = RESOURCE_LIMITS.maxToolObservationBytesPerTurn;
  for (let i = 0; i < results.length; i++) {
    const call = limitedCalls[i];
    const result = results[i];
    const {
      observation,
      resultText,
      toolName,
      observationBytes,
      observationMode,
    } = resolveContextObservation(
      call,
      result,
      remainingObservationBytes,
      config.toolOwnerId,
    );

    addContextMessage(config, {
      role: "tool",
      content: observation,
      roundId,
      toolName,
      toolCallId: call.id,
    });
    remainingObservationBytes -= observationBytes;
    await config.hookRuntime?.dispatch("post_tool", {
      workspace: config.workspace,
      sessionId: config.sessionId,
      turnId: config.turnId,
      modelId: config.modelId,
      toolName: call.toolName,
      toolCallId: call.id,
      success: result.success,
      summary: result.summaryDisplay,
      content: result.returnDisplay,
      llmObservation: observation,
      observationMode,
      presentationKind: result.presentationKind,
      truncatedForLlm: result.truncatedForLlm === true,
      truncatedForTranscript: result.truncatedForTranscript === true,
      argsSummary: generateArgsSummary(call.toolName, call.args),
    });
    toolUses.push({
      toolName: call.toolName,
      result: resultText ?? "",
    });
    toolBytes += observationBytes;
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
    buildCitationSourceItems(limitedCalls, results),
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
    (
      looksLikeToolCallJsonAnywhere(responseText) ||
      looksLikeToolCallTextEnvelope(responseText)
    )
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
    const repairedToolCall = parseToolCallTextEnvelope(responseText);
    if (
      repairedToolCall &&
      canRepairTextEnvelopeIntoLocalToolCall(repairedToolCall.toolName, config)
    ) {
      response.content = "";
      response.toolCalls = [{
        toolName: repairedToolCall.toolName,
        args: repairedToolCall.args,
      }];
      return { action: "proceed" };
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

function canRepairTextEnvelopeIntoLocalToolCall(
  toolName: string,
  config: OrchestratorConfig,
): boolean {
  return hasTool(toolName, config.toolOwnerId);
}

function formatPlanPreview(
  plan: import("./planning.ts").Plan,
): string {
  const lines = [
    `Plan ready: ${plan.goal}`,
    ...plan.steps.map((step, index) => `${index + 1}. ${step.title}`),
  ];
  return lines.join("\n");
}

function formatPlanForExecution(
  plan: import("./planning.ts").Plan,
  directFileTargets?: readonly string[],
): string {
  const directFileLine = directFileTargets?.length === 1
    ? `The user explicitly named this target file: ${
      directFileTargets[0]
    }. Stay in that file unless you are blocked.`
    : undefined;
  const lines = [
    "You are no longer planning. You are now executing the approved plan.",
    "Follow the approved plan in order and stay on the current step until it is complete or blocked.",
    "Treat each step as a goal to accomplish, not a script to replay word-for-word. Translate away temporary research chatter like omitted lines, truncation, or repeated failed searches.",
    "Do not restate the plan, do not answer tutorial-style, and do not re-open broad research unless a step genuinely requires it.",
    ...(directFileLine ? [directFileLine] : []),
    "If the user already named the file, work in that file directly instead of doing broad repo-wide searches.",
    "Prefer dedicated tools first: use read_file/list_files/search_code for inspection and edit_file/write_file for changes.",
    "For approved filesystem-organization steps such as mkdir, mv, cp, or rm, use shell_exec directly instead of asking for another planning clarification. Note: shell_exec expands ~, *, ?, and $VAR through a real shell when these are present.",
    "Use git_diff/git_status for repo inspection instead of shell_exec git commands whenever those tools are available.",
    "If read_file already gave you the needed context for the named file, skip extra search_code or whole-file shell_exec and move straight to edit_file.",
    "If read_file is truncated or a search fails once, immediately switch to a more precise read-only inspection method such as shell_exec with rg -n or sed -n instead of repeating the same search.",
    "shell_exec accepts one simple command only. Do not use &&, |, ;, subshells, or multi-command wrappers.",
    "Do not use git stash, git reset, or other workspace-shaping commands unless the user explicitly asked for them.",
    "Do not run heavyweight verification like deno check unless the approved step explicitly calls for it or the change is risky enough to justify it.",
    "Once you have enough context to make the requested change, edit immediately. Do not keep searching for a perfect anchor.",
    "Once the requested change is confirmed with a targeted read or diff, mark the step done instead of continuing with extra tool calls.",
    "The planning phase should have already surfaced clarifications and operational constraints. Do not ask new clarifying questions during execution.",
    "Keep todo_write aligned with actual progress so the checklist stays accurate.",
    "When you call todo_write, only use these statuses: pending, in_progress, completed.",
    "Do not repeat edit_file on the same change unless the prior edit failed or a follow-up read proved the edit did not land correctly.",
    "The approved execution mode is authoritative. Treat expected file-move, mkdir, copy, rename, and delete work as part of execution instead of reopening plan-time clarification.",
    "Keep your progress aligned to these steps:",
    ...plan.steps.map((step, index) =>
      `${index + 1}. [${step.id}] ${step.title}`
    ),
    'When you complete a step, end your response with: "STEP_DONE <id>".',
    "If execution becomes genuinely impossible, stop and finish with a concise blocker summary instead of asking a new clarification.",
  ];
  return lines.join("\n");
}

async function withDraftingToolLock<T>(
  config: OrchestratorConfig,
  fn: () => Promise<T>,
): Promise<T> {
  if (!config.toolFilterState) {
    return await fn();
  }

  const previousAllowlist = cloneToolList(config.toolFilterState.allowlist);
  const previousDenylist = cloneToolList(config.toolFilterState.denylist);
  const previousConfigAllowlist = cloneToolList(config.toolAllowlist);
  const previousConfigDenylist = cloneToolList(config.toolDenylist);
  const allToolNames = Object.keys(resolveTools({
    ownerId: config.toolOwnerId,
  }));

  config.toolFilterState.allowlist = undefined;
  config.toolFilterState.denylist = allToolNames;
  config.toolAllowlist = undefined;
  config.toolDenylist = allToolNames;

  try {
    return await fn();
  } finally {
    config.toolFilterState.allowlist = previousAllowlist;
    config.toolFilterState.denylist = previousDenylist;
    config.toolAllowlist = previousConfigAllowlist;
    config.toolDenylist = previousConfigDenylist;
  }
}

async function handleDraftedPlan(
  plan: import("./planning.ts").Plan,
  state: LoopState,
  lc: LoopConfig,
  config: OrchestratorConfig,
): Promise<LoopDirective> {
  config.onAgentEvent?.({ type: "plan_created", plan });
  config.onTrace?.({ type: "plan_created", plan });
  if (config.planModeState) {
    config.planModeState.phase = "reviewing";
    config.onAgentEvent?.({
      type: "plan_phase_changed",
      phase: config.planModeState.phase,
    });
  }

  if (!config.planReview) {
    return { action: "return", value: formatPlanPreview(plan) };
  }

  const reviewDecision = await config.planReview.ensureApproved(plan);
  if (reviewDecision === "approved") {
    state.planState = createPlanState(plan);
    if (config.planModeState) {
      const executionAllowlist = derivePlanExecutionAllowlist(
        plan,
        config.planModeState.executionAllowlist,
        { directFileTargets: config.planModeState.directFileTargets },
      );
      config.planModeState.phase = "executing";
      config.planModeState.executionAllowlist = executionAllowlist;
      config.onAgentEvent?.({
        type: "plan_phase_changed",
        phase: config.planModeState.phase,
      });
      config.permissionMode = config.planModeState.executionPermissionMode;
      if (config.toolFilterState) {
        config.toolFilterState.allowlist = executionAllowlist
          ? [...executionAllowlist]
          : undefined;
        config.toolFilterState.denylist =
          config.planModeState.executionDenylist?.length
            ? [...config.planModeState.executionDenylist]
            : undefined;
      }
      config.toolAllowlist = executionAllowlist
        ? [...executionAllowlist]
        : undefined;
      config.toolDenylist = config.planModeState.executionDenylist?.length
        ? [...config.planModeState.executionDenylist]
        : undefined;
      config.toolFilterBaseline = {
        allowlist: executionAllowlist ? [...executionAllowlist] : undefined,
        denylist: config.planModeState.executionDenylist?.length
          ? [...config.planModeState.executionDenylist]
          : undefined,
      };
    }
    lc.planningConfig.requireStepMarkers = true;
    addContextMessage(config, {
      role: "user",
      content: [
        "[System] The plan has been approved. Begin execution now.",
        formatPlanForExecution(plan, config.planModeState?.directFileTargets),
      ].join("\n\n"),
    });
    return { action: "continue" };
  }

  if (reviewDecision === "revise") {
    if (config.planModeState) {
      config.planModeState.phase = "researching";
      config.onAgentEvent?.({
        type: "plan_phase_changed",
        phase: config.planModeState.phase,
      });
    }
    addContextMessage(config, {
      role: "user",
      content:
        "Revise the plan and emit a replacement PLAN block when ready. Stay in read-only planning mode.",
    });
    return { action: "continue" };
  }

  return {
    action: "return",
    value: "Plan review was cancelled. No changes were made.",
  };
}

async function maybeDraftPlanFromResearch(
  state: LoopState,
  lc: LoopConfig,
  config: OrchestratorConfig,
  llmFunction: LLMFunction,
): Promise<LoopDirective | null> {
  if (
    !config.planModeState?.active ||
    config.planModeState.phase !== "researching"
  ) {
    return null;
  }

  const shouldDraft = state.toolUses.length > 0 &&
    (
      state.iterations >= getPlanResearchIterationBudget(lc.maxIterations) ||
      state.repeatToolCount >= lc.maxRepeatToolCalls
    );
  if (!shouldDraft) return null;

  config.planModeState.phase = "drafting";
  config.onAgentEvent?.({
    type: "plan_phase_changed",
    phase: config.planModeState.phase,
  });
  config.onAgentEvent?.({
    type: "planning_update",
    iteration: state.iterations,
    summary: "Drafting a structured plan from the gathered context.",
  });

  try {
    const agentNames = (config.agentProfiles ?? []).map((agent) =>
      agent.name
    );
    const plan = await withDraftingToolLock(
      config,
      () =>
        requestPlan(
          llmFunction,
          config.context.getMessages(),
          config.currentUserRequest ?? "",
          lc.planningConfig,
          agentNames,
          config.planModeState?.directFileTargets,
          config.signal,
        ),
    );
    if (plan) {
      return await handleDraftedPlan(plan, state, lc, config);
    }
  } catch (error) {
    config.onAgentEvent?.({
      type: "planning_update",
      iteration: state.iterations,
      summary: `Plan drafting retry needed: ${getErrorMessage(error)}`,
    });
  }

  config.planModeState.phase = "researching";
  config.onAgentEvent?.({
    type: "plan_phase_changed",
    phase: config.planModeState.phase,
  });
  addContextMessage(config, {
    role: "user",
    content:
      "Research is sufficient. Stop exploring and return ONLY a PLAN ... END_PLAN block using the gathered context.",
  });
  return { action: "continue" };
}

function extractClarifyingQuestion(response: string): string | null {
  if (!response.trim()) return null;
  const withoutCodeBlocks = response.replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ");
  const segments = withoutCodeBlocks.split(/(?<=[.?!])\s+/);
  for (let i = segments.length - 1; i >= 0; i--) {
    const candidate = segments[i]?.replace(/^[\s>*-]+/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!candidate || !candidate.endsWith("?") || candidate.length > 220) {
      continue;
    }
    if (
      /\b(what|which|who|where|when|why|how|can|could|would|should|do|does|did|is|are|will)\b/i
        .test(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

function responseNeedsConcreteTask(response: string): boolean {
  return /\b(no specific task|no task to plan|nothing to plan|not a task i can act on|actual question or task|what would you like to (accomplish|work on|plan)|what can i help you with|could you tell me what you'd like)\b/i
    .test(response);
}

function isBinaryFollowUpQuestion(question: string): boolean {
  return /\b(would you like|do you want|want me to|should i|can i|may i)\b/i
    .test(question);
}

function isGenericConversationalFollowUp(question: string): boolean {
  return /\b(help with anything else|anything else i can help with|anything else|anything more|something else i can help with|do anything else for you)\b/i
    .test(question);
}

function buildDefaultFollowUpOptions(
  question: string,
): InteractionOption[] | undefined {
  if (!isBinaryFollowUpQuestion(question)) {
    return undefined;
  }
  return [
    {
      label: "Yes",
      value: "yes",
      detail: "Proceed with the assistant's proposed next action.",
      recommended: true,
    },
    {
      label: "No",
      value: "no",
      detail: "Stop here and do not continue with that action.",
    },
  ];
}

function shouldConvertDefaultFollowUpToInteraction(
  response: string,
  state: LoopState,
  config: OrchestratorConfig,
): boolean {
  if (!config.onInteraction) return false;
  if (config.planModeState?.active) return false;
  if (state.planState) return false;
  if (state.toolUses.length === 0) return false;
  if (!responseAsksQuestion(response)) return false;
  if (isGenericConversationalFollowUp(response)) return false;
  return isBinaryFollowUpQuestion(response) ||
    /\b(how would you like|which option|which would you prefer|what should i do next)\b/i
      .test(response);
}

/**
 * Handle the "no tool calls" branch: plan advancement, no-input guard,
 * grounding checks, and format cleanup.
 */
export async function handleFinalResponse(
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
): Promise<LoopDirective> {
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
        effectiveAllowlist(config),
      ),
    });
    return { action: "continue" };
  }

  let finalResponse = result.finalResponse ?? responseText;

  mergePassageIndex(state, result.latestCitationSourceIndex ?? []);

  if (
    config.planModeState?.active &&
    config.planModeState.phase !== "executing" &&
    config.planModeState.phase !== "done"
  ) {
    const parsedPlan = parsePlanResponse(finalResponse);
    if (parsedPlan.plan) {
      if (config.planModeState.phase === "researching") {
        config.planModeState.phase = "drafting";
        config.onAgentEvent?.({
          type: "plan_phase_changed",
          phase: config.planModeState.phase,
        });
      }
      const directive = await handleDraftedPlan(
        parsedPlan.plan,
        state,
        lc,
        config,
      );
      if (directive.action === "return") {
        emitFinalResponseMeta();
      }
      return directive;
    }

    const clarificationQuestion = extractClarifyingQuestion(finalResponse);
    if (clarificationQuestion || responseNeedsConcreteTask(finalResponse)) {
      const question = clarificationQuestion ??
        "What concrete task do you want me to plan?";
      if (config.onInteraction) {
        const interaction = await config.onInteraction({
          type: "interaction_request",
          requestId: crypto.randomUUID(),
          mode: "question",
          question,
        });
        const answer = interaction.userInput?.trim();
        if (answer) {
          addContextMessage(config, {
            role: "user",
            content: `[Clarification] ${answer}`,
          });
          return { action: "continue" };
        }
      }
      emitFinalResponseMeta();
      return {
        action: "return",
        value:
          "Plan mode needs a concrete task to plan. Describe what you want implemented, changed, or researched, or exit plan mode for general questions.",
      };
    }

    if (finalResponse.trim() && state.finalResponseFormatRetries < 1) {
      state.finalResponseFormatRetries++;
      config.onAgentEvent?.({
        type: "planning_update",
        iteration: state.iterations,
        summary: finalResponse.slice(0, 300),
      });
      addContextMessage(config, {
        role: "user",
        content:
          "You are still in plan mode. Do not answer directly. Either ask one concise clarification with ask_user or return ONLY a PLAN ... END_PLAN block.",
      });
      return { action: "continue" };
    }
    emitFinalResponseMeta();
    return {
      action: "return",
      value:
        "Plan mode could not produce a structured plan. Restate the task more concretely, or exit plan mode for general questions.",
    };
  }

  if (shouldConvertDefaultFollowUpToInteraction(finalResponse, state, config)) {
    const question = extractClarifyingQuestion(finalResponse) ??
      "How would you like to proceed?";
    const interaction = await config.onInteraction!({
      type: "interaction_request",
      requestId: crypto.randomUUID(),
      mode: "question",
      question,
      options: buildDefaultFollowUpOptions(question),
    });
    const answer = interaction.userInput?.trim();
    if (answer) {
      addContextMessage(config, {
        role: "user",
        content: `[Follow-up answer] ${answer}`,
      });
      return { action: "continue" };
    }
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
    (
      looksLikeToolCallJsonAnywhere(finalResponse) ||
      looksLikeToolCallTextEnvelope(finalResponse)
    )
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
  const providerMetadataCitations = providerCitations.length === 0
    ? mapProviderMetadataToCitations(result.providerMetadata)
    : [];
  const retrievalCitations = buildRetrievalCitations(state.passageIndex);
  const emittedCitations = providerCitations.length > 0
    ? providerCitations
    : providerMetadataCitations.length > 0
    ? providerMetadataCitations
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
    nativeSources?: LLMSource[];
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

  // --- Denial tracking (single pass over results) ---
  let anyDeniedThisTurn = false;
  const executedNames: string[] = [];
  let allToolsBlocked = result.results.length > 0;

  for (let i = 0; i < result.results.length; i++) {
    const toolCall = result.toolCalls[i];
    if (!toolCall) break;
    const toolName = toolCall.toolName;
    const toolResult = result.results[i];
    executedNames.push(toolName);

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
    allToolsBlocked = false;
  } else if (allToolsBlocked) {
    for (const name of executedNames) {
      if ((state.denialCountByTool.get(name) || 0) < lc.maxDenials) {
        allToolsBlocked = false;
        break;
      }
    }
  }

  state.lastToolNames = executedNames;

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

  const editFileRecovery = result.results.find((toolResult) =>
    toolResult.recovery
  )
    ?.recovery;
  if (editFileRecovery) {
    addContextMessage(config, {
      role: "system",
      content: renderEditFileRecoveryPrompt(editFileRecovery),
    });
  }

  // tool_search can narrow the runtime tool schema set for subsequent iterations.
  for (let i = 0; i < result.results.length; i++) {
    const toolCall = result.toolCalls[i];
    const toolResult = result.results[i];
    if (toolCall?.toolName !== "tool_search" || !toolResult?.success) continue;

    const rawAllowlist = parseToolSearchAllowlist(toolResult.result);
    if (rawAllowlist.length === 0) continue;

    const updatedBaselineAllowlist = config.onToolSearchDiscovered?.(
      rawAllowlist,
    );
    if (updatedBaselineAllowlist) {
      config.toolFilterBaseline = {
        allowlist: [...updatedBaselineAllowlist],
        denylist: cloneToolList(
          config.toolFilterBaseline?.denylist ?? config.toolDenylist,
        ),
      };
    }

    const currentAllowlist = config.toolFilterBaseline?.allowlist ??
      effectiveAllowlist(config);
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
  let loopDetected = false;
  if (!lc.skipCompensation) {
    if (!anyDeniedThisTurn && result.toolCallsMade > 0) {
      const signature = buildToolSignature(result.toolCalls);
      if (signature && signature === state.lastToolSignature) {
        state.repeatToolCount += 1;
      } else {
        state.repeatToolCount = 1;
        state.lastToolSignature = signature;
      }
    } else {
      state.lastToolSignature = "";
      state.repeatToolCount = 0;
    }
  }

  if (!lc.skipCompensation && state.repeatToolCount >= lc.maxRepeatToolCalls) {
    loopDetected = true;
    config.onTrace?.({
      type: "loop_detected",
      signature: state.lastToolSignature,
      count: state.repeatToolCount,
    });
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

  const planDraftDirective = await maybeDraftPlanFromResearch(
    state,
    lc,
    config,
    llmFunction,
  );
  if (planDraftDirective) {
    return planDraftDirective;
  }

  if (loopDetected) {
    const repeatedTool = result.toolCalls[0]?.toolName;
    if (state.loopRecoverySignature !== state.lastToolSignature) {
      state.loopRecoverySignature = state.lastToolSignature;
      state.loopRecoveryStep = 0;
    }

    if (state.loopRecoveryStep === 0) {
      state.loopRecoveryStep = 1;
      addContextMessage(config, {
        role: "user",
        content:
          "You are repeating the same tool pattern without progress. Change approach now: inspect a different source, use tool_search, ask a concise clarification, or move to an edit/verification step. Do not repeat the same tool call batch.",
      });
      return { action: "continue" };
    }

    if (state.loopRecoveryStep === 1 && repeatedTool) {
      state.loopRecoveryStep = 2;
      state.temporaryToolDenylist.set(repeatedTool, 2);
      addContextMessage(config, {
        role: "user",
        content:
          `Loop recovery: '${repeatedTool}' is temporarily blocked for the next 2 turns. Use a different tool or ask_user instead of repeating it.`,
      });
      return { action: "continue" };
    }

    if (state.loopRecoveryStep === 2) {
      state.loopRecoveryStep = 3;
      addContextMessage(config, {
        role: "user",
        content:
          "Loop recovery escalation: do not repeat the prior tool pattern. Prefer tool_search, ask_user, or a concise final answer if you already have enough information.",
      });
      return { action: "continue" };
    }

    return {
      action: "return",
      value: [
        "Tool call loop detected.",
        "The same tool calls were repeated multiple times without progress.",
        "Please clarify the request or provide additional guidance.",
      ].join("\n"),
    };
  }

  state.loopRecoverySignature = undefined;
  state.loopRecoveryStep = 0;

  // Build citation source index from raw web tool payloads (for span attribution).
  const citationSources = buildCitationSourceIndex(
    buildCitationSourceItems(result.toolCalls, result.results),
  );
  mergePassageIndex(state, citationSources);

  // --- Web tool tracking (for mid-conversation reminders) ---
  state.lastToolsIncludedWeb = result.toolCalls.some(
    (tc) => isWebToolName(tc.toolName),
  ) || (result.nativeSources?.length ?? 0) > 0;

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
