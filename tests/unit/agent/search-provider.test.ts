import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { ValidationError } from "../../../src/common/error.ts";
import {
  getSearchProvider,
  resetSearchProviders,
  resolveSearchProvider,
} from "../../../src/hlvm/agent/tools/web/search-provider.ts";
import {
  initSearchProviders,
  resetSearchProviderBootstrap,
} from "../../../src/hlvm/agent/tools/web/search-provider-bootstrap.ts";

// Reset state before each test to avoid cross-test pollution
function setup() {
  resetSearchProviderBootstrap();
  resetSearchProviders();
  initSearchProviders();
}

Deno.test("initSearchProviders registers duckduckgo provider", () => {
  setup();
  const ddg = getSearchProvider("duckduckgo");
  assert(ddg !== undefined, "duckduckgo provider should be registered");
  assertEquals(ddg!.name, "duckduckgo");
});

Deno.test("initSearchProviders is idempotent", () => {
  resetSearchProviderBootstrap();
  resetSearchProviders();
  initSearchProviders();
  initSearchProviders(); // second call should be no-op
  const ddg = getSearchProvider("duckduckgo");
  assert(ddg !== undefined);
});

Deno.test("resetSearchProviders clears all state", () => {
  setup();
  resetSearchProviders();
  assertEquals(getSearchProvider("duckduckgo"), undefined);
});

Deno.test("getSearchProvider returns undefined for unknown provider", () => {
  setup();
  assertEquals(getSearchProvider("unknown"), undefined);
});

Deno.test("resolveSearchProvider returns duckduckgo for default", () => {
  setup();
  const provider = resolveSearchProvider("duckduckgo", false);
  assertEquals(provider.name, "duckduckgo");
  assertEquals(provider.requiresApiKey, false);
});

Deno.test("resolveSearchProvider throws for explicit unknown provider", () => {
  setup();
  assertThrows(
    () => resolveSearchProvider("nonexistent", true),
    ValidationError,
  );
});
