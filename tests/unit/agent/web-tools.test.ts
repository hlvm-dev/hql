import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";
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

Deno.test("web_search validates query", async () => {
  const search = WEB_TOOLS.web_search;
  await assertRejects(
    () => search.fn({} as Record<string, unknown>, "/tmp"),
    ValidationError,
  );
});

Deno.test("research_web validates query", async () => {
  const research = WEB_TOOLS.research_web;
  await assertRejects(
    () => research.fn({} as Record<string, unknown>, "/tmp"),
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

Deno.test("extract_url validates url", async () => {
  const extract = WEB_TOOLS.extract_url;
  await assertRejects(
    () => extract.fn({} as Record<string, unknown>, "/tmp"),
    ValidationError,
  );
});

Deno.test("extract_html validates html", async () => {
  const extract = WEB_TOOLS.extract_html;
  await assertRejects(
    () => extract.fn({} as Record<string, unknown>, "/tmp"),
    ValidationError,
  );
});

Deno.test("extract_html parses title, description, text, links", async () => {
  const extract = WEB_TOOLS.extract_html;
  const html = `
    <!doctype html>
    <html>
      <head>
        <title>Example Site</title>
        <meta name="description" content="Example description">
      </head>
      <body>
        <nav>Nav Item</nav>
        <h1>Hello</h1>
        <p>World <a href="https://example.com">Link</a></p>
        <script>var x = 1;</script>
      </body>
    </html>
  `;

  const result = await extract.fn({ html }, "/tmp") as Record<string, unknown>;
  assertEquals(result.title, "Example Site");
  assertEquals(result.description, "Example description");
  assertEquals(result.textTruncated, false);
  assertEquals(result.links, ["https://example.com"]);
  assertStringIncludes(String(result.text), "Hello");
  assertStringIncludes(String(result.text), "World");
  assert(!String(result.text).includes("Nav Item"));
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

Deno.test("research_web respects network policy (deny)", async () => {
  const research = WEB_TOOLS.research_web;
  const policy: AgentPolicy = {
    version: 1,
    networkRules: { deny: ["*"] },
  };

  await assertRejects(
    () =>
      research.fn(
        { query: "hlvm" },
        "/tmp",
        { policy },
      ),
    ValidationError,
  );
});

Deno.test("web tools metadata declares L1 safety", () => {
  assertEquals(WEB_TOOLS.search_web.safetyLevel, "L1");
  assertEquals(WEB_TOOLS.web_search.safetyLevel, "L1");
  assertEquals(WEB_TOOLS.research_web.safetyLevel, "L1");
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
