import { assertEquals, assertNotStrictEquals } from "jsr:@std/assert";
import { createAgent } from "../../../src/hlvm/agent/agent.ts";
import {
  createCallbackEventSink,
  createReadableStreamEventSink,
} from "../../../src/hlvm/agent/agent-events.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import { createToolProfileState } from "../../../src/hlvm/agent/tool-profiles.ts";
import type {
  AgentEvent,
  AgentLoopResult,
} from "../../../src/hlvm/agent/orchestrator.ts";

function loopResult(text: string): AgentLoopResult {
  return {
    text,
    stopReason: "complete",
    iterations: 1,
    durationMs: 1,
    toolUseCount: 0,
    usage: {
      calls: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      source: "estimated",
    },
  };
}

Deno.test("Agent event sink adapts callback delivery", async () => {
  const events: AgentEvent[] = [];
  const sink = createCallbackEventSink({
    onToken: (text) => events.push({ type: "token", text }),
    onTrace: (event) => events.push({ type: "trace", event }),
  });

  await sink.emit({ type: "token", text: "a" });
  await sink.emit({
    type: "trace",
    event: { type: "iteration", current: 1, max: 3 },
  });

  assertEquals(events.map((event) => event.type), ["token", "trace"]);
});

Deno.test("Agent event sink closes readable stream with final result", async () => {
  const { sink, stream } = createReadableStreamEventSink();
  const reader = stream.getReader();

  await sink.emit({ type: "token", text: "a" });
  assertEquals(await reader.read(), {
    done: false,
    value: { type: "token", text: "a" },
  });

  const result = loopResult("done");
  await sink.close?.(result);
  assertEquals(await reader.read(), {
    done: false,
    value: { type: "result", result },
  });
  assertEquals(await reader.read(), { done: true, value: undefined });
});

Deno.test({
  name: "createAgent runs and streams from an immutable base config",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const context = new ContextManager();
    const agent = createAgent({
      config: {
        workspace: "/tmp",
        context,
        permissionMode: "bypassPermissions",
        maxIterations: 3,
      },
      llmFunction: async () => ({ content: "ok", toolCalls: [] }),
    });

    const first = await agent.run("answer");
    assertEquals(first.text, "ok");
    assertEquals(first.stopReason, "complete");

    const forked = agent.fork({ maxIterations: 1 });
    const handle = forked.start("stream");
    const second = await handle.result;
    const events: AgentEvent[] = [];
    for await (const event of handle.events) {
      events.push(event);
    }

    assertEquals(second.text, "ok");
    assertEquals(events.at(-1), { type: "result", result: second });
  },
});

Deno.test({
  name: "fork creates isolated context — does not share parent message history",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const parentContext = new ContextManager();
    const agent = createAgent({
      config: {
        workspace: "/tmp",
        context: parentContext,
        permissionMode: "bypassPermissions",
        maxIterations: 1,
      },
      llmFunction: async () => ({ content: "parent-reply", toolCalls: [] }),
    });

    // Run parent — adds messages to parentContext
    await agent.run("parent-prompt");
    const parentMsgCount = parentContext.getMessages().length;

    // Fork — should get a fresh context
    const child = agent.fork({ maxIterations: 1 });
    const childResult = await child.run("child-prompt");
    assertEquals(childResult.text, "parent-reply");

    // Parent context should not have grown from the child's run
    assertEquals(parentContext.getMessages().length, parentMsgCount);
  },
});

Deno.test({
  name:
    "createAgent does not mutate caller toolProfileState across runs or forks",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const toolProfileState = createToolProfileState({
      baseline: {
        slot: "baseline",
        allowlist: ["read_file"],
      },
    });
    const initialGeneration = toolProfileState._generation;
    const context = new ContextManager();
    const agent = createAgent({
      config: {
        workspace: "/tmp",
        context,
        permissionMode: "bypassPermissions",
        maxIterations: 1,
        toolProfileState,
      },
      llmFunction: async () => ({ content: "ok", toolCalls: [] }),
    });

    await agent.run("first");
    const fork = agent.fork({ maxIterations: 1 });
    await fork.run("second");

    assertEquals(toolProfileState._generation, initialGeneration);
    assertEquals(toolProfileState.layers.domain, undefined);
    assertEquals(toolProfileState.layers.discovery, undefined);
    assertEquals(toolProfileState.layers.runtime, undefined);
  },
});
