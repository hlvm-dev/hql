import { assertEquals } from "jsr:@std/assert";
import { resolveWebConfig } from "../../../src/common/config/web-resolver.ts";

Deno.test("web resolver: returns defaults when no config provided", () => {
  const resolved = resolveWebConfig();

  assertEquals(resolved.search.provider, "brave");
  assertEquals(resolved.search.maxResults, 5);
  assertEquals(resolved.search.serpapi.baseUrl, "https://serpapi.com");
  assertEquals(resolved.fetch.maxChars, 50000);
});

Deno.test("web resolver: respects serpapi provider config", () => {
  const resolved = resolveWebConfig({
    search: {
      provider: "serpapi",
      serpapi: {
        apiKey: "cfg-serp-key",
        baseUrl: "https://example-serpapi.test",
      },
    },
  });

  assertEquals(resolved.search.provider, "serpapi");
  assertEquals(resolved.search.serpapi.apiKey, "cfg-serp-key");
  assertEquals(resolved.search.serpapi.baseUrl, "https://example-serpapi.test");
});

Deno.test("web resolver: env vars override configured keys", () => {
  const previousBrave = Deno.env.get("BRAVE_API_KEY");
  const previousSerpApi = Deno.env.get("SERPAPI_API_KEY");
  Deno.env.set("BRAVE_API_KEY", "env-brave-key");
  Deno.env.set("SERPAPI_API_KEY", "env-serp-key");

  try {
    const resolved = resolveWebConfig({
      search: {
        brave: { apiKey: "config-brave-key" },
        serpapi: { apiKey: "config-serp-key" },
      },
    });

    assertEquals(resolved.search.brave.apiKey, "env-brave-key");
    assertEquals(resolved.search.serpapi.apiKey, "env-serp-key");
  } finally {
    if (previousBrave === undefined) {
      Deno.env.delete("BRAVE_API_KEY");
    } else {
      Deno.env.set("BRAVE_API_KEY", previousBrave);
    }
    if (previousSerpApi === undefined) {
      Deno.env.delete("SERPAPI_API_KEY");
    } else {
      Deno.env.set("SERPAPI_API_KEY", previousSerpApi);
    }
  }
});
