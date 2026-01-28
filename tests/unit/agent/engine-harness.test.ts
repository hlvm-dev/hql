/**
 * Deterministic engine harness tests (Tier 1)
 *
 * Uses scripted LLM responses + fake tools to verify end-to-end loop
 * without external LLM dependencies.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";
import { runReActLoop, type LLMFunction } from "../../../src/hlvm/agent/orchestrator.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import { TOOL_REGISTRY } from "../../../src/hlvm/agent/registry.ts";
import { generateSystemPrompt } from "../../../src/hlvm/agent/llm-integration.ts";

// ============================================================
// Test helpers
// ============================================================

interface ScriptedStep {
  response: string;
  expectLastIncludes?: string;
}

function createScriptedLLM(steps: ScriptedStep[]): LLMFunction {
  let index = 0;
  return async (messages, signal) => {
    if (signal?.aborted) {
      const err = new Error("LLM aborted");
      err.name = "AbortError";
      throw err;
    }

    if (index >= steps.length) {
      throw new Error("Scripted LLM exhausted steps");
    }

    const step = steps[index++];

    if (step.expectLastIncludes) {
      const last = messages[messages.length - 1];
      assertStringIncludes(last.content, step.expectLastIncludes);
    }

    return step.response;
  };
}

function addFakeTool(name: string, result: unknown): void {
  TOOL_REGISTRY[name] = {
    fn: async () => result,
    description: "Fake tool for deterministic tests",
    args: {},
  };
}

function addFailingTool(name: string, message: string): void {
  TOOL_REGISTRY[name] = {
    fn: async () => {
      throw new Error(message);
    },
    description: "Fake failing tool for deterministic tests",
    args: {},
  };
}

function removeTool(name: string): void {
  delete TOOL_REGISTRY[name];
}

function createContext(): ContextManager {
  const context = new ContextManager({ maxTokens: 4000 });
  context.addMessage({
    role: "system",
    content: generateSystemPrompt(),
  });
  return context;
}

// ============================================================
// Tests
// ============================================================

Deno.test({
  name: "Engine harness: deterministic tool call -> grounded final answer",
  async fn() {
    const toolName = "fake_list";
    addFakeTool(toolName, ["a", "b"]);

    try {
      const llm = createScriptedLLM([
        {
          response: `TOOL_CALL\n{"toolName":"${toolName}","args":{}}\nEND_TOOL_CALL`,
        },
        {
          response: `Based on ${toolName}, there are 2 items: a, b.`,
          expectLastIncludes: "Tool:",
        },
      ]);

      const context = createContext();
      const result = await runReActLoop(
        "List items",
        {
          workspace: "/tmp",
          context,
          autoApprove: true,
          maxToolCalls: 3,
          groundingMode: "strict",
        },
        llm,
      );

      assertStringIncludes(result, "Based on");
      assertStringIncludes(result, "2");

      const stats = context.getStats();
      assertEquals(stats.toolMessages >= 1, true);

      // Deterministic transcript shape
      const roles = context.getMessages().map((m) => m.role);
      assertEquals(roles, ["system", "user", "assistant", "tool", "assistant"]);
    } finally {
      removeTool(toolName);
    }
  },
});

Deno.test({
  name: "Engine harness: grounding strict retries once and succeeds",
  async fn() {
    const toolName = "fake_list_retry";
    addFakeTool(toolName, ["a", "b"]);

    try {
      const llm = createScriptedLLM([
        {
          response: `TOOL_CALL\n{"toolName":"${toolName}","args":{}}\nEND_TOOL_CALL`,
        },
        {
          response: "There are 2 items.",
          expectLastIncludes: "Tool:",
        },
        {
          response: `Based on ${toolName}, there are 2 items: a, b.`,
          expectLastIncludes: "Grounding required.",
        },
      ]);

      const context = createContext();
      const result = await runReActLoop(
        "List items",
        {
          workspace: "/tmp",
          context,
          autoApprove: true,
          maxToolCalls: 3,
          groundingMode: "strict",
        },
        llm,
      );

      assertStringIncludes(result, "Based on");
      assertStringIncludes(result, "2");
    } finally {
      removeTool(toolName);
    }
  },
});

Deno.test({
  name: "Engine harness: grounding strict fails after retry",
  async fn() {
    const toolName = "fake_list_fail";
    addFakeTool(toolName, ["a", "b"]);

    try {
      const llm = createScriptedLLM([
        {
          response: `TOOL_CALL\n{"toolName":"${toolName}","args":{}}\nEND_TOOL_CALL`,
        },
        {
          response: "There are 2 items.",
          expectLastIncludes: "Tool:",
        },
        {
          response: "Still ungrounded response.",
          expectLastIncludes: "Grounding required.",
        },
      ]);

      const context = createContext();
      await assertRejects(
        () =>
          runReActLoop(
            "List items",
            {
              workspace: "/tmp",
              context,
              autoApprove: true,
              maxToolCalls: 3,
              groundingMode: "strict",
            },
            llm,
          ),
        Error,
        "Ungrounded response after",
      );
    } finally {
      removeTool(toolName);
    }
  },
});

Deno.test({
  name: "Engine harness: parse error recovery continues loop",
  async fn() {
    const toolName = "fake_echo";
    addFakeTool(toolName, "ok");

    try {
      const llm = createScriptedLLM([
        {
          // Invalid JSON to trigger parse error
          response: `TOOL_CALL\n{"toolName":"${toolName}","args":{}\nEND_TOOL_CALL`,
        },
        {
          // LLM sees parse error message from tool role
          response: `TOOL_CALL\n{"toolName":"${toolName}","args":{}}\nEND_TOOL_CALL`,
          expectLastIncludes: "Parse Error",
        },
        {
          response: `Based on ${toolName}, result is ok.`,
          expectLastIncludes: "Tool:",
        },
      ]);

      const context = createContext();
      const result = await runReActLoop(
        "Echo",
        {
          workspace: "/tmp",
          context,
          autoApprove: true,
          maxToolCalls: 3,
          groundingMode: "strict",
        },
        llm,
      );

      assertStringIncludes(result, "Based on");
      assertStringIncludes(result, "ok");

      // Transcript shape includes parse error tool message
      const roles = context.getMessages().map((m) => m.role);
      assertEquals(roles, [
        "system",
        "user",
        "assistant",
        "tool",
        "assistant",
        "tool",
        "assistant",
      ]);
    } finally {
      removeTool(toolName);
    }
  },
});

Deno.test({
  name: "Engine harness: continueOnError executes remaining tools",
  async fn() {
    const okTool = "fake_ok";
    const failTool = "fake_fail";

    addFakeTool(okTool, "ok");
    addFailingTool(failTool, "boom");

    try {
      const llm = createScriptedLLM([
        {
          response:
            `TOOL_CALL\n{"toolName":"${okTool}","args":{}}\nEND_TOOL_CALL\n` +
            `TOOL_CALL\n{"toolName":"${failTool}","args":{}}\nEND_TOOL_CALL`,
        },
        {
          response: `Based on ${okTool}, got ok. ${failTool} failed.`,
          expectLastIncludes: "Tool:",
        },
      ]);

      const context = createContext();
      const result = await runReActLoop(
        "Run two tools",
        {
          workspace: "/tmp",
          context,
          autoApprove: true,
          maxToolCalls: 3,
          continueOnError: true,
        },
        llm,
      );

      assertStringIncludes(result, "ok");
      assertStringIncludes(result, "failed");

      const toolMessages = context.getMessages().filter((m) => m.role === "tool");
      const toolText = toolMessages.map((m) => m.content).join("\n");
      assertStringIncludes(toolText, okTool);
      assertStringIncludes(toolText, failTool);
      // At least one tool message recorded for observations
      assertEquals(toolMessages.length >= 1, true);
    } finally {
      removeTool(okTool);
      removeTool(failTool);
    }
  },
});

Deno.test({
  name: "Engine harness: total tool result bytes limit enforced",
  async fn() {
    const toolName = "fake_big";
    addFakeTool(toolName, "x".repeat(50));

    try {
      const llm = createScriptedLLM([
        {
          response: `TOOL_CALL\n{"toolName":"${toolName}","args":{}}\nEND_TOOL_CALL`,
        },
      ]);

      const context = createContext();
      await assertRejects(
        () =>
          runReActLoop(
            "Get big result",
            {
              workspace: "/tmp",
              context,
              autoApprove: true,
              maxToolCalls: 3,
              maxTotalToolResultBytes: 10,
            },
            llm,
          ),
        Error,
        "total tool result bytes",
      );
    } finally {
      removeTool(toolName);
    }
  },
});
