/**
 * AgentEngine Tests
 *
 * Verifies the AgentEngine interface, SDK default behavior,
 * and getAgentEngine/setAgentEngine/resetAgentEngine singleton.
 */

import {
  assertEquals,
  assertExists,
} from "jsr:@std/assert";
import {
  getAgentEngine,
  resetAgentEngine,
  setAgentEngine,
  type AgentEngine,
  type AgentLLMConfig,
} from "../../../src/hlvm/agent/engine.ts";
import { SdkAgentEngine } from "../../../src/hlvm/agent/engine-sdk.ts";

// ============================================================
// Default Engine
// ============================================================

Deno.test({
  name: "SdkAgentEngine.createLLM returns a function",
  fn() {
    const engine = new SdkAgentEngine();
    const llm = engine.createLLM({ model: "ollama/test" });
    assertEquals(typeof llm, "function");
  },
});

Deno.test({
  name: "SdkAgentEngine.createSummarizer returns a function",
  fn() {
    const engine = new SdkAgentEngine();
    const summarizer = engine.createSummarizer("ollama/test");
    assertEquals(typeof summarizer, "function");
  },
});

// ============================================================
// Singleton: getAgentEngine / setAgentEngine / resetAgentEngine
// ============================================================

Deno.test({
  name: "getAgentEngine returns SdkAgentEngine by default",
  fn() {
    resetAgentEngine();
    const engine = getAgentEngine();
    assertExists(engine);
    assertEquals(engine instanceof SdkAgentEngine, true);
    assertEquals(typeof engine.createLLM, "function");
    assertEquals(typeof engine.createSummarizer, "function");
  },
});

Deno.test({
  name: "setAgentEngine / getAgentEngine round-trips a custom engine",
  fn() {
    resetAgentEngine();
    const calls: string[] = [];

    const custom: AgentEngine = {
      createLLM(_config: AgentLLMConfig) {
        calls.push("createLLM");
        return () => Promise.resolve({ content: "mock", toolCalls: [] });
      },
      createSummarizer(_model?: string) {
        calls.push("createSummarizer");
        return () => Promise.resolve("summary");
      },
    };

    setAgentEngine(custom);
    const engine = getAgentEngine();

    engine.createLLM({});
    engine.createSummarizer();

    assertEquals(calls, ["createLLM", "createSummarizer"]);

    // Clean up
    resetAgentEngine();
  },
});

Deno.test({
  name: "resetAgentEngine restores default",
  fn() {
    const custom: AgentEngine = {
      createLLM() {
        return () => Promise.resolve({ content: "custom", toolCalls: [] });
      },
      createSummarizer() {
        return () => Promise.resolve("custom");
      },
    };

    setAgentEngine(custom);
    resetAgentEngine();

    const engine = getAgentEngine();
    assertEquals(engine instanceof SdkAgentEngine, true);
    const llm = engine.createLLM({ model: "ollama/test" });
    assertEquals(typeof llm, "function");
  },
});
