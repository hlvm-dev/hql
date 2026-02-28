import { assertEquals } from "jsr:@std/assert";
import { resolveWebConfig } from "../../../src/common/config/web-resolver.ts";

Deno.test("web resolver: returns defaults when no config provided", () => {
  const resolved = resolveWebConfig();

  assertEquals(resolved.search.provider, "duckduckgo");
  assertEquals(resolved.search.maxResults, 5);
  assertEquals(resolved.fetch.maxChars, 50000);
});

Deno.test("web resolver: keeps duckduckgo as only search provider", () => {
  const resolved = resolveWebConfig({
    search: {
      provider: "duckduckgo",
      maxResults: 7,
    },
  });

  assertEquals(resolved.search.provider, "duckduckgo");
  assertEquals(resolved.search.maxResults, 7);
});

Deno.test("web resolver: search config ignores unrelated env vars", () => {
  const resolved = resolveWebConfig(
    {
      search: {
        provider: "duckduckgo",
      },
    },
    {
      get: () => undefined,
    },
  );

  assertEquals(resolved.search.provider, "duckduckgo");
});

Deno.test("web resolver: accepts explicit duckduckgo provider config", () => {
  const resolved = resolveWebConfig({
    search: {
      provider: "duckduckgo",
      maxResults: 10,
    },
  });

  assertEquals(resolved.search.provider, "duckduckgo");
  assertEquals(resolved.search.maxResults, 10);
});

Deno.test("web resolver: keeps duckduckgo as default when no provider specified", () => {
  const resolved = resolveWebConfig({
    search: {
      maxResults: 3,
    },
  });

  assertEquals(resolved.search.provider, "duckduckgo");
  assertEquals(resolved.search.maxResults, 3);
});
