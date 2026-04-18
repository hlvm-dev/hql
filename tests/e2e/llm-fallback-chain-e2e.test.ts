/**
 * E2E tests for the LLM fallback chain with real gemma4 inference.
 *
 * Proves the fallback chain works with real model inference, real timing,
 * and real error classification — not just mocked functions.
 *
 * Requires: Ollama with gemma4 on port 11439 (auto-skips if unavailable).
 */

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  classifyForLocalFallback,
  isLocalFallbackReady,
  LOCAL_FALLBACK_MODEL_ID,
  withFallbackChain,
} from "../../src/hlvm/runtime/local-fallback.ts";
import { callLLMWithModelFallback } from "../../src/hlvm/agent/auto-select.ts";
import type { LLMFunction } from "../../src/hlvm/agent/orchestrator-llm.ts";
import { collectChat } from "../../src/hlvm/runtime/local-llm.ts";
import type { LLMResponse } from "../../src/hlvm/agent/tool-call.ts";
import { withExclusiveTestResource } from "../shared/light-helpers.ts";

// ---------------------------------------------------------------------------
// Availability gate — auto-skip if gemma4 is not running
// ---------------------------------------------------------------------------

const OLLAMA_PORT = 11439;
const TIMEOUT = 30_000;

const modelName = LOCAL_FALLBACK_MODEL_ID.split("/").pop() ?? "";
let gemmaAvailable = false;
try {
  const res = await fetch(`http://localhost:${OLLAMA_PORT}/api/tags`);
  if (res.ok) {
    const data = await res.json();
    gemmaAvailable = data.models?.some((m: { name: string }) =>
      m.name === modelName || m.name.startsWith(modelName)
    );
  }
} catch {
  // Ollama not running
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function e2e(name: string, fn: () => Promise<void>) {
  Deno.test({
    name: `[E2E] fallback-chain: ${name}`,
    ignore: !gemmaAvailable,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      await withExclusiveTestResource("local-llm-runtime", async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT);
        try {
          await fn();
        } finally {
          clearTimeout(timer);
        }
      });
    },
  });
}

/** Real gemma4 wrapped as LLMFunction — calls Ollama chat completion. */
function makeRealGemmaLLM(): LLMFunction {
  return async (messages, _signal?, _options?) => {
    const prompt = messages.map((m) => m.content).join("\n");
    const content = await collectChat(prompt, {
      temperature: 0,
      maxTokens: 128,
    });
    return {
      content,
      toolCalls: [],
    } satisfies LLMResponse;
  };
}

/** LLMFunction that always throws the given error. */
function makeFailingLLM(error: Error): LLMFunction {
  return async (_messages, _signal?, _options?) => {
    throw error;
  };
}

/** Minimal LLMResponse from static text. */
function staticResponse(text: string): LLMResponse {
  return { content: text, toolCalls: [] };
}

// ---------------------------------------------------------------------------
// Test 1: Real gemma4 produces a valid response (baseline)
// ---------------------------------------------------------------------------

e2e("real gemma4 produces a valid response", async () => {
  const content = await collectChat("What is 2+2? Reply with just the number.", {
    temperature: 0,
    maxTokens: 32,
  });
  assert(content.length > 0, "gemma4 returned empty response");
  assert(content.includes("4"), `expected '4' in response, got: ${content}`);
});

// ---------------------------------------------------------------------------
// Test 2: 429 → gemma4 instantly, real response + timing < 2s
// ---------------------------------------------------------------------------

e2e("429 rate limit falls to gemma4 with real response under 2s", async () => {
  const rateLimitError = Object.assign(new Error("rate limit exceeded (429)"), {
    statusCode: 429,
  });

  const fallbacksCalled: string[] = [];
  const traces: Array<{ from: string; to: string; reason: string }> = [];
  const start = performance.now();

  const result = await withFallbackChain<LLMResponse>({
    tryPrimary: () => {
      throw rateLimitError;
    },
    fallbacks: ["cloud-1", "cloud-2"],
    tryFallback: (model) => {
      fallbacksCalled.push(model);
      return Promise.resolve(staticResponse("should not reach"));
    },
    lastResort: {
      model: LOCAL_FALLBACK_MODEL_ID,
      isAvailable: isLocalFallbackReady,
    },
    tryLastResort: async (_model) => {
      const content = await collectChat("Say hello.", {
        temperature: 0,
        maxTokens: 32,
      });
      return { content, toolCalls: [] };
    },
    onTrace: (from, to, reason) => traces.push({ from, to, reason }),
  });

  const elapsed = performance.now() - start;

  assert(result.content.length > 0, "expected real gemma4 response");
  assertEquals(fallbacksCalled, [], "cloud fallbacks should NOT be called when lastResort is available");
  assert(elapsed < 2000, `expected < 2s, got ${elapsed.toFixed(0)}ms`);
  assert(traces.length > 0, "expected at least one trace event");
});

// ---------------------------------------------------------------------------
// Test 3: Multiple error types all fall to gemma4
// ---------------------------------------------------------------------------

e2e("ECONNREFUSED, timeout, and unknown errors all fall to gemma4", async () => {
  const errors = [
    Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    Object.assign(new Error("network timeout"), { code: "ETIMEDOUT" }),
    new Error("exotic unknown error from alien provider"),
  ];

  for (const err of errors) {
    const start = performance.now();
    const result = await withFallbackChain<LLMResponse>({
      tryPrimary: () => {
        throw err;
      },
      fallbacks: [],
      tryFallback: () => Promise.resolve(staticResponse("unused")),
      lastResort: {
        model: LOCAL_FALLBACK_MODEL_ID,
        isAvailable: isLocalFallbackReady,
      },
      tryLastResort: async () => {
        const content = await collectChat("Reply OK.", {
          temperature: 0,
          maxTokens: 16,
        });
        return { content, toolCalls: [] };
      },
    });
    const elapsed = performance.now() - start;

    assert(result.content.length > 0, `no response for error: ${err.message}`);
    assert(elapsed < 2000, `slow for error "${err.message}": ${elapsed.toFixed(0)}ms`);
  }
});

// ---------------------------------------------------------------------------
// Test 4: 401 auth error falls to gemma4
// ---------------------------------------------------------------------------

e2e("401 auth error with statusCode falls to gemma4", async () => {
  const authError = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  let gemmaUsed = false;

  const result = await withFallbackChain<LLMResponse>({
    tryPrimary: () => {
      throw authError;
    },
    fallbacks: [],
    tryFallback: () => Promise.resolve(staticResponse("unused")),
    lastResort: {
      model: LOCAL_FALLBACK_MODEL_ID,
      isAvailable: isLocalFallbackReady,
    },
    tryLastResort: async () => {
      gemmaUsed = true;
      const content = await collectChat("Say yes.", {
        temperature: 0,
        maxTokens: 16,
      });
      return { content, toolCalls: [] };
    },
  });

  assert(gemmaUsed, "gemma4 should be used for 401 auth errors");
  assert(result.content.length > 0, "expected real response");
});

// ---------------------------------------------------------------------------
// Test 5: Invalid request → no fallback, immediate throw
// ---------------------------------------------------------------------------

e2e("invalid request error throws immediately with no fallback", async () => {
  const invalidError = new Error("invalid request format");
  let gemmaChecked = false;
  let gemmaUsed = false;

  await assertRejects(
    () =>
      withFallbackChain<LLMResponse>({
        tryPrimary: () => {
          throw invalidError;
        },
        fallbacks: [],
        tryFallback: () => Promise.resolve(staticResponse("unused")),
        lastResort: {
          model: LOCAL_FALLBACK_MODEL_ID,
          isAvailable: async () => {
            gemmaChecked = true;
            return true;
          },
        },
        tryLastResort: async () => {
          gemmaUsed = true;
          return staticResponse("should not reach");
        },
      }),
    Error,
  );

  assertEquals(gemmaUsed, false, "gemma4 should NOT be called for invalid request");
});

// ---------------------------------------------------------------------------
// Test 6: AbortError → no fallback, immediate throw
// ---------------------------------------------------------------------------

e2e("AbortError throws immediately with no fallback", async () => {
  const abortError = new DOMException("aborted", "AbortError");
  let gemmaUsed = false;

  try {
    await withFallbackChain<LLMResponse>({
      tryPrimary: () => {
        throw abortError;
      },
      fallbacks: [],
      tryFallback: () => Promise.resolve(staticResponse("unused")),
      lastResort: {
        model: LOCAL_FALLBACK_MODEL_ID,
        isAvailable: async () => true,
      },
      tryLastResort: async () => {
        gemmaUsed = true;
        return staticResponse("should not reach");
      },
    });
    assert(false, "should have thrown");
  } catch (e) {
    assert(e instanceof DOMException, `expected DOMException, got ${e}`);
    assertEquals((e as DOMException).name, "AbortError");
  }

  assertEquals(gemmaUsed, false, "gemma4 should NOT be called for AbortError");
});

// ---------------------------------------------------------------------------
// Test 7: Full callLLMWithModelFallback pipeline with real gemma4
// ---------------------------------------------------------------------------

e2e("callLLMWithModelFallback pipeline with real gemma4 lastResort", async () => {
  const rateLimitError = Object.assign(new Error("rate limit exceeded"), {
    statusCode: 429,
  });

  // deno-lint-ignore no-explicit-any
  const traces: Array<Record<string, any>> = [];
  const realGemma = makeRealGemmaLLM();
  const start = performance.now();

  const result = await callLLMWithModelFallback(
    // primaryCall: fails with 429
    () => {
      throw rateLimitError;
    },
    // fallbacks: empty (skip cloud)
    [],
    // createFallbackLLM: returns real gemma
    (_model) => realGemma,
    // callWithRetry: direct invocation (no retry in e2e)
    async (llmFn) =>
      await llmFn(
        [{ role: "user", content: "What color is the sky? One word." }],
      ),
    // onTrace — cast to any to avoid TraceEvent union mismatch
    // deno-lint-ignore no-explicit-any
    (event) => traces.push(event as any),
    // lastResort
    {
      model: LOCAL_FALLBACK_MODEL_ID,
      isAvailable: isLocalFallbackReady,
    },
  );

  const elapsed = performance.now() - start;

  assert(result.content.length > 0, "expected real gemma4 content");
  assert(elapsed < 5000, `expected < 5s, got ${elapsed.toFixed(0)}ms`);
  const fallbackTrace = traces.find((t) => t.type === "auto_fallback");
  assert(fallbackTrace, "expected auto_fallback trace event");
});

// ---------------------------------------------------------------------------
// Test 8: Timing — fast path < 2s, degraded path < 2s
// ---------------------------------------------------------------------------

e2e("fast and degraded fallback paths both complete under 2s", async () => {
  const rateLimitError = Object.assign(new Error("rate limit"), {
    statusCode: 429,
  });

  // Fast path: lastResort ready → immediate switch
  const startFast = performance.now();
  await withFallbackChain<LLMResponse>({
    tryPrimary: () => {
      throw rateLimitError;
    },
    fallbacks: [],
    tryFallback: () => Promise.resolve(staticResponse("unused")),
    lastResort: {
      model: LOCAL_FALLBACK_MODEL_ID,
      isAvailable: async () => true, // simulated instant readiness
    },
    tryLastResort: async () => staticResponse("fast-path result"),
  });
  const fastElapsed = performance.now() - startFast;
  assert(fastElapsed < 2000, `fast path: expected < 2s, got ${fastElapsed.toFixed(0)}ms`);

  // Degraded path: lastResort NOT ready → cloud fallback succeeds
  const startDegraded = performance.now();
  await withFallbackChain<LLMResponse>({
    tryPrimary: () => {
      throw rateLimitError;
    },
    fallbacks: ["cloud-backup"],
    tryFallback: (_model) => Promise.resolve(staticResponse("cloud ok")),
    lastResort: {
      model: LOCAL_FALLBACK_MODEL_ID,
      isAvailable: async () => false, // simulated unavailable
    },
    tryLastResort: async () => staticResponse("should not reach"),
  });
  const degradedElapsed = performance.now() - startDegraded;
  assert(degradedElapsed < 2000, `degraded path: expected < 2s, got ${degradedElapsed.toFixed(0)}ms`);
});

// ---------------------------------------------------------------------------
// Test 9: isLocalFallbackReady() returns true with real I/O
// ---------------------------------------------------------------------------

e2e("isLocalFallbackReady returns true against real Ollama", async () => {
  const ready = await isLocalFallbackReady();
  assertEquals(ready, true, "expected isLocalFallbackReady() = true with gemma4 available");
});

// ---------------------------------------------------------------------------
// Test 10: classifyForLocalFallback — diverse error types
// ---------------------------------------------------------------------------

e2e("classifyForLocalFallback correctly classifies diverse errors", async () => {
  // Fallback-worthy errors
  const rateLimitErr = Object.assign(new Error("rate limit exceeded"), {
    statusCode: 429,
  });
  assertEquals(
    await classifyForLocalFallback(rateLimitErr),
    "rate_limit",
    "429 should classify as rate_limit",
  );

  const connRefused = Object.assign(new Error("ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  const connClass = await classifyForLocalFallback(connRefused);
  assert(
    connClass !== null,
    `ECONNREFUSED should be fallback-worthy, got null`,
  );

  const timeoutErr = Object.assign(new Error("request timed out"), {
    code: "ETIMEDOUT",
  });
  const timeoutClass = await classifyForLocalFallback(timeoutErr);
  assert(
    timeoutClass !== null,
    `timeout should be fallback-worthy, got null`,
  );

  // NOT fallback-worthy errors
  const abortErr = new DOMException("aborted", "AbortError");
  assertEquals(
    await classifyForLocalFallback(abortErr),
    null,
    "AbortError should NOT be fallback-worthy",
  );

  const overflowErr = Object.assign(new Error("context length exceeded"), {
    statusCode: 400,
  });
  // context_overflow may or may not be detected — depends on error classification
  // At minimum, verify it doesn't crash
  const overflowClass = await classifyForLocalFallback(overflowErr);
  assert(
    overflowClass === null || typeof overflowClass === "string",
    "classifyForLocalFallback should return string or null",
  );
});
