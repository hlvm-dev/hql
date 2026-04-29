import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  __clearAutoModelFailureCooldownsForTesting,
  __setListAllProviderModelsForTesting,
  buildTaskProfile,
  callLLMWithModelFallback,
  chooseAutoModel,
  filterModels,
  invalidateAutoModelCache,
  isAutoModel,
  type ModelCaps,
  modelInfoToModelCaps,
  recordAutoModelFailure,
  resolveAutoModel,
  scoreModel,
  type TaskProfile,
} from "../../../src/hlvm/agent/auto-select.ts";
import {
  classifyForLocalFallback,
  isLocalFallbackWorthy,
  LOCAL_FALLBACK_MODEL_ID,
  withFallbackChain,
} from "../../../src/hlvm/runtime/local-fallback.ts";
import {
  classifyTask,
  extractJson,
  getLocalModelDisplayName,
} from "../../../src/hlvm/runtime/local-llm.ts";
import { DEFAULT_MODEL_ID } from "../../../src/common/config/types.ts";
import type { ModelInfo } from "../../../src/hlvm/providers/types.ts";
import type { LLMResponse } from "../../../src/hlvm/agent/tool-call.ts";

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

Deno.test("buildTaskProfile: uses precomputed task classification when provided", async () => {
  const profile = await buildTaskProfile(
    "implement a JSON formatter",
    undefined,
    undefined,
    {
      isCodeTask: true,
      isReasoningTask: false,
      needsStructuredOutput: true,
    },
  );
  assertEquals(profile.isCodeTask, true);
  assertEquals(profile.isReasoningTask, false);
  assertEquals(profile.needsStructuredOutput, true);
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
  const caps = modelInfoToModelCaps(
    "ollama/llama3.2",
    makeModelInfo({
      name: "llama3.2",
      metadata: { provider: "ollama" },
    }),
  );
  assertEquals(caps.local, true);
  assertEquals(caps.costTier, "free");
});

Deno.test("modelInfoToModelCaps: cloud frontier model", () => {
  const caps = modelInfoToModelCaps(
    "anthropic/claude-sonnet-4",
    makeModelInfo({
      name: "claude-sonnet-4",
      capabilities: ["chat", "tools", "vision"],
      metadata: { provider: "anthropic", cloud: true },
    }),
  );
  assertEquals(caps.local, false);
  assertEquals(caps.codingStrength, "strong");
  assertEquals(caps.vision, true);
});

Deno.test("modelInfoToModelCaps: unknown model gets safe defaults", () => {
  const caps = modelInfoToModelCaps(
    "openai/unknown-model-xyz",
    makeModelInfo({
      name: "unknown-model-xyz",
      metadata: { provider: "openai", cloud: true },
    }),
  );
  assertEquals(caps.costTier, "mid");
  assertEquals(caps.codingStrength, "strong"); // frontier provider → strong
});

Deno.test("modelInfoToModelCaps: vision capability detected", () => {
  const caps = modelInfoToModelCaps(
    "test/model",
    makeModelInfo({
      capabilities: ["chat", "tools", "vision"],
    }),
  );
  assertEquals(caps.vision, true);
});

Deno.test("modelInfoToModelCaps: long context detected", () => {
  const caps = modelInfoToModelCaps(
    "test/model",
    makeModelInfo({
      contextWindow: 200_000,
    }),
  );
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

Deno.test("isLocalFallbackWorthy: rate_limit error is fallback-worthy", async () => {
  assertEquals(
    await isLocalFallbackWorthy(new Error("rate limit exceeded (429)")),
    true,
  );
});

Deno.test("isLocalFallbackWorthy: transient network error is fallback-worthy", async () => {
  assertEquals(await isLocalFallbackWorthy(new Error("ECONNREFUSED")), true);
});

Deno.test("isLocalFallbackWorthy: timeout error is fallback-worthy", async () => {
  assertEquals(
    await isLocalFallbackWorthy(new Error("request timed out after 30s")),
    true,
  );
});

Deno.test("isLocalFallbackWorthy: invalid request permanent error is not fallback-worthy", async () => {
  assertEquals(
    await isLocalFallbackWorthy(new Error("HTTP 400 Bad Request")),
    false,
  );
});

Deno.test("isLocalFallbackWorthy: abort error is not fallback-worthy", async () => {
  const abortErr = new DOMException("Aborted", "AbortError");
  assertEquals(await isLocalFallbackWorthy(abortErr), false);
});

Deno.test("isLocalFallbackWorthy: auth error WITH statusCode is fallback-worthy", async () => {
  // Message must match permanent pattern AND have statusCode for the auth-exception path
  const authErr = Object.assign(new Error("HTTP 401 Unauthorized"), {
    statusCode: 401,
  });
  assertEquals(await isLocalFallbackWorthy(authErr), true);
});

Deno.test("isLocalFallbackWorthy: auth/quota permanent messages are fallback-worthy", async () => {
  assertEquals(
    await isLocalFallbackWorthy(new Error("HTTP 401 Unauthorized")),
    true,
  );
  assertEquals(
    await isLocalFallbackWorthy(
      new Error("exceeded your current quota; insufficient_quota"),
    ),
    true,
  );
});

Deno.test("isLocalFallbackWorthy: 403 error WITH statusCode is fallback-worthy", async () => {
  const authErr = Object.assign(new Error("HTTP 403 Forbidden"), {
    statusCode: 403,
  });
  assertEquals(await isLocalFallbackWorthy(authErr), true);
});

Deno.test("isLocalFallbackWorthy: context_overflow is not fallback-worthy", async () => {
  assertEquals(
    await isLocalFallbackWorthy(new Error("maximum context length exceeded")),
    false,
  );
});

Deno.test("classifyForLocalFallback: returns error class string when worthy", async () => {
  assertEquals(
    await classifyForLocalFallback(new Error("rate limit exceeded (429)")),
    "rate_limit",
  );
  assertEquals(
    await classifyForLocalFallback(new Error("ECONNREFUSED")),
    "transient",
  );
  assertEquals(
    await classifyForLocalFallback(new Error("request timed out after 30s")),
    "timeout",
  );
});

Deno.test("classifyForLocalFallback: returns null when not worthy", async () => {
  assertEquals(
    await classifyForLocalFallback(
      new Error("maximum context length exceeded"),
    ),
    null,
  );
  assertEquals(
    await classifyForLocalFallback(new DOMException("Aborted", "AbortError")),
    null,
  );
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

Deno.test("callLLMWithModelFallback: degraded path tries fallbacks when no last-resort", async () => {
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

Deno.test("callLLMWithModelFallback: no fallback on invalid-request permanent error", async () => {
  const permError = new Error("HTTP 400 Bad Request: invalid request");

  try {
    await callLLMWithModelFallback(
      () => Promise.reject(permError),
      ["fallback-1"],
      () => () => Promise.resolve(mockResponse("should not reach")),
      (fn) => fn([], undefined),
    );
    assertEquals(true, false); // should not reach
  } catch (err) {
    assertEquals((err as Error).message, permError.message);
  }
});

Deno.test("callLLMWithModelFallback: degraded path exhausted throws original error", async () => {
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
    assertEquals(callCount, 2); // both fallbacks tried (no last-resort available)
    assertEquals((err as Error).message, original.message);
  }
});

Deno.test("callLLMWithModelFallback: last-resort used immediately when available", async () => {
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
    {
      model: LOCAL_FALLBACK_MODEL_ID,
      isAvailable: () => Promise.resolve(true),
    },
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
      {
        model: LOCAL_FALLBACK_MODEL_ID,
        isAvailable: () => Promise.resolve(false),
      },
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
    {
      model: LOCAL_FALLBACK_MODEL_ID,
      isAvailable: () => Promise.resolve(true),
    },
  );
  assertEquals(lastResortCalled, true);
  assertEquals(result.content, "from-gemma-manual");
});

Deno.test("callLLMWithModelFallback: invalid-request permanent error skips lastResort even when present", async () => {
  const permError = new Error("HTTP 400 Bad Request: invalid request");
  try {
    await callLLMWithModelFallback(
      () => Promise.reject(permError),
      [],
      () => () => Promise.resolve(mockResponse("should not reach")),
      (fn) => fn([], undefined),
      undefined,
      {
        model: LOCAL_FALLBACK_MODEL_ID,
        isAvailable: () => Promise.resolve(true),
      },
    );
    assertEquals(true, false); // should not reach
  } catch (err) {
    assertEquals((err as Error).message, permError.message);
  }
});

Deno.test("callLLMWithModelFallback: local-unavailable error names concrete primary model", async () => {
  await assertRejects(
    () =>
      callLLMWithModelFallback(
        () => Promise.reject(new Error("rate limit exceeded (429)")),
        [],
        () => () => Promise.resolve(mockResponse("should not reach")),
        (fn) => fn([], undefined),
        undefined,
        {
          model: LOCAL_FALLBACK_MODEL_ID,
          isAvailable: () => Promise.resolve(false),
        },
        "anthropic/claude-sonnet-4",
      ),
    Error,
    "Model anthropic/claude-sonnet-4 failed, and local",
  );
});

// ============================================================
// withFallbackChain (SSOT — local-fallback.ts)
// ============================================================

Deno.test("withFallbackChain: any error skips cloud fallbacks when last-resort ready", async () => {
  for (
    const errorMsg of [
      "rate limit exceeded (429)",
      "Connection reset (ECONNRESET)",
      "Request timed out after 30s",
    ]
  ) {
    let fallbackCallCount = 0;
    let lastResortCalled = false;

    const result = await withFallbackChain<string>({
      tryPrimary: () => Promise.reject(new Error(errorMsg)),
      fallbacks: ["cloud-fb-1", "cloud-fb-2"],
      tryFallback: () => {
        fallbackCallCount++;
        return Promise.reject(new Error("should not reach"));
      },
      lastResort: {
        model: LOCAL_FALLBACK_MODEL_ID,
        isAvailable: () => Promise.resolve(true),
      },
      tryLastResort: () => {
        lastResortCalled = true;
        return Promise.resolve("from-gemma");
      },
    });

    assertEquals(
      fallbackCallCount,
      0,
      `cloud fallbacks skipped for: ${errorMsg}`,
    );
    assertEquals(lastResortCalled, true);
    assertEquals(result, "from-gemma");
  }
});

Deno.test("withFallbackChain: tries cloud fallbacks when last-resort unavailable", async () => {
  let fallbackCallCount = 0;

  const result = await withFallbackChain<string>({
    tryPrimary: () =>
      Promise.reject(new Error("Connection reset (ECONNRESET)")),
    fallbacks: ["cloud-fb-1"],
    tryFallback: () => {
      fallbackCallCount++;
      return Promise.resolve("fallback-ok");
    },
    lastResort: {
      model: LOCAL_FALLBACK_MODEL_ID,
      isAvailable: () => Promise.resolve(false),
    },
  });

  assertEquals(
    fallbackCallCount,
    1,
    "cloud fallback tried when last-resort unavailable",
  );
  assertEquals(result, "fallback-ok");
});

Deno.test("withFallbackChain: canFallback=false blocks fallback after worthy failure", async () => {
  let fallbackCalled = false;
  try {
    await withFallbackChain<string>({
      tryPrimary: () =>
        Promise.reject(new Error("Connection reset (ECONNRESET)")),
      fallbacks: ["cloud-fb-1"],
      canFallback: () => false,
      tryFallback: () => {
        fallbackCalled = true;
        return Promise.resolve("should not reach");
      },
      lastResort: {
        model: LOCAL_FALLBACK_MODEL_ID,
        isAvailable: () => Promise.resolve(true),
      },
    });
    assertEquals(true, false);
  } catch (err) {
    assertEquals((err as Error).message, "Connection reset (ECONNRESET)");
    assertEquals(fallbackCalled, false);
  }
});

Deno.test("withFallbackChain: onLastResortUnavailable called when chain exhausted", async () => {
  try {
    await withFallbackChain<string>({
      tryPrimary: () => Promise.reject(new Error("rate limit exceeded (429)")),
      fallbacks: [],
      tryFallback: () => Promise.reject(new Error("unreachable")),
      lastResort: {
        model: LOCAL_FALLBACK_MODEL_ID,
        isAvailable: () => Promise.resolve(false),
      },
      onLastResortUnavailable: () => {
        throw new Error("gemma4 still preparing");
      },
    });
    assertEquals(true, false); // should not reach
  } catch (err) {
    assertEquals((err as Error).message, "gemma4 still preparing");
  }
});

Deno.test("withFallbackChain: permanent error throws immediately, no fallback", async () => {
  let fallbackCalled = false;
  try {
    await withFallbackChain<string>({
      tryPrimary: () => Promise.reject(new Error("invalid request format")),
      fallbacks: ["cloud-fb-1"],
      tryFallback: () => {
        fallbackCalled = true;
        return Promise.resolve("should not reach");
      },
      lastResort: {
        model: LOCAL_FALLBACK_MODEL_ID,
        isAvailable: () => Promise.resolve(true),
      },
    });
    assertEquals(true, false);
  } catch {
    assertEquals(fallbackCalled, false, "no fallback for permanent errors");
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
  const diff = scoreModel(reasoning, profile) -
    scoreModel(noReasoning, profile);
  assertEquals(diff, 3);
});

Deno.test("scoreModel: reasoning model without reasoning task gets no bonus", () => {
  const profile = defaultProfile({ isReasoningTask: false });
  const reasoning = makeCaps({ codingStrength: "strong", reasoning: true });
  const noReasoning = makeCaps({ codingStrength: "strong", reasoning: false });
  assertEquals(
    scoreModel(reasoning, profile),
    scoreModel(noReasoning, profile),
  );
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
  assertEquals(
    scoreModel(longCtx, profile) > scoreModel(shortCtx, profile),
    true,
  );
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
  const caps = modelInfoToModelCaps(
    "openai/o1-preview",
    makeModelInfo({
      name: "o1-preview",
      capabilities: ["chat", "tools"],
      metadata: { provider: "openai", cloud: true, apiKeyConfigured: true },
    }),
  );
  assertEquals(caps.reasoning, true);
});

Deno.test("modelInfoToModelCaps: reasoning detected from thinking capability", () => {
  const caps = modelInfoToModelCaps(
    "test/model",
    makeModelInfo({
      name: "some-model",
      capabilities: ["chat", "tools", "thinking"] as ModelInfo["capabilities"],
      metadata: { provider: "test" },
    }),
  );
  assertEquals(caps.reasoning, true);
});

Deno.test("modelInfoToModelCaps: non-reasoning model has reasoning=false", () => {
  const caps = modelInfoToModelCaps(
    "openai/gpt-4o",
    makeModelInfo({
      name: "gpt-4o",
      capabilities: ["chat", "tools", "vision"],
      metadata: { provider: "openai", cloud: true, apiKeyConfigured: true },
    }),
  );
  assertEquals(caps.reasoning, false);
});

// ============================================================
// Discovery Caching
// ============================================================

Deno.test("invalidateAutoModelCache: exported and callable", () => {
  // Smoke test: invalidateAutoModelCache should not throw
  invalidateAutoModelCache();
});

Deno.test("resolveAutoModel: concurrent callers share a single provider-list fetch", async () => {
  invalidateAutoModelCache();
  const deferred = createDeferred<ModelInfo[]>();
  let calls = 0;
  __setListAllProviderModelsForTesting(async () => {
    calls++;
    return await deferred.promise;
  });
  try {
    const first = resolveAutoModel("hello");
    const second = resolveAutoModel("hello");
    deferred.resolve([
      makeProviderModelInfo("claude-sonnet-4", "anthropic"),
    ]);
    const [a, b] = await Promise.all([first, second]);
    assertEquals(calls, 1);
    assertEquals(a.model, "anthropic/claude-sonnet-4");
    assertEquals(b.model, "anthropic/claude-sonnet-4");
  } finally {
    __setListAllProviderModelsForTesting(null);
  }
});

Deno.test("resolveAutoModel: failed fetch clears pending state for retry", async () => {
  invalidateAutoModelCache();
  let calls = 0;
  let failOnce = true;
  __setListAllProviderModelsForTesting(async () => {
    calls++;
    if (failOnce) {
      failOnce = false;
      throw new Error("provider discovery failed");
    }
    return [makeProviderModelInfo("claude-sonnet-4", "anthropic")];
  });
  try {
    await assertRejects(
      () => resolveAutoModel("hello"),
      Error,
      "provider discovery failed",
    );
    const result = await resolveAutoModel("hello");
    assertEquals(calls, 2);
    assertEquals(result.model, "anthropic/claude-sonnet-4");
  } finally {
    __setListAllProviderModelsForTesting(null);
  }
});

Deno.test("resolveAutoModel: skips recently fallback-worthy failed model", async () => {
  const failures = [
    Object.assign(new Error("rate limit exceeded (429)"), { statusCode: 429 }),
    new Error("request timed out after 30s"),
    Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    Object.assign(new Error("HTTP 401 Unauthorized"), { statusCode: 401 }),
    new Error("exceeded your current quota; insufficient_quota"),
    new Error("provider failed in an unknown new shape"),
  ];

  try {
    for (const failure of failures) {
      invalidateAutoModelCache();
      __clearAutoModelFailureCooldownsForTesting();
      __setListAllProviderModelsForTesting(async () => [
        makeProviderModelInfo("claude-sonnet-4", "anthropic"),
        makeProviderModelInfo("gpt-4o", "openai"),
      ]);

      const first = await resolveAutoModel("hello", undefined, undefined, {
        isCodeTask: false,
        isReasoningTask: false,
        needsStructuredOutput: false,
      });

      assertEquals(await recordAutoModelFailure(first.model, failure), true);

      const second = await resolveAutoModel("hello", undefined, undefined, {
        isCodeTask: false,
        isReasoningTask: false,
        needsStructuredOutput: false,
      });
      assertEquals(second.model !== first.model, true);
    }
  } finally {
    __setListAllProviderModelsForTesting(null);
    __clearAutoModelFailureCooldownsForTesting();
  }
});

Deno.test("resolveAutoModel: invalid request failure does not cool down model", async () => {
  invalidateAutoModelCache();
  __clearAutoModelFailureCooldownsForTesting();
  __setListAllProviderModelsForTesting(async () => [
    makeProviderModelInfo("claude-sonnet-4", "anthropic"),
    makeProviderModelInfo("gpt-4o", "openai"),
  ]);
  try {
    const first = await resolveAutoModel("hello", undefined, undefined, {
      isCodeTask: false,
      isReasoningTask: false,
      needsStructuredOutput: false,
    });

    assertEquals(
      await recordAutoModelFailure(first.model, new Error("invalid request")),
      false,
    );

    const second = await resolveAutoModel("hello", undefined, undefined, {
      isCodeTask: false,
      isReasoningTask: false,
      needsStructuredOutput: false,
    });
    assertEquals(second.model, first.model);
  } finally {
    __setListAllProviderModelsForTesting(null);
    __clearAutoModelFailureCooldownsForTesting();
  }
});

Deno.test("invalidateAutoModelCache: clears pending and resolved cache state", async () => {
  invalidateAutoModelCache();
  const firstDeferred = createDeferred<ModelInfo[]>();
  let mode: "first" | "second" = "first";
  let calls = 0;
  __setListAllProviderModelsForTesting(async () => {
    calls++;
    if (mode === "first") {
      return await firstDeferred.promise;
    }
    return [makeProviderModelInfo("gpt-4o", "openai")];
  });
  try {
    const first = resolveAutoModel("hello");
    await Promise.resolve();

    invalidateAutoModelCache();
    mode = "second";

    const second = await resolveAutoModel("hello");
    firstDeferred.resolve([
      makeProviderModelInfo("claude-sonnet-4", "anthropic"),
    ]);
    await first;

    const third = await resolveAutoModel("hello");
    assertEquals(calls, 2);
    assertEquals(second.model, "openai/gpt-4o");
    assertEquals(third.model, "openai/gpt-4o");
  } finally {
    __setListAllProviderModelsForTesting(null);
  }
});

// ============================================================
// Task-aware scoring (pure — uses pre-built profiles, no LLM dependency)
// ============================================================

Deno.test("scoreModel: code task profile prefers strong coder over mid", () => {
  const profile = defaultProfile({ isCodeTask: true });
  const strong = makeCaps({
    id: "anthropic/claude-sonnet-4",
    codingStrength: "strong",
  });
  const mid = makeCaps({ id: "openai/gpt-4o-mini", codingStrength: "mid" });
  assertEquals(scoreModel(strong, profile) > scoreModel(mid, profile), true);
});

Deno.test("scoreModel: reasoning task profile prefers reasoning model", () => {
  const profile = defaultProfile({ isReasoningTask: true });
  const reasoning = makeCaps({
    id: "openai/o1-preview",
    codingStrength: "strong",
    reasoning: true,
  });
  const noReasoning = makeCaps({
    id: "openai/gpt-4o",
    codingStrength: "strong",
    reasoning: false,
  });
  assertEquals(
    scoreModel(reasoning, profile) > scoreModel(noReasoning, profile),
    true,
  );
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
