import { assertEquals } from "jsr:@std/assert";
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
