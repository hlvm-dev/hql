/**
 * Tests for context-resolver.ts — Dynamic context window budget resolution
 */

import { assertEquals, assertGreater } from "jsr:@std/assert";
import {
  handleContextOverflow,
  resetContextCache,
  resolveContextWindow,
} from "../../../src/hlvm/agent/context-resolver.ts";
import { parseOverflowError as ollamaOverflow } from "../../../src/hlvm/providers/ollama/api.ts";
import { parseOverflowError as openaiOverflow } from "../../../src/hlvm/providers/openai/api.ts";
import { parseOverflowError as anthropicOverflow } from "../../../src/hlvm/providers/anthropic/api.ts";
import { parseOverflowError as googleOverflow } from "../../../src/hlvm/providers/google/api.ts";
import type { ContextOverflowInfo } from "../../../src/hlvm/providers/types.ts";

// Reset cache between tests
function setup() {
  resetContextCache();
}

// ============================================================================
// resolveContextWindow
// ============================================================================

Deno.test("resolveContextWindow: user override takes highest priority", async () => {
  setup();
  const budget = await resolveContextWindow({
    provider: "openai",
    model: "gpt-4o",
    userOverride: 100_000,
    modelInfo: { name: "gpt-4o", contextWindow: 128_000 },
  });
  // User override: 100_000 * 0.85 = 85_000
  assertEquals(budget, 85_000);
});

Deno.test("resolveContextWindow: modelInfo.contextWindow used when no user override", async () => {
  setup();
  const budget = await resolveContextWindow({
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    modelInfo: { name: "claude-sonnet-4-5", contextWindow: 200_000 },
  });
  // 200_000 * 0.85 = 170_000
  assertEquals(budget, 170_000);
});

Deno.test("resolveContextWindow: falls back to 32K default", async () => {
  setup();
  const budget = await resolveContextWindow({
    provider: "unknown",
    model: "mystery-model",
  });
  // 32_000 * 0.85 = 27_200
  assertEquals(budget, 27_200);
});

Deno.test("resolveContextWindow: cache is used on second call", async () => {
  setup();
  // First call seeds the cache from modelInfo
  await resolveContextWindow({
    provider: "ollama",
    model: "llama3.2",
    modelInfo: { name: "llama3.2", contextWindow: 131_072 },
  });
  // Second call WITHOUT modelInfo should still get the cached value
  const budget = await resolveContextWindow({
    provider: "ollama",
    model: "llama3.2",
  });
  // 131_072 * 0.85 = 111_411
  assertEquals(budget, Math.floor(131_072 * 0.85));
});

Deno.test("resolveContextWindow: zero/negative user override is ignored", async () => {
  setup();
  const budget = await resolveContextWindow({
    provider: "openai",
    model: "gpt-4o",
    userOverride: 0,
    modelInfo: { name: "gpt-4o", contextWindow: 128_000 },
  });
  // Should use modelInfo, not the zero override
  assertEquals(budget, Math.floor(128_000 * 0.85));
});

// ============================================================================
// handleContextOverflow
// ============================================================================

Deno.test("handleContextOverflow: high-confidence limit → cache + retry", async () => {
  setup();
  const result = await handleContextOverflow({
    error: new Error("maximum context length is 128000 tokens"),
    provider: "openai",
    model: "gpt-4o",
    parseOverflow: openaiOverflow,
    currentBudget: 200_000,
  });
  assertEquals(result.shouldRetry, true);
  assertEquals(result.newBudget, Math.floor(128_000 * 0.85));
});

Deno.test("handleContextOverflow: low-confidence → reduce by 75%", async () => {
  setup();
  const result = await handleContextOverflow({
    error: new Error("too many tokens in request"),
    provider: "ollama",
    model: "test",
    parseOverflow: (_err: unknown): ContextOverflowInfo => ({
      isOverflow: true,
      confidence: "low",
    }),
    currentBudget: 32_000,
    overflowRetryCount: 0,
  });
  assertEquals(result.shouldRetry, true);
  assertEquals(result.newBudget, Math.floor(32_000 * 0.75));
});

Deno.test("handleContextOverflow: second retry → reduce by 50%", async () => {
  setup();
  const result = await handleContextOverflow({
    error: new Error("too many tokens"),
    provider: "ollama",
    model: "test",
    parseOverflow: (_err: unknown): ContextOverflowInfo => ({
      isOverflow: true,
      confidence: "low",
    }),
    currentBudget: 24_000,
    overflowRetryCount: 1,
  });
  assertEquals(result.shouldRetry, true);
  assertEquals(result.newBudget, Math.floor(24_000 * 0.5));
});

Deno.test("handleContextOverflow: max retries exceeded → no retry", async () => {
  setup();
  const result = await handleContextOverflow({
    error: new Error("context overflow"),
    provider: "test",
    model: "test",
    parseOverflow: (_err: unknown): ContextOverflowInfo => ({
      isOverflow: true,
      confidence: "low",
    }),
    currentBudget: 16_000,
    overflowRetryCount: 2,
  });
  assertEquals(result.shouldRetry, false);
});

Deno.test("handleContextOverflow: non-overflow error → no retry", async () => {
  setup();
  const result = await handleContextOverflow({
    error: new Error("invalid api key"),
    provider: "openai",
    model: "gpt-4o",
    parseOverflow: openaiOverflow,
    currentBudget: 128_000,
  });
  assertEquals(result.shouldRetry, false);
});

// ============================================================================
// Provider Overflow Parsers
// ============================================================================

Deno.test("Ollama parseOverflowError: context_length pattern", () => {
  const info = ollamaOverflow(new Error("context_length is 4096"));
  assertEquals(info.isOverflow, true);
  assertEquals(info.limitTokens, 4096);
  assertEquals(info.confidence, "high");
});

Deno.test("Ollama parseOverflowError: non-overflow error", () => {
  const info = ollamaOverflow(new Error("connection refused"));
  assertEquals(info.isOverflow, false);
});

Deno.test("OpenAI parseOverflowError: maximum context length pattern", () => {
  const info = openaiOverflow(
    new Error("This model's maximum context length is 128000 tokens. However, your messages resulted in 150000 tokens."),
  );
  assertEquals(info.isOverflow, true);
  assertEquals(info.limitTokens, 128000);
  assertEquals(info.confidence, "high");
});

Deno.test("OpenAI parseOverflowError: N tokens > M pattern", () => {
  const info = openaiOverflow(new Error("150000 tokens > 128000 token limit"));
  assertEquals(info.isOverflow, true);
  assertEquals(info.limitTokens, 128000);
  assertEquals(info.confidence, "high");
});

Deno.test("Anthropic parseOverflowError: prompt is too long pattern", () => {
  const info = anthropicOverflow(
    new Error("prompt is too long: 250000 tokens > 200000 token limit"),
  );
  assertEquals(info.isOverflow, true);
  assertEquals(info.limitTokens, 200000);
  assertEquals(info.confidence, "high");
});

Deno.test("Anthropic parseOverflowError: no numbers → low confidence", () => {
  const info = anthropicOverflow(new Error("prompt is too long"));
  assertEquals(info.isOverflow, true);
  assertEquals(info.confidence, "low");
});

Deno.test("Google parseOverflowError: exceeds limit pattern", () => {
  const info = googleOverflow(
    new Error("input token count exceeds the limit 1048576"),
  );
  assertEquals(info.isOverflow, true);
  assertEquals(info.limitTokens, 1048576);
  assertEquals(info.confidence, "high");
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
