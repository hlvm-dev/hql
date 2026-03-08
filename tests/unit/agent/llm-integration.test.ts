import {
  assertEquals,
  assertNotStrictEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  buildToolDefinitions,
  clearToolDefCache,
  generateSystemPrompt,
} from "../../../src/hlvm/agent/llm-integration.ts";
import {
  classifyModelTier,
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
  assertEquals(prompt.includes("**Arguments:**"), false);
  assertEquals(prompt.includes("**Returns:**"), false);
  assertEquals(prompt.includes("Safety Level"), false);
});

Deno.test("LLM integration: custom instructions are included and truncated", () => {
  const prompt = generateSystemPrompt({
    customInstructions: "x".repeat(3000),
  });

  assertStringIncludes(prompt, "# Custom Instructions");
  assertEquals(prompt.includes("x".repeat(2001)), false);
});

Deno.test("LLM integration: model tiers classify and compare correctly", () => {
  assertEquals(classifyModelTier(null, true), "frontier");
  assertEquals(classifyModelTier({ parameterSize: "7B" }), "weak");
  assertEquals(classifyModelTier({ parameterSize: "13B" }), "mid");
  assertEquals(classifyModelTier({ contextWindow: 128_000 }), "frontier");

  assertEquals(tierMeetsMinimum("weak", "mid"), false);
  assertEquals(tierMeetsMinimum("mid", "weak"), true);
  assertEquals(tierMeetsMinimum("frontier", "frontier"), true);
});

Deno.test("LLM integration: prompt content scales by tier", () => {
  const weak = generateSystemPrompt({ modelTier: "weak" });
  const mid = generateSystemPrompt({ modelTier: "mid" });
  const frontier = generateSystemPrompt({ modelTier: "frontier" });

  assertStringIncludes(weak, "# Examples");
  assertEquals(weak.includes("# Tips"), false);
  assertStringIncludes(mid, "# Tips");
  assertStringIncludes(frontier, "# Tips");
  assertEquals(weak.length < mid.length, true);
  assertEquals(frontier.length >= mid.length, true);
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
