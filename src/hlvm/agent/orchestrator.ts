/**
 * ReAct Orchestrator - Main AI agent loop
 *
 * Implements ReAct (Reasoning + Acting) pattern:
 * 1. Agent generates reasoning (Thought)
 * 2. Agent calls tool (Action)
 * 3. Tool returns result (Observation)
 * 4. Repeat until task complete
 *
 * Features:
 * - Native tool calling execution
 * - Safety checks before execution
 * - Context management
 * - Error handling with retry
 * - SSOT-compliant (uses all previous components)
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
import {
  ContextManager,
  ContextOverflowError,
  type Message,
} from "./context.ts";
import {
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_TIMEOUTS,
  MAX_ITERATIONS,
  MAX_RETRIES,
  RATE_LIMITS,
  RESOURCE_LIMITS,
} from "./constants.ts";
import { withTimeout } from "../../common/timeout-utils.ts";
import {
  type RateLimitConfig,
  RateLimitError,
  SlidingWindowRateLimiter,
} from "../../common/rate-limiter.ts";
import { assertMaxBytes } from "../../common/limits.ts";
import {
  getErrorMessage,
  truncate,
} from "../../common/utils.ts";
import { RuntimeError } from "../../common/error.ts";
import { checkGrounding, type ToolUse } from "./grounding.ts";
import { classifyError, getRecoveryHint } from "./error-taxonomy.ts";
import type { AgentPolicy } from "./policy.ts";
import { estimateUsage, type TokenUsage, UsageTracker } from "./usage.ts";
import type { MetricsSink } from "./metrics.ts";
import { normalizeToolArgs } from "./validation.ts";
import { type LLMResponse, type ToolCall } from "./tool-call.ts";
import { log } from "../api/log.ts";

export type { LLMResponse, ToolCall } from "./tool-call.ts";
import { getAgentProfile, listAgentProfiles } from "./agent-registry.ts";
import {
  looksLikeToolCallJsonAnywhere,
  responseAsksQuestion,
  tryParseToolCallsFromText,
} from "./model-compat.ts";
import {
  ensurePlaywrightChromium,
  isPlaywrightMissingError,
} from "./playwright-support.ts";
import { clearToolDefCache } from "./llm-integration.ts";

import {
  advancePlanState,
  createPlanState,
  extractStepDoneId,
  formatPlanForContext,
  type Plan,
  type PlanningConfig,
  type PlanState,
  requestPlan,
  shouldPlanRequest,
  stripStepMarkers,
} from "./planning.ts";

// ============================================================
// Types
// ============================================================

/** Result of tool execution */
interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  llmContent?: string;
  returnDisplay?: string;
  error?: string;
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch (error) {
    // Fix 20: Detect circular references and report clearly
    const msg = getErrorMessage(error);
    if (msg.includes("circular") || msg.includes("Converting circular")) {
      return "[Error: Tool returned circular reference data]";
    }
    return String(result ?? "");
  }
}

function buildToolResultOutputs(
  toolName: string,
  result: unknown,
  config: OrchestratorConfig,
): { llmContent: string; returnDisplay: string } {
  let formatted: { returnDisplay: string; llmContent?: string } | null = null;
  try {
    const tool = hasTool(toolName) ? getTool(toolName) : null;
    formatted = tool?.formatResult ? tool.formatResult(result) : null;
  } catch {
    formatted = null;
  }

  if (formatted && formatted.returnDisplay) {
    const returnDisplay = formatted.returnDisplay;
    const llmContent = formatted.llmContent ??
      config.context.truncateResult(returnDisplay);
    return { llmContent, returnDisplay };
  }

  const returnDisplay = stringifyToolResult(result);
  const llmContent = config.context.truncateResult(returnDisplay);
  return { llmContent, returnDisplay };
}

/** Check if tool result content indicates failure despite no exception.
 *  Only matches small, explicit {success: false, error: "..."} payloads. */
function isToolResultFailure(content: string): boolean {
  if (!content.startsWith("{") || content.length > 500) return false;
  try {
    const parsed = JSON.parse(content);
    if (
      parsed && typeof parsed === "object" &&
      parsed.success === false &&
      typeof parsed.error === "string" &&
      parsed.error.length > 0
    ) return true;
  } catch { /* not JSON */ }
  return false;
}

function buildToolObservation(
  toolCall: ToolCall,
  toolResult: ToolExecutionResult,
): { observation: string; resultText: string; toolName: string } {
  if (toolResult.success) {
    const resultText = toolResult.llmContent ?? stringifyToolResult(toolResult.result);
    // Detect tools that return error-as-data (success but content says failure)
    if (isToolResultFailure(resultText)) {
      const hint = getRecoveryHint(resultText);
      const observation = hint
        ? `${resultText}\nHint: ${hint}`
        : resultText;
      return { observation, resultText, toolName: toolCall.toolName };
    }
    return { observation: resultText, resultText, toolName: toolCall.toolName };
  }

  const errorText = toolResult.error ?? "Unknown error";
  const hint = getRecoveryHint(errorText);
  const observation = hint
    ? `Error: ${errorText}\nHint: ${hint}`
    : `Error: ${errorText}`;

  return { observation, resultText: `ERROR: ${errorText}`, toolName: toolCall.toolName };
}

/** Deduplicate identical tool calls (same name + same args) within a single turn */
function deduplicateToolCalls(calls: ToolCall[]): ToolCall[] {
  if (calls.length <= 1) return calls;
  const seen = new Set<string>();
  return calls.filter((call) => {
    const key = `${call.toolName}:${JSON.stringify(call.args, Object.keys(call.args ?? {}).sort())}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(args).filter(([, value]) =>
    value !== undefined
  );
  return Object.fromEntries(entries);
}

function buildToolErrorResult(
  toolName: string,
  error: string,
  startedAt: number,
  config: OrchestratorConfig,
): ToolExecutionResult {
  const result = {
    success: false,
    error,
    llmContent: error,
    returnDisplay: error,
  };

  config.onTrace?.({
    type: "tool_result",
    toolName,
    success: false,
    error,
    display: error,
  });
  config.onToolDisplay?.({
    toolName,
    success: false,
    content: error,
  });
  emitMetric(config, "tool_result", {
    toolName,
    success: false,
    error,
    durationMs: Date.now() - startedAt,
  });

  return result;
}

/** Cached Sets for allow/deny lookups (O(1) membership, O(n) key build). */
let _cachedAllowSet: { key: string; set: Set<string> } | null = null;
let _cachedDenySet: { key: string; set: Set<string> } | null = null;

function listCacheKey(list: string[]): string {
  // Null-byte separator is collision-free since tool names never contain \0
  return list.join("\0");
}

function getOrCreateSet(
  list: string[],
  cached: { key: string; set: Set<string> } | null,
): { key: string; set: Set<string> } {
  const key = listCacheKey(list);
  if (cached && cached.key === key) return cached;
  return { key, set: new Set(list) };
}

function isToolAllowed(
  toolName: string,
  config: OrchestratorConfig,
): boolean {
  if (config.toolAllowlist && config.toolAllowlist.length > 0) {
    _cachedAllowSet = getOrCreateSet(config.toolAllowlist, _cachedAllowSet);
    return _cachedAllowSet.set.has(toolName);
  }
  if (config.toolDenylist && config.toolDenylist.length > 0) {
    _cachedDenySet = getOrCreateSet(config.toolDenylist, _cachedDenySet);
    return !_cachedDenySet.set.has(toolName);
  }
  return true;
}

/** LLM function signature used by orchestrator */
export type LLMFunction = (
  messages: Message[],
  signal?: AbortSignal,
) => Promise<LLMResponse>;

/** Trace event for observability/debugging */
export type TraceEvent =
  | { type: "iteration"; current: number; max: number }
  | { type: "llm_call"; messageCount: number }
  | {
    type: "llm_response";
    length: number;
    truncated: string;
    content?: string;
    toolCalls?: number;
  }
  | { type: "tool_call"; toolName: string; args: unknown }
  | {
    type: "tool_result";
    toolName: string;
    success: boolean;
    result?: unknown;
    error?: string;
    display?: string;
  }
  | { type: "plan_created"; plan: Plan }
  | { type: "plan_step"; stepId: string; index: number; completed: boolean }
  | {
    type: "llm_retry";
    attempt: number;
    max: number;
    class: string;
    retryable: boolean;
    error: string;
  }
  | { type: "context_overflow"; maxTokens: number; estimatedTokens: number }
  | {
    type: "grounding_check";
    mode: "off" | "warn" | "strict";
    grounded: boolean;
    warnings: string[];
    retry: number;
    maxRetry: number;
  }
  | {
    type: "rate_limit";
    target: "llm" | "tool";
    maxCalls: number;
    windowMs: number;
    used: number;
    remaining: number;
    resetMs: number;
  }
  | {
    type: "resource_limit";
    kind: "tool_result_bytes";
    limit: number;
    used: number;
  }
  | {
    type: "llm_usage";
    usage: TokenUsage;
  }
  | { type: "loop_detected"; signature: string; count: number };

/** Tool output event for UI display */
export interface ToolDisplay {
  toolName: string;
  success: boolean;
  content: string;
}

/** Orchestrator configuration */
export interface OrchestratorConfig {
  /** Workspace directory for tool execution */
  workspace: string;
  /** Context manager for message history */
  context: ContextManager;
  /** Auto-approve all tool calls (for testing/automation) */
  autoApprove?: boolean;
  /** Maximum tool calls per turn (prevent infinite loops) */
  maxToolCalls?: number;
  /** Maximum consecutive denials before stopping (default: 3) */
  maxDenials?: number;
  /** Trace callback for observability (verbose/debug mode) */
  onTrace?: (event: TraceEvent) => void;
  /** Tool output callback for UI display */
  onToolDisplay?: (display: ToolDisplay) => void;
  /** LLM timeout in milliseconds (default: 60000) */
  llmTimeout?: number;
  /** Tool timeout in milliseconds (default: 60000) */
  toolTimeout?: number;
  /** Maximum retries for LLM calls (default: 3) */
  maxRetries?: number;
  /** Maximum consecutive identical tool call batches before stopping */
  maxToolCallRepeat?: number;
  /** Continue executing remaining tool calls even if one fails (default: true) */
  continueOnError?: boolean;
  /** Grounding enforcement mode (default: "off") */
  groundingMode?: "off" | "warn" | "strict";
  /** Rate limit for LLM calls (per sliding window) */
  llmRateLimit?: RateLimitConfig;
  /** Rate limit for tool calls (per sliding window) */
  toolRateLimit?: RateLimitConfig;
  /** Max total tool result bytes per run */
  maxTotalToolResultBytes?: number;
  /** Internal prebuilt rate limiter (LLM) */
  llmRateLimiter?: SlidingWindowRateLimiter | null;
  /** Internal prebuilt rate limiter (tools) */
  toolRateLimiter?: SlidingWindowRateLimiter | null;
  /** Optional policy overrides (allow/deny/ask) */
  policy?: AgentPolicy | null;
  /** Internal: prevent repeated Playwright install prompts */
  playwrightInstallAttempted?: boolean;
  /** Optional usage tracker for LLM token accounting */
  usage?: UsageTracker;
  /** Optional metrics sink for structured events */
  metrics?: MetricsSink;
  /** Planning configuration (optional) */
  planning?: PlanningConfig;
  /** Optional delegate handler for multi-agent orchestration */
  delegate?: (
    args: unknown,
    config: OrchestratorConfig,
  ) => Promise<unknown>;
  /** Optional tool allowlist (restrict tools for this run) */
  toolAllowlist?: string[];
  /** Optional tool denylist (block tools for this run) */
  toolDenylist?: string[];
  /** Require at least one tool call before answering */
  requireToolCalls?: boolean;
  /** Max retries when tool calls are required */
  maxToolCallRetries?: number;
  /** No-input mode: do not ask the user questions */
  noInput?: boolean;
  /** Skip weak-model compensation heuristics (for frontier models like Claude, GPT-4o, Gemini) */
  skipModelCompensation?: boolean;
  /** External abort signal (from HTTP request cancellation) */
  signal?: AbortSignal;
}

/** Reusable TextEncoder (stateless, no need to recreate) */
const TEXT_ENCODER = new TextEncoder();

function addContextMessage(
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
      emitMetric(config, "context_overflow", {
        maxTokens: error.maxTokens,
        estimatedTokens: error.estimatedTokens,
      });
    }
    throw error;
  }
}

function isRenderToolName(toolName: string): boolean {
  return toolName === "render_url" || toolName.endsWith("/render_url");
}

/** Fix 22: Case-insensitive loop detection for string values */
function buildToolSignature(calls: ToolCall[]): string {
  if (calls.length === 0) return "";
  return calls
    .map((call) => {
      const args = JSON.stringify(call.args, Object.keys(call.args ?? {}).sort());
      return `${call.toolName}:${args.toLowerCase()}`;
    })
    .sort()
    .join("|");
}

function buildToolRequiredMessage(allowlist?: string[]): string {
  const tools = allowlist && allowlist.length > 0
    ? allowlist.join(", ")
    : "the available tools";
  return [
    "Tool use is required to complete this request.",
    `Use one of: ${tools}.`,
    "Call the appropriate tool using native function calling.",
  ].join("\n");
}

function emitMetric(
  config: OrchestratorConfig,
  type: string,
  data: Record<string, unknown>,
): void {
  if (!config.metrics) return;
  config.metrics.emit({
    ts: Date.now(),
    type,
    data,
  });
}

/** Combined trace + metric + tool display for successful tool results (DRY helper) */
function emitToolSuccess(
  config: OrchestratorConfig,
  toolName: string,
  llmContent: string,
  returnDisplay: string,
  startedAt: number,
): void {
  config.onTrace?.({
    type: "tool_result",
    toolName,
    success: true,
    result: llmContent,
    display: returnDisplay,
  });
  config.onToolDisplay?.({
    toolName,
    success: true,
    content: returnDisplay,
  });
  emitMetric(config, "tool_result", {
    toolName,
    success: true,
    durationMs: Date.now() - startedAt,
  });
}

function createRateLimiter(
  config: RateLimitConfig | undefined,
): SlidingWindowRateLimiter | null {
  if (!config) return null;
  if (config.maxCalls <= 0 || config.windowMs <= 0) return null;
  return new SlidingWindowRateLimiter(config);
}

// ============================================================
// Tool Execution
// ============================================================

/**
 * Execute single tool call
 *
 * Performs:
 * 1. Tool validation (exists in registry)
 * 2. Safety check (with user confirmation if needed)
 * 3. Tool execution
 * 4. Result truncation (if needed)
 *
 * @param toolCall Tool call to execute
 * @param config Orchestrator configuration
 * @returns Execution result
 *
 * @example
 * ```ts
 * const result = await executeToolCall(
 *   { toolName: "read_file", args: { path: "src/main.ts" } },
 *   { workspace: "/project", context, autoApprove: true }
 * );
 *
 * if (result.success) {
 *   console.log("Result:", result.result);
 * }
 * ```
 */
export async function executeToolCall(
  toolCall: ToolCall,
  config: OrchestratorConfig,
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  // Normalize tool name (handle camelCase, casing, separators)
  const resolvedName = normalizeToolName(toolCall.toolName) ??
    toolCall.toolName;
  if (resolvedName !== toolCall.toolName) {
    log.debug(`Tool name normalized: ${toolCall.toolName} → ${resolvedName}`);
    toolCall = { ...toolCall, toolName: resolvedName };
  }

  const normalizedArgs = sanitizeArgs(normalizeToolArgs(toolCall.args));
  const toolExists = hasTool(toolCall.toolName);
  const preparedArgs = toolExists
    ? prepareToolArgsForExecution(toolCall.toolName, normalizedArgs)
    : undefined;
  const coercedArgs = preparedArgs?.coercedArgs ?? normalizedArgs;
  // Emit trace event: tool call
  config.onTrace?.({
    type: "tool_call",
    toolName: toolCall.toolName,
    args: coercedArgs,
  });
  emitMetric(config, "tool_call", {
    toolName: toolCall.toolName,
  });

  try {
    // Validate tool exists
    if (!toolExists) {
      const suggestions = suggestToolNames(toolCall.toolName);
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

    if (!isToolAllowed(toolCall.toolName, config)) {
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
      );
      return {
        success: true,
        result,
        llmContent,
        returnDisplay,
      };
    }

    // Get tool and execute (with timeout)
    const tool = getTool(toolCall.toolName);
    const toolTimeout = config.toolTimeout ?? DEFAULT_TIMEOUTS.tool;
    let result: unknown;
    try {
      result = await executeToolWithTimeout(
        tool.fn,
        coercedArgs,
        config.workspace,
        toolTimeout,
        config.policy ?? null,
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
 *
 * @param toolCalls Tool calls to execute
 * @param config Orchestrator configuration
 * @returns Array of execution results
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  config: OrchestratorConfig,
): Promise<ToolExecutionResult[]> {
  const continueOnError = config.continueOnError ?? true;
  const toolLimiter = config.toolRateLimiter ??
    createRateLimiter(config.toolRateLimit ?? RATE_LIMITS.toolCalls);
  config.toolRateLimiter = toolLimiter;

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
    emitMetric(config, "rate_limit", {
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

  // Sequential execution: stop on first error
  if (!continueOnError) {
    const results: ToolExecutionResult[] = [];
    for (const call of toolCalls) {
      const rateLimited = checkRateLimit();
      if (rateLimited) {
        results.push(rateLimited);
        break;
      }
      const result = await executeToolCall(call, config);
      results.push(result);
      if (!result.success) break;
    }
    return results;
  }

  // Parallel execution (default): run all calls concurrently
  const promises = toolCalls.map((call): Promise<ToolExecutionResult> => {
    const rateLimited = checkRateLimit();
    if (rateLimited) return Promise.resolve(rateLimited);
    return executeToolCall(call, config);
  });
  return Promise.all(promises);
}

// ============================================================
// ReAct Loop
// ============================================================

/**
 * Process agent response and execute tool calls
 *
 * Main orchestration function:
 * 1. Add agent response to context
 * 2. Execute structured tool calls with safety checks
 * 3. Add tool results to context
 * 4. Return results for next agent turn
 *
 * @param agentResponse Agent's response (may contain tool calls)
 * @param config Orchestrator configuration
 * @returns Tool execution results and whether to continue
 *
 * @example
 * ```ts
 * // Agent generates response with tool call
 * const agentResponse = {
 *   content: "Let me read that file.",
 *   toolCalls: [{ toolName: "read_file", args: { path: "src/main.ts" } }],
 * };
 *
 * const result = await processAgentResponse(
 *   agentResponse,
 *   { workspace: "/project", context, autoApprove: true }
 * );
 *
 * if (result.toolCallsMade > 0) {
 *   // Continue conversation with tool results
 *   const observation = result.results[0];
 *   // Send observation back to agent...
 * }
 * ```
 */
export async function processAgentResponse(
  agentResponse: LLMResponse,
  config: OrchestratorConfig,
): Promise<{
  toolCallsMade: number;
  results: ToolExecutionResult[];
  toolCalls: ToolCall[]; // Added for per-tool denial tracking (Issue #6)
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
  // Weak models sometimes emit the same call multiple times.
  const toolCalls = deduplicateToolCalls(rawToolCalls);

  if (toolCalls.length === 0) {
    // No tool calls — just add the assistant text
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

  // Always add assistant message with tool_calls metadata for proper conversation flow
  addContextMessage(config, {
    role: "assistant",
    content: content || "",
    toolCalls: toolCalls.map((tc) => ({
      id: tc.id,
      function: { name: tc.toolName, arguments: tc.args },
    })),
  });

  if (toolCalls.length > maxCalls) {
    addContextMessage(config, {
      role: "user",
      content:
        `Too many tool calls (${toolCalls.length}). Only the first ${maxCalls} will be executed.`,
    });
  }

  let limitedCalls = toolCalls.slice(0, maxCalls);

  // Fix 3: complete_task preempts other tool calls — only execute it
  const completeTaskPreemptIndex = limitedCalls.findIndex((c) => c.toolName === "complete_task");
  if (completeTaskPreemptIndex >= 0) {
    limitedCalls = [limitedCalls[completeTaskPreemptIndex]];
  }

  // Execute tool calls
  const results = await executeToolCalls(limitedCalls, config);

  // Add tool results to context + gather tool uses
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
    toolCalls: limitedCalls, // Return executed tool calls for denial tracking
    toolUses,
    toolBytes,
    shouldContinue: completeIndex < 0,
    finalResponse,
  };
}

// ============================================================
// Timeout/Retry Logic (Week 3)
// ============================================================

/**
 * Call LLM with timeout
 *
 * Wraps LLM call with timeout to prevent hangs.
 *
 * ⚠️ KNOWN LIMITATION: Promise.race rejects on timeout, but LLM stream
 * continues consuming! This is a resource leak that needs architectural fix.
 * See: Issue #5 (LLM timeouts don't abort streaming)
 *
 * FUTURE FIX: Requires LLM provider API to support:
 * - AbortSignal/AbortController in ai.chat()
 * - Generator cleanup/cancellation
 * - Proper stream abortion
 *
 * @param llmFn LLM function to call
 * @param messages Messages to send
 * @param timeout Timeout in milliseconds
 * @returns LLM response
 * @throws Error if timeout exceeded
 */
async function callLLMWithTimeout(
  llmFn: LLMFunction,
  messages: Message[],
  timeout: number,
): Promise<LLMResponse> {
  // All built-in providers forward AbortSignal to fetch(); timeout abort is honored.
  return await withTimeout(
    async (signal) => {
      const response = await llmFn(messages, signal);
      if (signal.aborted) {
        throw new RuntimeError("LLM call aborted");
      }
      return response;
    },
    { timeoutMs: timeout, label: "LLM call" },
  );
}

/**
 * Call LLM with retry and exponential backoff
 *
 * Retries LLM call on failure with exponential backoff.
 * Backoff schedule: 1s, 2s, 4s, 8s, ...
 *
 * @param llmFn LLM function to call
 * @param messages Messages to send
 * @param config Retry configuration
 * @returns LLM response
 * @throws Error if all retries exhausted
 */
async function callLLMWithRetry(
  llmFn: LLMFunction,
  messages: Message[],
  config: { timeout: number; maxRetries: number },
  onTrace?: (event: TraceEvent) => void,
): Promise<LLMResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      return await callLLMWithTimeout(llmFn, messages, config.timeout);
    } catch (error) {
      lastError = error as Error;

      const classified = classifyError(error);
      onTrace?.({
        type: "llm_retry",
        attempt: attempt + 1,
        max: config.maxRetries,
        class: classified.class,
        retryable: classified.retryable,
        error: classified.message,
      });
      if (!classified.retryable) {
        // Non-retryable: throw immediately with the original error message
        throw lastError;
      }

      // Don't retry on last attempt
      if (attempt === config.maxRetries - 1) break;

      // Fix 12: Honor Retry-After header from provider error messages
      const retryAfterMatch = classified.message.match(/retry-after: (\d+)s/);
      const retryAfterMs = retryAfterMatch
        ? parseInt(retryAfterMatch[1]) * 1000
        : null;
      // Exponential backoff: 1s, 2s, 4s, 8s — or provider's Retry-After
      const delay = retryAfterMs ?? Math.min(Math.pow(2, attempt) * 1000, 30000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new RuntimeError(
    `LLM failed after ${config.maxRetries} retries: ${lastError?.message}`,
  );
}

/**
 * Execute tool with timeout
 *
 * Wraps tool execution with timeout to prevent hangs.
 *
 * ⚠️ KNOWN LIMITATION: Promise.race rejects on timeout, but underlying process
 * continues running! This is a resource leak that needs architectural fix.
 * See: Issue #4 (Tool timeouts don't cancel processes)
 *
 * FUTURE FIX: Requires platform.command API to support:
 * - AbortSignal/AbortController
 * - Process kill on timeout
 * - Proper cleanup of file descriptors/handles
 *
 * @param toolFn Tool function to execute
 * @param args Tool arguments
 * @param workspace Workspace path
 * @param timeout Timeout in milliseconds
 * @returns Tool result
 * @throws Error if timeout exceeded
 */
async function executeToolWithTimeout(
  toolFn: ToolFunction,
  args: unknown,
  workspace: string,
  timeout: number,
  policy?: AgentPolicy | null,
): Promise<unknown> {
  // NOTE: If toolFn doesn't honor AbortSignal, underlying work may continue.
  return await withTimeout(
    async (signal) => {
      const result = await toolFn(args, workspace, { signal, policy });
      if (signal.aborted) {
        throw new RuntimeError("Tool execution aborted");
      }
      return result;
    },
    { timeoutMs: timeout, label: "Tool execution" },
  );
}

// ============================================================
// ReAct Loop
// ============================================================

/**
 * Run full ReAct loop
 *
 * Orchestrates the complete Think → Act → Observe cycle:
 * 1. Add user request to context
 * 2. Loop (up to MAX_ITERATIONS):
 *    a. Call LLM with timeout/retry
 *    b. Parse tool calls (native or text-repair fallback)
 *    c. Execute tools with safety checks and rate limiting
 *    d. Add results to context, continue until agent finishes
 * 3. Apply grounding checks, loop detection, and no-input guards
 *
 * @param userRequest User's request/question
 * @param config Orchestrator configuration
 * @param llmFunction Function to call LLM (dependency injection for testing)
 * @returns Final agent response
 */
export async function runReActLoop(
  userRequest: string,
  config: OrchestratorConfig,
  llmFunction: LLMFunction,
): Promise<string> {
  // Destructure frequently accessed config once
  const {
    context,
    onTrace,
  } = config;

  // Clear module-level caches to avoid stale data across runs
  _cachedAllowSet = null;
  _cachedDenySet = null;
  clearToolDefCache();

  // Total wall-clock timeout for the entire ReAct loop
  const totalTimeout = DEFAULT_TIMEOUTS.total;
  const loopDeadline = Date.now() + totalTimeout;

  // Add user request to context
  addContextMessage(config, {
    role: "user",
    content: userRequest,
  });

  // Initialize usage tracker if not provided
  const usageTracker = config.usage ?? new UsageTracker();
  config.usage = usageTracker;
  let iterations = 0;
  const maxIterations = MAX_ITERATIONS;

  // Denial tracking - per tool (Issue #6)
  const denialCountByTool = new Map<string, number>();
  const maxDenials = config.maxDenials ?? 3;

  // Timeout/retry configuration
  const llmTimeout = config.llmTimeout ?? DEFAULT_TIMEOUTS.llm;
  const maxRetries = config.maxRetries ?? MAX_RETRIES;
  const groundingMode = config.groundingMode ?? "off";
  const llmRateConfig = config.llmRateLimit ?? RATE_LIMITS.llmCalls;
  const llmLimiter = config.llmRateLimiter ?? createRateLimiter(llmRateConfig);
  config.llmRateLimiter = llmLimiter;
  // Tool rate limiter is created lazily in executeToolCalls()

  const maxToolResultBytes = config.maxTotalToolResultBytes ??
    RESOURCE_LIMITS.maxTotalToolResultBytes;
  let totalToolResultBytes = 0;

  const updateToolResultBytes = (delta: number): void => {
    totalToolResultBytes += delta;
    if (maxToolResultBytes > 0) {
      try {
        assertMaxBytes(
          "total tool result bytes",
          totalToolResultBytes,
          maxToolResultBytes,
        );
      } catch (error) {
        onTrace?.({
          type: "resource_limit",
          kind: "tool_result_bytes",
          limit: maxToolResultBytes,
          used: totalToolResultBytes,
        });
        emitMetric(config, "resource_limit", {
          kind: "tool_result_bytes",
          limit: maxToolResultBytes,
          used: totalToolResultBytes,
        });
        throw error;
      }
    }
  };

  const skipCompensation = config.skipModelCompensation ?? false;
  const toolUses: ToolUse[] = [];
  let groundingRetries = 0;
  const maxGroundingRetries = groundingMode === "strict" ? 1 : 0;
  const noInputEnabled = config.noInput ?? false;
  let noInputRetries = 0;
  const maxNoInputRetries = 1;
  const requireToolCalls = config.requireToolCalls ?? false;
  let toolCallRetries = 0;
  const maxToolCallRetries = config.maxToolCallRetries ?? 2;
  let midLoopFormatRetries = 0;
  let finalResponseFormatRetries = 0;
  const maxRepeatToolCalls = config.maxToolCallRepeat ?? 3;
  let lastToolSignature = "";
  let repeatToolCount = 0;
  let consecutiveToolFailures = 0;
  let emptyResponseRetried = false;

  // Planning (optional)
  const planningConfig: PlanningConfig = config.planning ?? { mode: "off" };
  let planState: PlanState | null = null;
  if (
    planningConfig.mode !== "off" &&
    shouldPlanRequest(userRequest, planningConfig.mode ?? "off")
  ) {
    try {
      const agentNames = listAgentProfiles().map((agent) => agent.name);
      const plan = await requestPlan(
        llmFunction,
        context.getMessages(),
        userRequest,
        planningConfig,
        agentNames,
      );
      if (plan) {
        addContextMessage(config, {
          role: "system",
          content: formatPlanForContext(plan, planningConfig),
        });
        const trackPlan = (planningConfig.mode ?? "off") === "always";
        if (trackPlan) {
          planState = createPlanState(plan);
        }
        onTrace?.({ type: "plan_created", plan });
      }
    } catch (error) {
      log.warn(`Planning skipped: ${getErrorMessage(error)}`);
    }
  }

  let lastResponse = "";

  while (iterations < maxIterations) {
    if (config.signal?.aborted) {
      return lastResponse || "Request cancelled by client";
    }
    if (Date.now() > loopDeadline) {
      return lastResponse || `Total timeout (${totalTimeout / 1000}s) exceeded. Task incomplete.`;
    }
    iterations++;

    // Emit trace event: iteration
    onTrace?.({
      type: "iteration",
      current: iterations,
      max: maxIterations,
    });

    try {
    if (planState) {
      const currentStep = planState.plan.steps[planState.currentIndex];
      if (
        currentStep?.agent &&
        !planState.delegatedIds.has(currentStep.id) &&
        config.delegate
      ) {
        const profile = getAgentProfile(currentStep.agent);
        if (profile) {
          const delegateArgs: Record<string, unknown> = {
            agent: profile.name,
            task: currentStep.goal ?? currentStep.title,
          };
          if (typeof config.maxToolCalls === "number") {
            delegateArgs.maxToolCalls = config.maxToolCalls;
          }
          if (config.groundingMode) {
            delegateArgs.groundingMode = config.groundingMode;
          }
          const delegateCall: ToolCall = {
            toolName: "delegate_agent",
            args: delegateArgs,
          };
          const delegateResult = await executeToolCall(delegateCall, config);
          if (!delegateResult.success) {
            // Delegation failed — add error to context so LLM can recover
            context.addMessage({
              role: "user",
              content: `Delegation failed: ${
                delegateResult.error ?? "unknown error"
              }`,
            });
          }
          planState.delegatedIds.add(currentStep.id);
          // Give the main LLM a chance to synthesize and mark STEP_DONE.
          continue;
        }
      }
    }

    // Call LLM to get agent response (with retry)
    const messages = context.getMessages();

    // Emit trace event: LLM call
    onTrace?.({
      type: "llm_call",
      messageCount: messages.length,
    });
    emitMetric(config, "llm_call", {
      messageCount: messages.length,
    });

    if (llmLimiter) {
      const status = llmLimiter.consume(1);
      if (!status.allowed) {
        onTrace?.({
          type: "rate_limit",
          target: "llm",
          maxCalls: status.maxCalls,
          windowMs: status.windowMs,
          used: status.used,
          remaining: status.remaining,
          resetMs: status.resetMs,
        });
        emitMetric(config, "rate_limit", {
          target: "llm",
          maxCalls: status.maxCalls,
          windowMs: status.windowMs,
          used: status.used,
          remaining: status.remaining,
          resetMs: status.resetMs,
        });
        throw new RateLimitError(
          `LLM rate limit exceeded (${status.used}/${status.maxCalls} per ${status.windowMs}ms)`,
          status.maxCalls,
          status.windowMs,
        );
      }
    }

    // Proactive context compaction before LLM call
    await context.compactIfNeeded();

    const llmStart = Date.now();
    const agentResponse = await callLLMWithRetry(
      llmFunction,
      messages,
      { timeout: llmTimeout, maxRetries },
      onTrace,
    );
    const llmDuration = Date.now() - llmStart;

    // Record token usage (estimated by default)
    const responseText = agentResponse.content ?? "";
    if (responseText) lastResponse = responseText;
    let response = agentResponse;
    const usage = estimateUsage(messages, responseText);
    usageTracker.record(usage);
    onTrace?.({
      type: "llm_usage",
      usage,
    });
    emitMetric(config, "llm_usage", { ...usage });

    // Emit trace event: LLM response
    onTrace?.({
      type: "llm_response",
      length: responseText.length,
      truncated: truncate(responseText, 200),
      content: responseText,
      toolCalls: agentResponse.toolCalls?.length ?? 0,
    });
    emitMetric(config, "llm_response", {
      length: responseText.length,
      durationMs: llmDuration,
    });

    // Detect and retry empty LLM responses (no content + no tool calls)
    if ((response.toolCalls?.length ?? 0) === 0 && !responseText.trim()) {
      if (!emptyResponseRetried) {
        emptyResponseRetried = true;
        continue; // retry the LLM call
      }
      return "The model returned an empty response. Please try again.";
    }

    // Weak-model compensation: detect tool call JSON in text and repair
    if (
      !skipCompensation &&
      (response.toolCalls?.length ?? 0) === 0 &&
      looksLikeToolCallJsonAnywhere(responseText)
    ) {
      if (midLoopFormatRetries < maxToolCallRetries) {
        midLoopFormatRetries++;
        const hasPriorTools = toolUses.length > 0;
        addContextMessage(config, {
          role: "user",
          content: hasPriorTools
            ? "Do not output tool call JSON. Provide a final answer based on the tool results."
            : "Native tool calling required. Do not output tool call JSON in text. Retry using structured tool calls.",
        });
        continue;
      }
      // Last resort: parse tool calls from text and execute them
      const parsed = tryParseToolCallsFromText(responseText);
      if (parsed.length > 0) {
        // Generate IDs so assistant message and tool results correlate
        let idCounter = 0;
        const repairedCalls = parsed.map((p) => ({
          ...p,
          id: `repair_${Date.now()}_${idCounter++}`,
        }));
        const repaired: LLMResponse = {
          content: "",
          toolCalls: repairedCalls,
        };
        onTrace?.({
          type: "tool_call",
          toolName: `[text-repair] ${repairedCalls[0].toolName}`,
          args: repairedCalls[0].args,
        });
        response = repaired;
        // Fall through to processAgentResponse below
      } else if (toolUses.length === 0) {
        return "Native tool calling required. Tool call JSON in text is not accepted.";
      } else {
        return responseText;
      }
    }

    // Process response and execute tools
    const result = await processAgentResponse(response, config);

    // If no tool calls, agent is done
    if (!result.shouldContinue) {
      if (
        requireToolCalls &&
        result.toolCallsMade === 0 &&
        toolUses.length === 0
      ) {
        toolCallRetries += 1;
        if (toolCallRetries > maxToolCallRetries) {
          return "Tool call required but none provided. Task incomplete.";
        }
        addContextMessage(config, {
          role: "user",
          content: buildToolRequiredMessage(config.toolAllowlist),
        });
        continue;
      }

      let finalResponse = result.finalResponse ?? responseText;

      if (planState) {
        const stepDoneId = extractStepDoneId(responseText);
        const requireMarkers = planningConfig.requireStepMarkers ?? false;
        if (requireMarkers && !stepDoneId) {
          const currentStep = planState.plan.steps[planState.currentIndex];
          const id = currentStep?.id ?? "unknown";
          addContextMessage(config, {
            role: "user",
            content:
              `Plan tracking required. End your response with STEP_DONE ${id} when the step is complete.`,
          });
          continue;
        }

        finalResponse = stripStepMarkers(responseText);

        const advance = advancePlanState(planState, stepDoneId);
        planState = advance.state;
        const completedIndex = planState.currentIndex - 1;
        const completedStep = planState.plan.steps[completedIndex];
        if (completedStep) {
          onTrace?.({
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
          continue;
        }
      }

      // Weak-model compensation: suppress questions in no-input mode
      if (
        !skipCompensation &&
        noInputEnabled &&
        noInputRetries < maxNoInputRetries &&
        responseAsksQuestion(finalResponse)
      ) {
        noInputRetries++;
        addContextMessage(config, {
          role: "user",
          content:
            "No-input mode: Do not ask questions. Provide a best-effort answer based on available tool results and reasonable assumptions.",
        });
        continue;
      }

      // Weak-model compensation: detect JSON in final answer
      if (
        !skipCompensation &&
        toolUses.length > 0 &&
        looksLikeToolCallJsonAnywhere(finalResponse)
      ) {
        if (finalResponseFormatRetries < maxToolCallRetries) {
          finalResponseFormatRetries++;
          addContextMessage(config, {
            role: "user",
            content:
              "Provide a final answer based on the tool results. Do not output tool call JSON.",
          });
          continue;
        }
        // Return as-is rather than crashing
        return finalResponse;
      }

      if (groundingMode !== "off" && toolUses.length > 0) {
        const grounding = checkGrounding(finalResponse, toolUses);
        onTrace?.({
          type: "grounding_check",
          mode: groundingMode,
          grounded: grounding.grounded,
          warnings: grounding.warnings,
          retry: groundingRetries,
          maxRetry: maxGroundingRetries,
        });
        emitMetric(config, "grounding_check", {
          mode: groundingMode,
          grounded: grounding.grounded,
          warnings: grounding.warnings,
          retry: groundingRetries,
          maxRetry: maxGroundingRetries,
        });

        if (!grounding.grounded) {
          if (groundingMode === "strict") {
            if (groundingRetries < maxGroundingRetries) {
              groundingRetries++;
              const warningText =
                `Grounding required. Revise your answer to cite tool results using tool names or "Based on ...".\n- ${
                  grounding.warnings.join("\n- ")
                }`;
              addContextMessage(config, { role: "user", content: warningText });
              continue;
            }
            // Return with warnings rather than crashing — response may still be usable
            const warningText = `\n\n[Grounding warnings]\n- ${
              grounding.warnings.join("\n- ")
            }`;
            return `${finalResponse}${warningText}`;
          }
          const warningText = `\n\n[Grounding warnings]\n- ${
            grounding.warnings.join("\n- ")
          }`;
          return `${finalResponse}${warningText}`;
        }
      }
      return finalResponse;
    }

    // Check for denied tool calls - per-tool tracking (Issue #6)
    let anyDeniedThisTurn = false;

    for (let i = 0; i < result.results.length; i++) {
      const toolName = result.toolCalls[i].toolName;
      const toolResult = result.results[i];

      if (!toolResult.success && toolResult.error?.includes("denied")) {
        anyDeniedThisTurn = true;
        const currentCount = denialCountByTool.get(toolName) || 0;
        denialCountByTool.set(toolName, currentCount + 1);

        // Check if this specific tool reached the limit
        if (denialCountByTool.get(toolName)! >= maxDenials) {
          addContextMessage(config, {
            role: "user",
            content:
              `Maximum denials (${maxDenials}) reached for tool '${toolName}'. Consider using ask_user tool to clarify requirements or try a different approach.`,
          });
        }
      }
    }

    if (!anyDeniedThisTurn) {
      // Fix 4: Only clear denial counts for tools that were called this turn
      for (const call of result.toolCalls) {
        denialCountByTool.delete(call.toolName);
      }
    }

    // Fix 2: Only check executed tool calls (not unexecuted ones in sequential mode)
    const executedCalls = result.toolCalls.slice(0, result.results.length);
    const allToolsBlocked = executedCalls.length > 0 && executedCalls.every((call) => {
      const count = denialCountByTool.get(call.toolName) || 0;
      return count >= maxDenials;
    });

    if (anyDeniedThisTurn && allToolsBlocked && result.toolCalls.length > 0) {
      // Agent is stuck - all attempted tools are blocked
      // Fix 1: Use callLLMWithRetry instead of raw llmFunction
      const finalResponse = await callLLMWithRetry(
        llmFunction,
        context.getMessages(),
        { timeout: llmTimeout, maxRetries },
        onTrace,
      );
      return finalResponse.content ?? "";
    }

    // Weak-model compensation: detect tool call loops
    if (!skipCompensation) {
      if (!anyDeniedThisTurn && result.toolCallsMade > 0) {
        const signature = buildToolSignature(result.toolCalls);
        if (signature && signature === lastToolSignature) {
          repeatToolCount += 1;
        } else {
          repeatToolCount = 1;
          lastToolSignature = signature;
        }

        if (repeatToolCount >= maxRepeatToolCalls) {
          onTrace?.({
            type: "loop_detected",
            signature,
            count: repeatToolCount,
          });
          return [
            "Tool call loop detected.",
            "The same tool calls were repeated multiple times without progress.",
            "Please clarify the request or provide additional guidance.",
          ].join("\n");
        }
      } else {
        lastToolSignature = "";
        repeatToolCount = 0;
      }
    }

    // Fix 5: Cap toolUses with sliding window for grounding checks
    const MAX_TOOL_USES_FOR_GROUNDING = 50;
    if (result.toolUses.length > 0) {
      toolUses.push(...result.toolUses);
      if (toolUses.length > MAX_TOOL_USES_FOR_GROUNDING) {
        toolUses.splice(0, toolUses.length - MAX_TOOL_USES_FOR_GROUNDING);
      }
      if (result.toolBytes > 0) {
        updateToolResultBytes(result.toolBytes);
      }
    }
    if (result.toolCallsMade > 0) {
      groundingRetries = 0;
    }

    // Track consecutive tool failures for early abort (only when ALL tools fail)
    const allFailed = result.results.length > 0 && result.results.every((r) => !r.success);
    if (allFailed) {
      consecutiveToolFailures++;
    } else {
      consecutiveToolFailures = 0;
    }
    if (consecutiveToolFailures >= 3) {
      // Stop early if tools keep failing consecutively
      const failedTools = result.results
        .filter((r) => !r.success)
        .map((r) => r.error ?? "unknown error");
      return `Tool execution failed after ${consecutiveToolFailures} consecutive failures:\n${
        failedTools.join("\n")
      }`;
    }
    } catch (error) {
      if (error instanceof ContextOverflowError) {
        return lastResponse || "Context limit reached. Please start a new conversation.";
      }
      throw error;
    }
  }

  // Hit max iterations
  return "Maximum iterations reached. Task incomplete.";
}
