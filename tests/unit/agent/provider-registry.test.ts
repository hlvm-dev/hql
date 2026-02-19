import { assertEquals } from "jsr:@std/assert";
import { ai } from "../../../src/hlvm/api/ai.ts";
import {
  parseModelString,
  registerProvider,
} from "../../../src/hlvm/providers/registry.ts";

Deno.test("parseModelString keeps model tags like model:latest", () => {
  const [provider, model] = parseModelString("mistral:latest");
  assertEquals(provider, null);
  assertEquals(model, "mistral:latest");
});

Deno.test("parseModelString recognizes known provider:model format", () => {
  const [provider, model] = parseModelString("ollama:llama3.2");
  assertEquals(provider, "ollama");
  assertEquals(model, "llama3.2");
});

Deno.test("parseModelString recognizes registered custom provider:model format", () => {
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
    async status() {
      return { available: true };
    },
  }));

  const [provider, model] = parseModelString("custom:alpha");
  assertEquals(provider, "custom");
  assertEquals(model, "alpha");
});

Deno.test("ai.models.get resolves provider/model input", async () => {
  // Register a test provider with a known model (real providers fetch dynamically, no hardcoded lists)
  registerProvider("testcloud", () => ({
    name: "testcloud",
    displayName: "TestCloud",
    capabilities: ["chat" as const, "models.list" as const],
    async *generate() { yield ""; },
    async *chat() { yield ""; },
    async status() { return { available: true }; },
    models: {
      list: async () => [{ name: "test-model-1", displayName: "Test Model 1" }],
      get: async (name: string) => name === "test-model-1" ? { name, displayName: "Test Model 1" } : null,
    },
  }));

  const model = await ai.models.get("test-model-1", "testcloud");
  assertEquals(model?.name, "test-model-1");
});
