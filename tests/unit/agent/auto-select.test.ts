import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  buildTaskProfile,
  callLLMWithModelFallback,
  chooseAutoModel,
  filterModels,
  invalidateAutoModelCache,
  isAutoModel,
  type ModelCaps,
  modelInfoToModelCaps,
  scoreModel,
  type TaskProfile,
} from "../../../src/hlvm/agent/auto-select.ts";
import {
  classifyForLocalFallback,
  isLocalFallbackWorthy,
  LOCAL_FALLBACK_MODEL_ID,
} from "../../../src/hlvm/runtime/local-fallback.ts";
import {
  classifyTask,
  classifyFollowUp,
  extractJson,
  getLocalModelDisplayName,
} from "../../../src/hlvm/runtime/local-llm.ts";
import { DEFAULT_MODEL_ID } from "../../../src/common/config/types.ts";
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
// buildTaskProfile (now async — calls classifyTask internally)
// ============================================================

Deno.test("buildTaskProfile: detects image attachment", async () => {
  const profile = await buildTaskProfile("hello", [{ kind: "image" }]);
  assertEquals(profile.hasImage, true);
});

Deno.test("buildTaskProfile: detects image mimeType", async () => {
  const profile = await buildTaskProfile("hello", [
    { mimeType: "image/png" },
  ]);
  assertEquals(profile.hasImage, true);
});

Deno.test("buildTaskProfile: large prompt detection", async () => {
  const largeQuery = "x".repeat(5000);
  const profile = await buildTaskProfile(largeQuery);
  assertEquals(profile.promptIsLarge, true);
});

Deno.test("buildTaskProfile: default profile has no special flags", async () => {
  const profile = await buildTaskProfile("hello");
  assertEquals(profile.hasImage, false);
  assertEquals(profile.promptIsLarge, false);
  assertEquals(profile.preferCheap, false);
  assertEquals(profile.preferQuality, false);
  assertEquals(profile.localOnly, false);
});

Deno.test("buildTaskProfile: policy passthrough", async () => {
  const profile = await buildTaskProfile("hello", undefined, {
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
    reasoning: false,
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
    isCodeTask: false,
    isReasoningTask: false,
    estimatedTokens: 5,
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
// chooseAutoModel (now async)
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

Deno.test("chooseAutoModel: rejects on empty model list", async () => {
  await assertRejects(
    () => chooseAutoModel("hello", undefined, undefined, []),
    Error,
    "No eligible models found",
  );
});

Deno.test("chooseAutoModel: single eligible model returned", async () => {
  const models = [
    makeProviderModelInfo("claude-sonnet-4", "anthropic"),
  ];
  const decision = await chooseAutoModel("hello", undefined, undefined, models);
  assertEquals(decision.model, "anthropic/claude-sonnet-4");
  assertEquals(decision.fallbacks.length, 0);
});

Deno.test("chooseAutoModel: multi-model ranking selects strongest", async () => {
  const models = [
    makeProviderModelInfo("gpt-4o-mini", "openai"),
    makeProviderModelInfo("claude-sonnet-4", "anthropic"),
    makeProviderModelInfo("gpt-4o", "openai"),
  ];
  const decision = await chooseAutoModel("hello", undefined, undefined, models);
  // Both claude-sonnet and gpt-4o are "strong" coding, but claude is preferred by provider order
  assertEquals(
    decision.model === "anthropic/claude-sonnet-4" ||
      decision.model === "openai/gpt-4o",
    true,
  );
  assertEquals(decision.fallbacks.length >= 1, true);
});

Deno.test("chooseAutoModel: image task selects vision model", async () => {
  const models = [
    makeProviderModelInfo("text-only", "openai"),
    makeProviderModelInfo("gpt-4o", "openai", ["chat", "tools", "vision"]),
  ];
  const decision = await chooseAutoModel(
    "describe this image",
    [{ kind: "image" }],
    undefined,
    models,
  );
  assertEquals(decision.model, "openai/gpt-4o");
});

Deno.test("chooseAutoModel: tie-break prefers lower cost then anthropic", async () => {
  const models = [
    makeProviderModelInfo("model-a", "openai", ["chat", "tools"]),
    makeProviderModelInfo("model-b", "anthropic", ["chat", "tools"]),
  ];
  const decision = await chooseAutoModel("hello", undefined, undefined, models);
  // Same score, same cost → anthropic preferred
  assertEquals(decision.model, "anthropic/model-b");
});

// ============================================================
// isLocalFallbackWorthy
// ============================================================

Deno.test("isLocalFallbackWorthy: rate_limit error is fallback-worthy", () => {
  assertEquals(isLocalFallbackWorthy(new Error("rate limit exceeded (429)")), true);
});

Deno.test("isLocalFallbackWorthy: transient network error is fallback-worthy", () => {
  assertEquals(isLocalFallbackWorthy(new Error("ECONNREFUSED")), true);
});

Deno.test("isLocalFallbackWorthy: timeout error is fallback-worthy", () => {
  assertEquals(isLocalFallbackWorthy(new Error("request timeout")), true);
});

Deno.test("isLocalFallbackWorthy: permanent error is not fallback-worthy", () => {
  assertEquals(isLocalFallbackWorthy(new Error("HTTP 401 Unauthorized")), false);
});

Deno.test("isLocalFallbackWorthy: abort error is not fallback-worthy", () => {
  const abortErr = new DOMException("Aborted", "AbortError");
  assertEquals(isLocalFallbackWorthy(abortErr), false);
});

Deno.test("isLocalFallbackWorthy: auth error WITH statusCode is fallback-worthy", () => {
  // Message must match permanent pattern AND have statusCode for the auth-exception path
  const authErr = Object.assign(new Error("HTTP 401 Unauthorized"), { statusCode: 401 });
  assertEquals(isLocalFallbackWorthy(authErr), true);
});

Deno.test("isLocalFallbackWorthy: 403 error WITH statusCode is fallback-worthy", () => {
  const authErr = Object.assign(new Error("HTTP 403 Forbidden"), { statusCode: 403 });
  assertEquals(isLocalFallbackWorthy(authErr), true);
});

Deno.test("isLocalFallbackWorthy: context_overflow is not fallback-worthy", () => {
  assertEquals(isLocalFallbackWorthy(new Error("maximum context length exceeded")), false);
});

Deno.test("classifyForLocalFallback: returns error class string when worthy", () => {
  assertEquals(classifyForLocalFallback(new Error("rate limit exceeded (429)")), "rate_limit");
  assertEquals(classifyForLocalFallback(new Error("ECONNREFUSED")), "transient");
  assertEquals(classifyForLocalFallback(new Error("request timeout")), "timeout");
});

Deno.test("classifyForLocalFallback: returns null when not worthy", () => {
  assertEquals(classifyForLocalFallback(new Error("maximum context length exceeded")), null);
  assertEquals(classifyForLocalFallback(new DOMException("Aborted", "AbortError")), null);
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
      if (model === LOCAL_FALLBACK_MODEL_ID) {
        lastResortCalled = true;
        return Promise.resolve(mockResponse("from-gemma"));
      }
      return Promise.reject(new Error("rate limit exceeded (429)"));
    },
    (fn) => fn([], undefined),
    undefined,
    { model: LOCAL_FALLBACK_MODEL_ID, isAvailable: () => Promise.resolve(true) },
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
      { model: LOCAL_FALLBACK_MODEL_ID, isAvailable: () => Promise.resolve(false) },
    );
    assertEquals(true, false); // should not reach
  } catch (err) {
    assertEquals((err as Error).message, original.message);
  }
});

Deno.test("callLLMWithModelFallback: manual mode (empty fallbacks) goes to last-resort", async () => {
  let lastResortCalled = false;
  const result = await callLLMWithModelFallback(
    () => Promise.reject(new Error("rate limit exceeded (429)")),
    [], // no scored fallbacks (manual mode)
    (model) => () => {
      if (model === LOCAL_FALLBACK_MODEL_ID) {
        lastResortCalled = true;
        return Promise.resolve(mockResponse("from-gemma-manual"));
      }
      return Promise.reject(new Error("unexpected model"));
    },
    (fn) => fn([], undefined),
    undefined,
    { model: LOCAL_FALLBACK_MODEL_ID, isAvailable: () => Promise.resolve(true) },
  );
  assertEquals(lastResortCalled, true);
  assertEquals(result.content, "from-gemma-manual");
});

Deno.test("callLLMWithModelFallback: permanent error skips lastResort even when present", async () => {
  const permError = new Error("HTTP 401 Unauthorized");
  try {
    await callLLMWithModelFallback(
      () => Promise.reject(permError),
      [],
      () => () => Promise.resolve(mockResponse("should not reach")),
      (fn) => fn([], undefined),
      undefined,
      { model: LOCAL_FALLBACK_MODEL_ID, isAvailable: () => Promise.resolve(true) },
    );
    assertEquals(true, false); // should not reach
  } catch (err) {
    assertEquals((err as Error).message, "HTTP 401 Unauthorized");
  }
});

// ============================================================
// Task Detection (buildTaskProfile — now async via LLM)
// ============================================================

Deno.test("buildTaskProfile: estimates tokens from query length", async () => {
  const profile = await buildTaskProfile("hello world"); // 11 chars → ceil(11/4) = 3
  assertEquals(profile.estimatedTokens, 3);
  const large = await buildTaskProfile("x".repeat(400)); // 400 chars → 100
  assertEquals(large.estimatedTokens, 100);
});

// ============================================================
// Enhanced Scoring
// ============================================================

Deno.test("scoreModel: code task gives strong coder +2 bonus", () => {
  const profile = defaultProfile({ isCodeTask: true });
  const strong = makeCaps({ codingStrength: "strong" });
  const mid = makeCaps({ codingStrength: "mid" });
  const diff = scoreModel(strong, profile) - scoreModel(mid, profile);
  // Base diff = 5-2 = 3, plus code bonus +2 for strong only = 5
  assertEquals(diff, 5);
});

Deno.test("scoreModel: reasoning task gives reasoning model +3 bonus", () => {
  const profile = defaultProfile({ isReasoningTask: true });
  const reasoning = makeCaps({ codingStrength: "strong", reasoning: true });
  const noReasoning = makeCaps({ codingStrength: "strong", reasoning: false });
  const diff = scoreModel(reasoning, profile) - scoreModel(noReasoning, profile);
  assertEquals(diff, 3);
});

Deno.test("scoreModel: reasoning model without reasoning task gets no bonus", () => {
  const profile = defaultProfile({ isReasoningTask: false });
  const reasoning = makeCaps({ codingStrength: "strong", reasoning: true });
  const noReasoning = makeCaps({ codingStrength: "strong", reasoning: false });
  assertEquals(scoreModel(reasoning, profile), scoreModel(noReasoning, profile));
});

Deno.test("scoreModel: code task with mid coder gets no bonus", () => {
  const profile = defaultProfile({ isCodeTask: true });
  const midWithCode = scoreModel(makeCaps({ codingStrength: "mid" }), profile);
  const midWithout = scoreModel(
    makeCaps({ codingStrength: "mid" }),
    defaultProfile({ isCodeTask: false }),
  );
  // Mid coders don't get the +2 code bonus (only strong)
  assertEquals(midWithCode, midWithout);
});

Deno.test("scoreModel: long context bonus uses estimatedTokens", () => {
  const profile = defaultProfile({ estimatedTokens: 5000 });
  const longCtx = makeCaps({ longContext: true });
  const shortCtx = makeCaps({ longContext: false });
  assertEquals(scoreModel(longCtx, profile) > scoreModel(shortCtx, profile), true);
});

// ============================================================
// Weak Model Fallback
// ============================================================

Deno.test("filterModels: excludes weak when strong alternatives exist", () => {
  const models = [
    makeCaps({ id: "weak", codingStrength: "weak" }),
    makeCaps({ id: "strong", codingStrength: "strong" }),
  ];
  const result = filterModels(models, defaultProfile());
  assertEquals(result.length, 1);
  assertEquals(result[0].id, "strong");
});

Deno.test("filterModels: includes weak when no strong alternatives (fallback path)", () => {
  const models = [
    makeCaps({ id: "weak-a", codingStrength: "weak" }),
    makeCaps({ id: "weak-b", codingStrength: "weak" }),
  ];
  const result = filterModels(models, defaultProfile());
  // No mid/strong models → weak models included as fallback
  assertEquals(result.length, 2);
});

// ============================================================
// ModelCaps reasoning field
// ============================================================

Deno.test("modelInfoToModelCaps: reasoning detected from override (o1)", () => {
  const caps = modelInfoToModelCaps("openai/o1-preview", makeModelInfo({
    name: "o1-preview",
    capabilities: ["chat", "tools"],
    metadata: { provider: "openai", cloud: true, apiKeyConfigured: true },
  }));
  assertEquals(caps.reasoning, true);
});

Deno.test("modelInfoToModelCaps: reasoning detected from thinking capability", () => {
  const caps = modelInfoToModelCaps("test/model", makeModelInfo({
    name: "some-model",
    capabilities: ["chat", "tools", "thinking"] as ModelInfo["capabilities"],
    metadata: { provider: "test" },
  }));
  assertEquals(caps.reasoning, true);
});

Deno.test("modelInfoToModelCaps: non-reasoning model has reasoning=false", () => {
  const caps = modelInfoToModelCaps("openai/gpt-4o", makeModelInfo({
    name: "gpt-4o",
    capabilities: ["chat", "tools", "vision"],
    metadata: { provider: "openai", cloud: true, apiKeyConfigured: true },
  }));
  assertEquals(caps.reasoning, false);
});

// ============================================================
// Discovery Caching
// ============================================================

Deno.test("invalidateAutoModelCache: exported and callable", () => {
  // Smoke test: invalidateAutoModelCache should not throw
  invalidateAutoModelCache();
});

// ============================================================
// Task-aware scoring (pure — uses pre-built profiles, no LLM dependency)
// ============================================================

Deno.test("scoreModel: code task profile prefers strong coder over mid", () => {
  const profile = defaultProfile({ isCodeTask: true });
  const strong = makeCaps({ id: "anthropic/claude-sonnet-4", codingStrength: "strong" });
  const mid = makeCaps({ id: "openai/gpt-4o-mini", codingStrength: "mid" });
  assertEquals(scoreModel(strong, profile) > scoreModel(mid, profile), true);
});

Deno.test("scoreModel: reasoning task profile prefers reasoning model", () => {
  const profile = defaultProfile({ isReasoningTask: true });
  const reasoning = makeCaps({ id: "openai/o1-preview", codingStrength: "strong", reasoning: true });
  const noReasoning = makeCaps({ id: "openai/gpt-4o", codingStrength: "strong", reasoning: false });
  assertEquals(scoreModel(reasoning, profile) > scoreModel(noReasoning, profile), true);
});

// ============================================================
// local-llm.ts: SSOT & utilities
// ============================================================

Deno.test("DEFAULT_MODEL_ID equals LOCAL_FALLBACK_MODEL_ID (SSOT)", () => {
  assertEquals(DEFAULT_MODEL_ID, LOCAL_FALLBACK_MODEL_ID);
});

Deno.test("getLocalModelDisplayName: derives from SSOT, not hardcoded", () => {
  const name = getLocalModelDisplayName();
  // Should be capitalized first letter, no provider prefix, no tag
  assertEquals(typeof name, "string");
  assertEquals(name.length > 0, true);
  assertEquals(name[0], name[0].toUpperCase());
  // Should not contain "ollama/" or ":"
  assertEquals(name.includes("/"), false);
  assertEquals(name.includes(":"), false);
});

Deno.test("extractJson: extracts JSON from clean input", () => {
  assertEquals(extractJson('{"code":true}'), '{"code":true}');
});

Deno.test("extractJson: strips preamble text", () => {
  assertEquals(
    extractJson('Here is the result: {"code":true,"reasoning":false}'),
    '{"code":true,"reasoning":false}',
  );
});

Deno.test("extractJson: handles markdown fences", () => {
  assertEquals(
    extractJson('```json\n{"code":true}\n```'),
    '{"code":true}',
  );
});

Deno.test("extractJson: returns empty object on no match", () => {
  assertEquals(extractJson("no json here"), "{}");
});

Deno.test("extractJson: returns empty object on empty input", () => {
  assertEquals(extractJson(""), "{}");
});

Deno.test("classifyTask: returns defaults on empty query", async () => {
  const result = await classifyTask("");
  assertEquals(result.isCodeTask, false);
  assertEquals(result.isReasoningTask, false);
  assertEquals(result.needsStructuredOutput, false);
});

Deno.test("classifyFollowUp: returns defaults on empty response", async () => {
  const result = await classifyFollowUp("");
  assertEquals(result.asksFollowUp, false);
  assertEquals(result.isBinaryQuestion, false);
  assertEquals(result.isGenericConversational, false);
});
