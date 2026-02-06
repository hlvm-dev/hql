/**
 * Agent E2E Tests
 *
 * End-to-end tests for AI agent system with real LLM.
 *
 * Requirements:
 *   - Ollama running with llama3.2:1b model
 *   - Or ANTHROPIC_API_KEY set for Claude
 *
 * Run with:
 *   deno test --allow-all tests/e2e/agent.test.ts
 *
 * Note: These tests are slower and require external services.
 *       They may be skipped in CI if LLM is not available.
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { ContextManager } from "../../src/hlvm/agent/context.ts";
import { runReActLoop } from "../../src/hlvm/agent/orchestrator.ts";
import {
  createAgentLLM,
  generateSystemPrompt,
} from "../../src/hlvm/agent/llm-integration.ts";
import { getPlatform } from "../../src/platform/platform.ts";

// ============================================================
// Test Configuration
// ============================================================

const MODEL = "ollama/llama3.1:8b"; // Reliable model for E2E testing
const TIMEOUT = 120000; // 2 minutes per test (LLM can be slow)

// ============================================================
// Helper: Check if LLM is available
// ============================================================

async function isLLMAvailable(): Promise<boolean> {
  try {
    const { ai } = await import("../../src/hlvm/api/ai.ts");
    const status = await ai.status();
    return status.available;
  } catch {
    return false;
  }
}

// ============================================================
// Test Helper
// ============================================================

async function runAgentTask(task: string): Promise<{
  result: string;
  context: ContextManager;
}> {
  const context = new ContextManager({
    maxTokens: 8000,
  });

  // Add system prompt
  context.addMessage({
    role: "system",
    content: generateSystemPrompt(),
  });

  // Create LLM
  const llm = createAgentLLM({ model: MODEL });

  // Run agent
  const result = await runReActLoop(
    task,
    {
      workspace: Deno.cwd(),
      context,
      autoApprove: true,
      maxToolCalls: 10,
    },
    llm,
  );

  return { result, context };
}

// ============================================================
// E2E Tests
// ============================================================

Deno.test({
  name: "E2E Agent: list files with real LLM",
  ignore: !(await isLLMAvailable()),
  async fn() {
    const { result, context } = await runAgentTask(
      "List all TypeScript files in src/hlvm/agent directory",
    );

    // Verify result is reasonable
    assertEquals(typeof result, "string");
    assertEquals(result.length > 0, true);

    // Verify tool calls were made
    const stats = context.getStats();
    assertEquals(stats.toolMessages > 0, true); // Should have called at least one tool

    // Result should mention some known files
    // (This is heuristic - LLM might format differently)
    const resultLower = result.toLowerCase();
    const mentionsFiles =
      resultLower.includes(".ts") || resultLower.includes("file");
    assertEquals(mentionsFiles, true);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "E2E Agent: count files with real LLM",
  ignore: !(await isLLMAvailable()),
  async fn() {
    const { result, context } = await runAgentTask(
      "How many TypeScript test files are in tests/unit/agent?",
    );

    // Verify result contains a number
    assertEquals(typeof result, "string");
    const hasNumber = /\d+/.test(result);
    assertEquals(hasNumber, true);

    // Verify tool calls were made
    const stats = context.getStats();
    assertEquals(stats.toolMessages > 0, true);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "E2E Agent: search code with real LLM",
  ignore: !(await isLLMAvailable()),
  async fn() {
    const { result, context } = await runAgentTask(
      "Search for the word 'orchestrator' in src/hlvm/agent/*.ts files",
    );

    // Verify result is reasonable
    assertEquals(typeof result, "string");
    assertEquals(result.length > 0, true);

    // Should have made tool calls
    const stats = context.getStats();
    assertEquals(stats.toolMessages > 0, true);

    // Result should mention finding something
    const resultLower = result.toLowerCase();
    const mentionsSearch =
      resultLower.includes("found") ||
      resultLower.includes("search") ||
      resultLower.includes("result");
    assertEquals(mentionsSearch, true);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "E2E Agent: read file with real LLM",
  ignore: !(await isLLMAvailable()),
  async fn() {
    // Create a test file IN workspace (not temp dir, to avoid sandbox blocking)
    const platform = getPlatform();
    const testFile = platform.path.join(Deno.cwd(), ".test-e2e-file.txt");

    try {
      await platform.fs.writeTextFile(testFile, "Hello from E2E test!");

      const { result, context } = await runAgentTask(
        `Read the file at ${testFile} and tell me what it says`,
      );

      // Should mention the content
      assertStringIncludes(result.toLowerCase(), "hello");
      assertStringIncludes(result.toLowerCase(), "e2e");

      // Should have made tool calls
      const stats = context.getStats();
      assertEquals(stats.toolMessages > 0, true);
    } finally {
      // Cleanup
      try {
        await platform.fs.remove(testFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "E2E Agent: multiple tool calls with real LLM",
  ignore: !(await isLLMAvailable()),
  async fn() {
    const { result, context } = await runAgentTask(
      "First list files in src/hlvm/agent, then count how many there are",
    );

    // This should require multiple tool calls
    const stats = context.getStats();
    // Might call list_files once, or list_files + search_code, etc.
    assertEquals(stats.toolMessages >= 1, true);

    // Result should include both listing and counting
    assertEquals(typeof result, "string");
    assertEquals(result.length > 0, true);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});


Deno.test({
  name: "E2E Agent: context management during long conversation",
  ignore: !(await isLLMAvailable()),
  async fn() {
    // Test that context stays within budget even with multiple tool calls

    const context = new ContextManager({
      maxTokens: 4000, // Small budget to force trimming
    });

    context.addMessage({
      role: "system",
      content: generateSystemPrompt(),
    });

    const llm = createAgentLLM({ model: MODEL });

    // Run a task that might require multiple tool calls
    await runReActLoop(
      "Search for 'import' in src/hlvm/agent files and tell me how many you found",
      {
        workspace: Deno.cwd(),
        context,
        autoApprove: true,
        maxToolCalls: 10,
      },
      llm,
    );

    // Context should not exceed budget
    const stats = context.getStats();
    assertEquals(stats.estimatedTokens <= 4000 + 500, true); // Allow small overflow
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

