import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";
import { RuntimeError } from "../../../src/common/error.ts";
import { ProviderErrorCode } from "../../../src/common/error-codes.ts";
import { http } from "../../../src/common/http-client.ts";
import { DEFAULT_OLLAMA_ENDPOINT } from "../../../src/common/config/types.ts";
import { aiEngine } from "../../../src/hlvm/runtime/ai-runtime.ts";
import { getModel } from "../../../src/hlvm/providers/ollama/api.ts";

Deno.test("ollama getModel returns null for a real missing-model response", async () => {
  const originalFetchRaw = http.fetchRaw.bind(http);
  let callCount = 0;

  http.fetchRaw = async (_url) => {
    callCount++;
    if (callCount === 1) {
      return new Response(
        JSON.stringify({ models: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ error: "model 'qwen3:8b' not found" }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const model = await getModel("http://127.0.0.1:11439", "qwen3:8b");
    assertEquals(model, null);
  } finally {
    http.fetchRaw = originalFetchRaw;
  }
});

Deno.test("ollama getModel surfaces dead-endpoint failures instead of pretending the model is missing", async () => {
  const originalFetchRaw = http.fetchRaw.bind(http);
  let callCount = 0;

  http.fetchRaw = async (_url) => {
    callCount++;
    if (callCount === 1) {
      throw new Error("tcp connect error: Connection refused (os error 61)");
    }
    throw new RuntimeError(
      "Ollama request could not reach the provider: tcp connect error: Connection refused (os error 61)",
      { code: ProviderErrorCode.NETWORK_ERROR },
    );
  };

  try {
    const error = await assertRejects(
      () => getModel("http://127.0.0.1:9999", "qwen3:8b"),
      RuntimeError,
    );
    assertEquals(error.code, ProviderErrorCode.NETWORK_ERROR);
    assertStringIncludes(error.message, "Connection refused");
  } finally {
    http.fetchRaw = originalFetchRaw;
  }
});

Deno.test("ollama getModel retries once by restarting the managed engine after connection refusal", async () => {
  const originalFetchRaw = http.fetchRaw.bind(http);
  const originalEnsureRunning = aiEngine.ensureRunning;
  let fetchCount = 0;
  let restartCount = 0;

  aiEngine.ensureRunning = async () => {
    restartCount++;
    return true;
  };
  http.fetchRaw = async (_url) => {
    fetchCount++;
    if (fetchCount === 1) {
      return new Response(
        JSON.stringify({ models: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (fetchCount === 2) {
      throw new RuntimeError(
        "Ollama request could not reach the provider: tcp connect error: Connection refused (os error 61)",
        { code: ProviderErrorCode.NETWORK_ERROR },
      );
    }
    return new Response(
      JSON.stringify({
        name: "qwen3:8b",
        details: { family: "qwen3" },
        capabilities: ["chat", "tools"],
        model_info: { "llama.context_length": 32768 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const model = await getModel(DEFAULT_OLLAMA_ENDPOINT, "qwen3:8b");
    assertEquals(restartCount, 1);
    assertEquals(model?.name, "qwen3:8b");
    assertEquals(model?.contextWindow, 32768);
  } finally {
    http.fetchRaw = originalFetchRaw;
    aiEngine.ensureRunning = originalEnsureRunning;
  }
});
