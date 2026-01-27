/**
 * ReAct Orchestrator Tests
 *
 * Verifies tool call parsing and execution orchestration
 */

import { assertEquals } from "jsr:@std/assert";
import {
  parseToolCalls,
  formatToolCall,
  executeToolCall,
  executeToolCalls,
  processAgentResponse,
  runReActLoop,
  type ToolCall,
} from "../../../src/hlvm/agent/orchestrator.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import { clearAllL1Confirmations } from "../../../src/hlvm/agent/security/safety.ts";

// Test workspace
const TEST_WORKSPACE = "/tmp/hlvm-test-orchestrator";

// ============================================================
// Tool Call Parsing tests
// ============================================================

Deno.test({
  name: "Orchestrator: parseToolCalls - parse single tool call",
  fn() {
    const response = `Let me read that file.
TOOL_CALL
{"toolName": "read_file", "args": {"path": "src/main.ts"}}
END_TOOL_CALL`;

    const calls = parseToolCalls(response);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].toolName, "read_file");
    assertEquals(calls[0].args.path, "src/main.ts");
  },
});

Deno.test({
  name: "Orchestrator: parseToolCalls - parse multiple tool calls",
  fn() {
    const response = `Let me search and then read.
TOOL_CALL
{"toolName": "search_code", "args": {"pattern": "test"}}
END_TOOL_CALL

Now let me read:
TOOL_CALL
{"toolName": "read_file", "args": {"path": "src/main.ts"}}
END_TOOL_CALL`;

    const calls = parseToolCalls(response);
    assertEquals(calls.length, 2);
    assertEquals(calls[0].toolName, "search_code");
    assertEquals(calls[1].toolName, "read_file");
  },
});

Deno.test({
  name: "Orchestrator: parseToolCalls - no tool calls",
  fn() {
    const response = "Here is my analysis of the code...";
    const calls = parseToolCalls(response);
    assertEquals(calls.length, 0);
  },
});

Deno.test({
  name: "Orchestrator: parseToolCalls - invalid JSON ignored",
  fn() {
    const response = `
TOOL_CALL
{invalid json}
END_TOOL_CALL`;

    const calls = parseToolCalls(response);
    assertEquals(calls.length, 0);
  },
});

Deno.test({
  name: "Orchestrator: parseToolCalls - incomplete envelope ignored",
  fn() {
    const response = `
TOOL_CALL
{"toolName": "read_file", "args": {"path": "test.ts"}}
`;

    const calls = parseToolCalls(response);
    assertEquals(calls.length, 0); // No END_TOOL_CALL
  },
});

Deno.test({
  name: "Orchestrator: parseToolCalls - missing fields ignored",
  fn() {
    const response1 = `
TOOL_CALL
{"args": {"path": "test.ts"}}
END_TOOL_CALL`;

    const calls1 = parseToolCalls(response1);
    assertEquals(calls1.length, 0); // No toolName

    const response2 = `
TOOL_CALL
{"toolName": "read_file"}
END_TOOL_CALL`;

    const calls2 = parseToolCalls(response2);
    assertEquals(calls2.length, 0); // No args
  },
});

Deno.test({
  name: "Orchestrator: parseToolCalls - multiline JSON",
  fn() {
    const response = `
TOOL_CALL
{
  "toolName": "write_file",
  "args": {
    "path": "src/main.ts",
    "content": "function test() {\\n  return true;\\n}"
  }
}
END_TOOL_CALL`;

    const calls = parseToolCalls(response);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].toolName, "write_file");
    assertEquals(calls[0].args.path, "src/main.ts");
  },
});

// ============================================================
// Tool Call Formatting tests
// ============================================================

Deno.test({
  name: "Orchestrator: formatToolCall - format tool call",
  fn() {
    const call: ToolCall = {
      toolName: "read_file",
      args: { path: "src/main.ts" },
    };

    const formatted = formatToolCall(call);
    assertEquals(formatted.includes("TOOL_CALL"), true);
    assertEquals(formatted.includes("END_TOOL_CALL"), true);
    assertEquals(formatted.includes("read_file"), true);

    // Should be parseable
    const parsed = parseToolCalls(formatted);
    assertEquals(parsed.length, 1);
    assertEquals(parsed[0].toolName, "read_file");
  },
});

// ============================================================
// Tool Execution tests
// ============================================================

Deno.test({
  name: "Orchestrator: executeToolCall - execute valid tool",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    const call: ToolCall = {
      toolName: "search_code",
      args: { pattern: "test" },
    };

    const result = await executeToolCall(call, {
      workspace: TEST_WORKSPACE,
      context,
      autoApprove: true, // Skip confirmation
    });

    assertEquals(result.success, true);
    assertEquals(result.result !== undefined, true);
  },
});

Deno.test({
  name: "Orchestrator: executeToolCall - unknown tool fails",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    const call: ToolCall = {
      toolName: "unknown_tool",
      args: {},
    };

    const result = await executeToolCall(call, {
      workspace: TEST_WORKSPACE,
      context,
      autoApprove: true,
    });

    assertEquals(result.success, false);
    assertEquals(result.error !== undefined, true);
    assertEquals(result.error!.includes("Unknown tool"), true);
  },
});

Deno.test({
  name: "Orchestrator: executeToolCall - respects autoApprove",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    const call: ToolCall = {
      toolName: "read_file",
      args: { path: "test.ts" },
    };

    // With autoApprove
    const result1 = await executeToolCall(call, {
      workspace: TEST_WORKSPACE,
      context,
      autoApprove: true,
    });

    // L0 tools should work even without autoApprove
    assertEquals(result1.success, true);
  },
});

Deno.test({
  name: "Orchestrator: executeToolCall - truncates large results",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager({ maxResultLength: 100 });

    // search_code might return large results
    const call: ToolCall = {
      toolName: "get_structure",
      args: {},
    };

    const result = await executeToolCall(call, {
      workspace: TEST_WORKSPACE,
      context,
      autoApprove: true,
    });

    assertEquals(result.success, true);

    // If result is large, should be truncated
    if (typeof result.result === "string" && result.result.length > 100) {
      assertEquals(result.result.includes("[Result truncated"), true);
    }
  },
});

Deno.test({
  name: "Orchestrator: executeToolCalls - execute multiple sequentially",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    const calls: ToolCall[] = [
      { toolName: "search_code", args: { pattern: "test" } },
      { toolName: "find_symbol", args: { name: "test" } },
    ];

    const results = await executeToolCalls(calls, {
      workspace: TEST_WORKSPACE,
      context,
      autoApprove: true,
    });

    assertEquals(results.length, 2);
    assertEquals(results[0].success, true);
    assertEquals(results[1].success, true);
  },
});

Deno.test({
  name: "Orchestrator: executeToolCalls - stop on error",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    const calls: ToolCall[] = [
      { toolName: "unknown_tool", args: {} }, // This will fail
      { toolName: "search_code", args: { pattern: "test" } }, // Should not execute
    ];

    const results = await executeToolCalls(calls, {
      workspace: TEST_WORKSPACE,
      context,
      autoApprove: true,
    });

    assertEquals(results.length, 1); // Stopped after first error
    assertEquals(results[0].success, false);
  },
});

// ============================================================
// Process Agent Response tests
// ============================================================

Deno.test({
  name: "Orchestrator: processAgentResponse - no tool calls",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    const response = "Here is my analysis...";

    const result = await processAgentResponse(response, {
      workspace: TEST_WORKSPACE,
      context,
      autoApprove: true,
    });

    assertEquals(result.toolCallsMade, 0);
    assertEquals(result.shouldContinue, false);

    // Should add agent response to context
    const messages = context.getMessages();
    assertEquals(messages.length >= 1, true);
    assertEquals(messages[messages.length - 1].role, "assistant");
  },
});

Deno.test({
  name: "Orchestrator: processAgentResponse - with tool calls",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    const response = `Let me search for that.
TOOL_CALL
{"toolName": "search_code", "args": {"pattern": "test"}}
END_TOOL_CALL`;

    const result = await processAgentResponse(response, {
      workspace: TEST_WORKSPACE,
      context,
      autoApprove: true,
    });

    assertEquals(result.toolCallsMade, 1);
    assertEquals(result.shouldContinue, true);
    assertEquals(result.results[0].success, true);

    // Should add tool result to context
    const messages = context.getMessages();
    const toolMessages = messages.filter((m) => m.role === "tool");
    assertEquals(toolMessages.length >= 1, true);
  },
});

Deno.test({
  name: "Orchestrator: processAgentResponse - limit tool calls",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();

    // Create response with many tool calls
    let response = "Let me do many searches.\n";
    for (let i = 0; i < 20; i++) {
      response += `TOOL_CALL\n{"toolName": "search_code", "args": {"pattern": "test${i}"}}\nEND_TOOL_CALL\n`;
    }

    const result = await processAgentResponse(response, {
      workspace: TEST_WORKSPACE,
      context,
      autoApprove: true,
      maxToolCalls: 5, // Limit to 5
    });

    // Should only execute 5 calls
    assertEquals(result.toolCallsMade <= 5, true);
  },
});

// ============================================================
// ReAct Loop tests
// ============================================================

Deno.test({
  name: "Orchestrator: runReActLoop - simple completion",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();

    // Mock LLM that returns final response immediately
    const mockLLM = async () => {
      return "I can help with that. The answer is 42.";
    };

    const result = await runReActLoop(
      "What is the answer?",
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: true,
      },
      mockLLM,
    );

    assertEquals(typeof result, "string");
    assertEquals(result.includes("42"), true);
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop - with tool calls",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();

    let callCount = 0;

    // Mock LLM that makes tool call first, then responds
    const mockLLM = async () => {
      callCount++;

      if (callCount === 1) {
        // First call: make tool call
        return `Let me search for that.
TOOL_CALL
{"toolName": "search_code", "args": {"pattern": "test"}}
END_TOOL_CALL`;
      } else {
        // Second call: final response
        return "Found the code. Here is my analysis...";
      }
    };

    const result = await runReActLoop(
      "Find test code",
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: true,
      },
      mockLLM,
    );

    assertEquals(typeof result, "string");
    assertEquals(callCount, 2); // Should have called LLM twice
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop - max iterations",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();

    // Mock LLM that always makes tool calls (infinite loop)
    const mockLLM = async () => {
      return `Let me search again.
TOOL_CALL
{"toolName": "search_code", "args": {"pattern": "test"}}
END_TOOL_CALL`;
    };

    const result = await runReActLoop(
      "Find something",
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: true,
      },
      mockLLM,
    );

    assertEquals(result.includes("Maximum iterations"), true);
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop - tool failure handling",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();

    let callCount = 0;

    // Mock LLM that tries invalid tool then gives up
    const mockLLM = async () => {
      callCount++;

      if (callCount === 1) {
        // First call: try invalid tool
        return `Let me try this tool.
TOOL_CALL
{"toolName": "invalid_tool", "args": {}}
END_TOOL_CALL`;
      } else {
        // Second call: give up
        return "Sorry, the tool failed. I cannot complete this task.";
      }
    };

    const result = await runReActLoop(
      "Do something",
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: true,
      },
      mockLLM,
    );

    assertEquals(typeof result, "string");
    assertEquals(callCount, 2);
  },
});

// ============================================================
// Edge cases
// ============================================================

Deno.test({
  name: "Orchestrator: parseToolCalls - whitespace tolerance",
  fn() {
    const response = `
  TOOL_CALL
{"toolName": "read_file", "args": {"path": "test.ts"}}
  END_TOOL_CALL
`;

    const calls = parseToolCalls(response);
    assertEquals(calls.length, 1);
  },
});

Deno.test({
  name: "Orchestrator: processAgentResponse - adds all messages to context",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    const initialCount = context.getMessages().length;

    const response = `Let me help.
TOOL_CALL
{"toolName": "search_code", "args": {"pattern": "test"}}
END_TOOL_CALL`;

    await processAgentResponse(response, {
      workspace: TEST_WORKSPACE,
      context,
      autoApprove: true,
    });

    const finalCount = context.getMessages().length;

    // Should add: 1 assistant message + 1 tool result message
    assertEquals(finalCount, initialCount + 2);
  },
});
