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
  try {
    // Validate tool exists
    if (!hasTool(toolCall.toolName)) {
      return {
        success: false,
        error: `Unknown tool: ${toolCall.toolName}`,
      };
    }

    // Check safety
    const approved = await checkToolSafety(
      toolCall.toolName,
      toolCall.args,
      config.autoApprove ?? false,
    );

    if (!approved) {
      return {
        success: false,
        error: `Tool execution denied by user: ${toolCall.toolName}`,
      };
    }

    // Get tool and execute
    const tool = getTool(toolCall.toolName);
    const result = await tool.fn(toolCall.args, config.workspace);

    // Truncate result if needed
    const resultStr = typeof result === "string"
      ? result
      : JSON.stringify(result, null, 2);

    const truncated = config.context.truncateResult(resultStr);

    return {
      success: true,
      result: truncated,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
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

  while (iterations < maxIterations) {
    iterations++;

    // Call LLM to get agent response
    const messages = config.context.getMessages();
    const agentResponse = await llmFunction(messages);

    // Process response and execute tools
    const result = await processAgentResponse(agentResponse, config);

    // If no tool calls, agent is done
    if (!result.shouldContinue) {
      return agentResponse;
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
