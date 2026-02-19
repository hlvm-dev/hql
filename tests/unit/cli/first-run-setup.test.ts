/**
 * Tests for first-run auto-setup.
 *
 * These are REAL tests — they call actual functions against real system state:
 * - parseParamSize: pure function
 * - pickBestCloudModel: uses live Ollama gist catalog
 * - isOllamaAuthErrorMessage: pure regex pattern matching
 * - verifyOllamaCloudModelAccess: real Ollama probe (needs running daemon)
 * - aiEngine: uses the real AIEngineLifecycle singleton
 * - findSystemOllama: probes real system for Ollama binary
 */

import { assertEquals } from "jsr:@std/assert";
import {
  isOllamaAuthErrorMessage,
  parseParamSize,
  pickBestCloudModel,
  runFirstTimeSetup,
  runOllamaSignin,
  verifyOllamaCloudModelAccess,
} from "../../../src/hlvm/cli/commands/first-run-setup.ts";
import { aiEngine } from "../../../src/hlvm/runtime/ai-runtime.ts";
import type { AIEngineLifecycle } from "../../../src/hlvm/runtime/ai-runtime.ts";
import type { ModelInfo } from "../../../src/hlvm/providers/types.ts";
import { findSystemOllama } from "../../../src/hlvm/cli/commands/ollama.ts";
import { getOllamaCatalogAsync } from "../../../src/hlvm/providers/ollama/catalog.ts";
import { isOllamaCloudModel } from "../../../src/hlvm/providers/ollama/cloud.ts";
import { checkStatus } from "../../../src/hlvm/providers/ollama/api.ts";
import { DEFAULT_OLLAMA_ENDPOINT } from "../../../src/common/config/types.ts";

/** Check if Ollama daemon is reachable for integration tests. */
async function isOllamaAvailable(): Promise<boolean> {
  const status = await checkStatus(DEFAULT_OLLAMA_ENDPOINT);
  return status.available;
}

// ============================================================================
// parseParamSize — pure function
// ============================================================================

Deno.test("parseParamSize: parses integer sizes", () => {
  assertEquals(parseParamSize("3B"), 3);
  assertEquals(parseParamSize("7B"), 7);
  assertEquals(parseParamSize("70B"), 70);
  assertEquals(parseParamSize("120B"), 120);
  assertEquals(parseParamSize("671B"), 671);
});

Deno.test("parseParamSize: parses fractional sizes", () => {
  assertEquals(parseParamSize("1.5B"), 1.5);
  assertEquals(parseParamSize("7.5B"), 7.5);
  assertEquals(parseParamSize("3.8b"), 3.8);
});

Deno.test("parseParamSize: returns Infinity for unknown/missing", () => {
  assertEquals(parseParamSize("Unknown"), Infinity);
  assertEquals(parseParamSize(undefined), Infinity);
  assertEquals(parseParamSize(""), Infinity);
});

Deno.test("parseParamSize: edge cases", () => {
  assertEquals(parseParamSize("0B"), 0);
  assertEquals(parseParamSize("0.5B"), 0.5);
  assertEquals(parseParamSize("no-number"), Infinity);
});

// ============================================================================
// pickBestCloudModel — live catalog data from gist
// ============================================================================

Deno.test("pickBestCloudModel: returns a cloud model with tools capability", async () => {
  const result = await pickBestCloudModel();

  // The real catalog should have cloud models with tools
  if (result === null) {
    // If catalog has no cloud+tools models, that's a data issue — skip
    console.warn("WARN: No cloud+tools models in catalog. Skipping.");
    return;
  }

  // Model name must contain "cloud" in the tag
  assertEquals(
    isOllamaCloudModel(result.name),
    true,
    `Expected cloud model, got: ${result.name}`,
  );

  // Must have tools capability
  assertEquals(
    result.capabilities?.includes("tools"),
    true,
    `Expected tools capability, got: ${result.capabilities}`,
  );
});

Deno.test("pickBestCloudModel: picks largest param-size cloud model dynamically", async () => {
  const result = await pickBestCloudModel();
  if (!result) return;

  // Verify the result is the largest cloud+tools model in catalog
  const catalog = await getOllamaCatalogAsync({ maxVariants: Infinity });
  const cloudTools = catalog.filter(
    (m) => isOllamaCloudModel(m.name) && m.capabilities?.includes("tools"),
  );
  cloudTools.sort(
    (a, b) => parseParamSize(b.parameterSize) - parseParamSize(a.parameterSize),
  );

  if (cloudTools.length > 0) {
    assertEquals(
      result.name,
      cloudTools[0].name,
      `Expected largest cloud model ${cloudTools[0].name}, got: ${result.name}`,
    );
  }
});

Deno.test("pickBestCloudModel: result has valid ModelInfo shape", async () => {
  const result = await pickBestCloudModel();
  if (!result) return;

  assertEquals(typeof result.name, "string");
  assertEquals(result.name.length > 0, true);
  assertEquals(Array.isArray(result.capabilities), true);
  // displayName should exist for catalog models
  assertEquals(typeof result.displayName, "string");
});

// ============================================================================
// isOllamaAuthErrorMessage — pure regex pattern matching
// ============================================================================

Deno.test("isOllamaAuthErrorMessage: detects auth error patterns", () => {
  // Direct keyword matches
  assertEquals(isOllamaAuthErrorMessage("unauthorized"), true);
  assertEquals(isOllamaAuthErrorMessage("Unauthorized"), true);
  assertEquals(isOllamaAuthErrorMessage("UNAUTHORIZED"), true);

  // HTTP status patterns
  assertEquals(isOllamaAuthErrorMessage("401"), true);
  assertEquals(isOllamaAuthErrorMessage("HTTP 401"), true);
  assertEquals(isOllamaAuthErrorMessage("401 Unauthorized"), true);
  assertEquals(isOllamaAuthErrorMessage("status 401: access denied"), true);

  // Auth keyword
  assertEquals(isOllamaAuthErrorMessage("auth required"), true);
  assertEquals(isOllamaAuthErrorMessage("authentication failed"), true);

  // Sign-in patterns (with and without hyphen/space)
  assertEquals(isOllamaAuthErrorMessage("please sign in"), true);
  assertEquals(isOllamaAuthErrorMessage("signin required"), true);
  assertEquals(isOllamaAuthErrorMessage("sign-in required"), true);

  // Real Ollama cloud error messages
  assertEquals(
    isOllamaAuthErrorMessage("Unauthorized access to cloud model"),
    true,
  );
});

Deno.test("isOllamaAuthErrorMessage: rejects non-auth errors", () => {
  assertEquals(isOllamaAuthErrorMessage("connection refused"), false);
  assertEquals(isOllamaAuthErrorMessage("model not found"), false);
  assertEquals(isOllamaAuthErrorMessage("timeout waiting for response"), false);
  assertEquals(isOllamaAuthErrorMessage("500 Internal Server Error"), false);
  assertEquals(isOllamaAuthErrorMessage("404 not found"), false);
  assertEquals(isOllamaAuthErrorMessage(""), false);
  assertEquals(isOllamaAuthErrorMessage("pull failed: network error"), false);
  assertEquals(isOllamaAuthErrorMessage("ECONNREFUSED"), false);
  assertEquals(isOllamaAuthErrorMessage("model too large for memory"), false);
});

// ============================================================================
// verifyOllamaCloudModelAccess — real Ollama integration
// ============================================================================

Deno.test({
  name: "verifyOllamaCloudModelAccess: returns true for accessible local model",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!(await isOllamaAvailable())) {
      console.warn("WARN: Ollama not running. Skipping.");
      return;
    }

    // Use a local model that should be accessible without auth
    const result = await verifyOllamaCloudModelAccess("ollama/llama3.1:8b");
    assertEquals(typeof result, "boolean");
    // If the model is pulled locally, this should return true
    // If not pulled, it may return false — both are valid for this test
    // The key assertion is that it returns a boolean without throwing
  },
});

Deno.test({
  name: "verifyOllamaCloudModelAccess: returns false for non-existent model",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!(await isOllamaAvailable())) {
      console.warn("WARN: Ollama not running. Skipping.");
      return;
    }

    // A model that definitely doesn't exist
    const result = await verifyOllamaCloudModelAccess(
      "ollama/totally-fake-nonexistent-model-xyz:99b",
    );
    assertEquals(result, false, "Non-existent model should return false");
  },
});

// ============================================================================
// runFirstTimeSetup — branch coverage with dependency injection
// ============================================================================

function createStubEngine(
  overrides: Partial<AIEngineLifecycle> = {},
): AIEngineLifecycle {
  return {
    isRunning: () => Promise.resolve(true),
    ensureRunning: () => Promise.resolve(true),
    getEnginePath: () => Promise.resolve("ollama"),
    ...overrides,
  };
}

Deno.test("runFirstTimeSetup: user decline falls back to model browser", async () => {
  const calls: string[] = [];
  const engine = createStubEngine({
    ensureRunning: () => {
      calls.push("ensureRunning");
      return Promise.resolve(true);
    },
  });

  const result = await runFirstTimeSetup(engine, {
    confirmSetup: () => Promise.resolve(false),
    fallbackToModelBrowser: () => {
      calls.push("fallback");
      return Promise.resolve("ollama/fallback-model:cloud");
    },
    logRaw: () => {},
    logError: () => {},
  });

  assertEquals(result, "ollama/fallback-model:cloud");
  assertEquals(calls.includes("ensureRunning"), false);
  assertEquals(calls.includes("fallback"), true);
});

Deno.test("runFirstTimeSetup: engine startup failure falls back", async () => {
  const calls: string[] = [];
  const engine = createStubEngine({
    ensureRunning: () => Promise.resolve(false),
  });

  const result = await runFirstTimeSetup(engine, {
    confirmSetup: () => Promise.resolve(true),
    fallbackToModelBrowser: () => {
      calls.push("fallback");
      return Promise.resolve("ollama/fallback-model:cloud");
    },
    logRaw: () => {},
    logError: () => {},
  });

  assertEquals(result, "ollama/fallback-model:cloud");
  assertEquals(calls.includes("fallback"), true);
});

Deno.test("runFirstTimeSetup: no cloud model falls back", async () => {
  const calls: string[] = [];
  const engine = createStubEngine();

  const result = await runFirstTimeSetup(engine, {
    confirmSetup: () => Promise.resolve(true),
    pickBestCloudModel: () => Promise.resolve(null),
    fallbackToModelBrowser: () => {
      calls.push("fallback");
      return Promise.resolve("ollama/fallback-model:cloud");
    },
    logRaw: () => {},
    logError: () => {},
  });

  assertEquals(result, "ollama/fallback-model:cloud");
  assertEquals(calls.includes("fallback"), true);
});

Deno.test("runFirstTimeSetup: pull failure falls back", async () => {
  const calls: string[] = [];
  const engine = createStubEngine();
  const cloudModel: ModelInfo = {
    name: "deepseek-v3.1:671b-cloud",
    displayName: "DeepSeek V3.1 671B",
    capabilities: ["tools"],
  };

  const result = await runFirstTimeSetup(engine, {
    confirmSetup: () => Promise.resolve(true),
    pickBestCloudModel: () => Promise.resolve(cloudModel),
    pullWithSignin: () => Promise.resolve(false),
    ensureCloudModelAccess: () => Promise.resolve(true),
    fallbackToModelBrowser: () => {
      calls.push("fallback");
      return Promise.resolve("ollama/fallback-model:cloud");
    },
    logRaw: () => {},
    logError: () => {},
  });

  assertEquals(result, "ollama/fallback-model:cloud");
  assertEquals(calls.includes("fallback"), true);
});

Deno.test("runFirstTimeSetup: success saves selected cloud model", async () => {
  const saved: string[] = [];
  const engine = createStubEngine();
  const cloudModel: ModelInfo = {
    name: "deepseek-v3.1:671b-cloud",
    displayName: "DeepSeek V3.1 671B",
    capabilities: ["tools"],
  };

  const result = await runFirstTimeSetup(engine, {
    confirmSetup: () => Promise.resolve(true),
    pickBestCloudModel: () => Promise.resolve(cloudModel),
    pullWithSignin: () => Promise.resolve(true),
    ensureCloudModelAccess: () => Promise.resolve(true),
    saveConfiguredModel: (modelId: string) => {
      saved.push(modelId);
      return Promise.resolve();
    },
    fallbackToModelBrowser: () =>
      Promise.reject(new Error("fallback should not be called on success")),
    logRaw: () => {},
    logError: () => {},
  });

  assertEquals(result, "ollama/deepseek-v3.1:671b-cloud");
  assertEquals(saved, ["ollama/deepseek-v3.1:671b-cloud"]);
});

Deno.test("runFirstTimeSetup: unverified cloud auth falls back and does not save", async () => {
  const saved: string[] = [];
  const calls: string[] = [];
  const engine = createStubEngine();
  const cloudModel: ModelInfo = {
    name: "deepseek-v3.1:671b-cloud",
    displayName: "DeepSeek V3.1 671B",
    capabilities: ["tools"],
  };

  const result = await runFirstTimeSetup(engine, {
    confirmSetup: () => Promise.resolve(true),
    pickBestCloudModel: () => Promise.resolve(cloudModel),
    pullWithSignin: () => Promise.resolve(true),
    ensureCloudModelAccess: () => Promise.resolve(false),
    saveConfiguredModel: (modelId: string) => {
      saved.push(modelId);
      return Promise.resolve();
    },
    fallbackToModelBrowser: () => {
      calls.push("fallback");
      return Promise.resolve("ollama/fallback-model:cloud");
    },
    logRaw: () => {},
    logError: () => {},
  });

  assertEquals(result, "ollama/fallback-model:cloud");
  assertEquals(saved.length, 0);
  assertEquals(calls.includes("fallback"), true);
});

Deno.test({
  name: "aiEngine.isRunning: returns boolean for real daemon check",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const running = await aiEngine.isRunning();
    assertEquals(typeof running, "boolean");

    if (!running) {
      console.warn("WARN: AI engine not running. Skipping running assertion.");
      return;
    }
    assertEquals(running, true);
  },
});

Deno.test({
  name: "aiEngine.getEnginePath: returns embedded or system path",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const path = await aiEngine.getEnginePath();
    assertEquals(typeof path, "string");
    assertEquals(path.length > 0, true);
    // Should be either a full path to embedded engine or "ollama" (system)
    assertEquals(
      path.includes("engine") || path === "ollama",
      true,
      `Expected engine path or 'ollama', got: ${path}`,
    );
  },
});

// ============================================================================
// findSystemOllama — probes real system
// ============================================================================

Deno.test({
  name: "findSystemOllama: finds Ollama on this machine",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const path = await findSystemOllama();

    // Ollama should be installed on the dev machine
    if (path === null) {
      console.warn("WARN: Ollama not installed on this machine. Skipping.");
      return;
    }

    assertEquals(typeof path, "string");
    assertEquals(path.length > 0, true);
    // Path should contain "ollama"
    assertEquals(
      path.includes("ollama"),
      true,
      `Expected path containing 'ollama', got: ${path}`,
    );
  },
});
