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
 * - Tool call envelope parsing (TOOL_CALL\n{json}\nEND_TOOL_CALL)
 * - Safety checks before execution
 * - Context management
 * - Error handling with retry
 * - SSOT-compliant (uses all previous components)
 */

import { getTool, hasTool, type ToolFunction } from "./registry.ts";
import { checkToolSafety } from "./security/safety.ts";
import { ContextManager, ContextOverflowError, type Message } from "./context.ts";
import {
  DEFAULT_TIMEOUTS,
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
import { RuntimeError, ValidationError } from "../../common/error.ts";
import { checkGrounding, type ToolUse } from "./grounding.ts";
import { classifyError } from "./error-taxonomy.ts";

// ============================================================
// Types
// ============================================================

/** Tool call parsed from agent response */
export interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

/** Parse error from tool call extraction */
export interface ParseError {
  /** Type of parse error */
  type: "json_parse" | "invalid_structure" | "unclosed_block" | "too_many_calls";
  /** Human-readable error message */
  message: string;
  /** Line number where error occurred (if applicable) */
  line?: number;
  /** The invalid JSON that failed to parse (if applicable) */
  json?: string;
}

/** Result of parsing tool calls from agent response */
export interface ParseResult {
  /** Successfully parsed tool calls */
  calls: ToolCall[];
  /** Parse errors encountered */
  errors: ParseError[];
}

/** Result of tool execution */
export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/** LLM function signature used by orchestrator */
export type LLMFunction = (
  messages: Message[],
  signal?: AbortSignal,
) => Promise<string>;

/** Trace event for observability/debugging */
export type TraceEvent =
  | { type: "iteration"; current: number; max: number }
  | { type: "llm_call"; messageCount: number }
  | { type: "llm_response"; length: number; truncated: string }
  | { type: "tool_call"; toolName: string; args: unknown }
  | { type: "tool_result"; toolName: string; success: boolean; result?: unknown; error?: string }
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
  };

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
  /** Trace callback for observability (--trace mode) */
  onTrace?: (event: TraceEvent) => void;
  /** LLM timeout in milliseconds (default: 30000) */
  llmTimeout?: number;
  /** Tool timeout in milliseconds (default: 60000) */
  toolTimeout?: number;
  /** Maximum retries for LLM calls (default: 3) */
  maxRetries?: number;
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
}

/** Tool call envelope constants */
const TOOL_CALL_START = "TOOL_CALL";
const TOOL_CALL_END = "END_TOOL_CALL";

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
    }
    throw error;
  }
}

function createRateLimiter(
  config: RateLimitConfig | undefined,
): SlidingWindowRateLimiter | null {
  if (!config) return null;
  if (config.maxCalls <= 0 || config.windowMs <= 0) return null;
  return new SlidingWindowRateLimiter(config);
}

// ============================================================
// Tool Call Parsing
// ============================================================

/**
 * Parse tool calls from agent response
 *
 * Expected format:
 * ```
 * TOOL_CALL
 * {"toolName": "read_file", "args": {"path": "src/main.ts"}}
 * END_TOOL_CALL
 * ```
 *
 * Supports multiple tool calls in single response.
 *
 * Returns both successfully parsed calls AND any errors encountered.
 * Errors are reported back to LLM to prevent hallucination (Issues #2, #3).
 *
 * @param response Agent response text
 * @param maxToolCalls Maximum allowed tool calls per turn (default: 10)
 * @returns Parse result with calls and errors
 *
 * @example
 * ```ts
 * const response = `Let me read that file.
 * TOOL_CALL
 * {"toolName": "read_file", "args": {"path": "src/main.ts"}}
 * END_TOOL_CALL`;
 *
 * const result = parseToolCalls(response, 10);
 * // Returns: { calls: [...], errors: [] }
 * ```
 */
export function parseToolCalls(response: string, maxToolCalls: number = 10): ParseResult {
  const calls: ToolCall[] = [];
  const errors: ParseError[] = [];

  // Find all TOOL_CALL...END_TOOL_CALL blocks
  const lines = response.split("\n");
  let inToolCall = false;
  let jsonLines: string[] = [];
  let toolCallStartLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === TOOL_CALL_START) {
      inToolCall = true;
      jsonLines = [];
      toolCallStartLine = i + 1; // Line number (1-indexed)
      continue;
    }

    if (trimmed === TOOL_CALL_END) {
      if (inToolCall && jsonLines.length > 0) {
        // Parse JSON
        const json = jsonLines.join("\n");
        try {
          const parsed = JSON.parse(json);

          // Validate structure
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            "toolName" in parsed &&
            "args" in parsed &&
            typeof parsed.toolName === "string" &&
            typeof parsed.args === "object" &&
            parsed.args !== null && // Reject null args (typeof null === "object" in JS!)
            !Array.isArray(parsed.args) // Reject array args
          ) {
            calls.push({
              toolName: parsed.toolName,
              args: parsed.args as Record<string, unknown>,
            });
          } else {
            // Invalid structure - Issue #2
            errors.push({
              type: "invalid_structure",
              message: `Tool call has invalid structure. Expected: {"toolName": "string", "args": {...}}. Got: ${json}`,
              line: toolCallStartLine,
              json: json,
            });
          }
        } catch (parseError) {
          // JSON parse failed - Issue #2
          const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
          errors.push({
            type: "json_parse",
            message: `Invalid JSON in tool call: ${errorMsg}`,
            line: toolCallStartLine,
            json: json,
          });
        }
      }

      inToolCall = false;
      jsonLines = [];
      toolCallStartLine = -1;
      continue;
    }

    if (inToolCall) {
      jsonLines.push(line);
    }
  }

  // Check for unclosed TOOL_CALL block - Issue #3
  if (inToolCall && jsonLines.length > 0) {
    const json = jsonLines.join("\n");
    errors.push({
      type: "unclosed_block",
      message: `Tool call block not closed. Missing END_TOOL_CALL after line ${toolCallStartLine}.`,
      line: toolCallStartLine,
      json: json,
    });
  }

  // Check for too many tool calls - Issue #8
  if (calls.length > maxToolCalls) {
    errors.push({
      type: "too_many_calls",
      message: `You generated ${calls.length} tool calls, but the limit is ${maxToolCalls}. Only the first ${maxToolCalls} will be executed.`,
    });
  }

  return { calls, errors };
}

/**
 * Format tool call for agent prompt
 *
 * Creates properly formatted envelope for documentation/examples.
 *
 * @param toolCall Tool call to format
 * @returns Formatted string
 */
export function formatToolCall(toolCall: ToolCall): string {
  const json = JSON.stringify(
    {
      toolName: toolCall.toolName,
      args: toolCall.args,
    },
    null,
    2,
  );

  return `${TOOL_CALL_START}\n${json}\n${TOOL_CALL_END}`;
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
  // Emit trace event: tool call
  config.onTrace?.({
    type: "tool_call",
    toolName: toolCall.toolName,
    args: toolCall.args,
  });

  try {
    // Validate tool exists
    if (!hasTool(toolCall.toolName)) {
      const result = {
        success: false,
        error: `Unknown tool: ${toolCall.toolName}`,
      };

      // Emit trace event: tool result (error)
      config.onTrace?.({
        type: "tool_result",
        toolName: toolCall.toolName,
        success: false,
        error: result.error,
      });

      return result;
    }

    // Check safety
    const approved = await checkToolSafety(
      toolCall.toolName,
      toolCall.args,
      config.autoApprove ?? false,
    );

    if (!approved) {
      const result = {
        success: false,
        error: `Tool execution denied by user: ${toolCall.toolName}`,
      };

      // Emit trace event: tool result (denied)
      config.onTrace?.({
        type: "tool_result",
        toolName: toolCall.toolName,
        success: false,
        error: result.error,
      });

      return result;
    }

    // Get tool and execute (with timeout)
    const tool = getTool(toolCall.toolName);
    const toolTimeout = config.toolTimeout ?? DEFAULT_TIMEOUTS.tool;
    const result = await executeToolWithTimeout(
      tool.fn,
      toolCall.args,
      config.workspace,
      toolTimeout,
    );

    // Truncate result if needed
    const resultStr = typeof result === "string"
      ? result
      : JSON.stringify(result, null, 2);

    const truncated = config.context.truncateResult(resultStr);

    // Emit trace event: tool result (success)
    config.onTrace?.({
      type: "tool_result",
      toolName: toolCall.toolName,
      success: true,
      result: truncated,
    });

    return {
      success: true,
      result: truncated,
    };
  } catch (error) {
    const result = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };

    // Emit trace event: tool result (error)
    config.onTrace?.({
      type: "tool_result",
      toolName: toolCall.toolName,
      success: false,
      error: result.error,
    });

    return result;
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
 * 2. Parse tool calls from response
 * 3. Execute tool calls with safety checks
 * 4. Add tool results to context
 * 5. Return results for next agent turn
 *
 * @param agentResponse Agent's response (may contain tool calls)
 * @param config Orchestrator configuration
 * @returns Tool execution results and whether to continue
 *
 * @example
 * ```ts
 * // Agent generates response with tool call
 * const agentResponse = `Let me read that file.
 * TOOL_CALL
 * {"toolName": "read_file", "args": {"path": "src/main.ts"}}
 * END_TOOL_CALL`;
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
  agentResponse: string,
  config: OrchestratorConfig,
): Promise<{
  toolCallsMade: number;
  results: ToolExecutionResult[];
  toolCalls: ToolCall[]; // Added for per-tool denial tracking (Issue #6)
  shouldContinue: boolean;
}> {
  // Add agent response to context
  addContextMessage(config, {
    role: "assistant",
    content: agentResponse,
  });

  // Parse tool calls - Issues #2, #3, #8: Now returns errors too
  const maxCalls = config.maxToolCalls ?? 10;
  const parseResult = parseToolCalls(agentResponse, maxCalls);
  const { calls: toolCalls, errors: parseErrors } = parseResult;

  // Report parse errors to LLM with self-teaching examples (Issue #10)
  if (parseErrors.length > 0) {
    for (const error of parseErrors) {
      let errorMsg = `❌ Parse Error${error.line ? ` (line ${error.line})` : ""}: ${error.message}`;

      // Add self-teaching protocol based on error type
      if (error.type === "json_parse") {
        errorMsg += `\n\n**Your JSON:**\n${error.json}\n\n**Correct Format:**\nTOOL_CALL\n{"toolName": "tool_name", "args": {...}}\nEND_TOOL_CALL\n\n**Common JSON errors:**\n- Missing closing brace }\n- Extra comma after last property\n- Unescaped quotes in strings\n- Single quotes instead of double quotes`;
      } else if (error.type === "invalid_structure") {
        errorMsg += `\n\n**Your JSON:**\n${error.json}\n\n**Correct Format:**\n{"toolName": "string", "args": {...}}\n\n**Required:**\n- "toolName" must be a string\n- "args" must be an object {...}\n- No extra fields allowed`;
      } else if (error.type === "unclosed_block") {
        errorMsg += `\n\n**Your incomplete block:**\n${error.json}\n\n**You forgot END_TOOL_CALL!**\n\nCorrect format:\nTOOL_CALL\n{"toolName": "tool_name", "args": {...}}\nEND_TOOL_CALL  ← Don't forget this!`;
      } else if (error.type === "too_many_calls") {
        errorMsg += `\n\n**Best Practices:**\n- Use 1-3 tool calls per turn for better control\n- Break complex tasks into multiple turns\n- Chain dependent operations: read → analyze → write\n- If you need more operations, complete current batch first`;
      }

      addContextMessage(config, {
        role: "tool",
        content: errorMsg,
      });
    }
  }

  // No tool calls = agent finished (or all failed to parse)
  if (toolCalls.length === 0) {
    // If there were parse errors, continue to let LLM fix them
    // Otherwise, agent is done
    return {
      toolCallsMade: 0,
      results: [],
      toolCalls: [],
      shouldContinue: parseErrors.length > 0,
    };
  }

  // Limit tool calls per turn (warning already reported at parse time)
  const limitedCalls = toolCalls.slice(0, maxCalls);

  // Execute tool calls
  const results = await executeToolCalls(limitedCalls, config);

  // Add tool results to context
  for (let i = 0; i < results.length; i++) {
    const call = limitedCalls[i];
    const result = results[i];

    const observation = result.success
      ? `Tool: ${call.toolName}\nResult: ${
        typeof result.result === "string"
          ? result.result
          : JSON.stringify(result.result)
      }`
      : `Tool: ${call.toolName}\nError: ${result.error}`;

    addContextMessage(config, {
      role: "tool",
      content: observation,
    });
  }

  return {
    toolCallsMade: results.length,
    results,
    toolCalls: limitedCalls, // Return executed tool calls for denial tracking
    shouldContinue: true, // Always continue after tool calls
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
): Promise<string> {
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
): Promise<string> {
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
): Promise<unknown> {
  // NOTE: If toolFn doesn't honor AbortSignal, underlying work may continue.
  return await withTimeout(
    async (signal) => {
      const result = await toolFn(args, workspace, { signal });
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

  const toolUses: ToolUse[] = [];
  let groundingRetries = 0;
  const maxGroundingRetries = groundingMode === "strict" ? 1 : 0;

  while (iterations < maxIterations) {
    iterations++;

    // Emit trace event: iteration
    config.onTrace?.({
      type: "iteration",
      current: iterations,
      max: maxIterations,
    });

    // Call LLM to get agent response (with retry)
    const messages = config.context.getMessages();

    // Emit trace event: LLM call
    config.onTrace?.({
      type: "llm_call",
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
        throw new RateLimitError(
          `LLM rate limit exceeded (${status.used}/${status.maxCalls} per ${status.windowMs}ms)`,
          status.maxCalls,
          status.windowMs,
        );
      }
    }

    const agentResponse = await callLLMWithRetry(
      llmFunction,
      messages,
      { timeout: llmTimeout, maxRetries },
      config.onTrace,
    );

    // Emit trace event: LLM response
    config.onTrace?.({
      type: "llm_response",
      length: agentResponse.length,
      truncated: agentResponse.substring(0, 200),
    });

    // Process response and execute tools
    const result = await processAgentResponse(agentResponse, config);

    // If no tool calls, agent is done
    if (!result.shouldContinue) {
      if (groundingMode !== "off") {
        const grounding = checkGrounding(agentResponse, toolUses);
        config.onTrace?.({
          type: "grounding_check",
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
          return `${agentResponse}${warningText}`;
        }
      }
      return agentResponse;
    }

    // Track tool uses for grounding checks
    for (let i = 0; i < result.toolCalls.length; i++) {
      const call = result.toolCalls[i];
      const toolResult = result.results[i];
      const resultText = toolResult.success
        ? typeof toolResult.result === "string"
          ? toolResult.result
          : JSON.stringify(toolResult.result)
        : `ERROR: ${toolResult.error}`;

      toolUses.push({
        toolName: call.toolName,
        result: resultText ?? "",
      });

      const bytes = encoder.encode(resultText ?? "").length;
      totalToolResultBytes += bytes;
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
          throw error;
        }
      }
    }
    if (result.toolCallsMade > 0) {
      groundingRetries = 0;
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
      return finalResponse;
    }

    // If any tool failed, agent might want to retry or give up
    const anyFailed = result.results.some((r) => !r.success);
    if (anyFailed && iterations >= maxIterations / 2) {
      // Stop early if tools keep failing
      return agentResponse;
    }
  }

  // Hit max iterations
  return "Maximum iterations reached. Task incomplete.";
}
