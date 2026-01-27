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

import { getTool, hasTool } from "./registry.ts";
import { checkToolSafety } from "./security/safety.ts";
import { ContextManager, type Message } from "./context.ts";

// ============================================================
// Types
// ============================================================

/** Tool call parsed from agent response */
export interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

/** Result of tool execution */
export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/** Trace event for observability/debugging */
export type TraceEvent =
  | { type: "iteration"; current: number; max: number }
  | { type: "llm_call"; messageCount: number }
  | { type: "llm_response"; length: number; truncated: string }
  | { type: "tool_call"; toolName: string; args: unknown }
  | { type: "tool_result"; toolName: string; success: boolean; result?: unknown; error?: string };

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
}

/** Tool call envelope constants */
const TOOL_CALL_START = "TOOL_CALL";
const TOOL_CALL_END = "END_TOOL_CALL";

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
 * @param response Agent response text
 * @returns Array of parsed tool calls
 *
 * @example
 * ```ts
 * const response = `Let me read that file.
 * TOOL_CALL
 * {"toolName": "read_file", "args": {"path": "src/main.ts"}}
 * END_TOOL_CALL`;
 *
 * const calls = parseToolCalls(response);
 * // Returns: [{ toolName: "read_file", args: { path: "src/main.ts" } }]
 * ```
 */
export function parseToolCalls(response: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // Find all TOOL_CALL...END_TOOL_CALL blocks
  const lines = response.split("\n");
  let inToolCall = false;
  let jsonLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === TOOL_CALL_START) {
      inToolCall = true;
      jsonLines = [];
      continue;
    }

    if (trimmed === TOOL_CALL_END) {
      if (inToolCall && jsonLines.length > 0) {
        // Parse JSON
        try {
          const json = jsonLines.join("\n");
          const parsed = JSON.parse(json);

          // Validate structure
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            "toolName" in parsed &&
            "args" in parsed &&
            typeof parsed.toolName === "string" &&
            typeof parsed.args === "object"
          ) {
            calls.push({
              toolName: parsed.toolName,
              args: parsed.args as Record<string, unknown>,
            });
          }
        } catch {
          // Skip invalid JSON
        }
      }

      inToolCall = false;
      jsonLines = [];
      continue;
    }

    if (inToolCall) {
      jsonLines.push(line);
    }
  }

  return calls;
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
    const toolTimeout = config.toolTimeout ?? 60000; // Default 60s
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

  for (const call of toolCalls) {
    const result = await executeToolCall(call, config);
    results.push(result);

    // Stop on first error (optional - could continue)
    if (!result.success) {
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
  shouldContinue: boolean;
}> {
  // Add agent response to context
  config.context.addMessage({
    role: "assistant",
    content: agentResponse,
  });

  // Parse tool calls
  const toolCalls = parseToolCalls(agentResponse);

  // No tool calls = agent finished
  if (toolCalls.length === 0) {
    return {
      toolCallsMade: 0,
      results: [],
      shouldContinue: false,
    };
  }

  // Limit tool calls per turn
  const maxCalls = config.maxToolCalls ?? 10;
  const limitedCalls = toolCalls.slice(0, maxCalls);

  if (toolCalls.length > maxCalls) {
    config.context.addMessage({
      role: "tool",
      content: `Warning: Too many tool calls (${toolCalls.length}). Limiting to ${maxCalls}.`,
    });
  }

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

    config.context.addMessage({
      role: "tool",
      content: observation,
    });
  }

  return {
    toolCallsMade: results.length,
    results,
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
 * @param llmFn LLM function to call
 * @param messages Messages to send
 * @param timeout Timeout in milliseconds
 * @returns LLM response
 * @throws Error if timeout exceeded
 */
async function callLLMWithTimeout(
  llmFn: (messages: Message[]) => Promise<string>,
  messages: Message[],
  timeout: number,
): Promise<string> {
  let timeoutId: number | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`LLM timeout after ${timeout}ms`)), timeout);
  });

  try {
    const result = await Promise.race([llmFn(messages), timeoutPromise]);
    clearTimeout(timeoutId); // Clean up timer on success
    return result;
  } catch (error) {
    clearTimeout(timeoutId); // Clean up timer on error
    throw error;
  }
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
  llmFn: (messages: Message[]) => Promise<string>,
  messages: Message[],
  config: { timeout: number; maxRetries: number },
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      return await callLLMWithTimeout(llmFn, messages, config.timeout);
    } catch (error) {
      lastError = error as Error;

      // Don't retry on last attempt
      if (attempt === config.maxRetries - 1) break;

      // Exponential backoff: 1s, 2s, 4s, 8s
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error(
    `LLM failed after ${config.maxRetries} retries: ${lastError?.message}`,
  );
}

/**
 * Execute tool with timeout
 *
 * Wraps tool execution with timeout to prevent hangs.
 *
 * @param toolFn Tool function to execute
 * @param args Tool arguments
 * @param workspace Workspace path
 * @param timeout Timeout in milliseconds
 * @returns Tool result
 * @throws Error if timeout exceeded
 */
async function executeToolWithTimeout(
  toolFn: (args: unknown, workspace: string) => Promise<unknown>,
  args: unknown,
  workspace: string,
  timeout: number,
): Promise<unknown> {
  let timeoutId: number | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Tool timeout after ${timeout}ms`)), timeout);
  });

  try {
    const result = await Promise.race([toolFn(args, workspace), timeoutPromise]);
    clearTimeout(timeoutId); // Clean up timer on success
    return result;
  } catch (error) {
    clearTimeout(timeoutId); // Clean up timer on error
    throw error;
  }
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
  llmFunction: (messages: Message[]) => Promise<string>,
): Promise<string> {
  // Add user request to context
  config.context.addMessage({
    role: "user",
    content: userRequest,
  });

  let iterations = 0;
  const maxIterations = 20; // Prevent infinite loops

  // Denial tracking (stateful in loop)
  let consecutiveDenials = 0;
  const maxDenials = config.maxDenials ?? 3;

  // Timeout/retry configuration
  const llmTimeout = config.llmTimeout ?? 30000; // Default 30s
  const maxRetries = config.maxRetries ?? 3; // Default 3 retries

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

    const agentResponse = await callLLMWithRetry(
      llmFunction,
      messages,
      { timeout: llmTimeout, maxRetries },
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
      return agentResponse;
    }

    // Check for denied tool calls
    const anyDenied = result.results.some(
      (r) => !r.success && r.error?.includes("denied"),
    );

    if (anyDenied) {
      consecutiveDenials++;

      if (consecutiveDenials >= maxDenials) {
        // Stop and suggest ask_user
        config.context.addMessage({
          role: "tool",
          content: `Maximum denials (${maxDenials}) reached. Consider using ask_user tool to clarify requirements or rephrase the task.`,
        });

        // Give agent one final chance to use ask_user
        const finalResponse = await llmFunction(config.context.getMessages());
        return finalResponse;
      }
    } else {
      // Reset counter on successful tool execution
      consecutiveDenials = 0;
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
