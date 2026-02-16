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

Deno.test("All provider KNOWN_MODELS have contextWindow set", async () => {
  const { OpenAIProvider } = await import("../../../src/hlvm/providers/openai/provider.ts");
  const { AnthropicProvider } = await import("../../../src/hlvm/providers/anthropic/provider.ts");
  const { GoogleProvider } = await import("../../../src/hlvm/providers/google/provider.ts");
  const providers = [
    new OpenAIProvider({ apiKey: "" }),
    new AnthropicProvider({ apiKey: "" }),
    new GoogleProvider({ apiKey: "" }),
  ];
  for (const provider of providers) {
    const models = await provider.models.list();
    for (const model of models) {
      assertGreater(model.contextWindow ?? 0, 0, `${model.name} missing contextWindow`);
    }
  }
});
