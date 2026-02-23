/**
 * LLM Integration Tests
 *
 * Verifies system prompt generation, model tier classification, and git context.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  generateSystemPrompt,
} from "../../../src/hlvm/agent/llm-integration.ts";
import {
  classifyModelTier,
  tierMeetsMinimum,
} from "../../../src/hlvm/agent/constants.ts";

// ============================================================
// System Prompt Generation
// ============================================================

Deno.test({
  name: "LLM Integration: generateSystemPrompt - includes role description",
  fn() {
    const prompt = generateSystemPrompt();

    assertStringIncludes(prompt, "AI assistant");
    assertStringIncludes(prompt, "tools");
    assertStringIncludes(prompt, "Platform:");
  },
});

Deno.test({
  name: "LLM Integration: generateSystemPrompt - lists tool names",
  fn() {
    const prompt = generateSystemPrompt();

    // Tool names listed (schemas sent via API, not in prompt)
    assertStringIncludes(prompt, "read_file");
    assertStringIncludes(prompt, "write_file");
    assertStringIncludes(prompt, "list_files");
    assertStringIncludes(prompt, "search_code");
    assertStringIncludes(prompt, "shell_exec");
  },
});

Deno.test({
  name:
    "LLM Integration: generateSystemPrompt - includes tool calling instructions",
  fn() {
    const prompt = generateSystemPrompt();

    assertStringIncludes(prompt, "function calling");
    assertStringIncludes(prompt, "Do NOT output tool call JSON");
  },
});

Deno.test({
  name:
    "LLM Integration: generateSystemPrompt - no verbose tool docs (schemas via API)",
  fn() {
    const prompt = generateSystemPrompt();

    // Prompt should NOT contain verbose tool documentation
    // (tool schemas are sent via native function calling API)
    assertEquals(prompt.includes("**Arguments:**"), false);
    assertEquals(prompt.includes("**Returns:**"), false);
    assertEquals(prompt.includes("Safety Level"), false);
  },
});

Deno.test({
  name:
    "LLM Integration: generateSystemPrompt - auto-generates tool routing table",
  fn() {
    const prompt = generateSystemPrompt();

    // Routing rules should map dedicated tools away from shell_exec
    assertStringIncludes(prompt, "# Tool Selection");
    assertStringIncludes(prompt, "read_file");
    assertStringIncludes(prompt, 'NOT shell_exec');
    assertStringIncludes(
      prompt,
      "shell_exec → ONLY when no dedicated tool exists",
    );
  },
});

Deno.test({
  name:
    "LLM Integration: generateSystemPrompt - auto-generates permission tiers",
  fn() {
    const prompt = generateSystemPrompt();

    assertStringIncludes(prompt, "# Permission Cost");
    assertStringIncludes(prompt, "Free (no approval):");
    assertStringIncludes(prompt, "Approve once:");
    assertStringIncludes(prompt, "Approve each time:");
    assertStringIncludes(prompt, "Prefer Free tools");
  },
});

Deno.test({
  name:
    "LLM Integration: generateSystemPrompt - includes conciseness directive",
  fn() {
    const prompt = generateSystemPrompt();

    assertStringIncludes(prompt, "Be direct and concise");
    assertStringIncludes(prompt, "No preamble");
  },
});

Deno.test({
  name:
    "LLM Integration: generateSystemPrompt - includes custom instructions when provided",
  fn() {
    const prompt = generateSystemPrompt({
      customInstructions: "Always use tabs for indentation.",
    });

    assertStringIncludes(prompt, "# Custom Instructions");
    assertStringIncludes(prompt, "Always use tabs for indentation.");
  },
});

Deno.test({
  name:
    "LLM Integration: generateSystemPrompt - truncates long custom instructions",
  fn() {
    const longInstructions = "x".repeat(3000);
    const prompt = generateSystemPrompt({
      customInstructions: longInstructions,
    });

    // Should be truncated to 2000 chars
    assertStringIncludes(prompt, "# Custom Instructions");
    assertEquals(prompt.includes("x".repeat(2001)), false);
  },
});

Deno.test({
  name:
    "LLM Integration: generateSystemPrompt - no project section when empty",
  fn() {
    const prompt = generateSystemPrompt();

    assertEquals(prompt.includes("# Project Instructions"), false);
  },
});

// ============================================================
// Model Tier Classification
// ============================================================

Deno.test({
  name: "classifyModelTier - classifies frontier / weak / mid / unknown correctly",
  fn() {
    // Frontier: API-hosted providers override everything
    assertEquals(classifyModelTier(null, true), "frontier");
    assertEquals(classifyModelTier({ parameterSize: "7B" }, true), "frontier");
    // Weak: local models under 13B params
    assertEquals(classifyModelTier({ parameterSize: "7B" }), "weak");
    assertEquals(classifyModelTier({ parameterSize: "3.8B" }), "weak");
    // Mid: local models 13B+
    assertEquals(classifyModelTier({ parameterSize: "13B" }), "mid");
    assertEquals(classifyModelTier({ parameterSize: "70B" }), "mid");
    // Unknown: safe default is mid
    assertEquals(classifyModelTier(null), "mid");
    assertEquals(classifyModelTier(undefined), "mid");
    // Large context window infers frontier
    assertEquals(classifyModelTier({ contextWindow: 128_000 }), "frontier");
  },
});

Deno.test({
  name: "tierMeetsMinimum - weak < mid < frontier ordering",
  fn() {
    // Weak meets weak only
    assertEquals(tierMeetsMinimum("weak", "weak"), true);
    assertEquals(tierMeetsMinimum("weak", "mid"), false);
    assertEquals(tierMeetsMinimum("weak", "frontier"), false);
    // Mid meets weak and mid
    assertEquals(tierMeetsMinimum("mid", "weak"), true);
    assertEquals(tierMeetsMinimum("mid", "mid"), true);
    assertEquals(tierMeetsMinimum("mid", "frontier"), false);
    // Frontier meets all
    assertEquals(tierMeetsMinimum("frontier", "weak"), true);
    assertEquals(tierMeetsMinimum("frontier", "frontier"), true);
  },
});

// ============================================================
// Tier-Conditional System Prompt
// ============================================================

Deno.test({
  name: "generateSystemPrompt - tier filtering: weak gets core + examples, mid/frontier get tips",
  fn() {
    const weak = generateSystemPrompt({ modelTier: "weak" });
    const mid = generateSystemPrompt({ modelTier: "mid" });
    const frontier = generateSystemPrompt({ modelTier: "frontier" });

    // Weak MUST include routing + permissions (they need guidance most)
    assertStringIncludes(weak, "# Tool Selection");
    assertStringIncludes(weak, "# Permission Cost");
    assertStringIncludes(weak, "Do NOT output tool call JSON");
    // Weak now includes concrete examples (high-leverage for weaker models)
    assertStringIncludes(weak, "# Examples");
    assertStringIncludes(weak, "Good:");
    assertStringIncludes(weak, "Bad:");
    // Tips remain mid/frontier only
    assertEquals(weak.includes("# Tips"), false);

    // Mid/frontier include tips
    assertStringIncludes(mid, "# Tips");
    assertStringIncludes(frontier, "# Tips");

    // Frontier also includes examples
    assertStringIncludes(frontier, "# Examples");
    assertStringIncludes(frontier, "Good:");
    assertStringIncludes(frontier, "Bad:");
  },
});

Deno.test({
  name: "generateSystemPrompt - git context renders dirty/clean and omits when absent",
  fn() {
    const withDirty = generateSystemPrompt({
      gitContext: { branch: "feature/test", dirty: true },
    });
    assertStringIncludes(withDirty, "Git: branch=feature/test (dirty)");

    const withClean = generateSystemPrompt({
      gitContext: { branch: "main", dirty: false },
    });
    assertStringIncludes(withClean, "Git: branch=main (clean)");

    const without = generateSystemPrompt();
    assertEquals(without.includes("Git: branch="), false);
  },
});

Deno.test({
  name: "generateSystemPrompt - prompt size grows from weak to mid (frontier >= mid)",
  fn() {
    const weakPrompt = generateSystemPrompt({ modelTier: "weak" });
    const midPrompt = generateSystemPrompt({ modelTier: "mid" });
    const frontierPrompt = generateSystemPrompt({ modelTier: "frontier" });

    assertEquals(weakPrompt.length < midPrompt.length, true);
    assertEquals(frontierPrompt.length >= midPrompt.length, true);
  },
});

// ============================================================
// detectGitContext — Direct Unit Tests
// ============================================================

import { detectGitContext } from "../../../src/hlvm/agent/session.ts";

Deno.test({
  name: "detectGitContext: returns branch and dirty state for a valid git repo",
  // detectGitContext uses Promise.race with a 3s setTimeout — timer leaks when git completes first
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Use the project root (known to be a git repo)
    const result = await detectGitContext(Deno.cwd());
    // Must return non-null for this git repo
    assertEquals(result !== null, true);
    assertEquals(typeof result!.branch, "string");
    assertEquals(result!.branch.length > 0, true);
    assertEquals(typeof result!.dirty, "boolean");
  },
});

Deno.test({
  name: "detectGitContext: returns null for non-git directory",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // /tmp is not a git repo
    const result = await detectGitContext("/tmp");
    assertEquals(result, null);
  },
});

Deno.test({
  name: "detectGitContext: returns null for non-existent directory",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const result = await detectGitContext("/nonexistent-dir-12345");
    assertEquals(result, null);
  },
});
