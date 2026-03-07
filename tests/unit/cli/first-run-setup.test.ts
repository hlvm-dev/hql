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
  runOllamaSignin,
  verifyOllamaCloudModelAccess,
} from "../../../src/hlvm/cli/commands/first-run-setup.ts";
import { getRuntimeHostIdentity } from "../../../src/hlvm/runtime/host-identity.ts";
import type { AIEngineLifecycle } from "../../../src/hlvm/runtime/ai-runtime.ts";
import type { ModelInfo } from "../../../src/hlvm/providers/types.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  findFreePort,
  withEnv,
  withRuntimeHostServer,
} from "../../shared/light-helpers.ts";

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

Deno.test({
  name: "runFirstTimeSetup: user decline falls back to model browser",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
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
  },
});

Deno.test({
  name: "runFirstTimeSetup: engine startup failure falls back",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
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
  },
});

Deno.test({
  name: "runFirstTimeSetup: no cloud model falls back",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
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
  },
});

Deno.test({
  name: "runFirstTimeSetup: pull failure falls back",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
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
  },
});

Deno.test({
  name: "runFirstTimeSetup: success saves selected cloud model",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
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
  },
});

Deno.test({
  name: "runFirstTimeSetup: unverified cloud auth falls back and does not save",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
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
  },
});

Deno.test("verifyOllamaCloudModelAccess: probes through the runtime host", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";
  const identity = await getRuntimeHostIdentity();
  let capturedModel = "";

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        initialized: true,
        definitions: 0,
        aiReady: true,
        version: identity.version,
        buildId: identity.buildId,
        authToken,
      });
    }

    if (url.pathname === "/api/models/verify-access") {
      const body = await req.json() as { model?: string };
      capturedModel = body.model ?? "";
      return Response.json({ available: true });
    }

    return new Response("Not found", { status: 404 });
  }, {
    hostname: "127.0.0.1",
    port,
    onListen: () => {},
  });

  try {
    await withEnv("HLVM_REPL_PORT", String(port), async () => {
      const result = await verifyOllamaCloudModelAccess(
        "ollama/deepseek-v3.1:671b-cloud",
      );
      assertEquals(result, true);
      assertEquals(capturedModel, "ollama/deepseek-v3.1:671b-cloud");
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runOllamaSignin: routes through the runtime host", async () => {
  let signinCalls = 0;

  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/api/providers/ollama/signin") {
      signinCalls += 1;
      return Response.json({
        success: true,
        output: ["Open this URL to sign in"],
        signinUrl: "https://ollama.com/connect?token=test",
        browserOpened: true,
      });
    }
    return new Response("Not found", { status: 404 });
  }, async () => {
    const result = await runOllamaSignin();
    assertEquals(result, true);
    assertEquals(signinCalls, 1);
  });
});
