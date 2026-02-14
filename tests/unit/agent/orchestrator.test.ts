/**
 * ReAct Orchestrator Tests
 *
 * Verifies structured tool call execution and orchestration
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  executeToolCall,
  executeToolCalls,
  type LLMResponse,
  processAgentResponse,
  runReActLoop,
  type ToolCall,
} from "../../../src/hlvm/agent/orchestrator.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import { clearAllL1Confirmations } from "../../../src/hlvm/agent/security/safety.ts";
import { TOOL_REGISTRY } from "../../../src/hlvm/agent/registry.ts";

// Test workspace
const TEST_WORKSPACE = "/tmp/hlvm-test-orchestrator";

function makeResponse(
  content: string,
  toolCalls: ToolCall[] = [],
): LLMResponse {
  return { content, toolCalls };
}

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
  name: "Orchestrator: executeToolCall - respects tool allowlist",
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
      autoApprove: true,
      toolAllowlist: ["read_file"],
    });

    assertEquals(result.success, false);
    assertStringIncludes(result.error ?? "", "Tool not allowed");
  },
});

Deno.test({
  name: "Orchestrator: executeToolCall - delegate_agent uses handler",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    let captured: Record<string, unknown> | null = null;

    const result = await executeToolCall(
      {
        toolName: "delegate_agent",
        args: { agent: "web", task: "test delegation" },
      },
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: true,
        delegate: async (args) => {
          await Promise.resolve();
          captured = args as Record<string, unknown>;
          return { ok: true };
        },
      },
    );

    assertEquals(result.success, true);
    assertEquals(captured?.["agent"], "web");
    assertEquals(captured?.["task"], "test delegation");
    assertStringIncludes(String(result.returnDisplay), '"ok": true');
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop - auto delegates plan step",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    let calls = 0;
    let delegated = false;

    const llm = async () => {
      await Promise.resolve();
      calls += 1;
      if (calls === 1) {
        return makeResponse(`PLAN
{\"goal\":\"Test\",\"steps\":[{\"id\":\"step-1\",\"title\":\"Research\",\"agent\":\"web\",\"goal\":\"Find details\"}]}
END_PLAN`);
      }
      return makeResponse("Done.\nSTEP_DONE step-1");
    };

    const result = await runReActLoop(
      "Plan test",
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: true,
        groundingMode: "off",
        planning: { mode: "always", requireStepMarkers: true },
        delegate: async () => {
          await Promise.resolve();
          delegated = true;
          return { note: "delegated" };
        },
      },
      llm,
    );

    assertEquals(delegated, true);
    assertStringIncludes(result, "Done.");
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
      fn: async (
        _args: unknown,
        _workspace: string,
        options?: { signal?: AbortSignal },
      ) => {
        await Promise.resolve();
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
    if (
      typeof result.llmContent === "string" && result.llmContent.length > 100
    ) {
      assertEquals(result.llmContent.includes("[Result truncated"), true);
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
      fn: async () => await Promise.resolve("ok"),
      description: "fake",
      args: {},
    };
    TOOL_REGISTRY[fakeTwo] = {
      fn: async () => await Promise.resolve("ok"),
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
  name:
    "Orchestrator: executeToolCalls - stop on error (continueOnError: false)",
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
    const response: LLMResponse = {
      content: "Here is my analysis...",
      toolCalls: [],
    };

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
    const response: LLMResponse = {
      content: "Let me search for that.",
      toolCalls: [{ toolName: "search_code", args: { pattern: "test" } }],
    };

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
    const toolCalls: ToolCall[] = [];
    for (let i = 0; i < 20; i++) {
      toolCalls.push({
        toolName: "search_code",
        args: { pattern: `test${i}` },
      });
    }
    const response: LLMResponse = {
      content: "Let me do many searches.",
      toolCalls,
    };

    const result = await processAgentResponse(response, {
      workspace: TEST_WORKSPACE,
      context,
      autoApprove: true,
      maxToolCalls: 5, // Limit to 5
    });

    // Should only execute 5 calls
    assertEquals(result.toolCallsMade, 5);
    const messages = context.getMessages();
    const assistant = messages.findLast((m) => m.role === "assistant");
    assertEquals(assistant?.toolCalls?.length, 5);
  },
});

Deno.test({
  name:
    "Orchestrator: processAgentResponse - deduplicates identical tool calls",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    const response = makeResponse("Let me check that.", [
      { toolName: "read_file", args: { path: "src/main.ts" } },
      { toolName: "read_file", args: { path: "src/main.ts" } }, // duplicate
      { toolName: "read_file", args: { path: "src/other.ts" } }, // different args
    ]);

    const result = await processAgentResponse(response, {
      workspace: TEST_WORKSPACE,
      context,
      autoApprove: true,
    });

    // Only 2 unique calls should be executed (not 3)
    assertEquals(result.toolCallsMade, 2);
  },
});

Deno.test({
  name:
    "Orchestrator: processAgentResponse - deduplicates nested args correctly",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    const response = makeResponse("Let me inspect nested args.", [
      {
        toolName: "search_code",
        args: { pattern: "test", options: { path: "src", mode: "exact" } },
      },
      {
        toolName: "search_code",
        args: { pattern: "test", options: { mode: "exact", path: "src" } },
      }, // same call, different key order
      {
        toolName: "search_code",
        args: { pattern: "test", options: { path: "tests", mode: "exact" } },
      }, // different nested arg value
    ]);

    const result = await processAgentResponse(response, {
      workspace: TEST_WORKSPACE,
      context,
      autoApprove: true,
    });

    assertEquals(result.toolCallsMade, 2);
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
      await Promise.resolve();
      return makeResponse("I can help with that. The answer is 42.");
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
  name: "Orchestrator: runReActLoop - rejects text tool-call JSON fallback",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    let callCount = 0;
    const mockLLM = async () => {
      await Promise.resolve();
      callCount++;
      return makeResponse(
        '{"toolName":"search_code","args":{"pattern":"test"}}',
      );
    };

    const result = await runReActLoop(
      "Find test code",
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: true,
        maxToolCallRetries: 1,
      },
      mockLLM,
    );

    assertEquals(
      result,
      "Native tool calling required. Tool call JSON in text is not accepted.",
    );
    assertEquals(callCount >= 1, true);
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop - llm rate limit enforced",
  async fn() {
    const toolName = "fake_rate_tool";
    TOOL_REGISTRY[toolName] = {
      fn: async () => await Promise.resolve("ok"),
      description: "fake",
      args: {},
    };

    try {
      const llm = async () =>
        await Promise.resolve(makeResponse("", [{ toolName, args: {} }]));

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
      await Promise.resolve();
      sawSignal = signal instanceof AbortSignal;
      return makeResponse("Signal response");
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
      await Promise.resolve();
      calls++;
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    };

    let threw = false;
    try {
      await runReActLoop(
        "Abort task",
        {
          workspace: TEST_WORKSPACE,
          context,
          autoApprove: true,
          maxRetries: 3,
        },
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
      await Promise.resolve();
      calls++;
      if (calls < 2) {
        throw new Error("Rate limit exceeded (429)");
      }
      return makeResponse("done");
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
  name: "Orchestrator: runReActLoop - overflow retry uses trimmed context payload",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager({
      maxTokens: 2000,
      overflowStrategy: "trim",
      minMessages: 1,
    });
    context.addMessage({ role: "system", content: "sys" });
    for (let i = 0; i < 8; i++) {
      context.addMessage({ role: "user", content: "x".repeat(400) });
    }

    const seenMessageCounts: number[] = [];
    const mockLLM = async (messages: import("../../../src/hlvm/agent/context.ts").Message[]) => {
      await Promise.resolve();
      seenMessageCounts.push(messages.length);
      if (messages.length > 3) {
        throw new Error("maximum context length is 100 tokens");
      }
      return makeResponse("ok");
    };

    const result = await runReActLoop(
      "Overflow retry task",
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: true,
        maxRetries: 3,
        parseOverflowError: () => ({
          isOverflow: true,
          limitTokens: 100,
          confidence: "high",
        }),
        providerName: "openai",
        modelName: "gpt-4o",
      },
      mockLLM,
    );

    assertEquals(result, "ok");
    assertEquals(seenMessageCounts.length, 2);
    assertEquals(seenMessageCounts[0] > seenMessageCounts[1], true);
    assertEquals(seenMessageCounts[1] <= 3, true);
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
      await Promise.resolve();
      callCount++;

      if (callCount === 1) {
        return makeResponse("Let me search for that.", [{
          toolName: "search_code",
          args: { pattern: "test" },
        }]);
      } else {
        return makeResponse("Found the code. Here is my analysis...");
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
    const mockLLM = async () =>
      await Promise.resolve(
        makeResponse("Let me search again.", [{
          toolName: "search_code",
          args: { pattern: "test" },
        }]),
      );

    const result = await runReActLoop(
      "Find something",
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: true,
      },
      mockLLM,
    );

    const hitMaxIterations = result.includes("Maximum iterations");
    const loopDetected = result.includes("Tool call loop detected");
    assertEquals(hitMaxIterations || loopDetected, true);
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
      await Promise.resolve();
      callCount++;

      if (callCount === 1) {
        return makeResponse("Let me try this tool.", [{
          toolName: "invalid_tool",
          args: {},
        }]);
      } else {
        return makeResponse(
          "Sorry, the tool failed. I cannot complete this task.",
        );
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
  name: "Orchestrator: processAgentResponse - adds all messages to context",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    const initialCount = context.getMessages().length;

    const response: LLMResponse = {
      content: "Let me help.",
      toolCalls: [{ toolName: "search_code", args: { pattern: "test" } }],
    };

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
  name:
    "Orchestrator: runReActLoop - denial stop policy tracks consecutive denials",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    let callCount = 0;

    // Mock LLM that tries L2 tool 3 times then gives up
    const mockLLM = async () => {
      await Promise.resolve();
      callCount++;

      if (callCount <= 3) {
        return makeResponse("Let me write the file.", [{
          toolName: "write_file",
          args: { path: "test.ts", content: "test" },
        }]);
      } else {
        return makeResponse("Let me clarify the requirements.", [{
          toolName: "ask_user",
          args: { question: "What should I do?" },
        }]);
      }
    };

    await runReActLoop(
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

    // Check that max denials message was added to context (as user message)
    const messages = context.getMessages();
    const maxDenialsMsg = messages.find((m) =>
      m.content.includes("Maximum denials")
    );
    // Verify max denials message exists and suggests ask_user as recovery
    assertStringIncludes(maxDenialsMsg!.content, "Maximum denials");
    assertStringIncludes(maxDenialsMsg!.content, "ask_user");
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop - denial counter tracks per tool",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    let callCount = 0;

    // Fix 4 changed denial behavior: successful tools only clear their own denial count.
    // write_file (L2) is denied each time; read_file (L0) success doesn't reset write_file count.
    // With maxDenials=3, write_file gets 3 denials before blocking.
    const mockLLM = async () => {
      await Promise.resolve();
      callCount++;

      if (callCount <= 3) {
        // Each odd call tries write_file (denied) then read_file (succeeds)
        return makeResponse("Let me try writing.", [{
          toolName: "write_file",
          args: { path: "test.ts", content: "test" },
        }]);
      } else {
        return makeResponse("Done analyzing.");
      }
    };

    const result = await runReActLoop(
      "Analyze file",
      {
        workspace: TEST_WORKSPACE,
        context,
        autoApprove: false, // Trigger denials for L2
        maxDenials: 3,
      },
      mockLLM,
    );

    // write_file denied 3 times, then allToolsBlocked triggers final LLM call
    assertEquals(callCount, 4);
    assertEquals(result.includes("Done analyzing"), true);

    // Should see max denials message for write_file
    const messages = context.getMessages();
    const maxDenialsMsg = messages.find((m) =>
      m.content.includes("Maximum denials")
    );
    assertEquals(maxDenialsMsg !== undefined, true);
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
      await Promise.resolve();
      callCount++;
      return makeResponse("Let me write.", [{
        toolName: "write_file",
        args: { path: "test.ts", content: "test" },
      }]);
    };

    await runReActLoop(
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
      await Promise.resolve();
      callCount++;
      return makeResponse("Let me write.", [{
        toolName: "write_file",
        args: { path: "test.ts", content: "test" },
      }]);
    };

    await runReActLoop(
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
      await Promise.resolve();
      return makeResponse("Let me write.", [{
        toolName: "write_file",
        args: { path: "test.ts", content: "test" },
      }]);
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

    // Check that suggestion message includes ask_user reference (sent as user message)
    const messages = context.getMessages();
    const suggestionMsg = messages.find((m) => m.content.includes("ask_user"));

    assertEquals(suggestionMsg !== undefined, true);
    assertEquals(
      suggestionMsg!.content.includes("clarify requirements"),
      true,
    );
  },
});
