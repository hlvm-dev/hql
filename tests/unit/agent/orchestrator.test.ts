/**
 * ReAct Orchestrator Tests
 *
 * Verifies tool call parsing and execution orchestration
 */

import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";
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
import { TOOL_REGISTRY } from "../../../src/hlvm/agent/registry.ts";

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

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 1);
    assertEquals(result.errors.length, 0);
    assertEquals(result.calls[0].toolName, "read_file");
    assertEquals(result.calls[0].args.path, "src/main.ts");
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

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 2);
    assertEquals(result.errors.length, 0);
    assertEquals(result.calls[0].toolName, "search_code");
    assertEquals(result.calls[1].toolName, "read_file");
  },
});

Deno.test({
  name: "Orchestrator: parseToolCalls - no tool calls",
  fn() {
    const response = "Here is my analysis of the code...";
    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 0);
    assertEquals(result.errors.length, 0);
  },
});

Deno.test({
  name: "Orchestrator: parseToolCalls - invalid JSON reports error",
  fn() {
    const response = `
TOOL_CALL
{invalid json}
END_TOOL_CALL`;

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 0);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].type, "json_parse");
  },
});

Deno.test({
  name: "Orchestrator: parseToolCalls - incomplete envelope reports error",
  fn() {
    const response = `
TOOL_CALL
{"toolName": "read_file", "args": {"path": "test.ts"}}
`;

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 0); // No END_TOOL_CALL
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].type, "unclosed_block");
  },
});

Deno.test({
  name: "Orchestrator: parseToolCalls - missing fields reports errors",
  fn() {
    const response1 = `
TOOL_CALL
{"args": {"path": "test.ts"}}
END_TOOL_CALL`;

    const result1 = parseToolCalls(response1);
    assertEquals(result1.calls.length, 0); // No toolName
    assertEquals(result1.errors.length, 1);
    assertEquals(result1.errors[0].type, "invalid_structure");

    const response2 = `
TOOL_CALL
{"toolName": "read_file"}
END_TOOL_CALL`;

    const result2 = parseToolCalls(response2);
    assertEquals(result2.calls.length, 0); // No args
    assertEquals(result2.errors.length, 1);
    assertEquals(result2.errors[0].type, "invalid_structure");
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

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 1);
    assertEquals(result.errors.length, 0);
    assertEquals(result.calls[0].toolName, "write_file");
    assertEquals(result.calls[0].args.path, "src/main.ts");
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
    const result = parseToolCalls(formatted);
    assertEquals(result.calls.length, 1);
    assertEquals(result.errors.length, 0);
    assertEquals(result.calls[0].toolName, "read_file");
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
  name: "Orchestrator: executeToolCall passes AbortSignal to tool",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    const toolName = "__test_signal_tool__";
    let sawSignal = false;

    TOOL_REGISTRY[toolName] = {
      fn: async (_args: unknown, _workspace: string, options?: { signal?: AbortSignal }) => {
        sawSignal = options?.signal instanceof AbortSignal;
        return "ok";
      },
      description: "test tool",
      args: {},
      safetyLevel: "L0" as const,
    };

    try {
      const result = await executeToolCall(
        { toolName, args: {} },
        { workspace: TEST_WORKSPACE, context, autoApprove: true },
      );

      assertEquals(result.success, true);
      assertEquals(sawSignal, true);
    } finally {
      delete TOOL_REGISTRY[toolName];
    }
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
  name: "Orchestrator: executeToolCalls - rate limit blocks extra tools",
  async fn() {
    clearAllL1Confirmations();

    const fakeOne = "fake_rate_one";
    const fakeTwo = "fake_rate_two";
    TOOL_REGISTRY[fakeOne] = {
      fn: async () => "ok",
      description: "fake",
      args: {},
    };
    TOOL_REGISTRY[fakeTwo] = {
      fn: async () => "ok",
      description: "fake",
      args: {},
    };

    try {
      const context = new ContextManager();
      const calls: ToolCall[] = [
        { toolName: fakeOne, args: {} },
        { toolName: fakeTwo, args: {} },
      ];

      const results = await executeToolCalls(calls, {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: true,
        toolRateLimit: { maxCalls: 1, windowMs: 1000 },
      });

      assertEquals(results.length, 2);
      assertEquals(results[0].success, true);
      assertEquals(results[1].success, false);
      assertStringIncludes(results[1].error ?? "", "rate limit");
    } finally {
      delete TOOL_REGISTRY[fakeOne];
      delete TOOL_REGISTRY[fakeTwo];
    }
  },
});

Deno.test({
  name: "Orchestrator: executeToolCalls - stop on error (continueOnError: false)",
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
      continueOnError: false, // Explicitly stop on error
    });

    assertEquals(results.length, 1); // Stopped after first error
    assertEquals(results[0].success, false);
  },
});

Deno.test({
  name: "Orchestrator: executeToolCalls - continue on error (default behavior)",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    const calls: ToolCall[] = [
      { toolName: "unknown_tool", args: {} }, // This will fail
      { toolName: "search_code", args: { pattern: "test" } }, // Should still execute
    ];

    const results = await executeToolCalls(calls, {
      workspace: TEST_WORKSPACE,
      context,
      autoApprove: true,
      // continueOnError defaults to true
    });

    assertEquals(results.length, 2); // Both executed
    assertEquals(results[0].success, false); // First failed
    assertEquals(results[1].success, true); // Second succeeded
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
  name: "Orchestrator: runReActLoop - llm rate limit enforced",
  async fn() {
    const toolName = "fake_rate_tool";
    TOOL_REGISTRY[toolName] = {
      fn: async () => "ok",
      description: "fake",
      args: {},
    };

    try {
      const llm = async () =>
        `TOOL_CALL\n{"toolName":"${toolName}","args":{}}\nEND_TOOL_CALL`;

      const context = new ContextManager();
      context.addMessage({
        role: "system",
        content: "system",
      });

      await assertRejects(
        () =>
          runReActLoop(
            "do rate limited run",
            {
              workspace: TEST_WORKSPACE,
              context,
              autoApprove: true,
              llmRateLimit: { maxCalls: 1, windowMs: 1000 },
            },
            llm,
          ),
        Error,
        "rate limit",
      );
    } finally {
      delete TOOL_REGISTRY[toolName];
    }
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop passes AbortSignal to LLM",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    let sawSignal = false;

    const mockLLM = async (_messages: any[], signal?: AbortSignal) => {
      sawSignal = signal instanceof AbortSignal;
      return "Signal response";
    };

    const result = await runReActLoop(
      "Signal task",
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: true,
      },
      mockLLM,
    );

    assertEquals(result, "Signal response");
    assertEquals(sawSignal, true);
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop - does not retry on AbortError",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    let calls = 0;

    const mockLLM = async () => {
      calls++;
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    };

    let threw = false;
    try {
      await runReActLoop(
        "Abort task",
        { workspace: TEST_WORKSPACE, context, autoApprove: true, maxRetries: 3 },
        mockLLM,
      );
    } catch {
      threw = true;
    }

    assertEquals(threw, true);
    assertEquals(calls, 1);
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop - retries on rate limit then succeeds",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    let calls = 0;

    const mockLLM = async () => {
      calls++;
      if (calls < 2) {
        throw new Error("Rate limit exceeded (429)");
      }
      return "done";
    };

    const result = await runReActLoop(
      "Rate limit task",
      { workspace: TEST_WORKSPACE, context, autoApprove: true, maxRetries: 2 },
      mockLLM,
    );

    assertEquals(result, "done");
    assertEquals(calls, 2);
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

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 1);
    assertEquals(result.errors.length, 0);
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

// ============================================================
// Denial Stop Policy tests
// ============================================================

Deno.test({
  name: "Orchestrator: runReActLoop - denial stop policy tracks consecutive denials",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    let callCount = 0;

    // Mock LLM that tries L2 tool 3 times then gives up
    const mockLLM = async () => {
      callCount++;

      if (callCount <= 3) {
        // First 3 calls: try write_file (L2, will be denied)
        return `Let me write the file.
TOOL_CALL
{"toolName": "write_file", "args": {"path": "test.ts", "content": "test"}}
END_TOOL_CALL`;
      } else {
        // 4th call: after max denials message, use ask_user
        return `Let me clarify the requirements.
TOOL_CALL
{"toolName": "ask_user", "args": {"question": "What should I do?"}}
END_TOOL_CALL`;
      }
    };

    const result = await runReActLoop(
      "Write a test file",
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: false, // Trigger denials
        maxDenials: 3,
      },
      mockLLM,
    );

    // Should stop after 3 denials and give agent chance to use ask_user
    assertEquals(callCount, 4);

    // Check that max denials message was added to context
    const messages = context.getMessages();
    const toolMessages = messages.filter((m) => m.role === "tool");
    const maxDenialsMsg = toolMessages.find((m) =>
      m.content.includes("Maximum denials")
    );
    assertEquals(maxDenialsMsg !== undefined, true);
    assertEquals(maxDenialsMsg!.content.includes("ask_user"), true);
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop - denial counter resets on success",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    let callCount = 0;

    // Mock LLM that alternates between L2 and L0 tools
    const mockLLM = async () => {
      callCount++;

      if (callCount === 1 || callCount === 3) {
        // Calls 1, 3: try L2 tool (denied)
        return `Let me write.
TOOL_CALL
{"toolName": "write_file", "args": {"path": "test.ts", "content": "test"}}
END_TOOL_CALL`;
      } else if (callCount === 2 || callCount === 4) {
        // Calls 2, 4: use L0 tool (succeeds, resets counter)
        return `Let me read instead.
TOOL_CALL
{"toolName": "read_file", "args": {"path": "test.ts"}}
END_TOOL_CALL`;
      } else {
        // Call 5: finish
        return "Done analyzing.";
      }
    };

    const result = await runReActLoop(
      "Analyze file",
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: false, // Trigger denials for L2
        maxDenials: 2,
      },
      mockLLM,
    );

    // Should complete all 5 calls without hitting max denials
    // Because L0 tools reset the counter
    assertEquals(callCount, 5);
    assertEquals(result.includes("Done analyzing"), true);

    // Should NOT see max denials message
    const messages = context.getMessages();
    const maxDenialsMsg = messages.find((m) =>
      m.content.includes("Maximum denials")
    );
    assertEquals(maxDenialsMsg, undefined);
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop - respects custom maxDenials config",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    let callCount = 0;

    // Mock LLM that keeps trying L2 tool
    const mockLLM = async () => {
      callCount++;
      return `Let me write.
TOOL_CALL
{"toolName": "write_file", "args": {"path": "test.ts", "content": "test"}}
END_TOOL_CALL`;
    };

    const result = await runReActLoop(
      "Write file",
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: false,
        maxDenials: 2, // Custom limit (instead of default 3)
      },
      mockLLM,
    );

    // Should stop after 2 denials (not 3)
    // Call 1: denied, Call 2: denied, Call 3: max denials message + final chance
    assertEquals(callCount, 3);

    // Verify max denials message
    const messages = context.getMessages();
    const maxDenialsMsg = messages.find((m) =>
      m.content.includes("Maximum denials (2)")
    );
    assertEquals(maxDenialsMsg !== undefined, true);
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop - default maxDenials is 3",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    let callCount = 0;

    // Mock LLM that keeps trying L2 tool
    const mockLLM = async () => {
      callCount++;
      return `Let me write.
TOOL_CALL
{"toolName": "write_file", "args": {"path": "test.ts", "content": "test"}}
END_TOOL_CALL`;
    };

    const result = await runReActLoop(
      "Write file",
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: false,
        // No maxDenials specified, should default to 3
      },
      mockLLM,
    );

    // Should stop after 3 denials
    // Call 1-3: denied, Call 4: max denials message + final chance
    assertEquals(callCount, 4);

    // Verify default of 3
    const messages = context.getMessages();
    const maxDenialsMsg = messages.find((m) =>
      m.content.includes("Maximum denials (3)")
    );
    assertEquals(maxDenialsMsg !== undefined, true);
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop - suggests ask_user after max denials",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();

    // Mock LLM that keeps trying L2 tool
    const mockLLM = async () => {
      return `Let me write.
TOOL_CALL
{"toolName": "write_file", "args": {"path": "test.ts", "content": "test"}}
END_TOOL_CALL`;
    };

    await runReActLoop(
      "Write file",
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: false,
        maxDenials: 2,
      },
      mockLLM,
    );

    // Check that suggestion message includes ask_user reference
    const messages = context.getMessages();
    const toolMessages = messages.filter((m) => m.role === "tool");
    const suggestionMsg = toolMessages.find((m) =>
      m.content.includes("ask_user")
    );

    assertEquals(suggestionMsg !== undefined, true);
    assertEquals(
      suggestionMsg!.content.includes("clarify requirements"),
      true,
    );
  },
});
