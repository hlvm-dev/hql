import { assertEquals } from "jsr:@std/assert";
import { ai } from "../../../src/hlvm/api/ai.ts";
import {
  getProviderDefaultConfig,
  parseModelString,
  registerProvider,
} from "../../../src/hlvm/providers/registry.ts";

Deno.test("parseModelString keeps model tags like model:latest", () => {
  const [provider, model] = parseModelString("mistral:latest");
  assertEquals(provider, null);
  assertEquals(model, "mistral:latest");
});

Deno.test("parseModelString keeps legacy provider:model as plain model", () => {
  const [provider, model] = parseModelString("ollama:llama3.2");
  assertEquals(provider, null);
  assertEquals(model, "ollama:llama3.2");
});

Deno.test("parseModelString keeps custom provider:model as plain model", () => {
  registerProvider("custom", () => ({
    name: "custom",
    displayName: "Custom",
    capabilities: [],
    async *generate() {
      yield "";
    },
    async *chat() {
      yield "";
    },
    status() {
      return Promise.resolve({ available: true });
    },
  }));

  const [provider, model] = parseModelString("custom:alpha");
  assertEquals(provider, null);
  assertEquals(model, "custom:alpha");
});

Deno.test("ai.models.get resolves provider/model input", async () => {
  // Register a test provider with a known model (real providers fetch dynamically, no hardcoded lists)
  registerProvider("testcloud", () => ({
    name: "testcloud",
    displayName: "TestCloud",
    capabilities: ["chat" as const, "models.list" as const],
    async *generate() {
      yield "";
    },
    async *chat() {
      yield "";
    },
    status() {
      return Promise.resolve({ available: true });
    },
    models: {
      list: () =>
        Promise.resolve([{
          name: "test-model-1",
          displayName: "Test Model 1",
        }]),
      get: (name: string) =>
        Promise.resolve(
          name === "test-model-1"
            ? { name, displayName: "Test Model 1" }
            : null,
        ),
    },
  }));

  const model = await ai.models.get("test-model-1", "testcloud");
  assertEquals(model?.name, "test-model-1");
});

Deno.test("getProviderDefaultConfig returns provider defaults", () => {
  registerProvider(
    "cfgtest",
    () => ({
      name: "cfgtest",
      displayName: "CfgTest",
      capabilities: [],
      async *generate() {
        yield "";
      },
      async *chat() {
        yield "";
      },
      status() {
        return Promise.resolve({ available: true });
      },
    }),
    {
      endpoint: "https://example.test",
      defaultModel: "model-x",
      apiKey: "key-123",
    },
  );

  const cfg = getProviderDefaultConfig("cfgtest");
  assertEquals(cfg, {
    endpoint: "https://example.test",
    defaultModel: "model-x",
    apiKey: "key-123",
  });
});
