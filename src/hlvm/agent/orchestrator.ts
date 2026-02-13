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
  TEXT_ENCODER,
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
import { getAgentLogger } from "./logger.ts";

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

/** Mutable state for the ReAct loop, consolidated from 16 local variables */
interface LoopState {
  iterations: number;
  usageTracker: UsageTracker;
  denialCountByTool: Map<string, number>;
  totalToolResultBytes: number;
  toolUses: ToolUse[];
  groundingRetries: number;
  noInputRetries: number;
  toolCallRetries: number;
  midLoopFormatRetries: number;
  finalResponseFormatRetries: number;
  lastToolSignature: string;
  repeatToolCount: number;
  consecutiveToolFailures: number;
  emptyResponseRetried: boolean;
  planState: PlanState | null;
  lastResponse: string;
}

/** Resolved constants from OrchestratorConfig, computed once at loop start */
interface LoopConfig {
  maxIterations: number;
  maxDenials: number;
  llmTimeout: number;
  maxRetries: number;
  groundingMode: "off" | "warn" | "strict";
  llmLimiter: SlidingWindowRateLimiter | null;
  maxToolResultBytes: number;
  skipCompensation: boolean;
  maxGroundingRetries: number;
  noInputEnabled: boolean;
  maxNoInputRetries: number;
  requireToolCalls: boolean;
  maxToolCallRetries: number;
  maxRepeatToolCalls: number;
  planningConfig: PlanningConfig;
  loopDeadline: number;
  totalTimeout: number;
}

/** Control flow directive from extracted loop functions */
type LoopDirective =
  | { action: "continue" }
  | { action: "return"; value: string }
  | { action: "proceed" }

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

/**
 * Creates a tool-allowed checker with its own cached sets.
 * Eliminates module-level mutable state that could leak between runs.
 */
function createToolAllowedChecker(): (
  toolName: string,
  config: OrchestratorConfig,
) => boolean {
  let cachedAllowSet: { key: string; set: Set<string> } | null = null;
  let cachedDenySet: { key: string; set: Set<string> } | null = null;

  const listCacheKey = (list: string[]): string => list.join("\0");

  const getOrCreateSet = (
    list: string[],
    cached: { key: string; set: Set<string> } | null,
  ): { key: string; set: Set<string> } => {
    const key = listCacheKey(list);
    if (cached && cached.key === key) return cached;
    return { key, set: new Set(list) };
  };

  return (toolName: string, config: OrchestratorConfig): boolean => {
    if (config.toolAllowlist && config.toolAllowlist.length > 0) {
      cachedAllowSet = getOrCreateSet(config.toolAllowlist, cachedAllowSet);
      return cachedAllowSet.set.has(toolName);
    }
    if (config.toolDenylist && config.toolDenylist.length > 0) {
      cachedDenySet = getOrCreateSet(config.toolDenylist, cachedDenySet);
      return !cachedDenySet.set.has(toolName);
    }
    return true;
  };
}

/** Instance-level checker — created fresh per runReActLoop call */
let isToolAllowed = createToolAllowedChecker();

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

// TEXT_ENCODER imported from common/utils.ts (SSOT)

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
    getAgentLogger().debug(`Tool name normalized: ${toolCall.toolName} → ${resolvedName}`);
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
// Timeout/Retry Logic
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
// ReAct Loop — Extracted Helpers
// ============================================================

/** Create initial mutable loop state from config */
function initializeLoopState(config: OrchestratorConfig): LoopState {
  const usageTracker = config.usage ?? new UsageTracker();
  config.usage = usageTracker;
  return {
    iterations: 0,
    usageTracker,
    denialCountByTool: new Map(),
    totalToolResultBytes: 0,
    toolUses: [],
    groundingRetries: 0,
    noInputRetries: 0,
    toolCallRetries: 0,
    midLoopFormatRetries: 0,
    finalResponseFormatRetries: 0,
    lastToolSignature: "",
    repeatToolCount: 0,
    consecutiveToolFailures: 0,
    emptyResponseRetried: false,
    planState: null,
    lastResponse: "",
  };
}

/** Resolve config constants once at loop start */
function resolveLoopConfig(config: OrchestratorConfig): LoopConfig {
  const groundingMode = config.groundingMode ?? "off";
  const llmRateConfig = config.llmRateLimit ?? RATE_LIMITS.llmCalls;
  const llmLimiter = config.llmRateLimiter ?? createRateLimiter(llmRateConfig);
  config.llmRateLimiter = llmLimiter;
  const totalTimeout = DEFAULT_TIMEOUTS.total;
  return {
    maxIterations: MAX_ITERATIONS,
    maxDenials: config.maxDenials ?? 3,
    llmTimeout: config.llmTimeout ?? DEFAULT_TIMEOUTS.llm,
    maxRetries: config.maxRetries ?? MAX_RETRIES,
    groundingMode,
    llmLimiter,
    maxToolResultBytes: config.maxTotalToolResultBytes ?? RESOURCE_LIMITS.maxTotalToolResultBytes,
    skipCompensation: config.skipModelCompensation ?? false,
    maxGroundingRetries: groundingMode === "strict" ? 1 : 0,
    noInputEnabled: config.noInput ?? false,
    maxNoInputRetries: 1,
    requireToolCalls: config.requireToolCalls ?? false,
    maxToolCallRetries: config.maxToolCallRetries ?? 2,
    maxRepeatToolCalls: config.maxToolCallRepeat ?? 3,
    planningConfig: config.planning ?? { mode: "off" },
    loopDeadline: Date.now() + totalTimeout,
    totalTimeout,
  };
}

/** Accumulate tool result bytes and throw if limit exceeded */
function checkToolResultBytesLimit(
  state: LoopState,
  lc: LoopConfig,
  config: OrchestratorConfig,
  delta: number,
): void {
  state.totalToolResultBytes += delta;
  if (lc.maxToolResultBytes > 0) {
    try {
      assertMaxBytes("total tool result bytes", state.totalToolResultBytes, lc.maxToolResultBytes);
    } catch (error) {
      config.onTrace?.({
        type: "resource_limit",
        kind: "tool_result_bytes",
        limit: lc.maxToolResultBytes,
        used: state.totalToolResultBytes,
      });
      emitMetric(config, "resource_limit", {
        kind: "tool_result_bytes",
        limit: lc.maxToolResultBytes,
        used: state.totalToolResultBytes,
      });
      throw error;
    }
  }
}

/**
 * Handle empty responses and weak-model text repair.
 * Returns a directive plus optionally a repaired LLMResponse.
 */
function handleTextOnlyResponse(
  response: LLMResponse,
  responseText: string,
  state: LoopState,
  lc: LoopConfig,
  config: OrchestratorConfig,
): LoopDirective & { response?: LLMResponse } {
  // Detect and retry empty LLM responses (no content + no tool calls)
  if ((response.toolCalls?.length ?? 0) === 0 && !responseText.trim()) {
    if (!state.emptyResponseRetried) {
      state.emptyResponseRetried = true;
      return { action: "continue" };
    }
    return { action: "return", value: "The model returned an empty response. Please try again." };
  }

  // Weak-model compensation: detect tool call JSON in text and repair
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
    // Last resort: parse tool calls from text and execute them
    const parsed = tryParseToolCallsFromText(responseText);
    if (parsed.length > 0) {
      let idCounter = 0;
      const repairedCalls = parsed.map((p) => ({
        ...p,
        id: `repair_${Date.now()}_${idCounter++}`,
      }));
      const repaired: LLMResponse = {
        content: "",
        toolCalls: repairedCalls,
      };
      config.onTrace?.({
        type: "tool_call",
        toolName: `[text-repair] ${repairedCalls[0].toolName}`,
        args: repairedCalls[0].args,
      });
      return { action: "proceed", response: repaired };
    } else if (state.toolUses.length === 0) {
      return { action: "return", value: "Native tool calling required. Tool call JSON in text is not accepted." };
    } else {
      return { action: "return", value: responseText };
    }
  }

  return { action: "proceed" };
}

/**
 * Handle the "no tool calls" branch: plan advancement, no-input guard,
 * grounding checks, and format cleanup.
 */
function handleFinalResponse(
  responseText: string,
  result: { toolCallsMade: number; finalResponse?: string },
  state: LoopState,
  lc: LoopConfig,
  config: OrchestratorConfig,
): LoopDirective {
  // Require tool calls if configured
  if (
    lc.requireToolCalls &&
    result.toolCallsMade === 0 &&
    state.toolUses.length === 0
  ) {
    state.toolCallRetries += 1;
    if (state.toolCallRetries > lc.maxToolCallRetries) {
      return { action: "return", value: "Tool call required but none provided. Task incomplete." };
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
      const currentStep = state.planState.plan.steps[state.planState.currentIndex];
      const id = currentStep?.id ?? "unknown";
      addContextMessage(config, {
        role: "user",
        content: `Plan tracking required. End your response with STEP_DONE ${id} when the step is complete.`,
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
        content: `Plan step completed. Next step: [${advance.nextStep.id}] ${advance.nextStep.title}. Continue.`,
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
      content: "No-input mode: Do not ask questions. Provide a best-effort answer based on available tool results and reasonable assumptions.",
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
        content: "Provide a final answer based on the tool results. Do not output tool call JSON.",
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
    emitMetric(config, "grounding_check", {
      mode: lc.groundingMode,
      grounded: grounding.grounded,
      warnings: grounding.warnings,
      retry: state.groundingRetries,
      maxRetry: lc.maxGroundingRetries,
    });

    if (!grounding.grounded) {
      if (lc.groundingMode === "strict") {
        if (state.groundingRetries < lc.maxGroundingRetries) {
          state.groundingRetries++;
          const warningText = `Grounding required. Revise your answer to cite tool results using tool names or "Based on ...".\n- ${grounding.warnings.join("\n- ")}`;
          addContextMessage(config, { role: "user", content: warningText });
          return { action: "continue" };
        }
        const warningText = `\n\n[Grounding warnings]\n- ${grounding.warnings.join("\n- ")}`;
        return { action: "return", value: `${finalResponse}${warningText}` };
      }
      const warningText = `\n\n[Grounding warnings]\n- ${grounding.warnings.join("\n- ")}`;
      return { action: "return", value: `${finalResponse}${warningText}` };
    }
  }
  return { action: "return", value: finalResponse };
}

/**
 * Handle post-tool-execution: denial tracking, loop detection,
 * tool accumulation, and consecutive failure tracking.
 */
async function handlePostToolExecution(
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
    if (!toolCall) break; // Guard: results and toolCalls may differ in length
    const toolName = toolCall.toolName;
    const toolResult = result.results[i];

    if (!toolResult.success && toolResult.error?.includes("denied")) {
      anyDeniedThisTurn = true;
      const currentCount = state.denialCountByTool.get(toolName) || 0;
      state.denialCountByTool.set(toolName, currentCount + 1);

      if (currentCount + 1 >= lc.maxDenials) {
        addContextMessage(config, {
          role: "user",
          content: `Maximum denials (${lc.maxDenials}) reached for tool '${toolName}'. Consider using ask_user tool to clarify requirements or try a different approach.`,
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
  const allToolsBlocked = executedCalls.length > 0 && executedCalls.every((call) => {
    const count = state.denialCountByTool.get(call.toolName) || 0;
    return count >= lc.maxDenials;
  });

  if (anyDeniedThisTurn && allToolsBlocked && result.toolCalls.length > 0) {
    const finalResponse = await callLLMWithRetry(
      llmFunction,
      config.context.getMessages(),
      { timeout: lc.llmTimeout, maxRetries: lc.maxRetries },
      config.onTrace,
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
      state.toolUses.splice(0, state.toolUses.length - MAX_TOOL_USES_FOR_GROUNDING);
    }
    if (result.toolBytes > 0) {
      checkToolResultBytesLimit(state, lc, config, result.toolBytes);
    }
  }
  if (result.toolCallsMade > 0) {
    state.groundingRetries = 0;
  }

  // --- Consecutive failure tracking ---
  const allFailed = result.results.length > 0 && result.results.every((r) => !r.success);
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
      value: `Tool execution failed after ${state.consecutiveToolFailures} consecutive failures:\n${failedTools.join("\n")}`,
    };
  }

  return { action: "proceed" };
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
  const { context, onTrace } = config;

  // Reset per-run caches to avoid stale data across runs
  isToolAllowed = createToolAllowedChecker();
  clearToolDefCache();

  // Initialize state and resolved config constants
  const state = initializeLoopState(config);
  const lc = resolveLoopConfig(config);

  // Add user request to context
  addContextMessage(config, { role: "user", content: userRequest });

  // Planning (optional)
  if (
    lc.planningConfig.mode !== "off" &&
    shouldPlanRequest(userRequest, lc.planningConfig.mode ?? "off")
  ) {
    try {
      const agentNames = listAgentProfiles().map((agent) => agent.name);
      const plan = await requestPlan(
        llmFunction,
        context.getMessages(),
        userRequest,
        lc.planningConfig,
        agentNames,
      );
      if (plan) {
        addContextMessage(config, {
          role: "system",
          content: formatPlanForContext(plan, lc.planningConfig),
        });
        if ((lc.planningConfig.mode ?? "off") === "always") {
          state.planState = createPlanState(plan);
        }
        onTrace?.({ type: "plan_created", plan });
      }
    } catch (error) {
      getAgentLogger().warn(`Planning skipped: ${getErrorMessage(error)}`);
    }
  }

  // Main ReAct loop
  while (state.iterations < lc.maxIterations) {
    if (config.signal?.aborted) {
      return state.lastResponse || "Request cancelled by client";
    }
    if (Date.now() > lc.loopDeadline) {
      return state.lastResponse || `Total timeout (${lc.totalTimeout / 1000}s) exceeded. Task incomplete.`;
    }
    state.iterations++;

    onTrace?.({
      type: "iteration",
      current: state.iterations,
      max: lc.maxIterations,
    });

    try {
    // Plan delegation (inline — complex control flow with continue)
    if (state.planState) {
      const currentStep = state.planState.plan.steps[state.planState.currentIndex];
      if (
        currentStep?.agent &&
        !state.planState.delegatedIds.has(currentStep.id) &&
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
          const delegateResult = await executeToolCall(
            { toolName: "delegate_agent", args: delegateArgs },
            config,
          );
          if (!delegateResult.success) {
            addContextMessage(config, {
              role: "user",
              content: `Delegation failed: ${delegateResult.error ?? "unknown error"}`,
            });
          }
          state.planState.delegatedIds.add(currentStep.id);
          continue;
        }
      }
    }

    // LLM call: rate limit → compaction → call → usage/trace
    const messages = context.getMessages();
    onTrace?.({ type: "llm_call", messageCount: messages.length });
    emitMetric(config, "llm_call", { messageCount: messages.length });

    if (lc.llmLimiter) {
      const status = lc.llmLimiter.consume(1);
      if (!status.allowed) {
        onTrace?.({
          type: "rate_limit", target: "llm",
          maxCalls: status.maxCalls, windowMs: status.windowMs,
          used: status.used, remaining: status.remaining, resetMs: status.resetMs,
        });
        emitMetric(config, "rate_limit", {
          target: "llm",
          maxCalls: status.maxCalls, windowMs: status.windowMs,
          used: status.used, remaining: status.remaining, resetMs: status.resetMs,
        });
        throw new RateLimitError(
          `LLM rate limit exceeded (${status.used}/${status.maxCalls} per ${status.windowMs}ms)`,
          status.maxCalls, status.windowMs,
        );
      }
    }

    await context.compactIfNeeded();

    const llmStart = Date.now();
    const agentResponse = await callLLMWithRetry(
      llmFunction, messages,
      { timeout: lc.llmTimeout, maxRetries: lc.maxRetries },
      onTrace,
    );
    const llmDuration = Date.now() - llmStart;

    const responseText = agentResponse.content ?? "";
    if (responseText) state.lastResponse = responseText;
    let response = agentResponse;

    const usage = estimateUsage(messages, responseText);
    state.usageTracker.record(usage);
    onTrace?.({ type: "llm_usage", usage });
    emitMetric(config, "llm_usage", { ...usage });
    onTrace?.({
      type: "llm_response",
      length: responseText.length,
      truncated: truncate(responseText, 200),
      content: responseText,
      toolCalls: agentResponse.toolCalls?.length ?? 0,
    });
    emitMetric(config, "llm_response", { length: responseText.length, durationMs: llmDuration });

    // Handle empty responses and weak-model text repair
    const textResult = handleTextOnlyResponse(response, responseText, state, lc, config);
    if (textResult.action === "continue") continue;
    if (textResult.action === "return") return textResult.value;
    if (textResult.response) response = textResult.response;

    // Process response and execute tools
    const result = await processAgentResponse(response, config);

    // If no tool calls, handle final response
    if (!result.shouldContinue) {
      const final = handleFinalResponse(responseText, result, state, lc, config);
      if (final.action === "continue") continue;
      if (final.action === "return") return final.value;
    }

    // Post-tool execution: denials, loop detection, accumulation, failures
    const post = await handlePostToolExecution(result, state, lc, config, llmFunction);
    if (post.action === "continue") continue;
    if (post.action === "return") return post.value;

    } catch (error) {
      if (error instanceof ContextOverflowError) {
        return state.lastResponse || "Context limit reached. Please start a new conversation.";
      }
      throw error;
    }
  }

  return "Maximum iterations reached. Task incomplete.";
}
