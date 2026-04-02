/**
 * Tests for context-resolver.ts — Simple context window budget resolution
 */

import { assertEquals, assertGreater } from "jsr:@std/assert";
import {
  resolveContextBudget,
} from "../../../src/hlvm/agent/context-resolver.ts";
import {
  DEFAULT_CONTEXT_WINDOW,
  OUTPUT_RESERVE_TOKENS,
} from "../../../src/hlvm/agent/constants.ts";

// ============================================================================
// resolveContextBudget — priority chain
// ============================================================================

Deno.test("resolveContextBudget: user override takes highest priority", () => {
  const result = resolveContextBudget({
    userOverride: 100_000,
    modelInfo: { name: "gpt-4o", contextWindow: 128_000 },
  });
  assertEquals(result.budget, 100_000 - OUTPUT_RESERVE_TOKENS);
  assertEquals(result.rawLimit, 100_000);
  assertEquals(result.source, "user_override");
});

Deno.test("resolveContextBudget: modelInfo.contextWindow used when no user override", () => {
  const result = resolveContextBudget({
    modelInfo: { name: "claude-sonnet-4-5", contextWindow: 200_000 },
  });
  assertEquals(result.budget, 200_000 - OUTPUT_RESERVE_TOKENS);
  assertEquals(result.rawLimit, 200_000);
  assertEquals(result.source, "model_info");
});

Deno.test("resolveContextBudget: falls back to DEFAULT_CONTEXT_WINDOW", () => {
  const result = resolveContextBudget({});
  assertEquals(result.budget, DEFAULT_CONTEXT_WINDOW - OUTPUT_RESERVE_TOKENS);
  assertEquals(result.rawLimit, DEFAULT_CONTEXT_WINDOW);
  assertEquals(result.source, "default");
});

Deno.test("resolveContextBudget: zero user override is ignored", () => {
  const result = resolveContextBudget({
    userOverride: 0,
    modelInfo: { name: "gpt-4o", contextWindow: 128_000 },
  });
  assertEquals(result.budget, 128_000 - OUTPUT_RESERVE_TOKENS);
  assertEquals(result.source, "model_info");
});

Deno.test("resolveContextBudget: negative user override is ignored", () => {
  const result = resolveContextBudget({
    userOverride: -100,
  });
  assertEquals(result.source, "default");
});

// ============================================================================
// Absolute reserve math
// ============================================================================

Deno.test("resolveContextBudget: absolute reserve math for 128K model", () => {
  const result = resolveContextBudget({
    modelInfo: { name: "gpt-4o", contextWindow: 128_000 },
  });
  assertEquals(result.budget, 128_000 - 4096);
  assertEquals(result.budget, 123_904);
});

Deno.test("resolveContextBudget: budget floor is 0 for tiny user override", () => {
  const result = resolveContextBudget({
    userOverride: 1000,
  });
  // 1000 - 4096 would be negative, so floor at 0
  assertEquals(result.budget, 0);
  assertEquals(result.source, "user_override");
});

Deno.test("resolveContextBudget: small modelInfo contextWindow falls through to fallback", () => {
  // Ollama reports default loaded context (e.g. 4096) which would give budget=0
  // Resolver should fall through to 32K fallback instead
  const result = resolveContextBudget({
    modelInfo: { name: "llama3.1:8b", contextWindow: 4096 },
  });
  assertEquals(result.budget, DEFAULT_CONTEXT_WINDOW - OUTPUT_RESERVE_TOKENS);
  assertEquals(result.source, "default");
});

// ============================================================================
// ContextManager getMaxTokens / setMaxTokens / trimToFit
// ============================================================================

Deno.test("ContextManager: get/setMaxTokens roundtrip", async () => {
  const { ContextManager } = await import("../../../src/hlvm/agent/context.ts");
  const ctx = new ContextManager({ maxTokens: 50_000 });
  assertEquals(ctx.getMaxTokens(), 50_000);
  ctx.setMaxTokens(128_000);
  assertEquals(ctx.getMaxTokens(), 128_000);
});

Deno.test("ContextManager: trimToFit trims context after budget reduction", async () => {
  const { ContextManager } = await import("../../../src/hlvm/agent/context.ts");
  const ctx = new ContextManager({ maxTokens: 100_000, preserveSystem: true, minMessages: 1 });
  ctx.addMessage({ role: "system", content: "sys" });
  // 3 messages of 20K chars each = 60K chars ≈ 15K tokens — fits in 100K
  ctx.addMessage({ role: "user", content: "A".repeat(20_000) });
  ctx.addMessage({ role: "assistant", content: "B".repeat(20_000) });
  ctx.addMessage({ role: "user", content: "C".repeat(20_000) });
  // Reduce budget to 6K tokens — context has ~15K tokens, needs trimming
  ctx.setMaxTokens(6_000);
  assertEquals(ctx.needsTrimming(), true);
  // trimToFit should drop old messages to fit the reduced budget
  ctx.trimToFit();
  assertEquals(ctx.needsTrimming(), false);
  // Should have kept system + minMessages(1) recent message
  assertEquals(ctx.getMessages().length, 2);
});

// ============================================================================
// KNOWN_MODELS contextWindow across all providers
// ============================================================================

Deno.test("resolveContextBudget: models with contextWindow use model_info source", () => {
  // Representative models across providers — tests the LOGIC that any model
  // with a valid contextWindow gets "model_info" source, not specific model lists.
  const representativeModels = [
    { name: "gpt-4o", contextWindow: 128_000 },
    { name: "claude-sonnet-4-5", contextWindow: 200_000 },
    { name: "gemini-2.0-flash", contextWindow: 1_000_000 },
    { name: "llama3.1:70b", contextWindow: 131_072 },
  ];
  for (const model of representativeModels) {
    const result = resolveContextBudget({ modelInfo: model });
    assertEquals(result.source, "model_info", `${model.name} should use model_info source`);
    assertGreater(result.budget, 0, `${model.name} should have positive budget`);
    assertEquals(result.rawLimit, model.contextWindow, `${model.name} rawLimit should equal contextWindow`);
  }
});

Deno.test("resolveContextBudget: models without contextWindow fall back to default", () => {
  // When a model has no contextWindow (or it's too small), the resolver must
  // fall back gracefully — this is the critical safety net being tested.
  const modelsWithoutWindow = [
    { name: "unknown-model" },
    { name: "custom-finetune", contextWindow: undefined },
    { name: "ollama-tiny", contextWindow: 0 },
    { name: "ollama-default-ctx", contextWindow: 4096 }, // <= OUTPUT_RESERVE_TOKENS
  ];
  for (const model of modelsWithoutWindow) {
    const result = resolveContextBudget({
      modelInfo: model as { name: string; contextWindow?: number },
    });
    assertEquals(result.source, "default", `${model.name} should fall back to default`);
    assertEquals(result.rawLimit, DEFAULT_CONTEXT_WINDOW, `${model.name} should use DEFAULT_CONTEXT_WINDOW`);
  }
});
