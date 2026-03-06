import { assert, assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert";
import {
  __testOnlyAverageResultScore,
  __testOnlyBuildSearchWebCacheKey,
  __testOnlyFormatSearchWebResult,
  __testOnlySelectDiversePrefetchTargets,
  resetWebToolBudget,
  WEB_TOOLS,
} from "../../../src/hlvm/agent/tools/web-tools.ts";
import {
  duckDuckGoSearch,
  generateQueryVariants,
  parseDuckDuckGoSearchResults,
  scoreSearchResults,
} from "../../../src/hlvm/agent/tools/web/duckduckgo.ts";
import { ValidationError } from "../../../src/common/error.ts";
import type { AgentPolicy } from "../../../src/hlvm/agent/policy.ts";
import {
  isAllowedByDomainFilters,
  registerSearchProvider,
  resetSearchProviders,
  type SearchCallOptions,
} from "../../../src/hlvm/agent/tools/web/search-provider.ts";
import {
  initSearchProviders,
  resetSearchProviderBootstrap,
} from "../../../src/hlvm/agent/tools/web/search-provider-bootstrap.ts";
import {
  dedupeSearchResults,
  rankSearchResults,
} from "../../../src/hlvm/agent/tools/web/search-ranking.ts";
import {
  findSystemChrome,
  renderWithChrome,
  shutdownChromeBrowser,
} from "../../../src/hlvm/agent/tools/web/headless-chrome.ts";

async function withIsolatedSearchRegistry(
  fn: () => Promise<void>,
): Promise<void> {
  resetSearchProviderBootstrap();
  resetSearchProviders();
  initSearchProviders();
  try {
    await fn();
  } finally {
    resetSearchProviderBootstrap();
    resetSearchProviders();
    initSearchProviders();
  }
}

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

Deno.test("web_fetch schema includes citations and batch args", () => {
  const meta = WEB_TOOLS.web_fetch;
  assert("urls" in meta.args);
  assert(meta.returns && "citations" in meta.returns);
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

Deno.test("search_web schema includes searchDepth arg", () => {
  const meta = WEB_TOOLS.search_web;
  assert("searchDepth" in meta.args);
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

Deno.test("web_fetch schema documents citations with excerpt", () => {
  const meta = WEB_TOOLS.web_fetch;
  assert(meta.returns && "citations" in meta.returns);
});

// ============================================================
// Headless Chrome fallback
// ============================================================

Deno.test("findSystemChrome returns string or null", async () => {
  const result = await findSystemChrome();
  assert(result === null || typeof result === "string");
});

Deno.test("shutdownChromeBrowser callable without error", async () => {
  await shutdownChromeBrowser();
});

Deno.test("web_fetch schema includes Chrome diagnostic fields in returns", () => {
  const meta = WEB_TOOLS.web_fetch;
  assert(meta.returns && "headlessChrome" in meta.returns);
  assert(meta.returns && "chromeAttempted" in meta.returns);
  assert(meta.returns && "chromeRenderChars" in meta.returns);
});

Deno.test({
  name: "renderWithChrome returns null when no Chrome available",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // When Chrome is not available (or env has no Chrome), should return null
    const originalEnv = Deno.env.get("CHROME_PATH");
    Deno.env.set("CHROME_PATH", "/nonexistent/chrome/binary");
    try {
      const result = await renderWithChrome("https://example.com", 5000);
      // Should return null (no Chrome at that path, and system Chrome may/may not exist)
      // The important thing is it doesn't throw
      assert(result === null || typeof result === "string");
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("CHROME_PATH", originalEnv);
      } else {
        Deno.env.delete("CHROME_PATH");
      }
      await shutdownChromeBrowser();
    }
  },
});

// ============================================================
// Prefetch cache key differentiation
// ============================================================

Deno.test("search cache key differs with prefetch on vs off", () => {
  const keyOn = __testOnlyBuildSearchWebCacheKey(
    "duckduckgo",
    "test",
    5,
    undefined,
    undefined,
    "all",
    undefined,
    "medium",
    true,
  );
  const keyOff = __testOnlyBuildSearchWebCacheKey(
    "duckduckgo",
    "test",
    5,
    undefined,
    undefined,
    "all",
    undefined,
    "medium",
    false,
  );
  assertNotEquals(keyOn, keyOff);
});

Deno.test("search cache key differs with searchDepth profile", () => {
  const low = __testOnlyBuildSearchWebCacheKey(
    "duckduckgo",
    "test",
    5,
    undefined,
    undefined,
    "all",
    undefined,
    "low",
    true,
    true,
  );
  const high = __testOnlyBuildSearchWebCacheKey(
    "duckduckgo",
    "test",
    5,
    undefined,
    undefined,
    "all",
    undefined,
    "high",
    true,
    true,
  );
  assertNotEquals(low, high);
});

Deno.test("search_web schema includes prefetch arg and passages return", () => {
  const meta = WEB_TOOLS.search_web;
  assert("prefetch" in meta.args);
  assert(meta.returns && "results[].passages" in meta.returns);
});

// ============================================================
// formatResult — compact text output
// ============================================================

Deno.test("formatResult returns compact text, not JSON", () => {
  const raw = {
    query: "deno 2.2 release",
    provider: "duckduckgo",
    count: 2,
    results: [
      { title: "Deno 2.2 Release Notes", url: "https://deno.com/blog/v2.2", snippet: "Deno 2.2 introduces workspaces", publishedDate: "2026-02-15", passages: ["The new release includes faster startup"] },
      { title: "What's New in Deno", url: "https://blog.example.com/deno-22", snippet: "Deno adds monorepo support" },
    ],
  };
  const formatted = __testOnlyFormatSearchWebResult(raw);
  assert(formatted !== null);
  assert(formatted!.returnDisplay.includes('Search: "deno 2.2 release"'));
  assert(formatted!.summaryDisplay.includes('Top sources for "deno 2.2 release"'));
  assert(formatted!.summaryDisplay.includes("[1] Deno 2.2 Release Notes"));
  assert(formatted!.returnDisplay.includes("[1] Deno 2.2 Release Notes"));
  assert(formatted!.returnDisplay.includes("Deno 2.2 Release Notes"));
  assert(formatted!.returnDisplay.includes("Published: 2026-02-15"));
  assert(formatted!.returnDisplay.includes("The new release includes faster startup"));
  assert(!formatted!.summaryDisplay.includes("Trust: authority="));
  assert(!formatted!.summaryDisplay.includes("{"));  // not JSON
});

Deno.test("formatResult shows pageDescription alongside snippet when both exist", () => {
  const raw = {
    query: "test",
    provider: "duckduckgo",
    count: 1,
    results: [
      {
        title: "Test Page",
        url: "https://example.com/test",
        snippet: "Short DDG snippet",
        pageDescription: "A much longer and richer description extracted from the page metadata",
      },
    ],
  };
  const formatted = __testOnlyFormatSearchWebResult(raw);
  assert(formatted !== null);
  // Concise user display should prefer the richer pageDescription summary.
  assert(!formatted!.summaryDisplay.includes("Short DDG snippet"));
  assert(formatted!.summaryDisplay.includes("A much longer and richer description"));
  // Full llmContent still preserves the detailed search listing.
  assert(formatted!.llmContent.includes("> Short DDG snippet"));
  assert(formatted!.llmContent.includes("> A much longer and richer description"));
});

Deno.test("formatResult raw result still has full results array", () => {
  const raw = {
    query: "test",
    provider: "duckduckgo",
    count: 1,
    results: [{ title: "Result", url: "https://example.com", snippet: "snippet" }],
    citations: [{ url: "https://example.com", title: "Result" }],
  };
  // formatResult only produces display text; raw object is untouched
  const formatted = __testOnlyFormatSearchWebResult(raw);
  assert(formatted !== null);
  assert(Array.isArray(raw.results));
  assertEquals(raw.results.length, 1);
  assertEquals(raw.citations.length, 1);
});

// ============================================================
// Cache key versioning: reformulate on vs off
// ============================================================

Deno.test("search cache key differs with reformulate on vs off", () => {
  const keyOn = __testOnlyBuildSearchWebCacheKey(
    "duckduckgo",
    "test",
    5,
    undefined,
    undefined,
    "all",
    undefined,
    "medium",
    true,
    true,
  );
  const keyOff = __testOnlyBuildSearchWebCacheKey(
    "duckduckgo",
    "test",
    5,
    undefined,
    undefined,
    "all",
    undefined,
    "medium",
    true,
    false,
  );
  assertNotEquals(keyOn, keyOff);
});

// ============================================================
// Reformulation merge/dedup (helper composition)
// ============================================================

Deno.test("dedupeSearchResults + rankSearchResults merge overlapping results correctly", () => {
  const query1Results = [
    { title: "Result A", url: "https://example.com/a", snippet: "deno release notes" },
    { title: "Result B", url: "https://example.com/b", snippet: "deno features overview" },
  ];
  const query2Results = [
    { title: "Result A (dup)", url: "https://example.com/a", snippet: "deno release notes (variant)" },
    { title: "Result C", url: "https://example.com/c", snippet: "deno typescript support" },
  ];
  const merged = [...query1Results, ...query2Results];
  const deduped = dedupeSearchResults(merged);
  assertEquals(deduped.length, 3); // A + B + C (A deduped)
  const ranked = rankSearchResults("deno release", deduped, "all");
  const limited = ranked.slice(0, 2);
  assertEquals(limited.length, 2);  // respects limit
});

// ============================================================
// Reformulation integration: duckDuckGoSearch with fetch stub
// ============================================================

Deno.test({
  name: "duckDuckGoSearch with reformulate=true fires variant queries and merges results",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Build fake DDG HTML for original query (only 1 result — triggers reformulation)
    function fakeDdgHtml(urls: string[]): string {
      const items = urls.map((u) =>
        `<a class="result__a" href="${u}">${u.split("/").pop()}</a>
         <a class="result__snippet">Snippet for ${u.split("/").pop()}</a>`
      ).join("\n");
      return `<html><body>${items}</body></html>`;
    }

    const queriesSeen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(url);
      const q = parsed.searchParams.get("q") ?? "";
      queriesSeen.push(q);

      // Original query returns 1 result (not enough → triggers variants)
      // Variant queries return 1 different result each
      let body: string;
      if (q === "deno 2.2 release") {
        body = fakeDdgHtml(["https://example.com/original"]);
      } else {
        body = fakeDdgHtml([`https://example.com/variant-${queriesSeen.length}`]);
      }

      return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/html" } }));
    }) as typeof globalThis.fetch;

    try {
      const raw = await duckDuckGoSearch("deno 2.2 release", 5, 10000, "all", undefined, undefined, undefined, undefined, true);
      const results = raw.results as Array<{ url?: string }>;

      // Should have fired variant queries
      const variants = generateQueryVariants("deno 2.2 release");
      assert(variants.length > 0, "should generate at least 1 variant");

      // Verify variant queries were actually sent (more than just the original + page2)
      assert(queriesSeen.length >= 2, `expected >=2 queries, got ${queriesSeen.length}: ${queriesSeen.join(", ")}`);

      // Results should be merged and deduped from original + variants
      assert(results.length >= 2, `expected >=2 merged results, got ${results.length}`);

      // Original URL should be present
      assert(results.some((r) => r.url === "https://example.com/original"), "original result missing");

      // At least one variant result should be present
      assert(results.some((r) => r.url?.includes("variant")), "no variant results merged");
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name: "duckDuckGoSearch low-confidence results trigger one variant retry even when limit is met",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    function fakeDdgHtml(urls: string[], label: string): string {
      const items = urls.map((u) =>
        `<a class="result__a" href="${u}">${label}</a>
         <a class="result__snippet">${label}</a>`
      ).join("\n");
      return `<html><body>${items}</body></html>`;
    }

    const query = "obscure 2026 signal";
    const expectedVariant = generateQueryVariants(query, 1)[0];
    assert(expectedVariant, "expected at least one variant");

    const queriesSeen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(url);
      const q = parsed.searchParams.get("q") ?? "";
      queriesSeen.push(q);

      // Original query already has 5 results (meets limit) but they are low-relevance.
      if (q === query) {
        const body = fakeDdgHtml([
          "https://example.com/a",
          "https://example.com/b",
          "https://example.com/c",
          "https://example.com/d",
          "https://example.com/e",
        ], "generic page");
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/html" } }));
      }

      const body = fakeDdgHtml(["https://example.com/variant-retry"], "variant page");
      return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/html" } }));
    }) as typeof globalThis.fetch;

    try {
      const raw = await duckDuckGoSearch(query, 5, 10000, "all", undefined, undefined, undefined, undefined, true);
      const diagnostics = (raw.diagnostics ?? {}) as Record<string, unknown>;
      assertEquals(diagnostics.lowConfidenceRetryTriggered, true);
      assert(queriesSeen.includes(expectedVariant), `missing retry query: ${expectedVariant}`);
      assert(queriesSeen.length >= 2, `expected >=2 requests, got ${queriesSeen.length}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});

// ============================================================
// formatResult — quality hint in llmContent only
// ============================================================

Deno.test("formatResult appends low-relevance tip in llmContent only when avg score < 4", () => {
  const raw = {
    query: "obscure topic",
    provider: "duckduckgo",
    count: 2,
    results: [
      { title: "Result A", url: "https://a.com", snippet: "unrelated", score: 2 },
      { title: "Result B", url: "https://b.com", snippet: "also unrelated", score: 3 },
    ],
  };
  const formatted = __testOnlyFormatSearchWebResult(raw);
  assert(formatted !== null);
  assert(!formatted!.summaryDisplay.includes("Tip:"), "tip should NOT be in summaryDisplay");
  assert(formatted!.summaryDisplay.includes("Evidence is weak."), "plain-language weak-evidence warning should be visible");
  assert(formatted!.llmContent.includes("Tip: Results have low relevance scores"), "tip should be in llmContent");
  assert(formatted!.llmContent.includes("Confidence reason:"), "confidence reason should be included in llmContent");
});

Deno.test("formatResult omits tip when avg score >= 4", () => {
  const raw = {
    query: "well matched",
    provider: "duckduckgo",
    count: 2,
    results: [
      { title: "Good A", url: "https://a.com", snippet: "well matched guide", score: 8 },
      { title: "Good B", url: "https://b.com", snippet: "well matched tutorial", score: 6 },
    ],
  };
  const formatted = __testOnlyFormatSearchWebResult(raw);
  assert(formatted !== null);
  assert(!formatted!.llmContent.includes("Tip:"), "no tip when scores are good");
  assert(formatted!.summaryDisplay.includes('Top sources for "well matched"'));
  assert(formatted!.llmContent.includes("[1] Good A"));
  assert(formatted!.summaryDisplay !== formatted!.llmContent);
});

Deno.test("formatResult computes avg from defined scores only (skips undefined)", () => {
  const raw = {
    query: "mixed",
    provider: "duckduckgo",
    count: 3,
    results: [
      { title: "Scored", url: "https://a.com", snippet: "mixed query match", score: 8 },
      { title: "Unscored", url: "https://b.com", snippet: "mixed reference" },
      { title: "Also Unscored", url: "https://c.com", snippet: "mixed docs" },
    ],
  };
  const formatted = __testOnlyFormatSearchWebResult(raw);
  assert(formatted !== null);
  // Only 1 scored result with score=8 → avg=8 → no tip
  assert(!formatted!.llmContent.includes("Tip:"), "avg of defined scores (8) >= 4, no tip");
});

Deno.test("formatResult includes relatedLinks and uncertainty hint only in llmContent on low confidence", () => {
  const raw = {
    query: "uncertain query",
    provider: "duckduckgo",
    count: 1,
    results: [
      {
        title: "Weak Result",
        url: "https://example.com/weak",
        snippet: "weak match",
        score: 2,
        relatedLinks: ["https://docs.example.com/ref", "https://other.example.org/guide"],
      },
    ],
  };
  const formatted = __testOnlyFormatSearchWebResult(raw);
  assert(formatted !== null);
  assert(!formatted!.summaryDisplay.includes("Related links to check:"));
  assert(!formatted!.summaryDisplay.includes("confidence is low"));
  assert(formatted!.llmContent.includes("Related links to check:"));
  assert(formatted!.llmContent.includes("https://docs.example.com/ref"));
  assert(formatted!.llmContent.includes("confidence is low"));
});

// ============================================================
// Diverse prefetch targeting
// ============================================================

Deno.test("diverse prefetch selects unique hosts first, backfills to 2", () => {
  const results = [
    { title: "A", url: "https://example.com/a", snippet: "a" },
    { title: "B", url: "https://example.com/b", snippet: "b" },
    { title: "C", url: "https://other.com/c", snippet: "c" },
  ];
  const prefetchTargets = __testOnlySelectDiversePrefetchTargets(results, 2);
  assertEquals(prefetchTargets.length, 2);
  assertEquals(prefetchTargets[0].url, "https://example.com/a");
  assertEquals(prefetchTargets[1].url, "https://other.com/c"); // skipped example.com/b
});

Deno.test("diverse prefetch backfills same-host when all results share one domain", () => {
  const results = [
    { title: "A", url: "https://same.com/a", snippet: "a" },
    { title: "B", url: "https://same.com/b", snippet: "b" },
    { title: "C", url: "https://same.com/c", snippet: "c" },
  ];

  const prefetchTargets = __testOnlySelectDiversePrefetchTargets(results, 2);

  // Pass 1 gets A (unique host), pass 2 backfills B
  assertEquals(prefetchTargets.length, 2);
  assertEquals(prefetchTargets[0].url, "https://same.com/a");
  assertEquals(prefetchTargets[1].url, "https://same.com/b");
});

Deno.test("adaptive prefetch can select 3 targets for low-confidence searches", () => {
  const results = [
    { title: "A", url: "https://a.com/1", snippet: "a" },
    { title: "B", url: "https://a.com/2", snippet: "b" },
    { title: "C", url: "https://b.com/3", snippet: "c" },
    { title: "D", url: "https://c.com/4", snippet: "d" },
  ];
  const prefetchTargets = __testOnlySelectDiversePrefetchTargets(results, 3);
  assertEquals(prefetchTargets.length, 3);
  assertEquals(prefetchTargets[0].url, "https://a.com/1");
  assertEquals(prefetchTargets[1].url, "https://b.com/3");
  assertEquals(prefetchTargets[2].url, "https://c.com/4");
});

Deno.test("average score helper returns undefined when no scored results", () => {
  const avg = __testOnlyAverageResultScore([
    { title: "A", url: "https://a.com" },
    { title: "B", url: "https://b.com" },
  ]);
  assertEquals(avg, undefined);
});

Deno.test("search_web validates searchDepth", async () => {
  const search = WEB_TOOLS.search_web;
  await assertRejects(
    () => search.fn({ query: "hlvm", searchDepth: "ultra" }, "/tmp"),
    ValidationError,
    "searchDepth must be one of",
  );
});

Deno.test({
  name: "search_web auto deep round triggers on low-confidence results",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      const queriesSeen: string[] = [];
      const query = `deno 2.2 sqlite builtin changes ${crypto.randomUUID().slice(0, 8)}`;
      registerSearchProvider({
        name: "duckduckgo",
        displayName: "deterministic-low-confidence",
      requiresApiKey: false,
      search(query: string, opts: SearchCallOptions) {
        queriesSeen.push(query);
        if (queriesSeen.length === 1) {
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 1,
            results: [
              {
                title: "Home",
                url: "https://generic.example.com/home",
                snippet: "welcome page",
              },
            ],
            diagnostics: { round: 1, limit: opts.limit },
          });
        }
        return Promise.resolve({
          query,
          provider: "duckduckgo",
          count: 2,
          results: [
            {
              title: "Deno 2.2 SQLite Builtin Release Notes",
              url: "https://docs.deno.com/runtime/sqlite/",
              snippet: "Deno 2.2 sqlite builtin changes and migration notes",
            },
            {
              title: "Deno 2.2 Blog",
              url: "https://deno.com/blog/v2.2",
              snippet: "What's new in deno 2.2 release",
            },
          ],
          diagnostics: { round: 2, limit: opts.limit },
        });
      },
    });

    resetWebToolBudget();
    const result = await WEB_TOOLS.search_web.fn(
      {
        query,
        maxResults: 3,
        prefetch: false,
        reformulate: false,
      },
      "/tmp",
    ) as Record<string, unknown>;

    const diagnostics = result.diagnostics as Record<string, unknown>;
    const deep = diagnostics.deep as Record<string, unknown>;
    assertEquals(queriesSeen.length, 2);
    assertEquals(deep.autoTriggered, true);
    assertEquals(deep.rounds, 2);
      assert(Array.isArray(deep.queryTrail));
    });
  },
});

Deno.test({
  name: "search_web auto deep round stays off for high-confidence results",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      const queriesSeen: string[] = [];
      const uniqueToken = crypto.randomUUID().slice(0, 8);
      const query = `python asyncio taskgroup tutorial ${uniqueToken}`;
      registerSearchProvider({
        name: "duckduckgo",
        displayName: "deterministic-high-confidence",
      requiresApiKey: false,
      search(query: string, opts: SearchCallOptions) {
        queriesSeen.push(query);
        return Promise.resolve({
          query,
          provider: "duckduckgo",
          count: 3,
          results: [
            {
              title: "Python asyncio TaskGroup Documentation",
              url: "https://docs.python.org/3/library/asyncio-task.html",
              snippet: `TaskGroup structured concurrency asyncio tutorial reference ${uniqueToken}`,
              score: 12,
            },
            {
              title: "TaskGroup Guide",
              url: "https://realpython.com/python311-exception-groups/",
              snippet: `python asyncio taskgroup tutorial and guide ${uniqueToken}`,
              score: 8,
            },
            {
              title: "TaskGroup Examples",
              url: "https://superfastpython.com/asyncio-taskgroup/",
              snippet: `asyncio taskgroup examples for Python ${uniqueToken}`,
              score: 7,
            },
          ],
          diagnostics: { limit: opts.limit },
        });
      },
    });

    resetWebToolBudget();
    const result = await WEB_TOOLS.search_web.fn(
      {
        query,
        maxResults: 3,
        prefetch: false,
        reformulate: false,
      },
      "/tmp",
    ) as Record<string, unknown>;

    const diagnostics = result.diagnostics as Record<string, unknown>;
    const deep = diagnostics.deep as Record<string, unknown>;
    assertEquals(queriesSeen.length, 1);
      assertEquals(deep.autoTriggered, false);
      assertEquals(deep.rounds, 1);
    });
  },
});
