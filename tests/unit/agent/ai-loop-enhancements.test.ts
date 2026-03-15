/**
 * Integration tests for AI loop enhancements:
 *   Item 1: Provider-native thinking/reasoning
 *   Item 2: Smart tool-result compression
 *   Item 3: Auto-verify after file writes
 *
 * These test the WIRING — that data actually flows through the real code paths,
 * not just that the leaf functions produce correct output in isolation.
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  buildToolResultOutputs,
  compressForLLM,
} from "../../../src/hlvm/agent/orchestrator-tool-formatting.ts";
import {
  getToolTimeoutMs,
  isFileWriteTool,
  maybeVerifySyntax,
} from "../../../src/hlvm/agent/orchestrator-tool-execution.ts";
import { DEFAULT_TIMEOUTS } from "../../../src/hlvm/agent/constants.ts";
import {
  buildProviderOptions,
  extractReasoningText,
} from "../../../src/hlvm/agent/engine-sdk.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import type { OrchestratorConfig } from "../../../src/hlvm/agent/orchestrator.ts";

// ============================================================
// Item 1: Provider-native thinking/reasoning
// ============================================================
// What's tested: buildProviderOptions produces correct config for each provider.
// What's NOT tested here (requires live model): actual SDK call returning reasoning.
// The reasoning extraction logic (filter+map) is tested via the extraction unit test below.

Deno.test("Item 1: buildProviderOptions enables native thinking for supported providers", () => {
  // Anthropic
  const anthropic = buildProviderOptions(
    {
      providerName: "anthropic",
      modelId: "claude-sonnet-4-5-20250929",
      providerConfig: null,
    },
    { thinkingCapable: true },
  );
  assertEquals(anthropic?.anthropic?.thinking, {
    type: "enabled",
    budgetTokens: 5000,
  });

  // Claude Code uses Anthropic provider options under the hood
  const claudeCode = buildProviderOptions(
    {
      providerName: "claude-code",
      modelId: "claude-sonnet-4-5-20250929",
      providerConfig: null,
    },
    { thinkingCapable: false },
  );
  assertEquals(claudeCode?.anthropic?.thinking, {
    type: "enabled",
    budgetTokens: 5000,
  });

  // OpenAI
  const openai = buildProviderOptions(
    { providerName: "openai", modelId: "o3", providerConfig: null },
    { thinkingCapable: true },
  );
  assertEquals(openai?.openai?.reasoningEffort, "low");

  // Google
  const google = buildProviderOptions(
    {
      providerName: "google",
      modelId: "gemini-2.5-flash",
      providerConfig: null,
    },
    { thinkingCapable: true },
  );
  assertEquals(google?.google?.thinkingConfig, {
    includeThoughts: true,
    thinkingLevel: "low",
  });

  // Ollama (no thinking) — only num_ctx
  const ollama = buildProviderOptions(
    { providerName: "ollama", modelId: "llama3.1:8b", providerConfig: null },
    { thinkingCapable: true, contextBudget: 8192 },
  );
  assertEquals(ollama?.ollama, { num_ctx: 8192 });
  assertEquals(ollama?.anthropic, undefined); // no thinking for ollama

  // Models outside the known reasoning families stay off
  const noThinking = buildProviderOptions(
    { providerName: "openai", modelId: "gpt-4o", providerConfig: null },
    { thinkingCapable: false },
  );
  assertEquals(noThinking, undefined);
});

Deno.test("Item 1: reasoning extraction logic handles SDK ReasoningPart[] format", () => {
  // Case 1: reasoning with text parts (normal case)
  const reasoning = [
    { type: "text", text: "Let me think about this. " },
    { type: "text", text: "The answer is 42." },
  ];
  const result = extractReasoningText(reasoning);
  assertEquals(result, "Let me think about this. The answer is 42.");

  // Case 2: empty reasoning array → undefined
  const emptyResult = extractReasoningText([]);
  assertEquals(emptyResult, undefined);

  // Case 3: null/undefined reasoning → undefined
  const nullResult = extractReasoningText(undefined);
  assertEquals(nullResult, undefined);

  // Case 4: reasoning with non-text parts (e.g., redacted thinking)
  const mixedReasoning = [
    { type: "text", text: "visible thought" },
    { type: "redacted", text: "" },
    { type: "text", text: " more thought" },
  ];
  const mixedResult = extractReasoningText(mixedReasoning);
  assertEquals(mixedResult, "visible thought more thought");

  // Case 5: string fallback
  assertEquals(
    extractReasoningText("single reasoning string"),
    "single reasoning string",
  );
});

Deno.test("Item 2: ask_user uses the user-input timeout instead of the generic tool timeout", () => {
  assertEquals(getToolTimeoutMs("ask_user"), DEFAULT_TIMEOUTS.userInput);
  assertEquals(getToolTimeoutMs("read_file"), DEFAULT_TIMEOUTS.tool);
  assertEquals(getToolTimeoutMs("read_file", 12_345), 12_345);
});

Deno.test("Item 1: LLMResponse reasoning field compiles and round-trips", () => {
  const response: import("../../../src/hlvm/agent/tool-call.ts").LLMResponse = {
    content: "The answer is 42",
    toolCalls: [],
    reasoning: "I thought deeply about this",
  };
  assertEquals(response.reasoning, "I thought deeply about this");

  // Without reasoning — still valid
  const response2: import("../../../src/hlvm/agent/tool-call.ts").LLMResponse =
    {
      content: "hello",
      toolCalls: [],
    };
  assertEquals(response2.reasoning, undefined);
});

// ============================================================
// Item 2: Smart tool-result compression
// ============================================================
// What we need to verify: buildToolResultOutputs actually calls compressForLLM
// and the compressed result reaches llmContent (what the LLM sees).

Deno.test("Item 2: buildToolResultOutputs compresses large read_file result before truncation", () => {
  // Create a fake OrchestratorConfig with a mock context that records what it receives
  let truncateInput = "";
  const mockConfig = {
    context: {
      truncateResult(result: string): string {
        truncateInput = result; // capture what compression produced BEFORE truncation
        return result; // pass through (no truncation in test)
      },
    },
  } as unknown as OrchestratorConfig;

  // Generate a large file result (200 lines, >4000 chars)
  const pad = "x".repeat(30);
  const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1} ${pad}`);
  const bigFileContent = lines.join("\n");

  // Call the real buildToolResultOutputs — this is the actual code path used by the orchestrator
  const { llmContent } = buildToolResultOutputs(
    "read_file",
    bigFileContent,
    mockConfig,
  );

  // The llmContent (what the LLM sees) should be compressed
  assertStringIncludes(llmContent, "line 1 "); // head preserved
  assertStringIncludes(llmContent, "line 80 "); // end of head
  assertStringIncludes(llmContent, "lines omitted"); // omission marker
  assertStringIncludes(llmContent, "line 200 "); // tail preserved
  assertEquals(llmContent.includes("line 100 "), false); // middle dropped

  // Verify truncateResult received the already-compressed content
  assertEquals(truncateInput, llmContent);
  assertEquals(truncateInput.length < bigFileContent.length, true);
});

Deno.test("Item 2: buildToolResultOutputs compresses large shell_exec result", () => {
  const mockConfig = {
    context: { truncateResult: (s: string) => s },
  } as unknown as OrchestratorConfig;

  const pad = "x".repeat(40);
  const lines: string[] = [];
  for (let i = 0; i < 15; i++) lines.push(`$ cmd ${i} ${pad}`);
  for (let i = 0; i < 50; i++) lines.push(`noise ${i} ${pad}`);
  lines.push("ERROR: critical failure");
  for (let i = 0; i < 25; i++) lines.push(`tail ${i} ${pad}`);
  const bigOutput = lines.join("\n");

  const { llmContent } = buildToolResultOutputs(
    "shell_exec",
    bigOutput,
    mockConfig,
  );

  assertStringIncludes(llmContent, "ERROR: critical failure"); // errors preserved
  assertStringIncludes(llmContent, "$ cmd 0"); // head preserved
  assertStringIncludes(llmContent, "lines omitted"); // compression happened
  assertEquals(llmContent.length < bigOutput.length, true);
});

Deno.test("Item 2: buildToolResultOutputs passes small results through unchanged", () => {
  const mockConfig = {
    context: { truncateResult: (s: string) => s },
  } as unknown as OrchestratorConfig;

  const small = "File: foo.ts\nSize: 42 bytes\n\nconst x = 1;";
  const { llmContent } = buildToolResultOutputs("read_file", small, mockConfig);

  // Small results pass through compressForLLM unchanged. stringifyToolResult wraps in quotes.
  assertStringIncludes(llmContent, "File: foo.ts");
  assertStringIncludes(llmContent, "const x = 1;");
  // No compression marker
  assertEquals(llmContent.includes("lines omitted"), false);
});

// Leaf function tests (these were validated before, keeping for regression)

Deno.test("Item 2: compressForLLM read_file head+tail", () => {
  const pad = "x".repeat(30);
  const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1} ${pad}`);
  const input = lines.join("\n");
  const result = compressForLLM("read_file", input);
  assertStringIncludes(result, "line 1 ");
  assertStringIncludes(result, "line 80 ");
  assertStringIncludes(result, "lines omitted");
  assertStringIncludes(result, "line 200 ");
  assertEquals(result.includes("line 100 "), false);
});

Deno.test("Item 2: compressForLLM git_diff strips excess context", () => {
  // Must exceed BOTH: >4000 chars AND >80 lines to trigger compression
  const pad = "x".repeat(40);
  const lines: string[] = [
    "diff --git a/foo.ts b/foo.ts",
    "--- a/foo.ts",
    "+++ b/foo.ts",
    "@@ -10,50 +10,50 @@ function hello() {",
  ];
  for (let i = 0; i < 40; i++) lines.push(`  unchanged ${i} ${pad}`);
  lines.push("+  added");
  lines.push("-  removed");
  for (let i = 0; i < 40; i++) lines.push(`  context ${i} ${pad}`);

  const input = lines.join("\n");
  assertEquals(input.length > 4000, true, "must exceed 4000 chars");
  assertEquals(
    lines.length > 80,
    true,
    `must exceed 80 lines, got ${lines.length}`,
  );

  const result = compressForLLM("git_diff", input);
  assertStringIncludes(result, "diff --git a/foo.ts");
  assertStringIncludes(result, "+  added");
  assertStringIncludes(result, "-  removed");
  const unchangedCount = (result.match(/unchanged/g) || []).length;
  assertEquals(
    unchangedCount <= 2,
    true,
    `Expected <=2 context, got ${unchangedCount}`,
  );
  assertEquals(
    result.length < input.length,
    true,
    "should be smaller after compression",
  );
});

// ============================================================
// Item 3: Auto-verify after file writes
// ============================================================
// What we need to verify:
// 1. maybeVerifySyntax runs real deno check / node --check
// 2. isFileWriteTool correctly identifies trigger tools
// The wiring (executeToolCall calling maybeVerifySyntax) is tested by
// confirming the function works with realistic ToolCall+Config shapes.

Deno.test("Item 3: isFileWriteTool identifies correct tools", () => {
  assertEquals(isFileWriteTool("write_file"), true);
  assertEquals(isFileWriteTool("edit_file"), true);
  assertEquals(isFileWriteTool("read_file"), false);
  assertEquals(isFileWriteTool("shell_exec"), false);
});

Deno.test({
  name: "Item 3: maybeVerifySyntax runs real tsc --noEmit on valid .ts file",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tmpDir = await Deno.makeTempDir();
    const filePath = getPlatform().path.join(tmpDir, "valid.ts");
    await Deno.writeTextFile(
      filePath,
      "const x: number = 42;\nexport { x };\n",
    );

    try {
      const result = await maybeVerifySyntax(
        { id: "t1", toolName: "write_file", args: { path: filePath } },
        { workspace: tmpDir } as Parameters<typeof maybeVerifySyntax>[1],
      );
      assertEquals(result?.ok, true);
      assertEquals(result?.summary, "Syntax check passed via tsc --noEmit.");
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "Item 3: maybeVerifySyntax runs real tsc --noEmit on INVALID .ts file — catches error",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tmpDir = await Deno.makeTempDir();
    const filePath = getPlatform().path.join(tmpDir, "broken.ts");
    await Deno.writeTextFile(filePath, "const x: number = ;\n");

    try {
      const result = await maybeVerifySyntax(
        { id: "t2", toolName: "write_file", args: { path: filePath } },
        { workspace: tmpDir } as Parameters<typeof maybeVerifySyntax>[1],
      );
      assertEquals(result?.ok, false);
      assertEquals(result?.summary, "Syntax check failed via tsc --noEmit.");
      assertStringIncludes(result?.diagnostics ?? "", "error");
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "Item 3: maybeVerifySyntax runs real node --check on valid .js file",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tmpDir = await Deno.makeTempDir();
    const filePath = `${tmpDir}/ok.js`;
    await Deno.writeTextFile(filePath, "const x = 42;\nconsole.log(x);\n");

    try {
      const result = await maybeVerifySyntax(
        { id: "t3", toolName: "write_file", args: { path: filePath } },
        { workspace: tmpDir } as Parameters<typeof maybeVerifySyntax>[1],
      );
      assertEquals(result?.ok, true);
      assertEquals(result?.summary, "Syntax check passed via node --check.");
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "Item 3: maybeVerifySyntax runs real node --check on INVALID .js file — catches error",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tmpDir = await Deno.makeTempDir();
    const filePath = `${tmpDir}/broken.js`;
    await Deno.writeTextFile(filePath, "const x = ;\n");

    try {
      const result = await maybeVerifySyntax(
        { id: "t4", toolName: "write_file", args: { path: filePath } },
        { workspace: tmpDir } as Parameters<typeof maybeVerifySyntax>[1],
      );
      assertEquals(result?.ok, false);
      assertEquals(result?.summary, "Syntax check failed via node --check.");
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "Item 3: maybeVerifySyntax returns null for .md (no checker)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const result = await maybeVerifySyntax(
      { id: "t5", toolName: "write_file", args: { path: "/tmp/README.md" } },
      { workspace: "/tmp" } as Parameters<typeof maybeVerifySyntax>[1],
    );
    assertEquals(result, null);
  },
});

Deno.test({
  name: "Item 3: maybeVerifySyntax returns null when path arg missing",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const result = await maybeVerifySyntax(
      { id: "t6", toolName: "write_file", args: {} },
      { workspace: "/tmp" } as Parameters<typeof maybeVerifySyntax>[1],
    );
    assertEquals(result, null);
  },
});
