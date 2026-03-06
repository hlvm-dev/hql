import { assertEquals } from "jsr:@std/assert";
import { http } from "../../../src/common/http-client.ts";
import {
  getOllamaCatalogAsync,
  resetOllamaCatalogCacheForTests,
} from "../../../src/hlvm/providers/ollama/catalog.ts";
import { withTempHlvmDir } from "../helpers.ts";

Deno.test("ollama catalog falls back to persisted cache when network fetch fails", async () => {
  await withTempHlvmDir(async () => {
    resetOllamaCatalogCacheForTests();

    const originalFetchRaw = http.fetchRaw.bind(http);
    http.fetchRaw = async () =>
      new Response(
        JSON.stringify({
          models: [{
            id: "qwen3",
            name: "Qwen 3",
            description: "Tool-capable model",
            variants: [{
              id: "qwen3:latest",
              parameters: "8B",
              size: "4.7GB",
            }],
            vision: false,
            tools: true,
          }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );

    try {
      const initial = await getOllamaCatalogAsync({ maxVariants: Infinity });
      assertEquals(initial.map((model) => model.name), ["qwen3:latest"]);

      resetOllamaCatalogCacheForTests();
      http.fetchRaw = async () => {
        throw new Error("network down");
      };

      const cached = await getOllamaCatalogAsync({ maxVariants: Infinity });
      assertEquals(cached.map((model) => model.name), ["qwen3:latest"]);
    } finally {
      http.fetchRaw = originalFetchRaw;
      resetOllamaCatalogCacheForTests();
    }
  });
});
