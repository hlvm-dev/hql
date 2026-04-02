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
  resolveProviderExecutionPlan,
} from "../../../src/hlvm/agent/tool-capabilities.ts";
import { buildExecutionSurface } from "../../../src/hlvm/agent/execution-surface.ts";
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

Deno.test("LLM integration: native web-search mode removes search_web-specific guidance", () => {
  const prompt = generateSystemPrompt({
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
  });

  assertStringIncludes(prompt, "# Web Tool Guidance");
  assertStringIncludes(prompt, "web_search is for live web discovery");
  assertEquals(prompt.includes("Use timeRange, not recency"), false);
  assertEquals(prompt.includes("Use prefetch, not preFetch"), false);
  assertEquals(prompt.includes("DuckDuckGo"), false);
  assertStringIncludes(
    prompt,
    "web_fetch is the default reader for a known page URL",
  );
  assertStringIncludes(prompt, "fetch_url is for raw HTML/markdown");
});

Deno.test("LLM integration: remote code guidance appears only when explicitly enabled", () => {
  const prompt = generateSystemPrompt({
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "google",
      allowlist: ["remote_code_execute"],
      nativeCapabilities: {
        webSearch: true,
        webPageRead: true,
        remoteCodeExecution: true,
      },
    }),
  });

  assertStringIncludes(prompt, "# Remote Code Execution");
  assertStringIncludes(prompt, "provider-hosted sandbox");
  assertStringIncludes(prompt, "not the same thing as local compute");
});

Deno.test("LLM integration: auto-mode prompt guidance explains active code.exec routing", () => {
  const providerExecutionPlan = resolveProviderExecutionPlan({
    providerName: "google",
    nativeCapabilities: {
      webSearch: true,
      webPageRead: true,
      remoteCodeExecution: true,
    },
    autoRequestedRemoteCodeExecution: true,
  });
  const executionSurface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "google/gemini-2.5-pro",
    pinnedProviderName: "google",
    providerExecutionPlan,
    taskCapabilityContext: {
      requestedCapabilities: ["code.exec"],
      source: "task-text",
      matchedCueLabels: ["calculate", "quick script"],
    },
  });
  const prompt = generateSystemPrompt({
    runtimeMode: "auto",
    executionSurface,
    providerExecutionPlan,
  });

  assertStringIncludes(prompt, "# Auto Execution");
  assertStringIncludes(prompt, "code.exec is active for this turn");
  assertStringIncludes(prompt, "provider-hosted sandbox");
  assertStringIncludes(prompt, "not local shell or workspace access");
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
  const prompt = generateSystemPrompt({ modelTier: "mid" });

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
});

Deno.test("LLM integration: generateSystemPrompt remains a text-only compatibility wrapper", () => {
  const compiled = compileSystemPrompt();
  const generated = generateSystemPrompt();

  assertEquals(generated, compiled.text);
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
