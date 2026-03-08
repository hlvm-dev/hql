/**
 * Agent SDK tests — verifies the thin wrapper delegates correctly.
 *
 * Uses createFixtureLLM + manual session injection to avoid real LLM calls.
 */

import { assertEquals } from "jsr:@std/assert";
import { Agent } from "../../../src/hlvm/agent/sdk.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import { generateSystemPrompt } from "../../../src/hlvm/agent/llm-integration.ts";
import { createFixtureLLM } from "../../../src/hlvm/agent/llm-fixtures.ts";
import type { LlmFixture } from "../../../src/hlvm/agent/llm-fixtures.ts";
import type { AgentSession } from "../../../src/hlvm/agent/session.ts";
import { ENGINE_PROFILES } from "../../../src/hlvm/agent/constants.ts";
import { createTodoState } from "../../../src/hlvm/agent/todo-state.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

/** Create a minimal AgentSession with a fixture LLM. */
function createTestSession(fixture: LlmFixture): AgentSession {
  const context = new ContextManager({ ...ENGINE_PROFILES.normal.context });
  context.addMessage({
    role: "system",
    content: generateSystemPrompt({}),
  });

  return {
    context,
    llm: createFixtureLLM(fixture),
    policy: null,
    l1Confirmations: new Map<string, boolean>(),
    toolOwnerId: "session:test",
    dispose: async () => {},
    profile: ENGINE_PROFILES.normal,
    isFrontierModel: false,
    modelTier: "mid",
    todoState: createTodoState(),
    resolvedContextBudget: {
      budget: ENGINE_PROFILES.normal.context.maxTokens,
      rawLimit: ENGINE_PROFILES.normal.context.maxTokens + 4096,
      source: "default" as const,
    },
  };
}

/** Inject a pre-built session into an Agent instance (bypasses ensureInit). */
function injectSession(agent: Agent, session: AgentSession): void {
  // deno-lint-ignore no-explicit-any
  const a = agent as any;
  a.session = session;
  a.initialized = true;
}

// ============================================================
// Tests
// ============================================================

Deno.test("Agent.chat() returns text response from fixture LLM", async () => {
  const fixture: LlmFixture = {
    version: 1,
    cases: [{
      name: "simple",
      steps: [{ response: "Hello from fixture" }],
    }],
  };

  const agent = new Agent({ workingDirectory: "/tmp" });
  injectSession(agent, createTestSession(fixture));

  const result = await agent.chat("Hi");
  assertEquals(result.text, "Hello from fixture");
  assertEquals(result.toolCalls.length, 0);

  await agent.dispose();
});

Deno.test("Agent.chat() accumulates context across calls", async () => {
  const fixture: LlmFixture = {
    version: 1,
    cases: [{
      name: "multi-turn",
      steps: [
        { response: "First response" },
        { response: "Second response" },
      ],
    }],
  };

  const session = createTestSession(fixture);
  const agent = new Agent({ workingDirectory: "/tmp" });
  injectSession(agent, session);

  const r1 = await agent.chat("First message");
  assertEquals(r1.text, "First response");
  const countAfterFirst = session.context.getMessages().length;

  const r2 = await agent.chat("Second message");
  assertEquals(r2.text, "Second response");
  const countAfterSecond = session.context.getMessages().length;

  // Context should grow — second turn has more messages than first
  assertEquals(countAfterSecond > countAfterFirst, true);

  await agent.dispose();
});

Deno.test("Agent constructor stores config", () => {
  const agent = new Agent({
    model: "test/model",
    workingDirectory: "/tmp/test",
  });
  // deno-lint-ignore no-explicit-any
  const cfg = (agent as any).config;
  assertEquals(cfg.model, "test/model");
  assertEquals(cfg.workingDirectory, "/tmp/test");
});

Deno.test("Agent.dispose() is safe to call twice", async () => {
  const fixture: LlmFixture = {
    version: 1,
    cases: [{ name: "x", steps: [{ response: "ok" }] }],
  };

  const agent = new Agent({ workingDirectory: "/tmp" });
  injectSession(agent, createTestSession(fixture));

  await agent.dispose();
  await agent.dispose(); // should not throw
});

Deno.test("Agent.chat() collects tool calls via onTrace", async () => {
  const fixture: LlmFixture = {
    version: 1,
    cases: [{
      name: "with-tools",
      steps: [
        {
          toolCalls: [{
            id: "tc1",
            toolName: "read_file",
            args: { path: "/tmp/test.txt" },
          }],
        },
        { response: "File contents: hello" },
      ],
    }],
  };

  const traceEvents: string[] = [];
  const agent = new Agent({
    workingDirectory: "/tmp",
    onTrace: (event) => traceEvents.push(event.type),
  });
  injectSession(agent, createTestSession(fixture));

  const result = await agent.chat("Read test.txt");
  assertEquals(result.text, "File contents: hello");
  // Trace events should have been forwarded to our callback
  assertEquals(traceEvents.length > 0, true);

  await agent.dispose();
});

Deno.test("Agent.chat() correlates repeated tool names by toolCallId", async () => {
  const platform = getPlatform();
  const tempDir = await platform.fs.makeTempDir({ prefix: "hlvm-agent-sdk-" });
  const fileA = platform.path.join(tempDir, "a.txt");
  const fileB = platform.path.join(tempDir, "b.txt");
  await platform.fs.writeTextFile(fileA, "alpha");
  await platform.fs.writeTextFile(fileB, "beta");

  try {
    const fixture: LlmFixture = {
      version: 1,
      cases: [{
        name: "duplicate-tool-name",
        steps: [
          {
            toolCalls: [
              { id: "read_a", toolName: "read_file", args: { path: fileA } },
              { id: "read_b", toolName: "read_file", args: { path: fileB } },
            ],
          },
          { response: "done" },
        ],
      }],
    };

    const agent = new Agent({ workingDirectory: tempDir });
    injectSession(agent, createTestSession(fixture));

    const result = await agent.chat("Read both files");

    assertEquals(result.toolCalls.length, 2);
    assertEquals(result.toolCalls[0].id, "read_a");
    assertEquals(String(result.toolCalls[0].result).includes("alpha"), true);
    assertEquals(result.toolCalls[1].id, "read_b");
    assertEquals(String(result.toolCalls[1].result).includes("beta"), true);

    await agent.dispose();
  } finally {
    await platform.fs.remove(tempDir, { recursive: true });
  }
});
