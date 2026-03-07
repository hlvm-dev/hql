import {
  assertEquals,
  assertNotStrictEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  buildToolDefinitions,
  clearToolDefCache,
  generateSystemPrompt,
} from "../../../src/hlvm/agent/llm-integration.ts";
import {
  classifyModelTier,
  tierMeetsMinimum,
} from "../../../src/hlvm/agent/constants.ts";
import { detectGitContext } from "../../../src/hlvm/agent/session.ts";
import {
  registerTool,
  unregisterTool,
} from "../../../src/hlvm/agent/registry.ts";
import { withTempDir } from "../helpers.ts";

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

Deno.test("LLM integration: prompt content scales by tier and renders git context", () => {
  const weak = generateSystemPrompt({ modelTier: "weak" });
  const mid = generateSystemPrompt({ modelTier: "mid" });
  const frontier = generateSystemPrompt({
    modelTier: "frontier",
    gitContext: { branch: "feature/test", dirty: true },
  });

  assertStringIncludes(weak, "# Examples");
  assertEquals(weak.includes("# Tips"), false);
  assertStringIncludes(mid, "# Tips");
  assertStringIncludes(frontier, "# Tips");
  assertStringIncludes(frontier, "Git: branch=feature/test (dirty)");
  assertEquals(weak.length < mid.length, true);
  assertEquals(frontier.length >= mid.length, true);
});

Deno.test({
  name: "LLM integration: detectGitContext returns branch metadata for a repo",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const result = await detectGitContext(getPlatform().process.cwd());

    assertEquals(result !== null, true);
    assertEquals(typeof result?.branch, "string");
    assertEquals((result?.branch?.length ?? 0) > 0, true);
    assertEquals(typeof result?.dirty, "boolean");
  },
});

Deno.test({
  name:
    "LLM integration: detectGitContext returns null for non-repos and missing paths",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempDir(async (tempDir) => {
      const missing = getPlatform().path.join(tempDir, "missing");
      assertEquals(await detectGitContext(tempDir), null);
      assertEquals(await detectGitContext(missing), null);
    });
  },
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
