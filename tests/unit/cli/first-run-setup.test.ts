/**
 * Deterministic tests for first-run auto-setup logic.
 *
 * Live daemon/catalog/system probes are intentionally excluded from the core
 * unit suite. Those belong in explicit integration checks, not unit tests that
 * can silently pass by early return.
 */

import { assertEquals } from "jsr:@std/assert";
import {
  parseParamSize,
  runFirstTimeSetup,
} from "../../../src/hlvm/cli/commands/first-run-setup.ts";
import type { AIEngineLifecycle } from "../../../src/hlvm/runtime/ai-runtime.ts";
import type { ModelInfo } from "../../../src/hlvm/providers/types.ts";

Deno.test("parseParamSize: parses integer sizes", () => {
  assertEquals(parseParamSize("3B"), 3);
  assertEquals(parseParamSize("7B"), 7);
  assertEquals(parseParamSize("70B"), 70);
  assertEquals(parseParamSize("120B"), 120);
  assertEquals(parseParamSize("671B"), 671);
});

Deno.test("parseParamSize: returns Infinity for unknown or missing values", () => {
  assertEquals(parseParamSize("Unknown"), Infinity);
  assertEquals(parseParamSize(undefined), Infinity);
  assertEquals(parseParamSize(""), Infinity);
});

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

Deno.test({ name: "runFirstTimeSetup: user decline falls back to model browser", sanitizeOps: false, sanitizeResources: false, async fn() {
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
}});

Deno.test({ name: "runFirstTimeSetup: engine startup failure falls back", sanitizeOps: false, sanitizeResources: false, async fn() {
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
}});

Deno.test({ name: "runFirstTimeSetup: no cloud model falls back", sanitizeOps: false, sanitizeResources: false, async fn() {
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
}});

Deno.test({ name: "runFirstTimeSetup: pull failure falls back", sanitizeOps: false, sanitizeResources: false, async fn() {
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
}});

Deno.test({ name: "runFirstTimeSetup: success saves selected cloud model", sanitizeOps: false, sanitizeResources: false, async fn() {
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
}});

Deno.test({ name: "runFirstTimeSetup: unverified cloud auth falls back and does not save", sanitizeOps: false, sanitizeResources: false, async fn() {
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
}});
