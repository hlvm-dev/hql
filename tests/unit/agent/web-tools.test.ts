import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import {
  parseDuckDuckGoSearchResults,
  WEB_TOOLS,
  scoreSearchResults,
} from "../../../src/hlvm/agent/tools/web-tools.ts";
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

Deno.test("parseDuckDuckGoSearchResults parses standard DDG result markup", () => {
  const html = `
  <html><body>
    <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fhlvm-docs">HLVM Docs</a>
    <a class="result__snippet">Official reference docs</a>
    <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fblog">HLVM Blog</a>
    <a class="result__snippet">Latest HLVM updates</a>
  </body></html>`;

  const results = parseDuckDuckGoSearchResults(html, 5);

  assertEquals(results.length, 2);
  assertEquals(results[0].title, "HLVM Docs");
  assertEquals(results[0].url, "https://example.com/hlvm-docs");
  assertEquals(results[0].snippet, "Official reference docs");
});

Deno.test("parseDuckDuckGoSearchResults supports lite result-link markup and dedupes URLs", () => {
  const html = `
  <html><body>
    <a class="result-link" rel="nofollow" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fsame">Same Result</a>
    <td class="result-snippet">First snippet</td>
    <a class="result-link" rel="nofollow" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fsame">Same Result Duplicate</a>
    <td class="result-snippet">Second snippet</td>
    <a class="result-link" rel="nofollow" href="/l/?uddg=https%3A%2F%2Fexample.com%2Ftwo">Second Result</a>
    <td class="result-snippet">Second result snippet</td>
  </body></html>`;

  const results = parseDuckDuckGoSearchResults(html, 5);

  assertEquals(results.length, 2);
  assertEquals(results[0].url, "https://example.com/same");
  assertEquals(results[1].url, "https://example.com/two");
});
