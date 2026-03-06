import { assertEquals } from "jsr:@std/assert";
import { http } from "../../../src/common/http-client.ts";
import {
  fetchPublicModelsForProvider,
  resetPublicCatalogCacheForTests,
} from "../../../src/hlvm/providers/public-catalog.ts";
import { withTempHlvmDir } from "../helpers.ts";

Deno.test("public catalog reuses one in-flight fetch across providers", async () => {
  await withTempHlvmDir(async () => {
    resetPublicCatalogCacheForTests();

    const originalFetchRaw = http.fetchRaw.bind(http);
    let calls = 0;

    http.fetchRaw = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "openai/gpt-4o",
              name: "OpenAI: GPT-4o",
              context_length: 128_000,
            },
            {
              id: "anthropic/claude-sonnet-4.5",
              name: "Anthropic: Claude Sonnet 4.5",
              context_length: 200_000,
            },
            {
              id: "google/gemini-2.5-pro",
              name: "Google: Gemini 2.5 Pro",
              context_length: 1_000_000,
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    try {
      const [openaiModels, anthropicModels, googleModels] = await Promise.all([
        fetchPublicModelsForProvider("openai"),
        fetchPublicModelsForProvider("anthropic"),
        fetchPublicModelsForProvider("google"),
      ]);

      assertEquals(calls, 1);
      assertEquals(openaiModels.map((model) => model.name), ["gpt-4o"]);
      assertEquals(anthropicModels.map((model) => model.name), [
        "claude-sonnet-4.5",
      ]);
      assertEquals(googleModels.map((model) => model.name), ["gemini-2.5-pro"]);
    } finally {
      http.fetchRaw = originalFetchRaw;
      resetPublicCatalogCacheForTests();
    }
  });
});

Deno.test("public catalog falls back to persisted cache when network fetch fails", async () => {
  await withTempHlvmDir(async () => {
    resetPublicCatalogCacheForTests();

    const originalFetchRaw = http.fetchRaw.bind(http);
    http.fetchRaw = async () =>
      new Response(
        JSON.stringify({
          data: [{
            id: "anthropic/claude-sonnet-4.6",
            name: "Anthropic: Claude Sonnet 4.6",
            context_length: 200_000,
          }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );

    try {
      const initial = await fetchPublicModelsForProvider("anthropic");
      assertEquals(initial.map((model) => model.name), ["claude-sonnet-4.6"]);

      resetPublicCatalogCacheForTests();
      http.fetchRaw = async () => {
        throw new Error("network down");
      };

      const cached = await fetchPublicModelsForProvider("anthropic");
      assertEquals(cached.map((model) => model.name), ["claude-sonnet-4.6"]);
    } finally {
      http.fetchRaw = originalFetchRaw;
      resetPublicCatalogCacheForTests();
    }
  });
});
