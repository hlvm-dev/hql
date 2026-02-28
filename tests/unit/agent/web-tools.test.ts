import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import {
  __testOnlyBuildSearchWebCacheKey,
  resetWebToolBudget,
  WEB_TOOLS,
} from "../../../src/hlvm/agent/tools/web-tools.ts";
import {
  parseDuckDuckGoSearchResults,
  scoreSearchResults,
} from "../../../src/hlvm/agent/tools/web/duckduckgo.ts";
import { ValidationError } from "../../../src/common/error.ts";
import type { AgentPolicy } from "../../../src/hlvm/agent/policy.ts";
import { isAllowedByDomainFilters } from "../../../src/hlvm/agent/tools/web/search-provider.ts";

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

Deno.test("web tools metadata declares L0 safety", () => {
  assertEquals(WEB_TOOLS.search_web.safetyLevel, "L0");
  assertEquals(WEB_TOOLS.fetch_url.safetyLevel, "L0");
  assertEquals(WEB_TOOLS.web_fetch.safetyLevel, "L0");
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

// ============================================================
// search_web: domain controls + citations
// ============================================================

Deno.test("search_web schema includes domain filter args", () => {
  const meta = WEB_TOOLS.search_web;
  assert("allowedDomains" in meta.args);
  assert("blockedDomains" in meta.args);
  assert("timeRange" in meta.args);
});

Deno.test("search_web schema declares citation returns", () => {
  const meta = WEB_TOOLS.search_web;
  assert(meta.returns && "citations" in meta.returns);
  assert(meta.returns && "retrievedAt" in meta.returns);
});

// ============================================================
// web_fetch: additive citation + batch mode
// ============================================================

Deno.test("web_fetch schema includes citation and batch args", () => {
  const meta = WEB_TOOLS.web_fetch;
  assert("urls" in meta.args);
  assert(meta.returns && "citation" in meta.returns);
  assert(meta.returns && "retrievedAt" in meta.returns);
});

Deno.test("web_fetch rejects more than 5 batch URLs", async () => {
  const fetch = WEB_TOOLS.web_fetch;
  await assertRejects(
    () =>
      fetch.fn(
        { urls: ["a", "b", "c", "d", "e", "f"] },
        "/tmp",
      ),
    ValidationError,
    "Too many URLs",
  );
});

Deno.test("web_fetch validates url or urls required", async () => {
  const fetch = WEB_TOOLS.web_fetch;
  await assertRejects(
    () => fetch.fn({ maxChars: 100 }, "/tmp"),
    ValidationError,
    "url or urls required",
  );
});

// ============================================================
// cache key + domain matching behavior
// ============================================================

Deno.test("search_web cache key changes with domain filters and is order-invariant", () => {
  const base = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5);
  const allowA = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5, [
    "a.com",
    "b.com",
  ]);
  const allowB = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5, [
    "b.com",
    "a.com",
  ]);
  const blocked = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5, [
    "a.com",
  ], ["x.com"]);
  const dayRange = __testOnlyBuildSearchWebCacheKey(
    "duckduckgo",
    "bitcoin",
    5,
    undefined,
    undefined,
    "day",
  );

  assertEquals(allowA, allowB);
  assert(base !== allowA);
  assert(allowA !== blocked);
  assert(base !== dayRange);
});

Deno.test("domain filter helper uses exact or subdomain matching only", () => {
  assertEquals(isAllowedByDomainFilters("api.github.com", ["github.com"]), true);
  assertEquals(isAllowedByDomainFilters("github.com", ["github.com"]), true);
  assertEquals(isAllowedByDomainFilters("notgithub.com", ["github.com"]), false);
  assertEquals(isAllowedByDomainFilters("evil-github.com", ["github.com"]), false);
  assertEquals(isAllowedByDomainFilters("docs.example.com", undefined, ["example.com"]), false);
});

Deno.test("search_web validates timeRange", async () => {
  const search = WEB_TOOLS.search_web;
  await assertRejects(
    () =>
      search.fn(
        { query: "hlvm", timeRange: "fortnight" },
        "/tmp",
      ),
    ValidationError,
    "timeRange must be one of",
  );
});

// ============================================================
// Locale validation
// ============================================================

Deno.test("search_web validates locale format", async () => {
  const search = WEB_TOOLS.search_web;
  await assertRejects(
    () =>
      search.fn(
        { query: "hlvm", locale: "bad" },
        "/tmp",
      ),
    ValidationError,
    "locale must be format",
  );
});

Deno.test("search_web schema includes locale arg", () => {
  const meta = WEB_TOOLS.search_web;
  assert("locale" in meta.args);
});

// ============================================================
// Structured error codes
// ============================================================

Deno.test("validation errors carry structured errorCode in metadata", async () => {
  try {
    await WEB_TOOLS.search_web.fn({} as Record<string, unknown>, "/tmp");
    assert(false, "should have thrown");
  } catch (err) {
    assert(err instanceof ValidationError);
    const meta = (err as ValidationError & { metadata?: Record<string, unknown> }).metadata;
    assertEquals(meta?.errorCode, "invalid_input");
  }
});

// ============================================================
// Per-run tool budget
// ============================================================

Deno.test("resetWebToolBudget is callable without error", () => {
  resetWebToolBudget();
});

// ============================================================
// Citation excerpt
// ============================================================

Deno.test("web_fetch schema documents citation with excerpt", () => {
  const meta = WEB_TOOLS.web_fetch;
  assert(meta.returns && "citation" in meta.returns);
});
