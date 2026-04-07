import {
  assertEquals,
  assertNotStrictEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  buildToolDefinitions,
  clearToolDefCache,
  compileSystemPrompt,
  generateSystemPrompt,
} from "../../../src/hlvm/agent/llm-integration.ts";
import {
  classifyModelTier,
  supportsAgentExecution,
  tierMeetsMinimum,
} from "../../../src/hlvm/agent/constants.ts";
import {
  registerTool,
  unregisterTool,
} from "../../../src/hlvm/agent/registry.ts";

Deno.test("LLM integration: default prompt includes core role, tools, and concision guidance", () => {
  const prompt = generateSystemPrompt();

  assertStringIncludes(prompt, "AI assistant");
  assertStringIncludes(prompt, "Platform:");
  assertStringIncludes(prompt, "read_file");
  assertStringIncludes(prompt, "shell_exec");
  assertStringIncludes(prompt, "Be direct and concise");
  assertStringIncludes(
    prompt,
    "do not narrate that you are about to search, fetch, inspect, or check something",
  );
  assertStringIncludes(
    prompt,
    "Final answers must not include workflow filler",
  );
  assertStringIncludes(prompt, "Do NOT output tool call JSON");
});

Deno.test("LLM integration: prompt renders routing and permission sections without verbose schema docs", () => {
  const prompt = generateSystemPrompt();

  assertStringIncludes(prompt, "# Tool Selection");
  assertStringIncludes(prompt, "# Web Tool Guidance");
  assertStringIncludes(prompt, "Use timeRange, not recency");
  assertStringIncludes(prompt, "Use prefetch, not preFetch");
  assertStringIncludes(
    prompt,
    "web_fetch is the default reader for a known page URL",
  );
  assertStringIncludes(
    prompt,
    "call web_fetch on that URL instead of inventing a derived URL",
  );
  assertStringIncludes(
    prompt,
    "shell_exec → ONLY when no dedicated tool exists",
  );
  assertStringIncludes(prompt, "# Permission Cost");
  assertStringIncludes(prompt, "Prefer Free tools");
  assertEquals(prompt.includes("deterministic answer draft"), false);
  assertEquals(prompt.includes("**Arguments:**"), false);
  assertEquals(prompt.includes("**Returns:**"), false);
  assertEquals(prompt.includes("Safety Level"), false);
});

Deno.test("LLM integration: prompt omits memory exceptions when memory tools are denied", () => {
  const prompt = generateSystemPrompt({
    toolDenylist: ["memory_write", "memory_search", "memory_edit"],
  });

  assertEquals(
    prompt.includes("memory_write, memory_search, and memory_edit"),
    false,
  );
});

Deno.test("LLM integration: prompt includes team coordination guidance when team tools are available", () => {
  const prompt = generateSystemPrompt({ modelTier: "standard" });

  assertStringIncludes(prompt, "# Agent Teams");
  assertStringIncludes(prompt, "Teammate");
  assertStringIncludes(prompt, "TaskCreate");
  assertStringIncludes(prompt, "SendMessage");
  assertStringIncludes(prompt, "Team Lifecycle");
});

Deno.test("LLM integration: custom instructions are included and truncated", () => {
  const prompt = generateSystemPrompt({
    instructions: { global: "x".repeat(3000), project: "", trusted: false },
  });

  assertStringIncludes(prompt, "# Custom Instructions");
  assertEquals(prompt.includes("x".repeat(2001)), false);
});

Deno.test("LLM integration: compileSystemPrompt exposes cache-segment metadata without dropping content", () => {
  const compiled = compileSystemPrompt();

  assertEquals(compiled.cacheSegments.length >= 2, true);
  assertEquals(
    compiled.cacheSegments.map((segment) => segment.text).join("\n\n"),
    compiled.text,
  );
  assertEquals(
    compiled.sections.every((section) =>
      ["static", "session", "turn"].includes(section.stability)
    ),
    true,
  );
  assertEquals(
    compiled.stableCacheProfile.stableSegmentCount,
    compiled.cacheSegments.filter((segment) => segment.stability !== "turn")
      .length,
  );
});

Deno.test("LLM integration: generateSystemPrompt remains a text-only compatibility wrapper", () => {
  const compiled = compileSystemPrompt();
  const generated = generateSystemPrompt();

  assertEquals(generated, compiled.text);
});

Deno.test("LLM integration: model tiers classify and compare correctly", () => {
  // Tier classification
  assertEquals(classifyModelTier(null, "anthropic/claude-sonnet"), "enhanced");
  assertEquals(classifyModelTier({ parameterSize: "2B" }), "constrained");
  assertEquals(classifyModelTier({ parameterSize: "7B" }), "standard");
  assertEquals(classifyModelTier({ parameterSize: "13B" }), "standard");
  assertEquals(classifyModelTier({ contextWindow: 128_000 }), "standard");
  assertEquals(classifyModelTier(null, "openai/gpt-4o"), "enhanced");

  // Tier comparison
  assertEquals(tierMeetsMinimum("constrained", "standard"), false);
  assertEquals(tierMeetsMinimum("standard", "constrained"), true);
  assertEquals(tierMeetsMinimum("enhanced", "enhanced"), true);
});

Deno.test("LLM integration: supportsAgentExecution uses capabilities ground truth", () => {
  // Cloud providers always support agent execution
  assertEquals(supportsAgentExecution("anthropic/haiku", null), true);
  assertEquals(supportsAgentExecution("openai/gpt-4o", null), true);
  assertEquals(supportsAgentExecution("google/gemini-2.5-pro", null), true);

  // Capability-driven: model reports "tools" → agent supported
  assertEquals(
    supportsAgentExecution("ollama/gemma4:e4b", {
      capabilities: ["chat", "tools"],
      parameterSize: "8B",
    }),
    true,
  );

  // Capability-driven: model reports NO "tools" → agent blocked
  assertEquals(
    supportsAgentExecution("ollama/notools:8b", {
      capabilities: ["chat"],
      parameterSize: "8B",
    }),
    false,
  );

  // No capability data → fallback to tier heuristic
  assertEquals(
    supportsAgentExecution("ollama/unknown", { parameterSize: "1B" }),
    false, // 1B < 3B = constrained = no agent
  );
  assertEquals(
    supportsAgentExecution("ollama/unknown", { parameterSize: "8B" }),
    true, // 8B >= 3B = standard = agent supported
  );
});

Deno.test("LLM integration: prompt content scales by tier", () => {
  const constrained = generateSystemPrompt({ modelTier: "constrained" });
  const standard = generateSystemPrompt({ modelTier: "standard" });
  const enhanced = generateSystemPrompt({ modelTier: "enhanced" });

  assertStringIncludes(constrained, "# Examples");
  assertEquals(constrained.includes("# Tips"), false);
  assertStringIncludes(standard, "# Tips");
  assertStringIncludes(enhanced, "# Tips");
  assertEquals(constrained.length < standard.length, true);
  assertEquals(enhanced.length >= standard.length, true);
});

Deno.test("LLM integration: buildToolDefinitions caches until the registry changes", () => {
  clearToolDefCache();
  const first = buildToolDefinitions();
  const second = buildToolDefinitions();
  assertEquals(first, second);

  registerTool("testGenTool", {
    description: "temp tool for generation test",
    args: {},
    fn: () => Promise.resolve("ok"),
  });

  try {
    const rebuilt = buildToolDefinitions();
    assertNotStrictEquals(first, rebuilt);
    assertEquals(
      rebuilt.some((tool) => tool.function.name === "testGenTool"),
      true,
    );
  } finally {
    unregisterTool("testGenTool");
    clearToolDefCache();
  }
});
