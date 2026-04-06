import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  buildTaskProfile,
  callLLMWithModelFallback,
  chooseAutoModel,
  filterModels,
  isAutoModel,
  isFallbackWorthy,
  type ModelCaps,
  modelInfoToModelCaps,
  scoreModel,
  type TaskProfile,
} from "../../../src/hlvm/agent/auto-select.ts";
import type { ModelInfo } from "../../../src/hlvm/providers/types.ts";
import type { LLMResponse } from "../../../src/hlvm/agent/tool-call.ts";

// ============================================================
// isAutoModel
// ============================================================

Deno.test("isAutoModel: 'auto' returns true", () => {
  assertEquals(isAutoModel("auto"), true);
});

Deno.test("isAutoModel: 'openai/gpt-4o' returns false", () => {
  assertEquals(isAutoModel("openai/gpt-4o"), false);
});

Deno.test("isAutoModel: 'Auto' (capitalized) returns false", () => {
  assertEquals(isAutoModel("Auto"), false);
});

// ============================================================
// buildTaskProfile
// ============================================================

Deno.test("buildTaskProfile: detects image attachment", () => {
  const profile = buildTaskProfile("hello", [{ kind: "image" }]);
  assertEquals(profile.hasImage, true);
});

Deno.test("buildTaskProfile: detects image mimeType", () => {
  const profile = buildTaskProfile("hello", [
    { mimeType: "image/png" },
  ]);
  assertEquals(profile.hasImage, true);
});

Deno.test("buildTaskProfile: large prompt detection", () => {
  const largeQuery = "x".repeat(5000);
  const profile = buildTaskProfile(largeQuery);
  assertEquals(profile.promptIsLarge, true);
});

Deno.test("buildTaskProfile: default profile has no special flags", () => {
  const profile = buildTaskProfile("hello");
  assertEquals(profile.hasImage, false);
  assertEquals(profile.promptIsLarge, false);
  assertEquals(profile.preferCheap, false);
  assertEquals(profile.preferQuality, false);
  assertEquals(profile.localOnly, false);
});

Deno.test("buildTaskProfile: policy passthrough", () => {
  const profile = buildTaskProfile("hello", undefined, {
    preferCheap: true,
    localOnly: true,
  });
  assertEquals(profile.preferCheap, true);
  assertEquals(profile.localOnly, true);
});

// ============================================================
// modelInfoToModelCaps
// ============================================================

function makeModelInfo(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    name: "test-model",
    capabilities: ["chat", "tools"],
    metadata: { provider: "ollama" },
    ...overrides,
  };
}

Deno.test("modelInfoToModelCaps: ollama model is local", () => {
  const caps = modelInfoToModelCaps("ollama/llama3.2", makeModelInfo({
    name: "llama3.2",
    metadata: { provider: "ollama" },
  }));
  assertEquals(caps.local, true);
  assertEquals(caps.costTier, "free");
});

Deno.test("modelInfoToModelCaps: cloud frontier model", () => {
  const caps = modelInfoToModelCaps("anthropic/claude-sonnet-4", makeModelInfo({
    name: "claude-sonnet-4",
    capabilities: ["chat", "tools", "vision"],
    metadata: { provider: "anthropic", cloud: true },
  }));
  assertEquals(caps.local, false);
  assertEquals(caps.codingStrength, "strong");
  assertEquals(caps.vision, true);
});

Deno.test("modelInfoToModelCaps: unknown model gets safe defaults", () => {
  const caps = modelInfoToModelCaps("openai/unknown-model-xyz", makeModelInfo({
    name: "unknown-model-xyz",
    metadata: { provider: "openai", cloud: true },
  }));
  assertEquals(caps.costTier, "mid");
  assertEquals(caps.codingStrength, "strong"); // frontier provider → strong
});

Deno.test("modelInfoToModelCaps: vision capability detected", () => {
  const caps = modelInfoToModelCaps("test/model", makeModelInfo({
    capabilities: ["chat", "tools", "vision"],
  }));
  assertEquals(caps.vision, true);
});

Deno.test("modelInfoToModelCaps: long context detected", () => {
  const caps = modelInfoToModelCaps("test/model", makeModelInfo({
    contextWindow: 200_000,
  }));
  assertEquals(caps.longContext, true);
});

// ============================================================
// filterModels
// ============================================================

function makeCaps(overrides: Partial<ModelCaps> = {}): ModelCaps {
  return {
    id: "test/model",
    provider: "test",
    vision: false,
    longContext: false,
    structuredOutput: false,
    toolCalling: true,
    local: false,
    costTier: "mid",
    codingStrength: "mid",
    apiKeyConfigured: true,
    ...overrides,
  };
}

function defaultProfile(overrides: Partial<TaskProfile> = {}): TaskProfile {
  return {
    hasImage: false,
    promptIsLarge: false,
    preferCheap: false,
    preferQuality: false,
    localOnly: false,
    noUpload: false,
    needsStructuredOutput: false,
    ...overrides,
  };
}

Deno.test("filterModels: image requirement filters non-vision models", () => {
  const models = [
    makeCaps({ id: "a", vision: true }),
    makeCaps({ id: "b", vision: false }),
  ];
  const result = filterModels(models, defaultProfile({ hasImage: true }));
  assertEquals(result.length, 1);
  assertEquals(result[0].id, "a");
});

Deno.test("filterModels: localOnly filters cloud models", () => {
  const models = [
    makeCaps({ id: "a", local: true }),
    makeCaps({ id: "b", local: false }),
  ];
  const result = filterModels(models, defaultProfile({ localOnly: true }));
  assertEquals(result.length, 1);
  assertEquals(result[0].id, "a");
});

Deno.test("filterModels: weak coding strength filtered out", () => {
  const models = [
    makeCaps({ id: "a", codingStrength: "weak" }),
    makeCaps({ id: "b", codingStrength: "mid" }),
  ];
  const result = filterModels(models, defaultProfile());
  assertEquals(result.length, 1);
  assertEquals(result[0].id, "b");
});

Deno.test("filterModels: tool-calling required", () => {
  const models = [
    makeCaps({ id: "a", toolCalling: false }),
    makeCaps({ id: "b", toolCalling: true }),
  ];
  const result = filterModels(models, defaultProfile());
  assertEquals(result.length, 1);
  assertEquals(result[0].id, "b");
});

// ============================================================
// scoreModel
// ============================================================

Deno.test("scoreModel: vision bonus when needed", () => {
  const profile = defaultProfile({ hasImage: true });
  const withVision = makeCaps({ vision: true, codingStrength: "mid" });
  const noVision = makeCaps({ vision: false, codingStrength: "mid" });
  const scoreWith = scoreModel(withVision, profile);
  const scoreWithout = scoreModel(noVision, profile);
  assertEquals(scoreWith > scoreWithout, true);
});

Deno.test("scoreModel: cheap preference boosts free/cheap tiers", () => {
  const profile = defaultProfile({ preferCheap: true });
  const cheap = makeCaps({ costTier: "free", codingStrength: "mid" });
  const premium = makeCaps({ costTier: "premium", codingStrength: "mid" });
  assertEquals(scoreModel(cheap, profile) > scoreModel(premium, profile), true);
});

Deno.test("scoreModel: coding strength matters", () => {
  const profile = defaultProfile();
  const strong = makeCaps({ codingStrength: "strong" });
  const mid = makeCaps({ codingStrength: "mid" });
  assertEquals(scoreModel(strong, profile) > scoreModel(mid, profile), true);
});

Deno.test("scoreModel: quality preference doubles coding weight", () => {
  const profile = defaultProfile({ preferQuality: true });
  const strong = makeCaps({ codingStrength: "strong" });
  const mid = makeCaps({ codingStrength: "mid" });
  const diff = scoreModel(strong, profile) - scoreModel(mid, profile);
  // Without preferQuality: diff = 5-2 = 3
  // With preferQuality: diff = 10-4 = 6
  assertEquals(diff > 3, true);
});

// ============================================================
// chooseAutoModel
// ============================================================

function makeProviderModelInfo(
  name: string,
  provider: string,
  caps: string[] = ["chat", "tools"],
  extra: Partial<ModelInfo> = {},
): ModelInfo {
  return {
    name,
    capabilities: caps as ModelInfo["capabilities"],
    metadata: {
      provider,
      cloud: provider !== "ollama",
      apiKeyConfigured: true,
    },
    ...extra,
  };
}

Deno.test("chooseAutoModel: throws on empty model list", () => {
  assertThrows(
    () => chooseAutoModel("hello", undefined, undefined, []),
    Error,
    "No eligible models found",
  );
});

Deno.test("chooseAutoModel: single eligible model returned", () => {
  const models = [
    makeProviderModelInfo("claude-sonnet-4", "anthropic"),
  ];
  const decision = chooseAutoModel("hello", undefined, undefined, models);
  assertEquals(decision.model, "anthropic/claude-sonnet-4");
  assertEquals(decision.fallbacks.length, 0);
});

Deno.test("chooseAutoModel: multi-model ranking selects strongest", () => {
  const models = [
    makeProviderModelInfo("gpt-4o-mini", "openai"),
    makeProviderModelInfo("claude-sonnet-4", "anthropic"),
    makeProviderModelInfo("gpt-4o", "openai"),
  ];
  const decision = chooseAutoModel("hello", undefined, undefined, models);
  // Both claude-sonnet and gpt-4o are "strong" coding, but claude is preferred by provider order
  assertEquals(
    decision.model === "anthropic/claude-sonnet-4" ||
      decision.model === "openai/gpt-4o",
    true,
  );
  assertEquals(decision.fallbacks.length >= 1, true);
});

Deno.test("chooseAutoModel: image task selects vision model", () => {
  const models = [
    makeProviderModelInfo("text-only", "openai"),
    makeProviderModelInfo("gpt-4o", "openai", ["chat", "tools", "vision"]),
  ];
  const decision = chooseAutoModel(
    "describe this image",
    [{ kind: "image" }],
    undefined,
    models,
  );
  assertEquals(decision.model, "openai/gpt-4o");
});

Deno.test("chooseAutoModel: tie-break prefers lower cost then anthropic", () => {
  const models = [
    makeProviderModelInfo("model-a", "openai", ["chat", "tools"]),
    makeProviderModelInfo("model-b", "anthropic", ["chat", "tools"]),
  ];
  const decision = chooseAutoModel("hello", undefined, undefined, models);
  // Same score, same cost → anthropic preferred
  assertEquals(decision.model, "anthropic/model-b");
});

// ============================================================
// isFallbackWorthy
// ============================================================

Deno.test("isFallbackWorthy: rate_limit is fallback-worthy", () => {
  assertEquals(isFallbackWorthy("rate_limit"), true);
});

Deno.test("isFallbackWorthy: transient is fallback-worthy", () => {
  assertEquals(isFallbackWorthy("transient"), true);
});

Deno.test("isFallbackWorthy: timeout is fallback-worthy", () => {
  assertEquals(isFallbackWorthy("timeout"), true);
});

Deno.test("isFallbackWorthy: permanent is not fallback-worthy", () => {
  assertEquals(isFallbackWorthy("permanent"), false);
});

Deno.test("isFallbackWorthy: abort is not fallback-worthy", () => {
  assertEquals(isFallbackWorthy("abort"), false);
});

// ============================================================
// callLLMWithModelFallback
// ============================================================

function mockResponse(content: string): LLMResponse {
  return { content, toolCalls: [] };
}

Deno.test("callLLMWithModelFallback: primary success returns immediately", async () => {
  const result = await callLLMWithModelFallback(
    () => Promise.resolve(mockResponse("ok")),
    ["fallback-1"],
    () => () => Promise.resolve(mockResponse("fallback")),
    (fn) => fn([], undefined),
  );
  assertEquals(result.content, "ok");
});

Deno.test("callLLMWithModelFallback: falls back on transient error", async () => {
  const transientError = new Error("rate limit exceeded (429)");
  let fallbackCalled = false;
  const result = await callLLMWithModelFallback(
    () => Promise.reject(transientError),
    ["fallback-1"],
    () => () => {
      fallbackCalled = true;
      return Promise.resolve(mockResponse("from-fallback"));
    },
    (fn) => fn([], undefined),
  );
  assertEquals(fallbackCalled, true);
  assertEquals(result.content, "from-fallback");
});

Deno.test("callLLMWithModelFallback: no fallback on permanent error", async () => {
  const permError = new Error("HTTP 401 Unauthorized");

  try {
    await callLLMWithModelFallback(
      () => Promise.reject(permError),
      ["fallback-1"],
      () => () => Promise.resolve(mockResponse("should not reach")),
      (fn) => fn([], undefined),
    );
    assertEquals(true, false); // should not reach
  } catch (err) {
    assertEquals((err as Error).message, "HTTP 401 Unauthorized");
  }
});

Deno.test("callLLMWithModelFallback: all fallbacks exhausted throws original error", async () => {
  const original = new Error("rate limit exceeded (429)");
  let callCount = 0;

  try {
    await callLLMWithModelFallback(
      () => Promise.reject(original),
      ["fb-1", "fb-2"],
      () => () => {
        callCount++;
        return Promise.reject(new Error("rate limit exceeded (429)"));
      },
      (fn) => fn([], undefined),
    );
    assertEquals(true, false); // should not reach
  } catch (err) {
    assertEquals(callCount, 2); // both fallbacks tried
    assertEquals((err as Error).message, original.message);
  }
});

Deno.test("callLLMWithModelFallback: last-resort local model tried when all fallbacks fail", async () => {
  let lastResortCalled = false;
  const result = await callLLMWithModelFallback(
    () => Promise.reject(new Error("rate limit exceeded (429)")),
    ["fb-1"],
    (model) => () => {
      if (model === "ollama/gemma4:e4b") {
        lastResortCalled = true;
        return Promise.resolve(mockResponse("from-gemma"));
      }
      return Promise.reject(new Error("rate limit exceeded (429)"));
    },
    (fn) => fn([], undefined),
    undefined,
    { model: "ollama/gemma4:e4b", isAvailable: () => Promise.resolve(true) },
  );
  assertEquals(lastResortCalled, true);
  assertEquals(result.content, "from-gemma");
});

Deno.test("callLLMWithModelFallback: last-resort skipped when not available", async () => {
  const original = new Error("rate limit exceeded (429)");
  try {
    await callLLMWithModelFallback(
      () => Promise.reject(original),
      [],
      () => () => Promise.resolve(mockResponse("should not reach")),
      (fn) => fn([], undefined),
      undefined,
      { model: "ollama/gemma4:e4b", isAvailable: () => Promise.resolve(false) },
    );
    assertEquals(true, false); // should not reach
  } catch (err) {
    assertEquals((err as Error).message, original.message);
  }
});
