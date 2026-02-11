/**
 * Deterministic engine harness tests (Tier 1)
 *
 * Uses scripted LLM responses + fake tools to verify end-to-end loop
 * without external LLM dependencies.
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  type LLMFunction,
  runReActLoop,
  type ToolCall,
} from "../../../src/hlvm/agent/orchestrator.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import { TOOL_REGISTRY } from "../../../src/hlvm/agent/registry.ts";
import { generateSystemPrompt } from "../../../src/hlvm/agent/llm-integration.ts";
import { ENGINE_PROFILES } from "../../../src/hlvm/agent/constants.ts";

const TEST_MAX_TOOL_CALLS = 3;

// ============================================================
// Test helpers
// ============================================================

interface ScriptedStep {
  content?: string;
  toolCalls?: ToolCall[];
  expectLastIncludes?: string;
}

function createScriptedLLM(steps: ScriptedStep[]): LLMFunction {
  let index = 0;
  return (messages, signal) => {
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

    return Promise.resolve({
      content: step.content ?? "",
      toolCalls: step.toolCalls ?? [],
    });
  };
}

function addFakeTool(name: string, result: unknown): void {
  TOOL_REGISTRY[name] = {
    fn: () => Promise.resolve(result),
    description: "Fake tool for deterministic tests",
    args: {},
    skipValidation: true,
  };
}

function addValidatingTool(
  name: string,
  result: unknown,
  args: Record<string, string>,
): void {
  TOOL_REGISTRY[name] = {
    fn: () => Promise.resolve(result),
    description: "Fake tool for deterministic tests",
    args,
  };
}

function addFailingTool(name: string, message: string): void {
  TOOL_REGISTRY[name] = {
    fn: () => Promise.reject(new Error(message)),
    description: "Fake failing tool for deterministic tests",
    args: {},
    skipValidation: true,
  };
}

function removeTool(name: string): void {
  delete TOOL_REGISTRY[name];
}

function overrideTool(
  name: string,
  tool: typeof TOOL_REGISTRY[string],
): () => void {
  const original = TOOL_REGISTRY[name];
  TOOL_REGISTRY[name] = tool;
  return () => {
    if (original) {
      TOOL_REGISTRY[name] = original;
    } else {
      delete TOOL_REGISTRY[name];
    }
  };
}

function createContext(): ContextManager {
  const context = new ContextManager({
    maxTokens: Math.max(ENGINE_PROFILES.normal.context.maxTokens, 12000),
    overflowStrategy: "fail",
  });
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
  name: "Engine harness: complete_task ends the loop with summary",
  async fn() {
    const llm = createScriptedLLM([
      {
        toolCalls: [
          { toolName: "complete_task", args: { summary: "Done." } },
        ],
      },
    ]);

    const context = createContext();
    const result = await runReActLoop(
      "Finish task",
      {
        workspace: "/tmp",
        context,
        autoApprove: true,
        maxToolCalls: TEST_MAX_TOOL_CALLS,
        groundingMode: "strict",
      },
      llm,
    );

    assertEquals(result, "Done.");
  },
});

Deno.test({
  name: "Engine harness: empty search prompts clarification",
  async fn() {
    const restore = overrideTool("search_web", {
      fn: () =>
        Promise.resolve({
          query: "hlvm",
          provider: "duckduckgo",
          results: [],
          count: 0,
        }),
      description: "Fake search tool for tests",
      args: { query: "string - Query to search" },
      safetyLevel: "L1" as const,
    });

    try {
      const llm = createScriptedLLM([
        {
          toolCalls: [
            { toolName: "search_web", args: { query: "hlvm" } },
          ],
        },
        {
          content:
            "Based on search_web, the search returned no results. Please clarify the query.",
        },
      ]);

      const context = createContext();
      const result = await runReActLoop(
        "Find info",
        {
          workspace: "/tmp",
          context,
          autoApprove: true,
          maxToolCalls: TEST_MAX_TOOL_CALLS,
          groundingMode: "strict",
        },
        llm,
      );

      assertStringIncludes(result, "clarify");
    } finally {
      restore();
    }
  },
});

Deno.test({
  name: "Engine harness: deterministic tool call -> grounded final answer",
  async fn() {
    const toolName = "fake_list";
    addFakeTool(toolName, ["a", "b"]);

    try {
      const llm = createScriptedLLM([
        {
          toolCalls: [{ toolName, args: {} }],
        },
        {
          content: `Based on ${toolName}, there are 2 items: a, b.`,
        },
      ]);

      const context = createContext();
      const result = await runReActLoop(
        "List items",
        {
          workspace: "/tmp",
          context,
          autoApprove: true,
          maxToolCalls: TEST_MAX_TOOL_CALLS,
          groundingMode: "strict",
        },
        llm,
      );

      assertStringIncludes(result, "Based on");
      assertStringIncludes(result, "2");

      const stats = context.getStats();
      assertEquals(stats.toolMessages >= 1, true);

      // Deterministic transcript shape (assistant message with tool_calls precedes tool results)
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
          toolCalls: [{ toolName, args: {} }],
        },
        {
          content: "There are 2 items.",
        },
        {
          content: `Based on ${toolName}, there are 2 items: a, b.`,
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
          maxToolCalls: TEST_MAX_TOOL_CALLS,
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
  name: "Engine harness: grounding strict returns with warnings after retry",
  async fn() {
    const toolName = "fake_list_fail";
    addFakeTool(toolName, ["a", "b"]);

    try {
      const llm = createScriptedLLM([
        {
          toolCalls: [{ toolName, args: {} }],
        },
        {
          content: "There are 2 items.",
        },
        {
          content: "Still ungrounded response.",
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
          maxToolCalls: TEST_MAX_TOOL_CALLS,
          groundingMode: "strict",
        },
        llm,
      );

      // Strict mode now returns with warnings instead of throwing
      assertStringIncludes(result, "Still ungrounded response.");
      assertStringIncludes(result, "[Grounding warnings]");
    } finally {
      removeTool(toolName);
    }
  },
});

Deno.test({
  name: "Engine harness: multi-step search -> read -> summarize",
  async fn() {
    const searchTool = "fake_search_code";
    const readTool = "fake_read_file";

    addFakeTool(searchTool, {
      matches: [
        {
          file: "src/hlvm/agent/llm-integration.ts",
          line: 200,
          content: "export function generateSystemPrompt()",
        },
      ],
      count: 1,
    });
    addFakeTool(
      readTool,
      "export function generateSystemPrompt() {\n  return `You are an AI coding agent...`;\n}",
    );

    try {
      const llm = createScriptedLLM([
        {
          toolCalls: [
            {
              toolName: searchTool,
              args: { pattern: "generateSystemPrompt", path: "src" },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolName: readTool,
              args: { path: "src/hlvm/agent/llm-integration.ts" },
            },
          ],
          expectLastIncludes: "generateSystemPrompt",
        },
        {
          content:
            `Based on ${searchTool} and ${readTool}, generateSystemPrompt defines the system prompt and returns a large instruction string.`,
        },
      ]);

      const context = createContext();
      const result = await runReActLoop(
        "Find generateSystemPrompt and summarize its key sections.",
        {
          workspace: "/tmp",
          context,
          autoApprove: true,
          maxToolCalls: TEST_MAX_TOOL_CALLS,
          groundingMode: "strict",
        },
        llm,
      );

      assertStringIncludes(result, "generateSystemPrompt");
      const stats = context.getStats();
      assertEquals(stats.toolMessages >= 2, true);
    } finally {
      removeTool(searchTool);
      removeTool(readTool);
    }
  },
});

Deno.test({
  name: "Engine harness: invalid args recovery continues loop",
  async fn() {
    const toolName = "fake_echo";
    addValidatingTool(toolName, "ok", {
      path: "string - Required path",
    });

    try {
      const llm = createScriptedLLM([
        {
          // Missing required argument triggers validation error
          toolCalls: [{ toolName, args: {} }],
        },
        {
          // LLM sees invalid-args message from tool role
          toolCalls: [{ toolName, args: { path: "ok" } }],
          expectLastIncludes: "Invalid arguments",
        },
        {
          content: `Based on ${toolName}, result is ok.`,
        },
      ]);

      const context = createContext();
      const result = await runReActLoop(
        "Echo",
        {
          workspace: "/tmp",
          context,
          autoApprove: true,
          maxToolCalls: TEST_MAX_TOOL_CALLS,
          groundingMode: "strict",
        },
        llm,
      );

      assertStringIncludes(result, "Based on");
      assertStringIncludes(result, "ok");

      // Transcript shape: assistant(tool_calls) precedes tool results
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
          toolCalls: [
            { toolName: okTool, args: {} },
            { toolName: failTool, args: {} },
          ],
        },
        {
          content: `Based on ${okTool}, got ok. ${failTool} failed.`,
        },
      ]);

      const context = createContext();
      const result = await runReActLoop(
        "Run two tools",
        {
          workspace: "/tmp",
          context,
          autoApprove: true,
          maxToolCalls: TEST_MAX_TOOL_CALLS,
          continueOnError: true,
        },
        llm,
      );

      assertStringIncludes(result, "ok");
      assertStringIncludes(result, "failed");

      const toolMessages = context.getMessages().filter((m) =>
        m.role === "tool"
      );
      // Tool names are now in the toolName field, not content
      const toolNames = toolMessages.map((m) => m.toolName).filter(Boolean);
      assertEquals(toolNames.includes(okTool), true);
      assertEquals(toolNames.includes(failTool), true);
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
          toolCalls: [{ toolName, args: {} }],
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
              maxToolCalls: TEST_MAX_TOOL_CALLS,
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

Deno.test({
  name: "Engine harness: planning enforces step progression",
  async fn() {
    const toolA = "fake_plan_tool_a";
    const toolB = "fake_plan_tool_b";
    addFakeTool(toolA, "A");
    addFakeTool(toolB, "B");

    try {
      const llm = createScriptedLLM([
        {
          content: `PLAN
{"goal":"Do two steps","steps":[{"id":"step-1","title":"Run A","tools":["${toolA}"]},{"id":"step-2","title":"Run B","tools":["${toolB}"]}]}
END_PLAN`,
        },
        {
          toolCalls: [{ toolName: toolA, args: {} }],
        },
        {
          content: `Step 1 done.\nSTEP_DONE step-1`,
        },
        {
          toolCalls: [{ toolName: toolB, args: {} }],
        },
        {
          content: `All done.\nSTEP_DONE step-2`,
        },
      ]);

      const context = createContext();
      const result = await runReActLoop(
        "Do two steps",
        {
          workspace: "/tmp",
          context,
          autoApprove: true,
          maxToolCalls: TEST_MAX_TOOL_CALLS,
          planning: { mode: "always", requireStepMarkers: true },
        },
        llm,
      );

      assertStringIncludes(result, "All done.");
      const stats = context.getStats();
      assertEquals(stats.toolMessages >= 2, true);
    } finally {
      removeTool(toolA);
      removeTool(toolB);
    }
  },
});
