import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { WEB_TOOLS, scoreSearchResults } from "../../../src/hlvm/agent/tools/web-tools.ts";
import { ValidationError } from "../../../src/common/error.ts";
import type { AgentPolicy } from "../../../src/hlvm/agent/policy.ts";

Deno.test("search_web validates query", async () => {
  const search = WEB_TOOLS.search_web;
  await assertRejects(
    () => search.fn({} as Record<string, unknown>, "/tmp"),
    ValidationError,
  );
});

Deno.test("fetch_url validates url", async () => {
  const fetch = WEB_TOOLS.fetch_url;
  await assertRejects(
    () => fetch.fn({} as Record<string, unknown>, "/tmp"),
    ValidationError,
  );
});

Deno.test("web_fetch validates url", async () => {
  const fetch = WEB_TOOLS.web_fetch;
  await assertRejects(
    () => fetch.fn({} as Record<string, unknown>, "/tmp"),
    ValidationError,
  );
});

Deno.test("search_web respects network policy (deny)", async () => {
  const search = WEB_TOOLS.search_web;
  const policy: AgentPolicy = {
    version: 1,
    networkRules: { deny: ["*"] },
  };

  await assertRejects(
    () =>
      search.fn(
        { query: "hlvm" },
        "/tmp",
        { policy },
      ),
    ValidationError,
  );
});

Deno.test("fetch_url respects network policy (deny)", async () => {
  const fetch = WEB_TOOLS.fetch_url;
  const policy: AgentPolicy = {
    version: 1,
    networkRules: { deny: ["*"] },
  };

  await assertRejects(
    () =>
      fetch.fn(
        { url: "https://example.com" },
        "/tmp",
        { policy },
      ),
    ValidationError,
  );
});

Deno.test("web tools metadata declares L1 safety", () => {
  assertEquals(WEB_TOOLS.search_web.safetyLevel, "L1");
  assertEquals(WEB_TOOLS.fetch_url.safetyLevel, "L1");
  assertEquals(WEB_TOOLS.web_fetch.safetyLevel, "L1");
});

Deno.test("scoreSearchResults ranks higher relevance first", () => {
  const query = "hlvm tool calling";
  const results = [
    { title: "Unrelated news", url: "https://example.com/news", snippet: "daily report" },
    { title: "HLVM tool calling guide", url: "https://docs.example.com/hlvm-tools", snippet: "tool calling reference" },
    { title: "Tooling tips", url: "https://example.com/tools", snippet: "hlvm basics" },
  ];
  const scored = scoreSearchResults(query, results);
  assertEquals(scored[0].title, "HLVM tool calling guide");
  assert(scored[0].score !== undefined);
});
