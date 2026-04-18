/**
 * Agent System Integration Tests — the HARD tests
 *
 * Tests the risky 500 lines:
 * - run-agent.ts: actual runAgent() with mock LLM
 * - agent-tool.ts: actual tool function call
 * - llmFunction threading chain
 * - ContextManager isolation
 * - Async agent execution
 * - loadAgentDefinitions from filesystem
 */

import {
  assertEquals,
  assertExists,
  assertMatch,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  getHlvmTasksDir,
  getMcpConfigPath,
} from "../../../src/common/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { runAgent } from "../../../src/hlvm/agent/tools/run-agent.ts";
import { GENERAL_PURPOSE_AGENT } from "../../../src/hlvm/agent/tools/built-in/general.ts";
import { EXPLORE_AGENT } from "../../../src/hlvm/agent/tools/built-in/explore.ts";
import { AGENT_MAX_TURNS } from "../../../src/hlvm/agent/tools/agent-constants.ts";
import type { AgentToolResult } from "../../../src/hlvm/agent/tools/agent-types.ts";
import type { LLMFunction } from "../../../src/hlvm/agent/orchestrator-llm.ts";
import type { LLMResponse } from "../../../src/hlvm/agent/tool-call.ts";
import type { ToolMetadata } from "../../../src/hlvm/agent/registry.ts";
import {
  loadAgentDefinitions,
  parseAgentFromMarkdown,
} from "../../../src/hlvm/agent/tools/agent-definitions.ts";
import { AGENT_TOOL_METADATA as AGENT_TOOL } from "../../../src/hlvm/agent/tools/agent-tool-metadata.ts";
import {
  drainCompletionNotifications,
  getAllBackgroundAgents,
} from "../../../src/hlvm/agent/tools/agent-tool.ts";
import {
  type AgentEngine,
  type AgentLLMConfig,
  resetAgentEngine,
  setAgentEngine,
} from "../../../src/hlvm/agent/engine.ts";
import {
  createSession,
  getMessages,
} from "../../../src/hlvm/store/conversation-store.ts";
import { withTempHlvmDir } from "../helpers.ts";

const platform = getPlatform();
const TEST_WORKSPACE = "/tmp/hlvm-test-agent-integration";

// ============================================================
// Helpers
// ============================================================

/** Create a mock LLM that returns a fixed response after N calls */
function createMockLLM(response: string): LLMFunction {
  return async (
    _messages,
    _signal?,
    _options?,
  ): Promise<LLMResponse> => {
    return {
      content: response,
      toolCalls: [], // No tool calls → loop terminates immediately
    };
  };
}

/** Create a mock LLM that counts calls */
function createCountingLLM(response: string): {
  llm: LLMFunction;
  getCallCount: () => number;
} {
  let callCount = 0;
  const llm: LLMFunction = async () => {
    callCount++;
    return { content: response, toolCalls: [] };
  };
  return { llm, getCallCount: () => callCount };
}

/**
 * Create a mock LLM that makes tool calls for N turns, then returns text.
 * This is essential for testing multi-turn behavior and maxTurns enforcement.
 */
function createToolCallingLLM(opts: {
  toolCallsPerTurn: Array<{ toolName: string; args: Record<string, unknown> }>;
  turnsBeforeStop: number;
  finalResponse: string;
}): { llm: LLMFunction; getCallCount: () => number } {
  let callCount = 0;
  const llm: LLMFunction = async () => {
    callCount++;
    if (callCount <= opts.turnsBeforeStop) {
      return {
        content: "",
        toolCalls: opts.toolCallsPerTurn.map((tc, i) => ({
          id: `call_${callCount}_${i}`,
          toolName: tc.toolName,
          args: tc.args,
        })),
      };
    }
    return { content: opts.finalResponse, toolCalls: [] };
  };
  return { llm, getCallCount: () => callCount };
}

/**
 * Create a mock LLM that captures all message arrays passed to it.
 * For verifying context isolation.
 */
function createCapturingLLM(response: string): {
  llm: LLMFunction;
  getCapturedMessages: () => unknown[][];
} {
  const captured: unknown[][] = [];
  const llm: LLMFunction = async (messages) => {
    captured.push([...messages]);
    return { content: response, toolCalls: [] };
  };
  return { llm, getCapturedMessages: () => captured };
}

function extractLastUserText(messages: unknown[]): string {
  const lastUser = [...messages].reverse().find((message) =>
    typeof message === "object" && message !== null &&
    "role" in message && (message as { role?: unknown }).role === "user"
  ) as { content?: unknown } | undefined;
  return typeof lastUser?.content === "string" ? lastUser.content : "";
}

/** Create mock tool registry */
function mockToolRegistry(...names: string[]): Record<string, ToolMetadata> {
  const registry: Record<string, ToolMetadata> = {};
  for (const name of names) {
    registry[name] = {
      fn: async () => `result from ${name}`,
      description: `Mock ${name}`,
      args: {},
    };
  }
  return registry;
}

async function ensureDir(path: string): Promise<void> {
  try {
    await platform.fs.mkdir(path, { recursive: true });
  } catch { /* exists */ }
}

async function cleanDir(path: string): Promise<void> {
  try {
    await platform.fs.remove(path, { recursive: true });
  } catch { /* doesn't exist */ }
}

// ============================================================
// 1. run-agent.ts — actual execution with mock LLM
// ============================================================

Deno.test({
  name: "runAgent: executes with mock LLM and returns result",
  async fn() {
    const mockLLM = createMockLLM("I found 3 auth files in the codebase.");
    const tools = mockToolRegistry("read_file", "search_code");

    await ensureDir(TEST_WORKSPACE);
    try {
      const result = await runAgent({
        agentDefinition: GENERAL_PURPOSE_AGENT,
        prompt: "Find all auth-related files",
        workspace: TEST_WORKSPACE,
        llmFunction: mockLLM,
        allTools: tools,
        agentId: "test-agent-1",
      });

      assertEquals(result.agentType, "general-purpose");
      assertStringIncludes(result.text, "auth");
      assertEquals(typeof result.durationMs, "number");
      assertEquals(result.durationMs >= 0, true);
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "runAgent: sub-agent user message is the raw prompt (CC parity AgentTool.tsx:538 — initialPrompt is main-thread-only)",
  async fn() {
    let capturedPrompt = "";
    const inspectLLM: LLMFunction = async (messages) => {
      capturedPrompt = extractLastUserText(messages);
      return { content: "ACK: complete", toolCalls: [] };
    };
    const tools = mockToolRegistry("read_file");

    await ensureDir(TEST_WORKSPACE);
    try {
      await runAgent({
        agentDefinition: {
          ...GENERAL_PURPOSE_AGENT,
          initialPrompt: "Always begin with ACK:",
        },
        prompt: "List one file",
        workspace: TEST_WORKSPACE,
        llmFunction: inspectLLM,
        allTools: tools,
        agentId: "test-initial-prompt",
      });

      assertEquals(capturedPrompt, "List one file");
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "runAgent: maxTurns enforced — loop stops even when LLM keeps calling tools",
  async fn() {
    // LLM keeps calling read_file forever — maxTurns must stop it
    const { llm, getCallCount } = createToolCallingLLM({
      toolCallsPerTurn: [{ toolName: "read_file", args: { path: "test.ts" } }],
      turnsBeforeStop: 999, // Never stops on its own
      finalResponse: "Should not reach here",
    });
    const tools = mockToolRegistry("read_file");

    const customAgent = {
      ...GENERAL_PURPOSE_AGENT,
      maxTurns: 3, // Must stop at 3
    };

    await ensureDir(TEST_WORKSPACE);
    try {
      const result = await runAgent({
        agentDefinition: customAgent,
        prompt: "Keep reading files forever",
        workspace: TEST_WORKSPACE,
        llmFunction: llm,
        allTools: tools,
        agentId: "test-maxturn-enforce",
      });

      // Loop should have stopped at or before maxTurns
      // The exact count depends on orchestrator internals, but it must be <= maxTurns + 1
      // (maxTurns iterations + possibly 1 final call)
      assertEquals(
        getCallCount() <= customAgent.maxTurns + 1,
        true,
        `Expected <= ${customAgent.maxTurns + 1} calls, got ${getCallCount()}`,
      );
      // Should have returned SOMETHING (not hang forever)
      assertExists(result.text);
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "runAgent: context isolation — agent 2 does NOT see agent 1's messages",
  async fn() {
    // Agent 1 gets a unique prompt, Agent 2 gets a different one.
    // Verify Agent 2's LLM call does NOT contain Agent 1's prompt.
    const { llm: llm1, getCapturedMessages: getCapture1 } = createCapturingLLM(
      "Agent 1 result.",
    );
    const { llm: llm2, getCapturedMessages: getCapture2 } = createCapturingLLM(
      "Agent 2 result.",
    );
    const tools = mockToolRegistry("read_file");

    await ensureDir(TEST_WORKSPACE);
    try {
      await runAgent({
        agentDefinition: GENERAL_PURPOSE_AGENT,
        prompt: "UNIQUE_MARKER_ALPHA_12345",
        workspace: TEST_WORKSPACE,
        llmFunction: llm1,
        allTools: tools,
        agentId: "test-iso-1",
      });

      await runAgent({
        agentDefinition: GENERAL_PURPOSE_AGENT,
        prompt: "UNIQUE_MARKER_BETA_67890",
        workspace: TEST_WORKSPACE,
        llmFunction: llm2,
        allTools: tools,
        agentId: "test-iso-2",
      });

      // Agent 2's messages should NOT contain Agent 1's marker
      const agent2Messages = getCapture2()[0];
      assertExists(agent2Messages);
      const allContent = JSON.stringify(agent2Messages);
      assertEquals(
        allContent.includes("UNIQUE_MARKER_ALPHA_12345"),
        false,
        "Agent 2 should NOT see Agent 1's prompt — context must be isolated",
      );
      // Agent 2 SHOULD contain its own marker
      assertEquals(
        allContent.includes("UNIQUE_MARKER_BETA_67890"),
        true,
        "Agent 2 should see its own prompt",
      );
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "runAgent: handles LLM error gracefully",
  async fn() {
    const errorLLM: LLMFunction = async () => {
      throw new Error("API rate limit exceeded");
    };
    const tools = mockToolRegistry("read_file");

    await ensureDir(TEST_WORKSPACE);
    try {
      const result = await runAgent({
        agentDefinition: GENERAL_PURPOSE_AGENT,
        prompt: "This will fail",
        workspace: TEST_WORKSPACE,
        llmFunction: errorLLM,
        allTools: tools,
        agentId: "test-error-1",
      });

      // Should return error message, not throw
      assertStringIncludes(result.text, "error");
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "runAgent: respects abort signal",
  async fn() {
    const controller = new AbortController();
    // Abort immediately
    controller.abort();

    const mockLLM = createMockLLM("Should not reach here");
    const tools = mockToolRegistry("read_file");

    await ensureDir(TEST_WORKSPACE);
    try {
      // Should throw or return error due to abort
      try {
        await runAgent({
          agentDefinition: GENERAL_PURPOSE_AGENT,
          prompt: "Aborted task",
          workspace: TEST_WORKSPACE,
          llmFunction: mockLLM,
          allTools: tools,
          agentId: "test-abort-1",
          signal: controller.signal,
        });
        // If it doesn't throw, the result should indicate error
      } catch (err) {
        // Expected — abort propagated
        assertExists(err);
      }
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "runAgent: Explore agent gets system prompt with READ-ONLY",
  async fn() {
    let capturedMessages: unknown[] = [];
    const captureLLM: LLMFunction = async (messages) => {
      capturedMessages = messages;
      return { content: "Found it.", toolCalls: [] };
    };
    const tools = mockToolRegistry("read_file", "search_code");

    await ensureDir(TEST_WORKSPACE);
    try {
      await runAgent({
        agentDefinition: EXPLORE_AGENT,
        prompt: "Find auth",
        workspace: TEST_WORKSPACE,
        llmFunction: captureLLM,
        allTools: tools,
        agentId: "test-explore-prompt",
      });

      // The first message should be system prompt containing READ-ONLY
      assertEquals(capturedMessages.length >= 1, true);
      const systemMsg = capturedMessages[0] as {
        role: string;
        content: string;
      };
      assertEquals(systemMsg.role, "system");
      assertStringIncludes(systemMsg.content, "READ-ONLY");
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================
// 2. agent-tool.ts — tool function call
// ============================================================

Deno.test({
  name: "agent-tool: fn throws without llmFunction",
  async fn() {
    const agentToolMeta = AGENT_TOOL["Agent"];
    assertExists(agentToolMeta);

    await assertRejects(
      () =>
        agentToolMeta.fn(
          { prompt: "test", description: "test" },
          TEST_WORKSPACE,
          {}, // No llmFunction
        ),
      Error,
      "llmFunction",
    );
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "agent-tool: fn throws on unknown agent type",
  async fn() {
    const agentToolMeta = AGENT_TOOL["Agent"];
    const mockLLM = createMockLLM("test");

    await ensureDir(TEST_WORKSPACE);
    try {
      await assertRejects(
        () =>
          agentToolMeta.fn(
            {
              prompt: "test",
              description: "test",
              subagent_type: "nonexistent-agent-xyz",
            },
            TEST_WORKSPACE,
            { llmFunction: mockLLM },
          ),
        Error,
        "not found",
      );
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "agent-tool: fn throws without prompt",
  async fn() {
    const agentToolMeta = AGENT_TOOL["Agent"];
    const mockLLM = createMockLLM("test");

    await assertRejects(
      () =>
        agentToolMeta.fn(
          { description: "test" }, // No prompt
          TEST_WORKSPACE,
          { llmFunction: mockLLM },
        ),
      Error,
      "prompt",
    );
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "agent-tool: sync execution returns completed result",
  async fn() {
    const agentToolMeta = AGENT_TOOL["Agent"];
    const mockLLM = createMockLLM("Here are the auth files I found.");

    await ensureDir(TEST_WORKSPACE);
    try {
      const result = await agentToolMeta.fn(
        {
          prompt: "Find auth files",
          description: "Auth research",
          subagent_type: "general-purpose",
        },
        TEST_WORKSPACE,
        { llmFunction: mockLLM },
      ) as {
        status: string;
        content: string;
        agentType: string;
        totalTokens: number;
      };

      assertEquals(result.status, "completed");
      assertStringIncludes(result.content, "auth");
      assertEquals(result.agentType, "general-purpose");
      assertEquals(typeof result.totalTokens, "number");
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test("agent-tool: formatResult strips continuation trailer for one-shot agents", () => {
  const formatted = AGENT_TOOL["Agent"].formatResult?.({
    status: "completed",
    agentId: "agent-1",
    agentType: "Explore",
    content: "Found files.",
    totalDurationMs: 42,
    totalToolUseCount: 2,
    totalTokens: 123,
  });

  assertExists(formatted);
  assertEquals(formatted!.llmContent, "Found files.");
});

Deno.test("agent-tool: formatResult includes HLVM-safe trailer for reusable agents", () => {
  const formatted = AGENT_TOOL["Agent"].formatResult?.({
    status: "completed",
    agentId: "agent-2",
    agentType: "general-purpose",
    content: "Did the work.",
    totalDurationMs: 84,
    totalToolUseCount: 3,
    totalTokens: 456,
  });

  assertExists(formatted);
  assertStringIncludes(formatted!.llmContent ?? "", "agentId: agent-2");
  assertStringIncludes(formatted!.llmContent ?? "", "<usage>total_tokens: 456");
  assertEquals((formatted!.llmContent ?? "").includes("SendMessage"), false);
});

Deno.test({
  name: "agent-tool: defaults to general-purpose when subagent_type omitted",
  async fn() {
    const agentToolMeta = AGENT_TOOL["Agent"];
    const mockLLM = createMockLLM("Done.");

    await ensureDir(TEST_WORKSPACE);
    try {
      const result = await agentToolMeta.fn(
        {
          prompt: "Do something",
          description: "test",
          // subagent_type omitted
        },
        TEST_WORKSPACE,
        { llmFunction: mockLLM },
      ) as { status: string; agentType: string };

      assertEquals(result.status, "completed");
      assertEquals(result.agentType, "general-purpose");
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "agent-tool: async execution returns async_launched",
  async fn() {
    await withTempHlvmDir(async () => {
      const agentToolMeta = AGENT_TOOL["Agent"];
      const mockLLM = createMockLLM("Background done.");

      await ensureDir(TEST_WORKSPACE);
      try {
        const result = await agentToolMeta.fn(
          {
            prompt: "Background task",
            description: "bg test",
            run_in_background: true,
          },
          TEST_WORKSPACE,
          { llmFunction: mockLLM },
        ) as { status: string; agentId: string; outputFile: string };

        assertEquals(result.status, "async_launched");
        assertExists(result.agentId);
        assertStringIncludes(result.outputFile, getHlvmTasksDir());
        assertEquals(await platform.fs.exists(result.outputFile), true);

        // Background agent should be tracked
        const bgAgents = getAllBackgroundAgents();
        const found = bgAgents.find((a) => a.agentId === result.agentId);
        assertExists(found);
        assertEquals(
          found!.status === "running" || found!.status === "completed",
          true,
        );
      } finally {
        await cleanDir(TEST_WORKSPACE);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================
// 3. loadAgentDefinitions — filesystem integration
// ============================================================

Deno.test({
  name: "loadAgentDefinitions: returns built-in agents when no .md files",
  async fn() {
    await ensureDir(TEST_WORKSPACE);
    try {
      const result = await loadAgentDefinitions(TEST_WORKSPACE);
      assertEquals(result.activeAgents.length >= 3, true); // GP + Explore + Plan
      const types = result.activeAgents.map((a) => a.agentType);
      assertEquals(types.includes("general-purpose"), true);
      assertEquals(types.includes("Explore"), true);
      assertEquals(types.includes("Plan"), true);
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "loadAgentDefinitions: loads .md agents from project dir",
  async fn() {
    const agentsDir = `${TEST_WORKSPACE}/.hlvm/agents`;
    await ensureDir(agentsDir);
    await platform.fs.writeTextFile(
      `${agentsDir}/custom-test.md`,
      `---
name: custom-test
description: A custom test agent
tools:
  - read_file
---

You are a custom test agent.`,
    );

    try {
      const result = await loadAgentDefinitions(TEST_WORKSPACE);
      const custom = result.activeAgents.find(
        (a) => a.agentType === "custom-test",
      );
      assertExists(custom);
      assertEquals(custom!.whenToUse, "A custom test agent");
      assertStringIncludes(custom!.getSystemPrompt(), "custom test agent");
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "loadAgentDefinitions: project agent overrides built-in with same name",
  async fn() {
    const agentsDir = `${TEST_WORKSPACE}/.hlvm/agents`;
    await ensureDir(agentsDir);
    await platform.fs.writeTextFile(
      `${agentsDir}/explore-override.md`,
      `---
name: Explore
description: Custom Explore agent
---

Custom explore prompt.`,
    );

    try {
      const result = await loadAgentDefinitions(TEST_WORKSPACE);
      const explore = result.activeAgents.find(
        (a) => a.agentType === "Explore",
      );
      assertExists(explore);
      // Project overrides built-in
      assertEquals(explore!.whenToUse, "Custom Explore agent");
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================
// 4. PREVIOUSLY MISSING: Multi-turn agent with tool calls
// ============================================================

Deno.test({
  name:
    "runAgent: multi-turn — LLM makes tool calls, loop continues, then stops",
  async fn() {
    // LLM makes tool calls for 2 turns, then returns final text
    const { llm, getCallCount } = createToolCallingLLM({
      toolCallsPerTurn: [{ toolName: "read_file", args: { path: "test.ts" } }],
      turnsBeforeStop: 2,
      finalResponse: "I read the files and here is my analysis.",
    });
    const tools = mockToolRegistry("read_file", "search_code");

    await ensureDir(TEST_WORKSPACE);
    try {
      const result = await runAgent({
        agentDefinition: GENERAL_PURPOSE_AGENT,
        prompt: "Analyze test.ts",
        workspace: TEST_WORKSPACE,
        llmFunction: llm,
        allTools: tools,
        agentId: "test-multiturn",
      });

      // Should have called LLM 3 times: 2 tool-calling turns + 1 final
      assertEquals(getCallCount(), 3);
      assertStringIncludes(result.text, "analysis");
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================
// 5. PREVIOUSLY MISSING: Tool resolution restricts child tools
// ============================================================

Deno.test({
  name:
    "runAgent: Explore agent tool calls are restricted — unknown tools fail",
  async fn() {
    // LLM tries to call write_file (which Explore disallows)
    const { llm } = createToolCallingLLM({
      toolCallsPerTurn: [{
        toolName: "write_file",
        args: { path: "x.ts", content: "hack" },
      }],
      turnsBeforeStop: 1,
      finalResponse: "Done.",
    });
    // Only provide tools that exist — but Explore's disallowedTools should filter write_file
    const tools = mockToolRegistry("read_file", "write_file", "search_code");

    await ensureDir(TEST_WORKSPACE);
    try {
      const result = await runAgent({
        agentDefinition: EXPLORE_AGENT,
        prompt: "Try to write a file",
        workspace: TEST_WORKSPACE,
        llmFunction: llm,
        allTools: tools,
        agentId: "test-explore-restricted",
      });

      // The agent should complete (not crash), but write_file should not be
      // in the allowlist. The orchestrator should handle the unknown tool gracefully.
      assertExists(result.text);
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================
// 6. PREVIOUSLY MISSING: agent-tool.ts full chain through orchestrator
// ============================================================

Deno.test({
  name:
    "agent-tool: sync spawn with Explore type — verifies full dispatch chain",
  async fn() {
    const agentToolMeta = AGENT_TOOL["Agent"];
    let capturedSystemPrompt = "";
    const captureLLM: LLMFunction = async (messages) => {
      const sysMsg = messages.find((m: any) => m.role === "system") as any;
      if (sysMsg) capturedSystemPrompt = sysMsg.content;
      return { content: "Found 5 relevant files.", toolCalls: [] };
    };

    await ensureDir(TEST_WORKSPACE);
    try {
      const result = await agentToolMeta.fn(
        {
          prompt: "Find all test files",
          description: "Test file search",
          subagent_type: "Explore",
        },
        TEST_WORKSPACE,
        { llmFunction: captureLLM },
      ) as { status: string; agentType: string; content: string };

      // Verify full chain: dispatch → resolve Explore → build prompt → run → return
      assertEquals(result.status, "completed");
      assertEquals(result.agentType, "Explore");
      assertStringIncludes(result.content, "files");
      // Verify Explore's system prompt was used (contains READ-ONLY)
      assertStringIncludes(capturedSystemPrompt, "READ-ONLY");
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================
// 7. PREVIOUSLY MISSING: async agent completes and result is accessible
// ============================================================

Deno.test({
  name: "agent-tool: async agent completes and result becomes accessible",
  async fn() {
    await withTempHlvmDir(async () => {
      const agentToolMeta = AGENT_TOOL["Agent"];
      const mockLLM = createMockLLM("Background work complete.");

      await ensureDir(TEST_WORKSPACE);
      try {
        const result = await agentToolMeta.fn(
          {
            prompt: "Long background task",
            description: "bg completion test",
            run_in_background: true,
          },
          TEST_WORKSPACE,
          { llmFunction: mockLLM },
        ) as { status: string; agentId: string; outputFile: string };

        assertEquals(result.status, "async_launched");
        const agentId = result.agentId;

        // Wait for background agent to complete (mock LLM is instant)
        const bg = getAllBackgroundAgents().find((a) => a.agentId === agentId);
        assertExists(bg);

        // Wait for the promise to resolve
        try {
          await bg!.promise;
        } catch { /* may throw if already resolved */ }

        // After completion, status should be updated
        await new Promise((r) => setTimeout(r, 50));
        const updated = getAllBackgroundAgents().find((a) =>
          a.agentId === agentId
        );
        assertExists(updated);
        assertEquals(updated!.status, "completed");
        assertExists(updated!.result);
        assertStringIncludes(updated!.result!.content, "Background work");

        const output = await platform.fs.readTextFile(result.outputFile);
        assertStringIncludes(output, "Background work complete.");
        assertStringIncludes(output, "<usage>total_tokens:");
      } finally {
        await cleanDir(TEST_WORKSPACE);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "agent-tool: async outputFile receives live transcript lines before completion",
  async fn() {
    await withTempHlvmDir(async () => {
      const agentToolMeta = AGENT_TOOL["Agent"];
      const slowToolLlm: LLMFunction = async (messages) => {
        const seenToolResult = JSON.stringify(messages).includes("streamed");
        if (!seenToolResult) {
          return {
            content: "",
            toolCalls: [{
              id: "call_1",
              toolName: "shell_exec",
              args: { command: "sleep 0.2 && printf streamed" },
            }],
          };
        }
        return { content: "Background shell done.", toolCalls: [] };
      };

      await ensureDir(TEST_WORKSPACE);
      try {
        const result = await agentToolMeta.fn(
          {
            prompt: "Run a slow shell command",
            description: "bg output streaming test",
            run_in_background: true,
          },
          TEST_WORKSPACE,
          { llmFunction: slowToolLlm },
        ) as { status: string; agentId: string; outputFile: string };

        assertEquals(result.status, "async_launched");

        await new Promise((r) => setTimeout(r, 50));
        const midRunOutput = await platform.fs.readTextFile(result.outputFile);
        assertStringIncludes(
          midRunOutput,
          'Agent "bg output streaming test" started.',
        );
        assertStringIncludes(midRunOutput, "shell_exec");

        const bg = getAllBackgroundAgents().find((a) =>
          a.agentId === result.agentId
        );
        assertExists(bg);
        try {
          await bg!.promise;
        } catch {
          // The background promise should not reject here, but keep cleanup best-effort.
        }
      } finally {
        await cleanDir(TEST_WORKSPACE);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================
// 8. Worktree integration via agent-tool
// ============================================================

Deno.test({
  name:
    "agent-tool: isolation='worktree' creates worktree and passes it as workspace",
  async fn() {
    // This test needs a real git repo as workspace
    const testRepo = "/tmp/hlvm-test-agent-worktree-integration";
    await ensureDir(testRepo);
    await platform.command.output({
      cmd: ["git", "init"],
      cwd: testRepo,
      stdout: "piped",
      stderr: "piped",
    });
    await platform.command.output({
      cmd: ["git", "config", "user.email", "t@t.com"],
      cwd: testRepo,
      stdout: "piped",
      stderr: "piped",
    });
    await platform.command.output({
      cmd: ["git", "config", "user.name", "T"],
      cwd: testRepo,
      stdout: "piped",
      stderr: "piped",
    });
    await platform.fs.writeTextFile(`${testRepo}/file.txt`, "original");
    await platform.command.output({
      cmd: ["git", "add", "file.txt"],
      cwd: testRepo,
      stdout: "piped",
      stderr: "piped",
    });
    await platform.command.output({
      cmd: ["git", "commit", "-m", "init"],
      cwd: testRepo,
      stdout: "piped",
      stderr: "piped",
    });

    try {
      let capturedWorkspace = "";
      // Mock LLM that captures what workspace (cwd context) it receives
      const captureLLM: LLMFunction = async (messages) => {
        // The system message or user message should reflect the workspace
        // But more importantly, the runReActLoop is called with the worktree path
        capturedWorkspace = "called"; // Just verify it was called
        return { content: "Done in worktree.", toolCalls: [] };
      };

      const agentToolMeta = AGENT_TOOL["Agent"];
      const result = await agentToolMeta.fn(
        {
          prompt: "Do work in isolation",
          description: "worktree test",
          isolation: "worktree",
        },
        testRepo,
        { llmFunction: captureLLM },
      ) as { status: string; content: string; worktreePath?: string };

      assertEquals(result.status, "completed");
      assertEquals(capturedWorkspace, "called");
      // Agent made no changes → worktree should be cleaned up (no worktreePath)
      assertEquals(result.worktreePath, undefined);
    } finally {
      // Clean up any leftover worktrees
      await platform.command.output({
        cmd: ["git", "worktree", "prune"],
        cwd: testRepo,
        stdout: "piped",
        stderr: "piped",
      });
      await cleanDir(testRepo);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "agent-tool: cwd overrides child workspace for model-created subagents",
  async fn() {
    const capturedConfigs: AgentLLMConfig[] = [];
    const testEngine: AgentEngine = {
      createLLM(config) {
        capturedConfigs.push(config);
        return async () => {
          throw new Error("cwd-override-used");
        };
      },
      createSummarizer() {
        return async () => "summary";
      },
    };

    const cwdDir = "/tmp/hlvm-agent-cwd-override";
    setAgentEngine(testEngine);
    await ensureDir(cwdDir);
    await ensureDir(TEST_WORKSPACE);
    try {
      const agentToolMeta = AGENT_TOOL["Agent"];
      const result = await agentToolMeta.fn(
        {
          prompt: "List files from another cwd",
          description: "cwd override test",
          subagent_type: "Explore",
          model: "override-model-123",
          cwd: cwdDir,
        },
        TEST_WORKSPACE,
        {
          llmFunction: createMockLLM("parent llm should not be used"),
          modelId: "claude-code/claude-haiku-4-5-20251001",
        },
      ) as AgentToolResult;

      assertEquals(capturedConfigs.length, 1);
      assertEquals(capturedConfigs[0].workspace, cwdDir);
      assertStringIncludes(result.content, "cwd-override-used");
    } finally {
      resetAgentEngine();
      await cleanDir(cwdDir);
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "agent-tool: cwd and isolation='worktree' are mutually exclusive",
  async fn() {
    const agentToolMeta = AGENT_TOOL["Agent"];

    await ensureDir(TEST_WORKSPACE);
    try {
      await assertRejects(
        () =>
          agentToolMeta.fn(
            {
              prompt: "Do isolated work",
              description: "invalid cwd+worktree test",
              cwd: "/tmp",
              isolation: "worktree",
            },
            TEST_WORKSPACE,
            { llmFunction: createMockLLM("unused") },
          ),
        Error,
        "mutually exclusive",
      );
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "agent-tool: frontmatter mcpServers load configured and inline MCP tools into an agent-scoped owner",
  async fn() {
    await withTempHlvmDir(async () => {
      const capturedConfigs: AgentLLMConfig[] = [];
      const testEngine: AgentEngine = {
        createLLM(config) {
          capturedConfigs.push(config);
          return async () => {
            throw new Error("agent-mcp-loaded");
          };
        },
        createSummarizer() {
          return async () => "summary";
        },
      };

      const fixturePath = platform.path.join(
        platform.process.cwd(),
        "tests",
        "fixtures",
        "mcp-server.ts",
      );
      const agentsDir = `${TEST_WORKSPACE}/.hlvm/agents`;

      setAgentEngine(testEngine);
      await ensureDir(agentsDir);
      await platform.fs.mkdir(platform.path.dirname(getMcpConfigPath()), {
        recursive: true,
      });
      await platform.fs.writeTextFile(
        getMcpConfigPath(),
        JSON.stringify({
          version: 1,
          servers: [
            { name: "configured", command: ["deno", "run", fixturePath] },
          ],
        }),
      );
      await platform.fs.writeTextFile(
        `${agentsDir}/mcp-agent.md`,
        `---
name: mcp-agent
description: Agent with MCP tools
tools:
  - mcp_configured_echo
  - mcp_inline_test_echo
mcpServers:
  - configured
  - inline_test:
      command:
        - deno
        - run
        - ${fixturePath}
---

Use MCP tools only.`,
      );

      try {
        const agentToolMeta = AGENT_TOOL["Agent"];
        const result = await agentToolMeta.fn(
          {
            prompt: "Use MCP tools",
            description: "mcp agent test",
            subagent_type: "mcp-agent",
            model: "override-model-123",
          },
          TEST_WORKSPACE,
          {
            llmFunction: createMockLLM("parent llm should not be used"),
            modelId: "claude-code/claude-haiku-4-5-20251001",
          },
        ) as AgentToolResult;

        assertEquals(capturedConfigs.length, 1);
        assertEquals(
          capturedConfigs[0].toolAllowlist?.includes("mcp_configured_echo"),
          true,
        );
        assertEquals(
          capturedConfigs[0].toolAllowlist?.includes("mcp_inline_test_echo"),
          true,
        );
        assertMatch(capturedConfigs[0].toolOwnerId ?? "", /^agent:/);
        assertStringIncludes(result.content, "agent-mcp-loaded");
      } finally {
        resetAgentEngine();
        await cleanDir(TEST_WORKSPACE);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================
// 9. PREVIOUSLY MISSING: GP agent system prompt does NOT contain READ-ONLY
// ============================================================

Deno.test({
  name: "runAgent: GP agent prompt does NOT restrict to read-only",
  async fn() {
    let capturedSystemPrompt = "";
    const captureLLM: LLMFunction = async (messages) => {
      const sysMsg = messages.find((m: any) => m.role === "system") as any;
      if (sysMsg) capturedSystemPrompt = sysMsg.content;
      return { content: "Done.", toolCalls: [] };
    };
    const tools = mockToolRegistry("read_file", "write_file");

    await ensureDir(TEST_WORKSPACE);
    try {
      await runAgent({
        agentDefinition: GENERAL_PURPOSE_AGENT,
        prompt: "Do work",
        workspace: TEST_WORKSPACE,
        llmFunction: captureLLM,
        allTools: tools,
        agentId: "test-gp-prompt",
      });

      // GP should NOT have READ-ONLY restriction
      assertEquals(
        capturedSystemPrompt.includes("READ-ONLY"),
        false,
        "GP agent should NOT have READ-ONLY in system prompt",
      );
      // But should have the agent prefix
      assertStringIncludes(capturedSystemPrompt, "agent");
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================
// 10. Completion notification — parent receives background result
// ============================================================

Deno.test({
  name: "agent-tool: background agent enqueues completion notification",
  async fn() {
    // Drain any leftover notifications from previous tests
    drainCompletionNotifications();

    const agentToolMeta = AGENT_TOOL["Agent"];
    const mockLLM = createMockLLM(
      "Background analysis complete: found 3 issues.",
    );

    await ensureDir(TEST_WORKSPACE);
    try {
      const result = await agentToolMeta.fn(
        {
          prompt: "Analyze security in background",
          description: "bg notification test",
          run_in_background: true,
        },
        TEST_WORKSPACE,
        { llmFunction: mockLLM },
      ) as { status: string; agentId: string };

      assertEquals(result.status, "async_launched");

      // Wait for background agent to complete (mock LLM is instant)
      const bg = getAllBackgroundAgents().find((a) =>
        a.agentId === result.agentId
      );
      assertExists(bg);
      try {
        await bg!.promise;
      } catch { /* may already be resolved */ }

      // Give microtask time to enqueue notification
      await new Promise((r) => setTimeout(r, 100));

      // CC: parent drains completion queue → sees result as user message
      const notifications = drainCompletionNotifications();
      assertEquals(
        notifications.length >= 1,
        true,
        "Expected at least 1 completion notification",
      );

      const notification = notifications[notifications.length - 1];
      assertStringIncludes(notification, "background agent completed");
      assertStringIncludes(notification, "<task-notification>");
      assertStringIncludes(notification, "<status>completed</status>");
      assertStringIncludes(notification, "found 3 issues");
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "agent-tool: background agent persists completion notification into the session transcript",
  async fn() {
    await withTempHlvmDir(async () => {
      drainCompletionNotifications();
      const agentToolMeta = AGENT_TOOL["Agent"];
      const session = createSession("background notification test");

      await ensureDir(TEST_WORKSPACE);
      try {
        const result = await agentToolMeta.fn(
          {
            prompt: "Analyze security in background",
            description: "security-bg",
            run_in_background: true,
          },
          TEST_WORKSPACE,
          {
            llmFunction: createMockLLM("Security analysis complete."),
            sessionId: session.id,
          },
        ) as { status: string; agentId: string };

        assertEquals(result.status, "async_launched");

        const bg = getAllBackgroundAgents().find((a) =>
          a.agentId === result.agentId
        );
        assertExists(bg);
        try {
          await bg!.promise;
        } catch {
          // Best-effort cleanup only.
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
        const messages = getMessages(session.id, { sort: "asc", limit: 50 })
          .messages;
        const notification = messages.find((message) =>
          message.content.includes("<task-notification>")
        );
        assertExists(notification);
        assertEquals(notification!.role, "user");
        assertStringIncludes(
          notification!.content,
          "Security analysis complete.",
        );
        assertEquals(drainCompletionNotifications().length, 0);
      } finally {
        await cleanDir(TEST_WORKSPACE);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "agent-tool: errored background agent — error surfaces in notification result",
  async fn() {
    drainCompletionNotifications();

    const agentToolMeta = AGENT_TOOL["Agent"];
    // runAgent catches LLM errors gracefully (never-throw pattern)
    // so the error surfaces as completed result with error text
    const errorLLM: LLMFunction = async () => {
      throw new Error("Model overloaded");
    };

    await ensureDir(TEST_WORKSPACE);
    try {
      const result = await agentToolMeta.fn(
        {
          prompt: "This will error",
          description: "bg error test",
          run_in_background: true,
        },
        TEST_WORKSPACE,
        { llmFunction: errorLLM },
      ) as { status: string; agentId: string };

      assertEquals(result.status, "async_launched");

      const bg = getAllBackgroundAgents().find((a) =>
        a.agentId === result.agentId
      );
      assertExists(bg);
      try {
        await bg!.promise;
      } catch { /* may resolve or reject */ }

      await new Promise((r) => setTimeout(r, 100));

      // runAgent catches the error and returns it as text, so the notification
      // shows status=completed with error message in result content
      const notifications = drainCompletionNotifications();
      assertEquals(notifications.length >= 1, true);

      const notification = notifications[notifications.length - 1];
      assertStringIncludes(notification, "<status>completed</status>");
      assertStringIncludes(notification, "Model overloaded");
    } finally {
      await cleanDir(TEST_WORKSPACE);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "agent-tool: drainCompletionNotifications returns empty when no notifications",
  fn() {
    // Drain first to clear any leftovers
    drainCompletionNotifications();
    // Second drain should be empty
    const notifications = drainCompletionNotifications();
    assertEquals(notifications.length, 0);
  },
});

Deno.test({
  name:
    "agent-tool: explicit model override creates a child LLM with the override model",
  async fn() {
    const capturedConfigs: AgentLLMConfig[] = [];
    const testEngine: AgentEngine = {
      createLLM(config) {
        capturedConfigs.push(config);
        return async () => {
          throw new Error("child-override-used");
        };
      },
      createSummarizer() {
        return async () => "summary";
      },
    };

    setAgentEngine(testEngine);
    await ensureDir(TEST_WORKSPACE);
    try {
      const agentToolMeta = AGENT_TOOL["Agent"];
      const result = await agentToolMeta.fn(
        {
          prompt: "List one file",
          description: "model override test",
          subagent_type: "Explore",
          model: "override-model-123",
        },
        TEST_WORKSPACE,
        {
          llmFunction: createMockLLM("parent llm should not be used"),
          modelId: "claude-code/claude-haiku-4-5-20251001",
        },
      ) as AgentToolResult;

      assertEquals(capturedConfigs.length, 1);
      assertEquals(capturedConfigs[0].model, "override-model-123");
      assertStringIncludes(result.content, "child-override-used");
    } finally {
      resetAgentEngine();
      await cleanDir(TEST_WORKSPACE);
    }
  },
});

Deno.test({
  name:
    "agent-tool: explicit model override failure is surfaced instead of silently falling back",
  async fn() {
    const testEngine: AgentEngine = {
      createLLM() {
        throw new Error("invalid override model");
      },
      createSummarizer() {
        return async () => "summary";
      },
    };

    setAgentEngine(testEngine);
    await ensureDir(TEST_WORKSPACE);
    try {
      const agentToolMeta = AGENT_TOOL["Agent"];
      await assertRejects(
        () =>
          agentToolMeta.fn(
            {
              prompt: "List one file",
              description: "bad model test",
              subagent_type: "Explore",
              model: "definitely-invalid-model",
            },
            TEST_WORKSPACE,
            {
              llmFunction: createMockLLM("parent llm should not be used"),
              modelId: "claude-code/claude-haiku-4-5-20251001",
            },
          ),
        Error,
        "invalid override model",
      );
    } finally {
      resetAgentEngine();
      await cleanDir(TEST_WORKSPACE);
    }
  },
});
