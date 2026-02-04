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

import { getTool, hasTool, validateToolArgs, type ToolFunction } from "./registry.ts";
import { checkToolSafety } from "./security/safety.ts";
import { ContextManager, ContextOverflowError, type Message } from "./context.ts";
import {
  DEFAULT_TIMEOUTS,
  DEFAULT_MAX_TOOL_CALLS,
  MAX_ITERATIONS,
  MAX_RETRIES,
  RATE_LIMITS,
  RESOURCE_LIMITS,
} from "./constants.ts";
import { withTimeout } from "../../common/timeout-utils.ts";
import {
  RateLimitError,
  SlidingWindowRateLimiter,
  type RateLimitConfig,
} from "../../common/rate-limiter.ts";
import { assertMaxBytes } from "../../common/limits.ts";
import { getErrorMessage, isObjectValue } from "../../common/utils.ts";
import { RuntimeError, ValidationError } from "../../common/error.ts";
import { checkGrounding, type ToolUse } from "./grounding.ts";
import { classifyError } from "./error-taxonomy.ts";
import type { AgentPolicy } from "./policy.ts";
import { UsageTracker, estimateUsage, type TokenUsage } from "./usage.ts";
import type { MetricsSink } from "./metrics.ts";
import { isToolArgsObject, normalizeToolArgs } from "./validation.ts";
import { type LLMResponse, type ToolCall } from "./tool-call.ts";
import { log } from "../api/log.ts";
import { getPlatform } from "../../platform/platform.ts";

export type { LLMResponse, ToolCall } from "./tool-call.ts";
import { getAgentProfile, listAgentProfiles } from "./agent-registry.ts";
import {
  advancePlanState,
  createPlanState,
  extractStepDoneId,
  formatPlanForContext,
  requestPlan,
  stripStepMarkers,
  type Plan,
  type PlanState,
  type PlanningConfig,
  shouldPlanRequest,
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
  } catch {
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

function buildToolObservation(
  toolCall: ToolCall,
  toolResult: ToolExecutionResult,
): { observation: string; resultText: string } {
  const resultText = toolResult.success
    ? toolResult.llmContent ?? stringifyToolResult(toolResult.result)
    : `ERROR: ${toolResult.error}`;

  const observation = toolResult.success
    ? `Tool: ${toolCall.toolName}\nResult: ${resultText}`
    : `Tool: ${toolCall.toolName}\nError: ${toolResult.error}`;

  return { observation, resultText };
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
  const display = error;
  const result = {
    success: false,
    error,
    llmContent: display,
    returnDisplay: display,
  };

  config.onTrace?.({
    type: "tool_result",
    toolName,
    success: false,
    error,
    display,
  });
  config.onToolDisplay?.({
    toolName,
    success: false,
    content: display,
  });
  emitMetric(config, "tool_result", {
    toolName,
    success: false,
    error,
    durationMs: Date.now() - startedAt,
  });

  return result;
}

function isToolAllowed(
  toolName: string,
  config: OrchestratorConfig,
): boolean {
  if (config.toolAllowlist && config.toolAllowlist.length > 0) {
    return config.toolAllowlist.includes(toolName);
  }
  if (config.toolDenylist && config.toolDenylist.length > 0) {
    return !config.toolDenylist.includes(toolName);
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
  | { type: "llm_retry"; attempt: number; max: number; class: string; retryable: boolean; error: string }
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
  /** LLM timeout in milliseconds (default: 30000) */
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
}

/** Tool call envelope constants */

const PLAYWRIGHT_ERROR_MARKERS = [
  "executable doesn't exist",
  "install chromium",
  "please run the following command to download new browsers",
];

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

function responseAsksQuestion(response: string): boolean {
  if (!response) return false;
  return response.includes("?");
}

function isRenderToolName(toolName: string): boolean {
  return toolName === "render_url" || toolName.endsWith("/render_url");
}

function buildToolSignature(calls: ToolCall[]): string {
  return calls.map((call) => {
    const args = JSON.stringify(call.args ?? {});
    return `${call.toolName}:${args}`;
  }).join("|");
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

function looksLikeToolCallJsonAnywhere(text: string): boolean {
  const pattern =
    /\{[\s\S]*?"(toolName|tool_name|function_name|name)"\s*:\s*"[^"]+"[\s\S]*?"(args|parameters|arguments)"\s*:\s*[\s\S]*?\}/m;
  return pattern.test(text);
}

function looksLikeToolInstruction(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\bjson object\b/.test(lower)) return true;
  if (/(function call|tool call)/.test(lower)) return true;
  if (/\bparameters\b/.test(lower) && /\btool\b/.test(lower)) return true;
  if (/\b(use|call|invoke|execute)\b/.test(lower) && /\btool\b/.test(lower)) {
    return true;
  }
  return false;
}

export function shouldSuppressFinalResponse(response: string): boolean {
  if (!response.trim()) return true;
  if (looksLikeToolCallJsonAnywhere(response)) return true;
  if (looksLikeToolInstruction(response)) return true;
  return false;
}

function isPlaywrightMissingError(message: string): boolean {
  const lower = message.toLowerCase();
  return PLAYWRIGHT_ERROR_MARKERS.some((marker) => lower.includes(marker));
}

async function promptPlaywrightInstall(
  config: OrchestratorConfig,
): Promise<boolean> {
  try {
    const tool = getTool("ask_user");
    const response = await tool.fn(
      {
        question:
          "Playwright Chromium is required to render this page. Install now? (y/n)",
      },
      config.workspace,
    );
    return String(response).trim().toLowerCase().startsWith("y");
  } catch (error) {
    log.warn(`Playwright install prompt failed: ${getErrorMessage(error)}`);
    return false;
  }
}

async function runPlaywrightInstall(): Promise<boolean> {
  const platform = getPlatform();
  try {
    const process = platform.command.run({
      cmd: ["npx", "playwright", "install", "chromium"],
      stdout: "inherit",
      stderr: "inherit",
    });
    const status = await process.status;
    if (!status.success) {
      log.error("Playwright install failed");
      return false;
    }
    return true;
  } catch (error) {
    log.error(`Playwright install failed: ${getErrorMessage(error)}`);
    return false;
  }
}

async function ensurePlaywrightChromium(
  config: OrchestratorConfig,
): Promise<boolean> {
  if (config.playwrightInstallAttempted) return false;
  config.playwrightInstallAttempted = true;
  const confirmed = await promptPlaywrightInstall(config);
  if (!confirmed) return false;

  log.info("Installing Playwright Chromium...");
  return await runPlaywrightInstall();
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
  const normalizedArgs = sanitizeArgs(normalizeToolArgs(toolCall.args));
  // Emit trace event: tool call
  config.onTrace?.({
    type: "tool_call",
    toolName: toolCall.toolName,
    args: normalizedArgs,
  });
  emitMetric(config, "tool_call", {
    toolName: toolCall.toolName,
  });

  try {
    // Validate tool exists
    if (!hasTool(toolCall.toolName)) {
      return buildToolErrorResult(
        toolCall.toolName,
        `Unknown tool: ${toolCall.toolName}`,
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

    const validation = validateToolArgs(toolCall.toolName, normalizedArgs);
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
      normalizedArgs,
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
      const result = await config.delegate(normalizedArgs, config);
      const { llmContent, returnDisplay } = buildToolResultOutputs(
        toolCall.toolName,
        result,
        config,
      );
      config.onTrace?.({
        type: "tool_result",
        toolName: toolCall.toolName,
        success: true,
        result: llmContent,
        display: returnDisplay,
      });
      config.onToolDisplay?.({
        toolName: toolCall.toolName,
        success: true,
        content: returnDisplay,
      });
      emitMetric(config, "tool_result", {
        toolName: toolCall.toolName,
        success: true,
        durationMs: Date.now() - startedAt,
      });
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
        normalizedArgs,
        config.workspace,
        toolTimeout,
        config.policy ?? null,
      );
    } catch (error) {
      const message = getErrorMessage(error);
      if (isRenderToolName(toolCall.toolName) && isPlaywrightMissingError(message)) {
        const installed = await ensurePlaywrightChromium(config);
        if (installed) {
          result = await executeToolWithTimeout(
            tool.fn,
            normalizedArgs,
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

    // Emit trace event: tool result (success)
    config.onTrace?.({
      type: "tool_result",
      toolName: toolCall.toolName,
      success: true,
      result: llmContent,
      display: returnDisplay,
    });
    config.onToolDisplay?.({
      toolName: toolCall.toolName,
      success: true,
      content: returnDisplay,
    });
    emitMetric(config, "tool_result", {
      toolName: toolCall.toolName,
      success: true,
      durationMs: Date.now() - startedAt,
    });

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
 * Execute multiple tool calls sequentially
 *
 * @param toolCalls Tool calls to execute
 * @param config Orchestrator configuration
 * @returns Array of execution results
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  config: OrchestratorConfig,
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];
  const continueOnError = config.continueOnError ?? true; // Default: continue
  const toolLimiter = config.toolRateLimiter ??
    createRateLimiter(config.toolRateLimit ?? RATE_LIMITS.toolCalls);
  config.toolRateLimiter = toolLimiter;

  for (const call of toolCalls) {
    if (toolLimiter) {
      const status = toolLimiter.consume(1);
      if (!status.allowed) {
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
        const error = new RateLimitError(
          `Tool rate limit exceeded (${status.used}/${status.maxCalls} per ${status.windowMs}ms)`,
          status.maxCalls,
          status.windowMs,
        );
        const result = { success: false, error: error.message };
        results.push(result);
        if (!continueOnError) {
          break;
        }
        continue;
      }
    }

    const result = await executeToolCall(call, config);
    results.push(result);

    // Stop on first error only if continueOnError is false
    if (!result.success && !continueOnError) {
      break;
    }
  }

  return results;
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
  if (content) {
    addContextMessage(config, {
      role: "assistant",
      content,
    });
  }

  const maxCalls = config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const toolCalls = Array.isArray(agentResponse.toolCalls)
    ? agentResponse.toolCalls
    : [];

  if (toolCalls.length > maxCalls) {
    addContextMessage(config, {
      role: "tool",
      content:
        `Too many tool calls (${toolCalls.length}). Only the first ${maxCalls} will be executed.`,
    });
  }

  if (toolCalls.length === 0) {
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

  const limitedCalls = toolCalls.slice(0, maxCalls);

  // Execute tool calls
  const results = await executeToolCalls(limitedCalls, config);

  // Add tool results to context + gather tool uses
  const toolUses: ToolUse[] = [];
  let toolBytes = 0;
  const encoder = new TextEncoder();
  for (let i = 0; i < results.length; i++) {
    const call = limitedCalls[i];
    const result = results[i];
    const { observation, resultText } = buildToolObservation(call, result);

    addContextMessage(config, {
      role: "tool",
      content: observation,
    });
    toolUses.push({
      toolName: call.toolName,
      result: resultText ?? "",
    });
    toolBytes += encoder.encode(resultText ?? "").length;

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
  // NOTE: If llmFn doesn't honor AbortSignal, underlying stream may continue.
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
        break;
      }

      // Don't retry on last attempt
      if (attempt === config.maxRetries - 1) break;

      // Exponential backoff: 1s, 2s, 4s, 8s
      const delay = Math.pow(2, attempt) * 1000;
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
 * Orchestrates complete conversation:
 * 1. Initialize context with system prompt
 * 2. Add user request
 * 3. Loop:
 *    a. Call LLM to get agent response
 *    b. Process response (execute tool calls)
 *    c. Continue until agent finishes
 *
 * Note: This is a simplified version. Real implementation would:
 * - Integrate with actual LLM API
 * - Handle streaming responses
 * - Implement timeout/retry logic
 * - Add more sophisticated error handling
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
  const toolRateConfig = config.toolRateLimit ?? RATE_LIMITS.toolCalls;
  const llmLimiter = config.llmRateLimiter ?? createRateLimiter(llmRateConfig);
  const toolLimiter = config.toolRateLimiter ?? createRateLimiter(toolRateConfig);
  config.llmRateLimiter = llmLimiter;
  config.toolRateLimiter = toolLimiter;

  const maxToolResultBytes = config.maxTotalToolResultBytes ??
    RESOURCE_LIMITS.maxTotalToolResultBytes;
  let totalToolResultBytes = 0;
  const encoder = new TextEncoder();

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
        config.onTrace?.({
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

  const toolUses: ToolUse[] = [];
  let groundingRetries = 0;
  const maxGroundingRetries = groundingMode === "strict" ? 1 : 0;
  const noInputEnabled = config.noInput ?? false;
  let noInputRetries = 0;
  const maxNoInputRetries = 1;
  const requireToolCalls = config.requireToolCalls ?? false;
  let toolCallRetries = 0;
  const maxToolCallRetries = config.maxToolCallRetries ?? 1;
  let toolFormatRetries = 0;
  const maxRepeatToolCalls = config.maxToolCallRepeat ?? 3;
  let lastToolSignature = "";
  let repeatToolCount = 0;

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
        config.context.getMessages(),
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
        config.onTrace?.({ type: "plan_created", plan });
      }
    } catch (error) {
      log.warn(`Planning skipped: ${getErrorMessage(error)}`);
    }
  }

  while (iterations < maxIterations) {
    iterations++;

    // Emit trace event: iteration
    config.onTrace?.({
      type: "iteration",
      current: iterations,
      max: maxIterations,
    });

    if (planState) {
      const currentStep = planState.plan.steps[planState.currentIndex];
      if (
        currentStep?.agent &&
        !planState.delegatedIds.includes(currentStep.id) &&
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
          planState.delegatedIds.push(currentStep.id);
          // Give the main LLM a chance to synthesize and mark STEP_DONE.
          continue;
        }
      }
    }

    // Call LLM to get agent response (with retry)
    const messages = config.context.getMessages();

    // Emit trace event: LLM call
    config.onTrace?.({
      type: "llm_call",
      messageCount: messages.length,
    });
    emitMetric(config, "llm_call", {
      messageCount: messages.length,
    });

    if (llmLimiter) {
      const status = llmLimiter.consume(1);
      if (!status.allowed) {
        config.onTrace?.({
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

    const llmStart = Date.now();
    const agentResponse = await callLLMWithRetry(
      llmFunction,
      messages,
      { timeout: llmTimeout, maxRetries },
      config.onTrace,
    );
    const llmDuration = Date.now() - llmStart;

    // Record token usage (estimated by default)
    let responseText = agentResponse.content ?? "";
    let response = agentResponse;
    const usage = estimateUsage(messages, responseText);
    usageTracker.record(usage);
    config.onTrace?.({
      type: "llm_usage",
      usage,
    });
    emitMetric(config, "llm_usage", { ...usage });

    // Emit trace event: LLM response
    config.onTrace?.({
      type: "llm_response",
      length: responseText.length,
      truncated: responseText.substring(0, 200),
      content: responseText,
      toolCalls: agentResponse.toolCalls?.length ?? 0,
    });
    emitMetric(config, "llm_response", {
      length: responseText.length,
      durationMs: llmDuration,
    });

    if (
      (response.toolCalls?.length ?? 0) === 0 &&
      looksLikeToolCallJsonAnywhere(responseText)
    ) {
      if (toolFormatRetries < maxToolCallRetries) {
        toolFormatRetries++;
        const hasPriorTools = toolUses.length > 0;
        addContextMessage(config, {
          role: "tool",
          content: hasPriorTools
            ? "Do not output tool call JSON. Provide a final answer based on the tool results."
            : "Native tool calling required. Do not output tool call JSON in text. Retry using structured tool calls.",
        });
        continue;
      }
      throw new ValidationError(
        "Model returned tool call JSON instead of native tool calls.",
        "tool_call_format",
      );
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
          role: "tool",
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
            role: "tool",
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
          config.onTrace?.({
            type: "plan_step",
            stepId: completedStep.id,
            index: completedIndex,
            completed: true,
          });
        }

        if (!advance.finished && advance.nextStep) {
          addContextMessage(config, {
            role: "tool",
            content:
              `Plan step completed. Next step: [${advance.nextStep.id}] ${advance.nextStep.title}. Continue.`,
          });
          continue;
        }
      }

      if (
        noInputEnabled &&
        noInputRetries < maxNoInputRetries &&
        responseAsksQuestion(finalResponse)
      ) {
        noInputRetries++;
        addContextMessage(config, {
          role: "tool",
          content:
            "No-input mode: Do not ask questions. Provide a best-effort answer based on available tool results and reasonable assumptions.",
        });
        continue;
      }

      if (
        toolUses.length > 0 &&
        (looksLikeToolCallJsonAnywhere(finalResponse) ||
          looksLikeToolInstruction(finalResponse))
      ) {
        if (toolFormatRetries < maxToolCallRetries) {
          toolFormatRetries++;
          addContextMessage(config, {
            role: "tool",
            content:
              "Provide a final answer based on the tool results. Do not output tool call JSON or tool instructions.",
          });
          continue;
        }
        throw new ValidationError(
          "Model returned tool instructions instead of a final answer.",
          "tool_call_format",
        );
      }

      if (groundingMode !== "off" && toolUses.length > 0) {
        const grounding = checkGrounding(finalResponse, toolUses);
        config.onTrace?.({
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
              const warningText = `Grounding required. Revise your answer to cite tool results using tool names or "Based on ...".\n- ${
                grounding.warnings.join("\n- ")
              }`;
              addContextMessage(config, { role: "tool", content: warningText });
              continue;
            }
            throw new ValidationError(
              `Ungrounded response after ${groundingRetries} retry: ${grounding.warnings.join(" ")}`,
              "grounding",
            );
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
            role: "tool",
            content: `Maximum denials (${maxDenials}) reached for tool '${toolName}'. Consider using ask_user tool to clarify requirements or try a different approach.`,
          });
        }
      }
    }

    if (!anyDeniedThisTurn) {
      // Reset ALL denial counts if no denials this turn (matches old behavior)
      // This allows agent to recover after using non-denied tools
      denialCountByTool.clear();
    }

    // Check if ALL tools in this turn were denied AND at max denials
    const allToolsBlocked = result.toolCalls.every((call) => {
      const count = denialCountByTool.get(call.toolName) || 0;
      return count >= maxDenials;
    });

    if (anyDeniedThisTurn && allToolsBlocked && result.toolCalls.length > 0) {
      // Agent is stuck - all attempted tools are blocked
      // Give one final chance to use ask_user or different tool
      const finalResponse = await llmFunction(config.context.getMessages());
      return finalResponse.content ?? "";
    }

    if (!anyDeniedThisTurn && result.toolCallsMade > 0) {
      const signature = buildToolSignature(result.toolCalls);
      if (signature && signature === lastToolSignature) {
        repeatToolCount += 1;
      } else {
        repeatToolCount = 1;
        lastToolSignature = signature;
      }

      if (repeatToolCount >= maxRepeatToolCalls) {
        config.onTrace?.({
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

    // Track tool uses for grounding checks
    if (result.toolUses.length > 0) {
      toolUses.push(...result.toolUses);
      if (result.toolBytes > 0) {
        updateToolResultBytes(result.toolBytes);
      }
    }
    if (result.toolCallsMade > 0) {
      groundingRetries = 0;
    }

    // If any tool failed, agent might want to retry or give up
    const anyFailed = result.results.some((r) => !r.success);
    if (anyFailed && iterations >= maxIterations / 2) {
      // Stop early if tools keep failing
      return responseText;
    }
  }

  // Hit max iterations
  return "Maximum iterations reached. Task incomplete.";
}
