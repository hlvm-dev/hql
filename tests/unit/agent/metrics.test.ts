/**
 * Metrics Tests
 *
 * Verifies structured metrics emission from orchestrator.
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { runReActLoop, type LLMFunction } from "../../../src/hlvm/agent/orchestrator.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import { TOOL_REGISTRY } from "../../../src/hlvm/agent/registry.ts";
import { generateSystemPrompt } from "../../../src/hlvm/agent/llm-integration.ts";
import { InMemoryMetrics, createJsonlMetricsSink } from "../../../src/hlvm/agent/metrics.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

// ============================================================
// Helpers
// ============================================================

function createScriptedLLM(responses: string[]): LLMFunction {
  let index = 0;
  return async () => {
    if (index >= responses.length) {
      throw new Error("LLM script exhausted");
    }
    return responses[index++];
  };
}

function addFakeTool(name: string, result: unknown): void {
  TOOL_REGISTRY[name] = {
    fn: async () => result,
    description: "Fake tool for metrics tests",
    args: {},
  };
}

function removeTool(name: string): void {
  delete TOOL_REGISTRY[name];
}

// ============================================================
// Tests
// ============================================================

Deno.test({
  name: "Metrics: in-memory sink receives core events",
  async fn() {
    const toolName = "fake_metrics_tool";
    addFakeTool(toolName, { ok: true });
    const metrics = new InMemoryMetrics();

    try {
      const llm = createScriptedLLM([
        `TOOL_CALL\n{"toolName":"${toolName}","args":{}}\nEND_TOOL_CALL`,
        `Based on ${toolName}, done.`,
      ]);

      const context = new ContextManager();
      context.addMessage({ role: "system", content: generateSystemPrompt() });

      await runReActLoop(
        "Do thing",
        {
          workspace: "/tmp",
          context,
          autoApprove: true,
          metrics,
        },
        llm,
      );

      const events = metrics.getEvents();
      const types = new Set(events.map((e) => e.type));
      assertEquals(types.has("llm_call"), true);
      assertEquals(types.has("llm_response"), true);
      assertEquals(types.has("tool_call"), true);
      assertEquals(types.has("tool_result"), true);
      assertEquals(types.has("llm_usage"), true);
    } finally {
      removeTool(toolName);
    }
  },
});

Deno.test({
  name: "Metrics: JSONL sink writes events",
  async fn() {
    const platform = getPlatform();
    const dir = await platform.fs.makeTempDir({ prefix: "hlvm-metrics-" });
    const path = platform.path.join(dir, "metrics.jsonl");
    const sink = createJsonlMetricsSink(path);

    await sink.emit({
      ts: Date.now(),
      type: "test_event",
      data: { ok: true },
    });

    const content = await platform.fs.readTextFile(path);
    assertStringIncludes(content, "\"type\":\"test_event\"");

    await platform.fs.remove(dir, { recursive: true });
  },
});
