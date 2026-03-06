import { assertEquals } from "jsr:@std/assert";
import { ai } from "../../../src/hlvm/api/ai.ts";
import {
  getProvider,
  getProviderDefaultConfig,
  registerProvider,
} from "../../../src/hlvm/providers/registry.ts";

function registerListProvider(name: string, modelName: string): void {
  registerProvider(name, () => ({
    name,
    displayName: `${name}-display`,
    capabilities: ["models.list" as const],
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
        Promise.resolve([{ name: modelName, displayName: modelName }]),
      get: (name: string) =>
        Promise.resolve(
          name === modelName
            ? { name: modelName, displayName: modelName }
            : null,
        ),
    },
  }));
}

Deno.test("ai.models.listAll filters providers and preserves provider metadata", async () => {
  registerListProvider("list-all-alpha", "alpha-model");
  registerListProvider("list-all-beta", "beta-model");

  const models = await ai.models.listAll({
    includeProviders: ["list-all-alpha", "list-all-beta"],
    excludeProviders: ["list-all-beta"],
  });

  assertEquals(models.map((model) => model.name), ["alpha-model"]);
  assertEquals(models[0]?.metadata?.provider, "list-all-alpha");
  assertEquals(
    models[0]?.metadata?.providerDisplayName,
    "list-all-alpha-display",
  );
});

Deno.test("ai.models.listAll falls back to Ollama catalog when local list is empty", async () => {
  const originalOllama = getProvider("ollama");
  const originalOllamaConfig = getProviderDefaultConfig("ollama") ?? undefined;

  registerProvider("ollama", () => ({
    name: "ollama",
    displayName: "Ollama",
    capabilities: ["models.list" as const, "models.catalog" as const],
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
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(null),
      catalog: () =>
        Promise.resolve([{
          name: "catalog-model",
          displayName: "Catalog Model",
        }]),
    },
  }), { ...originalOllamaConfig, isDefault: true });

  try {
    const models = await ai.models.listAll({ includeProviders: ["ollama"] });
    assertEquals(models.map((model) => model.name), ["catalog-model"]);
    assertEquals(models[0]?.metadata?.provider, "ollama");
  } finally {
    if (originalOllama) {
      registerProvider(
        "ollama",
        () => originalOllama,
        { ...originalOllamaConfig, isDefault: true },
      );
    }
  }
});
