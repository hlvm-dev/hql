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
  looksLikeToolCallTextEnvelope,
  parseToolCallTextEnvelope,
  responseAsksQuestion,
} from "./model-compat.ts";
import { renderEditFileRecoveryPrompt } from "./error-taxonomy.ts";
import { analyzeAssistantResponse } from "./response-analysis.ts";
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
import { callLLM, type LLMFunction } from "./orchestrator-llm.ts";
import type { ToolUse } from "./grounding.ts";
import { isMutatingTool } from "./security/safety.ts";
import {
  type BrowserRecoveryDecision,
  decideBrowserRecovery,
} from "./playwright/recovery-policy.ts";
import { hasStructuredPlaywrightVisualFailure } from "./playwright/failure-enrichment.ts";
import { startPlaywrightTraceCapture } from "./playwright/browser-manager.ts";
import {
  BROWSER_HYBRID_PROFILE_ID,
  clearToolProfileLayerFromTarget,
  ensureToolProfileState,
  resolvePersistentToolFilter,
  updateToolProfileLayer,
  widenBaselineForDomainProfile,
} from "./tool-profiles.ts";
import { runtimeDirective, runtimeNotice } from "./runtime-messages.ts";

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

async function resolveContextObservation(
  toolCall: ToolCall,
  toolResult: ToolExecutionResult,
  remainingObservationBytes: number,
  ownerId?: string,
): Promise<{
  observation: string;
  resultText: string;
  toolName: string;
  observationBytes: number;
  observationMode: "full" | "summary";
}> {
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
  const built = await buildToolObservation(
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
    observationMode: shouldUseSummary && built.usedRequestedObservation
      ? "summary"
      : "full",
  };
}

interface PlaywrightFailureCandidate {
  signature: string;
  toolName: string;
  errorText: string;
  failure: import("./tool-results.ts").ToolFailureMetadata;
  code?: string;
  kind: string;
  navigatedTo?: string;
  candidateHref?: string;
}

interface SelectedPlaywrightRecoveryCandidate {
  candidate: PlaywrightFailureCandidate;
  decision: BrowserRecoveryDecision | null;
  repeatCount: number;
}

function currentDomainProfileId(
  config: OrchestratorConfig,
): string | undefined {
  return config.toolProfileState?.layers.domain?.profileId;
}

const PLAYWRIGHT_VISUAL_LOOP_TOOL_NAMES = new Set([
  "pw_scroll",
  "pw_screenshot",
]);

const PLAYWRIGHT_RECOVERY_TEMP_DENY_TURNS = 2;

function collectPlaywrightFailureCandidates(
  result: {
    results: ToolExecutionResult[];
    toolCalls: ToolCall[];
  },
): PlaywrightFailureCandidate[] {
  const candidates: PlaywrightFailureCandidate[] = [];

  for (let index = 0; index < result.results.length; index++) {
    const toolCall = result.toolCalls[index];
    const toolResult = result.results[index];
    if (!toolCall?.toolName.startsWith("pw_")) continue;
    if (toolResult.success || !toolResult.failure) continue;
    const errorText = toolResult.error ?? toolResult.llmContent ?? "";
    candidates.push({
      signature: buildPlaywrightFailureSignature(
        toolCall.toolName,
        toolResult.failure,
      ),
      toolName: toolCall.toolName,
      errorText,
      failure: toolResult.failure,
      code: toolResult.failure.code,
      kind: toolResult.failure.kind,
      navigatedTo: typeof toolResult.failure.facts?.navigatedTo === "string"
        ? toolResult.failure.facts.navigatedTo
        : undefined,
      candidateHref: typeof toolResult.failure.facts?.candidateHref === "string"
        ? toolResult.failure.facts.candidateHref
        : undefined,
    });
  }

  return candidates;
}

function buildPlaywrightFailureSignature(
  toolName: string,
  failure: ToolExecutionResult["failure"] extends infer T ? T : never,
): string {
  if (failure && hasStructuredPlaywrightVisualFailure(failure)) {
    return `pw:${toolName}:visual_blocker`;
  }
  const code = failure?.code ?? failure?.kind ?? "unknown";
  return `pw:${toolName}:${code}`;
}

function playwrightRecoveryPriority(
  decision: BrowserRecoveryDecision | null,
  candidate: PlaywrightFailureCandidate,
): number {
  switch (decision?.stage) {
    case "direct_pw_alternative":
      return 0;
    case "download_destination_follow":
      return 1;
    case "promote_hybrid":
    case "repeat_visual_pw_guidance":
      return 2;
    case "repeat_structural_pw_guidance":
      return 3;
    default:
      return hasStructuredPlaywrightVisualFailure(candidate.failure) ? 4 : 5;
  }
}

function selectPlaywrightRecoveryCandidate(
  candidates: readonly PlaywrightFailureCandidate[],
  state: LoopState,
  config: OrchestratorConfig,
): SelectedPlaywrightRecoveryCandidate | null {
  if (candidates.length === 0) return null;

  const domainProfileId = currentDomainProfileId(config);
  let selected: SelectedPlaywrightRecoveryCandidate | null = null;

  for (const candidate of candidates) {
    const repeatCount = state.playwright.lastFailureSignature ===
        candidate.signature
      ? state.playwright.repeatFailureCount + 1
      : 1;
    const decision = decideBrowserRecovery({
      toolName: candidate.toolName,
      failure: candidate.failure,
      repeatCount,
      currentDomainProfileId: domainProfileId,
    });

    if (!selected) {
      selected = { candidate, decision, repeatCount };
      continue;
    }

    const nextPriority = playwrightRecoveryPriority(decision, candidate);
    const currentPriority = playwrightRecoveryPriority(
      selected.decision,
      selected.candidate,
    );
    if (nextPriority < currentPriority) {
      selected = { candidate, decision, repeatCount };
      continue;
    }

    if (
      nextPriority === currentPriority &&
      decision &&
      !selected.decision
    ) {
      selected = { candidate, decision, repeatCount };
    }
  }

  return selected;
}

function shouldCapturePlaywrightTrace(
  decision: BrowserRecoveryDecision,
): boolean {
  return decision.stage === "promote_hybrid" ||
    decision.stage === "repeat_visual_pw_guidance" ||
    decision.stage === "repeat_structural_pw_guidance";
}

function isPlaywrightVisualLoopTurn(
  result: {
    results: ToolExecutionResult[];
    toolCalls: ToolCall[];
  },
): boolean {
  if (
    result.toolCalls.length === 0 ||
    result.toolCalls.length !== result.results.length
  ) {
    return false;
  }
  for (let index = 0; index < result.toolCalls.length; index++) {
    const toolCall = result.toolCalls[index];
    const toolResult = result.results[index];
    if (
      !toolCall || !PLAYWRIGHT_VISUAL_LOOP_TOOL_NAMES.has(toolCall.toolName)
    ) {
      return false;
    }
    if (!toolResult.success) return false;
  }
  return true;
}

function buildPlaywrightVisualLoopMessage(): string {
  return [
    "Playwright is spending multiple turns on screenshots or scrolling without structural progress.",
    "Switch to pw_snapshot, pw_links, pw_content, or pw_evaluate.",
    "Do not continue visual browsing loops.",
  ].join("\n");
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
      content: runtimeNotice(
        `Too many tool calls (${toolCalls.length}). Only the first ${maxCalls} will be executed.`,
      ),
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
  let remainingObservationBytes =
    RESOURCE_LIMITS.maxToolObservationBytesPerTurn;
  for (let i = 0; i < results.length; i++) {
    const call = limitedCalls[i];
    const result = results[i];
    const {
      observation,
      resultText,
      toolName,
      observationBytes,
      observationMode,
    } = await resolveContextObservation(
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

    // Inject screenshot images as a user message so vision models can see them
    if (result.imageAttachments?.length) {
      if (config.visionCapable !== false) {
        addContextMessage(config, {
          role: "user",
          content: "[Screenshot attached]",
          roundId,
          attachments: result.imageAttachments.map((img, idx) => ({
            mode: "binary" as const,
            attachmentId: `cu-${call.id}-${idx}`,
            fileName: "screenshot.jpg",
            mimeType: img.mimeType,
            kind: "image" as const,
            conversationKind: "image" as const,
            size: img.data.length,
            data: img.data,
          })),
        });
      } else {
        const dims = result.imageAttachments
          .map((img) => `${img.width ?? "?"}x${img.height ?? "?"}`)
          .join(", ");
        addContextMessage(config, {
          role: "user",
          content:
            `[Screenshot captured (${dims}px) — not shown: model lacks vision]`,
          roundId,
        });
      }
    }

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
        content: runtimeDirective(
          hasPriorTools
            ? "Do not output tool call JSON. Provide a final answer based on the tool results."
            : "Native tool calling required. Do not output tool call JSON in text. Retry using structured tool calls.",
        ),
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
  if (
    !config.toolProfileState && !config.toolAllowlist && !config.toolDenylist
  ) {
    return await fn();
  }

  const profileState = ensureToolProfileState(config);
  const previousRuntimeLayer = profileState.layers.runtime
    ? {
      ...profileState.layers.runtime,
      allowlist: cloneToolList(profileState.layers.runtime.allowlist),
      denylist: cloneToolList(profileState.layers.runtime.denylist),
    }
    : undefined;
  const allToolNames = Object.keys(resolveTools({
    ownerId: config.toolOwnerId,
  }));

  updateToolProfileLayer(config, "runtime", {
    allowlist: undefined,
    denylist: allToolNames,
  });

  try {
    return await fn();
  } finally {
    if (previousRuntimeLayer) {
      updateToolProfileLayer(config, "runtime", previousRuntimeLayer);
    } else {
      clearToolProfileLayerFromTarget(config, "runtime");
    }
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
      const currentProfileState = ensureToolProfileState(config);
      const baselineLayer = currentProfileState.layers.baseline;
      updateToolProfileLayer(config, "baseline", {
        profileId: baselineLayer?.profileId,
        allowlist: executionAllowlist ? [...executionAllowlist] : undefined,
        denylist: config.planModeState.executionDenylist?.length
          ? [...config.planModeState.executionDenylist]
          : undefined,
        reason: "plan_execution_baseline",
      });
      updateToolProfileLayer(config, "plan", {
        allowlist: executionAllowlist ? [...executionAllowlist] : undefined,
        denylist: config.planModeState.executionDenylist?.length
          ? [...config.planModeState.executionDenylist]
          : undefined,
        reason: "plan_execution",
      });
    }
    lc.planningConfig.requireStepMarkers = true;
    addContextMessage(config, {
      role: "user",
      content: runtimeDirective([
        "The plan has been approved. Begin execution now.",
        formatPlanForExecution(plan, config.planModeState?.directFileTargets),
      ].join("\n\n")),
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
      content: runtimeDirective(
        "Revise the plan and emit a replacement PLAN block when ready. Stay in read-only planning mode.",
      ),
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
    const agentNames = (config.agentProfiles ?? []).map((agent) => agent.name);
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
    content: runtimeDirective(
      "Research is sufficient. Stop exploring and return ONLY a PLAN ... END_PLAN block using the gathered context.",
    ),
  });
  return { action: "continue" };
}

function extractClarifyingQuestion(response: string): string | null {
  const analysis = analyzeAssistantResponse(response);
  if (!analysis.asksQuestion || analysis.isGenericConversational) return null;
  return analysis.question;
}

function responseNeedsConcreteTask(response: string): boolean {
  return analyzeAssistantResponse(response).needsConcreteTask;
}

function responseLooksLikeWorkingNote(response: string): boolean {
  return analyzeAssistantResponse(response).isWorkingNote;
}

function buildDefaultFollowUpOptions(
  question: string,
): InteractionOption[] | undefined {
  if (!analyzeAssistantResponse(question).isBinaryQuestion) {
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

async function shouldConvertDefaultFollowUpToInteraction(
  response: string,
  state: LoopState,
  config: OrchestratorConfig,
): Promise<boolean> {
  if (!config.onInteraction) return false;
  if (config.planModeState?.active) return false;
  if (state.planState) return false;
  if (state.toolUses.length === 0) return false;
  const analysis = analyzeAssistantResponse(response);
  if (!analysis.asksQuestion || analysis.isGenericConversational) return false;
  return analysis.isBinaryQuestion || analysis.asksQuestion;
}

function shouldAutoContinuePrematureFollowUp(response: string): boolean {
  return analyzeAssistantResponse(response).isPrematureContinuationOffer;
}

const DOWNLOAD_REQUEST_PATTERN =
  /\b(download|installer|install\b|get the file|get the installer|save the file)\b/i;
const DOWNLOAD_ARTIFACT_PATTERN =
  /\b[A-Za-z0-9._-]+\.(?:dmg|pkg|zip|exe|msi|tar\.gz|tgz|deb|rpm|sh)\b/i;
const DIRECT_DOWNLOAD_URL_PATTERN =
  /https?:\/\/[^\s)`"'<>]+?\.(?:dmg|pkg|zip|exe|msi|tar\.gz|tgz|deb|rpm|sh)(?:\?[^\s)`"'<>]*)?/gi;
const SAVED_PATH_PATTERN = /(?:^|\n)Saved to:\s*(~?\/\S+|[A-Za-z]:\\\S+)/im;
const BACKTICKED_LOCAL_PATH_PATTERN = /`(~?\/[^`]+|[A-Za-z]:\\[^`]+)`/;

function responseContainsDownloadedFilename(response: string): boolean {
  return /(?:^|\n)Filename:\s*\S+/im.test(response) ||
    DOWNLOAD_ARTIFACT_PATTERN.test(response);
}

function responseContainsSavedPath(response: string): boolean {
  return SAVED_PATH_PATTERN.test(response) ||
    BACKTICKED_LOCAL_PATH_PATTERN.test(response);
}

function responseContainsDownloadArtifact(response: string): boolean {
  return responseContainsDownloadedFilename(response) &&
    responseContainsSavedPath(response);
}

function hasSuccessfulDownloadArtifact(toolUses: ToolUse[]): boolean {
  return toolUses.some((toolUse) =>
    toolUse.toolName === "pw_download" &&
    responseContainsDownloadArtifact(toolUse.result)
  );
}

function extractDirectDownloadUrls(text: string): string[] {
  const matches = text.match(DIRECT_DOWNLOAD_URL_PATTERN) ?? [];
  return matches.map((value) => value.trim()).filter(Boolean);
}

function shouldRunBrowserFinalAnswerGate(
  state: LoopState,
  config: OrchestratorConfig,
): boolean {
  return state.toolUses.some((toolUse) => toolUse.toolName.startsWith("pw_")) &&
    state.cachedDelegationSignal?.taskDomain === "browser" &&
    typeof config.currentUserRequest === "string" &&
    config.currentUserRequest.trim().length > 0;
}

async function assessBrowserFinalAnswer(
  state: LoopState,
  config: OrchestratorConfig,
  finalResponse: string,
): Promise<{ isComplete: boolean; missing: string | null }> {
  const userRequest = config.currentUserRequest?.trim() ?? "";
  if (!finalResponse.trim()) {
    return {
      isComplete: false,
      missing: "No final browser answer was provided.",
    };
  }

  if (DOWNLOAD_REQUEST_PATTERN.test(userRequest)) {
    const downloadUrls = [
      ...new Set([
        ...extractDirectDownloadUrls(finalResponse),
        ...state.toolUses.flatMap((toolUse) =>
          extractDirectDownloadUrls(toolUse.result)
        ),
      ]),
    ];
    if (!hasSuccessfulDownloadArtifact(state.toolUses)) {
      if (downloadUrls.length === 1) {
        return {
          isComplete: false,
          missing: `A direct downloadable file URL is already known (${
            downloadUrls[0]
          }). Call pw_download with url="${
            downloadUrls[0]
          }" now, then answer with Filename and Saved to.`,
        };
      }
      return {
        isComplete: false,
        missing:
          "The requested downloaded file artifact is still missing. Finish the download or state the exact blocker.",
      };
    }
    if (!responseContainsDownloadArtifact(finalResponse)) {
      return {
        isComplete: false,
        missing:
          "Name the downloaded file and where it was saved, or state the exact blocker.",
      };
    }
    return { isComplete: true, missing: null };
  }

  const { classifyBrowserFinalAnswer } = await import(
    "../runtime/local-llm.ts"
  );
  return classifyBrowserFinalAnswer(userRequest, finalResponse);
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
      content: runtimeDirective(
        buildToolRequiredMessage(
          effectiveAllowlist(config),
        ),
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

    // Check if the model is asking a clarifying question or the response needs
    // a concrete task — but only BEFORE the format retry is exhausted.
    if (state.finalResponseFormatRetries < 1) {
      const clarificationQuestion = extractClarifyingQuestion(
        finalResponse,
      );
      if (
        clarificationQuestion ||
        responseNeedsConcreteTask(finalResponse)
      ) {
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
        // No interaction handler — nudge the model with a format retry instead
        // of immediately giving up.
      }

      if (finalResponse.trim()) {
        state.finalResponseFormatRetries++;
        config.onAgentEvent?.({
          type: "planning_update",
          iteration: state.iterations,
          summary: finalResponse.slice(0, 300),
        });
        addContextMessage(config, {
          role: "user",
          content: runtimeDirective(
            "You are still in plan mode. Do not answer directly. Either ask one concise clarification with ask_user or return ONLY a PLAN ... END_PLAN block.",
          ),
        });
        return { action: "continue" };
      }
    }
    emitFinalResponseMeta();
    return {
      action: "return",
      value:
        "Plan mode could not produce a structured plan. Restate the task more concretely, or exit plan mode for general questions.",
    };
  }

  if (
    state.toolUses.length > 0 &&
    typeof config.currentUserRequest === "string" &&
    config.currentUserRequest.trim().length > 0 &&
    shouldAutoContinuePrematureFollowUp(finalResponse)
  ) {
    addContextMessage(config, {
      role: "user",
      content: runtimeDirective(
        "Do not ask the user for permission to continue with work already required by the original request. Continue and finish the requested task now.",
      ),
    });
    return { action: "continue" };
  }

  if (
    await shouldConvertDefaultFollowUpToInteraction(
      finalResponse,
      state,
      config,
    )
  ) {
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

  // Weak-model compensation: detect JSON in final answer before working-note
  // handling so tool-call JSON gets the more specific retry instruction.
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
        content: runtimeDirective(
          "Provide a final answer based on the tool results. Do not output tool call JSON.",
        ),
      });
      return { action: "continue" };
    }
    emitFinalResponseMeta();
    return { action: "return", value: finalResponse };
  }

  if (
    state.toolUses.length > 0 &&
    state.finalResponseFormatRetries < 1 &&
    responseLooksLikeWorkingNote(finalResponse)
  ) {
    state.finalResponseFormatRetries++;
    addContextMessage(config, {
      role: "user",
      content: runtimeDirective(
        "Do not narrate your next step as the final answer. Continue working until you can answer the user directly. If you are blocked, state the exact blocker and the evidence you already gathered.",
      ),
    });
    return { action: "continue" };
  }

  if (
    shouldRunBrowserFinalAnswerGate(state, config) &&
    state.playwright.finalAnswerRetries < 1
  ) {
    const assessment = await assessBrowserFinalAnswer(
      state,
      config,
      finalResponse,
    );
    if (!assessment.isComplete) {
      state.playwright.finalAnswerRetries++;
      addContextMessage(config, {
        role: "user",
        content: runtimeDirective(
          `The browser task is not fully answered yet. ${
            assessment.missing ??
              "Provide the direct answer now, or use another browser tool only if you still need evidence."
          } Do not narrate next steps.`,
        ),
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
        content: runtimeDirective(
          `Plan tracking required. End your response with STEP_DONE ${id} when the step is complete.`,
        ),
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
        content: runtimeDirective(
          `Plan step completed. Next step: [${advance.nextStep.id}] ${advance.nextStep.title}. Continue.`,
        ),
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
      content: runtimeDirective(
        "No-input mode: Do not ask questions. Provide a best-effort answer based on available tool results and reasonable assumptions.",
      ),
    });
    return { action: "continue" };
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
    const grounding = await checkGrounding(
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
        addContextMessage(config, {
          role: "user",
          content: runtimeDirective(warningText),
        });
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
      const nextCount = toolResult.failure?.kind === "permission_denied"
        ? lc.maxDenials
        : currentCount + 1;
      state.denialCountByTool.set(toolName, nextCount);

      if (nextCount >= lc.maxDenials) {
        addContextMessage(config, {
          role: "user",
          content: runtimeNotice(
            `Maximum denials (${lc.maxDenials}) reached for tool '${toolName}'. Consider using ask_user tool to clarify requirements or try a different approach.`,
          ),
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
    const finalResponse = await callLLM(
      llmFunction,
      config.context.getMessages(),
      {
        timeout: lc.llmTimeout,
        signal: config.signal,
        callOptions: { disableTools: true },
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
      role: "user",
      content: runtimeDirective(renderEditFileRecoveryPrompt(editFileRecovery)),
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
      const currentProfileState = ensureToolProfileState(config);
      const baselineLayer = currentProfileState.layers.baseline;
      updateToolProfileLayer(config, "baseline", {
        profileId: baselineLayer?.profileId,
        allowlist: [...updatedBaselineAllowlist],
        denylist: cloneToolList(baselineLayer?.denylist),
        reason: baselineLayer?.reason,
      });
    }

    const currentAllowlist = config.toolProfileState
      ? resolvePersistentToolFilter(config.toolProfileState).allowlist
      : config.toolAllowlist;
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

    clearToolProfileLayerFromTarget(config, "runtime");
    updateToolProfileLayer(config, "discovery", {
      allowlist: nextAllowlist,
      reason: "tool_search_narrowing",
    });

    const preview = nextAllowlist.slice(0, 12).join(", ");
    const extra = nextAllowlist.length > 12
      ? ` (+${nextAllowlist.length - 12} more)`
      : "";
    addContextMessage(config, {
      role: "user",
      content: runtimeNotice(
        `Tool context narrowed to: ${preview}${extra}. Continue using this focused tool set unless another tool_search changes it.`,
      ),
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

  const selectedPlaywrightRecovery = selectPlaywrightRecoveryCandidate(
    collectPlaywrightFailureCandidates(result),
    state,
    config,
  );
  const playwrightFailure = selectedPlaywrightRecovery?.candidate ?? null;
  if (playwrightFailure && selectedPlaywrightRecovery) {
    if (state.playwright.lastFailureSignature === playwrightFailure.signature) {
      state.playwright.repeatFailureCount =
        selectedPlaywrightRecovery.repeatCount;
    } else {
      state.playwright.lastFailureSignature = playwrightFailure.signature;
      state.playwright.repeatFailureCount =
        selectedPlaywrightRecovery.repeatCount;
      state.playwright.notifiedRecoveryKey = undefined;
    }
  } else {
    state.playwright.lastFailureSignature = undefined;
    state.playwright.repeatFailureCount = 0;
    state.playwright.notifiedRecoveryKey = undefined;
  }

  if (playwrightFailure && selectedPlaywrightRecovery) {
    const decision = selectedPlaywrightRecovery.decision;
    if (decision) {
      const recoveryKey = `${playwrightFailure.signature}:${decision.stage}`;
      if (state.playwright.notifiedRecoveryKey !== recoveryKey) {
        let tracePath: string | undefined;
        if (shouldCapturePlaywrightTrace(decision)) {
          tracePath = await startPlaywrightTraceCapture(
            `${playwrightFailure.signature}:${decision.stage}`,
            config.sessionId,
          ).catch(() => undefined);
        }
        if (decision.promoteToHybrid) {
          widenBaselineForDomainProfile(config, BROWSER_HYBRID_PROFILE_ID);
          updateToolProfileLayer(config, "domain", {
            profileId: BROWSER_HYBRID_PROFILE_ID,
            reason:
              `browser_recovery:${playwrightFailure.signature}:${decision.stage}`,
          });
          // Clear the runtime layer — it may hold a stale browser_safe
          // allowlist from applyAdaptiveToolPhase that would mask the
          // newly-added hybrid tools via intersection.
          clearToolProfileLayerFromTarget(config, "runtime");
        }
        if (decision.temporarilyBlockTool) {
          state.playwright.temporaryToolDenylist.set(
            decision.temporarilyBlockTool,
            PLAYWRIGHT_RECOVERY_TEMP_DENY_TURNS,
          );
        }
        state.playwright.notifiedRecoveryKey = recoveryKey;
        const directive = decision.temporarilyBlockTool
          ? `${decision.directive}\n${decision.temporarilyBlockTool} is temporarily blocked for the next ${PLAYWRIGHT_RECOVERY_TEMP_DENY_TURNS} turns. Use a different browser strategy now.`
          : decision.directive;
        if (tracePath) {
          config.onTrace?.({
            type: "playwright_trace",
            status: "started",
            reason: decision.stage,
            path: tracePath,
          });
        }
        addContextMessage(config, {
          role: "user",
          content: runtimeDirective(directive),
        });
        return { action: "continue" };
      }
    }
  }

  if (isPlaywrightVisualLoopTurn(result)) {
    state.playwright.repeatVisualLoopCount =
      (state.playwright.repeatVisualLoopCount) + 1;
  } else {
    state.playwright.repeatVisualLoopCount = 0;
    state.playwright.notifiedVisualLoop = false;
  }

  if (
    (state.playwright.repeatVisualLoopCount) >= 4 &&
    !state.playwright.notifiedVisualLoop
  ) {
    state.playwright.notifiedVisualLoop = true;
    addContextMessage(config, {
      role: "user",
      content: runtimeDirective(buildPlaywrightVisualLoopMessage()),
    });
    return { action: "continue" };
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
        content: runtimeDirective(
          "You are repeating the same tool pattern without progress. Change approach now: inspect a different source, use tool_search, ask a concise clarification, or move to an edit/verification step. Do not repeat the same tool call batch.",
        ),
      });
      return { action: "continue" };
    }

    if (state.loopRecoveryStep === 1 && repeatedTool) {
      state.loopRecoveryStep = 2;
      state.playwright.temporaryToolDenylist.set(
        repeatedTool,
        PLAYWRIGHT_RECOVERY_TEMP_DENY_TURNS,
      );
      addContextMessage(config, {
        role: "user",
        content: runtimeDirective(
          `Loop recovery: '${repeatedTool}' is temporarily blocked for the next ${PLAYWRIGHT_RECOVERY_TEMP_DENY_TURNS} turns. Use a different tool or ask_user instead of repeating it.`,
        ),
      });
      return { action: "continue" };
    }

    if (state.loopRecoveryStep === 2) {
      state.loopRecoveryStep = 3;
      addContextMessage(config, {
        role: "user",
        content: runtimeDirective(
          "Loop recovery escalation: do not repeat the prior tool pattern. Prefer tool_search, ask_user, or a concise final answer if you already have enough information.",
        ),
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
