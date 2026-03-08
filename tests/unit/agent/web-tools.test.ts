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
import { __testOnlyResetWebCache } from "../../../src/hlvm/agent/web-cache.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

async function withIsolatedSearchRegistry(
  fn: () => Promise<void>,
): Promise<void> {
  await __testOnlyResetWebCache();
  resetSearchProviderBootstrap();
  resetSearchProviders();
  initSearchProviders();
  try {
    await fn();
  } finally {
    await __testOnlyResetWebCache();
    resetSearchProviderBootstrap();
    resetSearchProviders();
    initSearchProviders();
  }
}

async function withStubbedFetch(
  stub: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    stub(input, init)) as typeof globalThis.fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function fakeDdgHtml(items: Array<{ url: string; title: string; snippet: string }>): string {
  return `<html><body>${items.map((item) =>
    `<a class="result__a" href="${item.url}">${item.title}</a>
     <a class="result__snippet">${item.snippet}</a>`
  ).join("\n")}</body></html>`;
}

Deno.test("web tools: input validation and network policy denial are enforced", async () => {
  const denyAll: AgentPolicy = { version: 1, networkRules: { deny: ["*"] } };

  await assertRejects(() => WEB_TOOLS.search_web.fn({} as Record<string, unknown>, "/tmp"), ValidationError);
  await assertRejects(() => WEB_TOOLS.fetch_url.fn({} as Record<string, unknown>, "/tmp"), ValidationError);
  await assertRejects(() => WEB_TOOLS.web_fetch.fn({} as Record<string, unknown>, "/tmp"), ValidationError);
  await assertRejects(() => WEB_TOOLS.search_web.fn({ query: "hlvm" }, "/tmp", { policy: denyAll }), ValidationError);
  await assertRejects(() => WEB_TOOLS.fetch_url.fn({ url: "https://example.com" }, "/tmp", { policy: denyAll }), ValidationError);
});

Deno.test("web tools: schema and metadata expose the core search and fetch contract", () => {
  const searchMeta = WEB_TOOLS.search_web;
  const fetchMeta = WEB_TOOLS.web_fetch;

  assertEquals(searchMeta.safetyLevel, "L0");
  assertEquals(WEB_TOOLS.fetch_url.safetyLevel, "L0");
  assertEquals(fetchMeta.safetyLevel, "L0");

  assert("allowedDomains" in searchMeta.args);
  assert("blockedDomains" in searchMeta.args);
  assert("timeRange" in searchMeta.args);
  assert("locale" in searchMeta.args);
  assert("searchDepth" in searchMeta.args);
  assert("prefetch" in searchMeta.args);
  assert(searchMeta.returns && "citations" in searchMeta.returns);
  assert(searchMeta.returns && "retrievedAt" in searchMeta.returns);
  assert(searchMeta.returns && "results[].passages" in searchMeta.returns);

  assert("urls" in fetchMeta.args);
  assert(fetchMeta.returns && "citations" in fetchMeta.returns);
  assert(fetchMeta.returns && "headlessChrome" in fetchMeta.returns);
  assert(fetchMeta.returns && "chromeAttempted" in fetchMeta.returns);
  assert(fetchMeta.returns && "chromeRenderChars" in fetchMeta.returns);
});

Deno.test("web tools: search and fetch validation reject invalid batch and query options with structured errors", async () => {
  await assertRejects(
    () => WEB_TOOLS.web_fetch.fn({ urls: ["a", "b", "c", "d", "e", "f"] }, "/tmp"),
    ValidationError,
    "Too many URLs",
  );
  await assertRejects(
    () => WEB_TOOLS.web_fetch.fn({ maxChars: 100 }, "/tmp"),
    ValidationError,
    "url or urls required",
  );
  await assertRejects(
    () => WEB_TOOLS.search_web.fn({ query: "hlvm", timeRange: "fortnight" }, "/tmp"),
    ValidationError,
    "timeRange must be one of",
  );
  await assertRejects(
    () => WEB_TOOLS.search_web.fn({ query: "hlvm", locale: "bad" }, "/tmp"),
    ValidationError,
    "locale must be format",
  );
  await assertRejects(
    () => WEB_TOOLS.search_web.fn({ query: "hlvm", searchDepth: "ultra" }, "/tmp"),
    ValidationError,
    "searchDepth must be one of",
  );

  try {
    await WEB_TOOLS.search_web.fn({} as Record<string, unknown>, "/tmp");
    assert(false, "should have thrown");
  } catch (error) {
    assert(error instanceof ValidationError);
    const metadata = (error as ValidationError & { metadata?: Record<string, unknown> }).metadata;
    assertEquals(metadata?.errorCode, "invalid_input");
  }
});

Deno.test("web tools: cache keys stay order-invariant but change across behavioral dimensions", () => {
  const base = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5);
  const allowA = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5, ["a.com", "b.com"]);
  const allowB = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5, ["b.com", "a.com"]);
  const blocked = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5, ["a.com"], ["x.com"]);
  const dayRange = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5, undefined, undefined, "day");
  const prefetchOff = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5, undefined, undefined, "all", undefined, "medium", false);
  const reformulateOff = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5, undefined, undefined, "all", undefined, "medium", true, false);
  const searchDepthHigh = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5, undefined, undefined, "all", undefined, "high", true, true);

  assertEquals(allowA, allowB);
  assertNotEquals(base, allowA);
  assertNotEquals(allowA, blocked);
  assertNotEquals(base, dayRange);
  assertNotEquals(base, prefetchOff);
  assertNotEquals(base, reformulateOff);
  assertNotEquals(base, searchDepthHigh);
});

Deno.test("web tools: search ranking and domain filters keep relevant domains only", () => {
  const scored = scoreSearchResults("hlvm tool calling", [
    { title: "Unrelated", url: "https://example.com/news", snippet: "daily report" },
    { title: "HLVM tool calling guide", url: "https://docs.example.com/hlvm-tools", snippet: "tool calling reference" },
    { title: "Tooling tips", url: "https://example.com/tools", snippet: "hlvm basics" },
  ]);

  assertEquals(scored[0].title, "HLVM tool calling guide");
  assert(scored[0].score !== undefined);
  assertEquals(isAllowedByDomainFilters("api.github.com", ["github.com"]), true);
  assertEquals(isAllowedByDomainFilters("github.com", ["github.com"]), true);
  assertEquals(isAllowedByDomainFilters("notgithub.com", ["github.com"]), false);
  assertEquals(isAllowedByDomainFilters("evil-github.com", ["github.com"]), false);
  assertEquals(isAllowedByDomainFilters("docs.example.com", undefined, ["example.com"]), false);
});

Deno.test("web tools: DuckDuckGo parsing supports both standard and lite markup with dedupe", () => {
  const standard = parseDuckDuckGoSearchResults(`
    <html><body>
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fhlvm-docs">HLVM Docs</a>
      <a class="result__snippet">Official reference docs</a>
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fblog">HLVM Blog</a>
      <a class="result__snippet">Latest HLVM updates</a>
    </body></html>
  `, 5);

  assertEquals(standard.length, 2);
  assertEquals(standard[0].title, "HLVM Docs");
  assertEquals(standard[0].url, "https://example.com/hlvm-docs");
  assertEquals(standard[0].snippet, "Official reference docs");

  const lite = parseDuckDuckGoSearchResults(`
    <html><body>
      <a class="result-link" rel="nofollow" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fsame">Same Result</a>
      <td class="result-snippet">First snippet</td>
      <a class="result-link" rel="nofollow" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fsame">Same Result Duplicate</a>
      <td class="result-snippet">Second snippet</td>
      <a class="result-link" rel="nofollow" href="/l/?uddg=https%3A%2F%2Fexample.com%2Ftwo">Second Result</a>
      <td class="result-snippet">Second result snippet</td>
    </body></html>
  `, 5);

  assertEquals(lite.length, 2);
  assertEquals(lite[0].url, "https://example.com/same");
  assertEquals(lite[1].url, "https://example.com/two");
});

Deno.test("web tools: formatting keeps compact displays, preserves raw results, and annotates low-confidence output", () => {
  const highConfidence = __testOnlyFormatSearchWebResult({
    query: "deno 2.2 release",
    provider: "duckduckgo",
    count: 2,
    diagnostics: {
      retrieval: {
        queryTrail: ["deno 2.2 release", "deno 2.2 release official docs"],
      },
    },
    results: [
      {
        title: "Deno 2.2 Release Notes",
        url: "https://deno.com/blog/v2.2",
        snippet: "Deno 2.2 introduces workspaces",
        pageDescription: "A much longer and richer description extracted from the page metadata",
        publishedDate: "2026-02-15",
        passages: ["The new release includes faster startup"],
        evidenceStrength: "high",
        evidenceReason: "page passages",
        score: 8,
      },
      { title: "What's New in Deno", url: "https://blog.example.com/deno-22", snippet: "Deno adds monorepo support", score: 6 },
    ],
    citations: [{ url: "https://deno.com/blog/v2.2", title: "Deno 2.2 Release Notes" }],
  });
  assert(highConfidence !== null);
  assert(highConfidence!.returnDisplay.includes('Search: "deno 2.2 release"'));
  assert(highConfidence!.returnDisplay.includes("A much longer and richer description"));
  assert(highConfidence!.llmContent.includes("A much longer and richer description"));
  assert(highConfidence!.llmContent.includes("Evidence pages:"));
  assert(highConfidence!.llmContent.includes("Query trail:"));
  assert(highConfidence!.returnDisplay.includes("Published: 2026-02-15"));
  assert(!highConfidence!.summaryDisplay.includes("{"));

  const lowConfidence = __testOnlyFormatSearchWebResult({
    query: "obscure topic",
    provider: "duckduckgo",
    count: 1,
    results: [
      {
        title: "Weak Result",
        url: "https://example.com/weak",
        snippet: "weak match",
        score: 2,
        relatedLinks: ["https://docs.example.com/ref"],
      },
    ],
  });
  assert(lowConfidence !== null);
  assert(lowConfidence!.summaryDisplay.includes("Evidence is weak."));
  assert(!lowConfidence!.summaryDisplay.includes("Related links to check:"));
  assert(lowConfidence!.llmContent.includes("Tip: Results have low relevance scores"));
  assert(lowConfidence!.llmContent.includes("Related links to check:"));
});

Deno.test("web tools: ranking helpers dedupe overlaps and compute confidence metrics", () => {
  const merged = dedupeSearchResults([
    { title: "Result A", url: "https://example.com/a", snippet: "deno release notes" },
    { title: "Result B", url: "https://example.com/b", snippet: "deno features overview" },
    { title: "Result A (dup)", url: "https://example.com/a", snippet: "deno release notes (variant)" },
    { title: "Result C", url: "https://example.com/c", snippet: "deno typescript support" },
  ]);
  assertEquals(merged.length, 3);
  assertEquals(rankSearchResults("deno release", merged, "all").slice(0, 2).length, 2);

  assertEquals(__testOnlyAverageResultScore([
    { title: "Scored", url: "https://a.com", score: 8 },
    { title: "Unscored", url: "https://b.com" },
  ]), 8);
  assertEquals(__testOnlyAverageResultScore([
    { title: "A", url: "https://a.com" },
    { title: "B", url: "https://b.com" },
  ]), undefined);
});

Deno.test("web tools: diverse prefetch selection prioritizes unique hosts before backfill", () => {
  assertEquals(
    __testOnlySelectDiversePrefetchTargets([
      { title: "A", url: "https://example.com/a", snippet: "a" },
      { title: "B", url: "https://example.com/b", snippet: "b" },
      { title: "C", url: "https://other.com/c", snippet: "c" },
    ], 2).map((result) => result.url),
    ["https://example.com/a", "https://other.com/c"],
  );

  assertEquals(
    __testOnlySelectDiversePrefetchTargets([
      { title: "A", url: "https://same.com/a", snippet: "a" },
      { title: "B", url: "https://same.com/b", snippet: "b" },
      { title: "C", url: "https://same.com/c", snippet: "c" },
    ], 2).map((result) => result.url),
    ["https://same.com/a", "https://same.com/b"],
  );

  assertEquals(
    __testOnlySelectDiversePrefetchTargets([
      { title: "A", url: "https://a.com/1", snippet: "a" },
      { title: "B", url: "https://a.com/2", snippet: "b" },
      { title: "C", url: "https://b.com/3", snippet: "c" },
      { title: "D", url: "https://c.com/4", snippet: "d" },
    ], 3).map((result) => result.url),
    ["https://a.com/1", "https://b.com/3", "https://c.com/4"],
  );
});

Deno.test({
  name: "web tools: Chrome helpers fail soft when the browser is unavailable",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const originalChromePath = platform.env.get("CHROME_PATH");
    platform.env.set("CHROME_PATH", "/nonexistent/chrome/binary");
    try {
      const chrome = await findSystemChrome();
      assert(chrome === null || typeof chrome === "string");
      const rendered = await renderWithChrome("https://example.com", 5000);
      assert(rendered === null || typeof rendered === "string");
    } finally {
      if (originalChromePath === undefined) {
        platform.env.delete("CHROME_PATH");
      } else {
        platform.env.set("CHROME_PATH", originalChromePath);
      }
      await shutdownChromeBrowser();
    }
  },
});

Deno.test({
  name: "web tools: reformulation merges variant results when the first search is insufficient",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const queriesSeen: string[] = [];

    await withStubbedFetch(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const query = new URL(url).searchParams.get("q") ?? "";
      queriesSeen.push(query);
      if (query === "deno 2.2 release") {
        return new Response(fakeDdgHtml([
          { url: "https://example.com/original", title: "original", snippet: "original" },
        ]), { status: 200, headers: { "Content-Type": "text/html" } });
      }
      return new Response(fakeDdgHtml([
        { url: `https://example.com/variant-${queriesSeen.length}`, title: "variant", snippet: "variant" },
      ]), { status: 200, headers: { "Content-Type": "text/html" } });
    }, async () => {
      const raw = await duckDuckGoSearch("deno 2.2 release", 5, 10000, "all", undefined, undefined, undefined, undefined, true);
      const variants = generateQueryVariants("deno 2.2 release");
      const results = raw.results as Array<{ url?: string }>;

      assert(variants.length > 0);
      assert(queriesSeen.length >= 2);
      assert(results.some((result) => result.url === "https://example.com/original"));
      assert(results.some((result) => result.url?.includes("variant")));
    });
  },
});

Deno.test({
  name: "web tools: low-confidence retry fires one variant query even when the initial limit is met",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const query = "obscure 2026 signal";
    const expectedVariant = generateQueryVariants(query, 1)[0];
    const queriesSeen: string[] = [];

    await withStubbedFetch(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const q = new URL(url).searchParams.get("q") ?? "";
      queriesSeen.push(q);
      if (q === query) {
        return new Response(fakeDdgHtml([
          { url: "https://example.com/a", title: "generic", snippet: "generic page" },
          { url: "https://example.com/b", title: "generic", snippet: "generic page" },
          { url: "https://example.com/c", title: "generic", snippet: "generic page" },
          { url: "https://example.com/d", title: "generic", snippet: "generic page" },
          { url: "https://example.com/e", title: "generic", snippet: "generic page" },
        ]), { status: 200, headers: { "Content-Type": "text/html" } });
      }
      return new Response(fakeDdgHtml([
        { url: "https://example.com/variant-retry", title: "variant", snippet: "variant page" },
      ]), { status: 200, headers: { "Content-Type": "text/html" } });
    }, async () => {
      const raw = await duckDuckGoSearch(query, 5, 10000, "all", undefined, undefined, undefined, undefined, true);
      const diagnostics = (raw.diagnostics ?? {}) as Record<string, unknown>;
      assertEquals(diagnostics.lowConfidenceRetryTriggered, true);
      assert(expectedVariant);
      assert(queriesSeen.includes(expectedVariant));
      assert(queriesSeen.length >= 2);
    });
  },
});

Deno.test({
  name: "web tools: auto deep round triggers for weak searches and stays off for strong ones",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      const lowQueriesSeen: string[] = [];
      const lowQuery = `deno 2.2 sqlite builtin changes ${crypto.randomUUID().slice(0, 8)}`;

      registerSearchProvider({
        name: "duckduckgo",
        displayName: "deterministic-low-confidence",
        requiresApiKey: false,
        search(query: string, opts: SearchCallOptions) {
          lowQueriesSeen.push(query);
          if (lowQueriesSeen.length === 1) {
            return Promise.resolve({
              query,
              provider: "duckduckgo",
              count: 1,
              results: [{ title: "Home", url: "https://generic.example.com/home", snippet: "welcome page" }],
              diagnostics: { round: 1, limit: opts.limit },
            });
          }
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 2,
            results: [
              { title: "Deno 2.2 SQLite Builtin Release Notes", url: "https://docs.deno.com/runtime/sqlite/", snippet: "Deno 2.2 sqlite builtin changes and migration notes" },
              { title: "Deno 2.2 Blog", url: "https://deno.com/blog/v2.2", snippet: "What's new in deno 2.2 release" },
            ],
            diagnostics: { round: 2, limit: opts.limit },
          });
        },
      });

      resetWebToolBudget();
      const lowResult = await WEB_TOOLS.search_web.fn({ query: lowQuery, maxResults: 3, prefetch: false, reformulate: false }, "/tmp") as Record<string, unknown>;
      const lowDeep = (lowResult.diagnostics as Record<string, unknown>).deep as Record<string, unknown>;
      assertEquals(lowQueriesSeen.length, 2);
      assertEquals(lowDeep.autoTriggered, true);
      assertEquals(lowDeep.rounds, 2);
      assert(Array.isArray(lowDeep.queryTrail));
    });

    await withIsolatedSearchRegistry(async () => {
      const highQueriesSeen: string[] = [];
      const uniqueToken = crypto.randomUUID().slice(0, 8);
      const highQuery = `python asyncio taskgroup tutorial ${uniqueToken}`;

      registerSearchProvider({
        name: "duckduckgo",
        displayName: "deterministic-high-confidence",
        requiresApiKey: false,
        search(query: string, opts: SearchCallOptions) {
          highQueriesSeen.push(query);
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 3,
            results: [
              { title: "Python asyncio TaskGroup Documentation", url: "https://docs.python.org/3/library/asyncio-task.html", snippet: `TaskGroup structured concurrency asyncio tutorial reference ${uniqueToken}`, score: 12 },
              { title: "TaskGroup Guide", url: "https://realpython.com/python311-exception-groups/", snippet: `python asyncio taskgroup tutorial and guide ${uniqueToken}`, score: 8 },
              { title: "TaskGroup Examples", url: "https://superfastpython.com/asyncio-taskgroup/", snippet: `asyncio taskgroup examples for Python ${uniqueToken}`, score: 7 },
            ],
            diagnostics: { limit: opts.limit },
          });
        },
      });

      resetWebToolBudget();
      const highResult = await WEB_TOOLS.search_web.fn({ query: highQuery, maxResults: 3, prefetch: false, reformulate: false }, "/tmp") as Record<string, unknown>;
      const highDeep = (highResult.diagnostics as Record<string, unknown>).deep as Record<string, unknown>;
      assertEquals(highQueriesSeen.length, 1);
      assertEquals(highDeep.autoTriggered, false);
      assertEquals(highDeep.rounds, 1);
    });
  },
});

Deno.test({
  name: "web tools: search_web records retrieval diagnostics and evidence from fetched pages",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      registerSearchProvider({
        name: "duckduckgo",
        displayName: "deterministic-prefetch",
        requiresApiKey: false,
        search(query: string, opts: SearchCallOptions) {
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 2,
            results: [
              {
                title: "Python TaskGroup Docs",
                url: "https://docs.python.org/3/library/asyncio-task.html",
                snippet: "TaskGroup official documentation",
                score: 10,
              },
              {
                title: "Python 3.11 What's New",
                url: "https://docs.python.org/3/whatsnew/3.11.html",
                snippet: "What's new in Python 3.11",
                score: 8,
              },
            ],
            diagnostics: { limit: opts.limit },
          });
        },
      });

      await withStubbedFetch(async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("asyncio-task")) {
          return new Response(
            `<html><head><meta name="description" content="Official asyncio TaskGroup documentation" /></head><body><article><p>TaskGroup provides structured concurrency and cancels sibling tasks when one task fails.</p></article></body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response(
          `<html><head><time datetime="2025-07-01">July 1 2025</time></head><body><article><p>Python 3.11 added TaskGroup and ExceptionGroup support.</p></article></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }, async () => {
        resetWebToolBudget();
        const raw = await WEB_TOOLS.search_web.fn(
          {
            query: "Explain Python asyncio TaskGroup using official docs first",
            maxResults: 2,
            prefetch: true,
            reformulate: false,
          },
          "/tmp",
        ) as Record<string, unknown>;

        const diagnostics = raw.diagnostics as Record<string, unknown>;
        const retrieval = diagnostics.retrieval as Record<string, unknown>;
        const results = raw.results as Array<Record<string, unknown>>;

        assertEquals((retrieval.rounds as number) >= 1, true);
        assert(Array.isArray(retrieval.queryTrail));
        assertEquals((retrieval.queryTrail as string[])[0], "Explain Python asyncio TaskGroup using official docs first");
        assert(Array.isArray(retrieval.fetchedUrls));
        assertEquals((retrieval.fetchedUrls as unknown[]).length > 0, true);
        assertEquals(retrieval.synthesizedFromFetch, true);
        assertEquals((retrieval.fetchEvidenceCount as number) >= 1, true);
        assert(results.some((result) => Array.isArray(result.passages) && (result.passages as unknown[]).length > 0));
        assert(results.some((result) => result.evidenceStrength === "high"));
      });
    });
  },
});

Deno.test({
  name: "web tools: search_web decomposes compare queries and synthesizes from fetched evidence first",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      const queriesSeen: string[] = [];
      registerSearchProvider({
        name: "duckduckgo",
        displayName: "deterministic-decomposition",
        requiresApiKey: false,
        search(query: string) {
          queriesSeen.push(query);
          if (/fastapi vs flask/i.test(query)) {
            return Promise.resolve({
              query,
              provider: "duckduckgo",
              count: 3,
              results: [
                {
                  title: "FastAPI vs Flask overview",
                  url: "https://example.com/compare",
                  snippet: "Compare FastAPI and Flask for production workloads.",
                  score: 4,
                },
                {
                  title: "FastAPI docs",
                  url: "https://fastapi.tiangolo.com/deployment/",
                  snippet: "FastAPI deployment docs",
                  score: 3,
                },
                {
                  title: "Flask docs",
                  url: "https://flask.palletsprojects.com/en/stable/deploying/",
                  snippet: "Flask deployment docs",
                  score: 3,
                },
              ],
            });
          }
          if (/fastapi/i.test(query)) {
            return Promise.resolve({
              query,
              provider: "duckduckgo",
              count: 2,
              results: [
                {
                  title: "FastAPI deployment",
                  url: "https://fastapi.tiangolo.com/deployment/",
                  snippet: "FastAPI production deployment",
                  score: 10,
                },
                {
                  title: "FastAPI tutorial",
                  url: "https://fastapi.tiangolo.com/tutorial/",
                  snippet: "FastAPI docs",
                  score: 8,
                },
              ],
            });
          }
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 2,
            results: [
              {
                title: "Flask deploying to production",
                url: "https://flask.palletsprojects.com/en/stable/deploying/",
                snippet: "Flask production deployment",
                score: 10,
              },
              {
                title: "Flask docs",
                url: "https://flask.palletsprojects.com/en/stable/",
                snippet: "Flask docs",
                score: 7,
              },
            ],
          });
        },
      });

      await withStubbedFetch(async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("fastapi")) {
          return new Response(
            `<html><body><article><p>FastAPI deployment favors ASGI servers and async-first request handling.</p></article></body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response(
          `<html><body><article><p>Flask deployment typically uses WSGI servers and a simpler synchronous core.</p></article></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }, async () => {
        resetWebToolBudget();
        const raw = await WEB_TOOLS.search_web.fn(
          {
            query: "Compare FastAPI vs Flask production tradeoffs",
            maxResults: 4,
            prefetch: true,
            reformulate: false,
          },
          "/tmp",
        ) as Record<string, unknown>;

        const diagnostics = raw.diagnostics as Record<string, unknown>;
        const retrieval = diagnostics.retrieval as Record<string, unknown>;
        const results = raw.results as Array<Record<string, unknown>>;
        const formatted = __testOnlyFormatSearchWebResult(raw);

        assertEquals((retrieval.decompositionApplied as boolean), true);
        assertEquals(Array.isArray(retrieval.subqueries), true);
        assertEquals((retrieval.fetchEscalationReason as string), "comparison");
        assertEquals(queriesSeen.length >= 2, true);
        assert(results.some((result) => result.selectedForFetch === true));
        assert(results.some((result) => result.selectedForSynthesis === true));
        assert(formatted?.llmContent.includes("Evidence pages:"));
        assert(formatted?.llmContent.includes("Supporting results:"));
      });
    });
  },
});

Deno.test("searchWeb merges Google News for recency queries", async () => {
  resetWebToolBudget();

  await withIsolatedSearchRegistry(async () => {
    const ddgHtml = fakeDdgHtml([
      { url: "https://ddg.example.com/a", title: "DDG Result A", snippet: "Primary search result" },
      { url: "https://ddg.example.com/b", title: "DDG Result B", snippet: "Another result" },
    ]);

    const newsRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>News</title>
<item><title>Latest Release Notes</title><link>https://news.example.com/release</link>
<description>Breaking news about the release</description>
<pubDate>Thu, 06 Mar 2025 10:00:00 GMT</pubDate></item>
</channel></rss>`;

    await withStubbedFetch(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("news.google.com")) {
        return new Response(newsRss, { status: 200, headers: { "content-type": "application/rss+xml" } });
      }
      // DDG search and any prefetch
      return new Response(ddgHtml, { status: 200, headers: { "content-type": "text/html" } });
    }, async () => {
      const raw = await WEB_TOOLS.search_web.fn(
        { query: "latest Deno release notes 2025", maxResults: 5, prefetch: false, reformulate: false },
        "/tmp",
      ) as Record<string, unknown>;

      const results = raw.results as Array<Record<string, unknown>>;
      const diagnostics = raw.diagnostics as Record<string, unknown>;
      const retrieval = diagnostics.retrieval as Record<string, unknown>;

      assert(results.length > 0);
      assertEquals(retrieval.newsSupplemented, true);
      assert((retrieval.newsResultCount as number) > 0);

      // Verify news result was merged in
      const hasNewsResult = results.some((r) =>
        (r.url as string)?.includes("news.example.com")
      );
      assert(hasNewsResult, "Expected Google News result to be merged into results");
    });
  });
});

Deno.test("searchWeb applies domain filters to Google News supplemental results", async () => {
  resetWebToolBudget();

  await withIsolatedSearchRegistry(async () => {
    registerSearchProvider({
      name: "duckduckgo",
      displayName: "deterministic-google-news-filters",
      requiresApiKey: false,
      search(query: string) {
        return Promise.resolve({
          query,
          provider: "duckduckgo",
          count: 1,
          results: [
            {
              title: "Allowed result",
              url: "https://allowed.example.com/a",
              snippet: "Allowed domain result",
              score: 8,
            },
          ],
        });
      },
    });

    const newsRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>News</title>
<item><title>Blocked by allowlist</title><link>https://news.example.com/release</link>
<description>Breaking news about the release</description>
<pubDate>Thu, 06 Mar 2025 10:00:00 GMT</pubDate></item>
</channel></rss>`;

    await withStubbedFetch(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("news.google.com")) {
        return new Response(newsRss, { status: 200, headers: { "content-type": "application/rss+xml" } });
      }
      return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    }, async () => {
      const raw = await WEB_TOOLS.search_web.fn(
        {
          query: "latest Deno release notes 2025",
          maxResults: 5,
          prefetch: false,
          reformulate: false,
          allowedDomains: ["allowed.example.com"],
        },
        "/tmp",
      ) as Record<string, unknown>;

      const results = raw.results as Array<Record<string, unknown>>;
      const diagnostics = raw.diagnostics as Record<string, unknown>;
      const retrieval = diagnostics.retrieval as Record<string, unknown>;

      assertEquals(results.length, 1);
      assertEquals(results[0].url, "https://allowed.example.com/a");
      assertEquals(retrieval.newsSupplemented, false);
      assertEquals(retrieval.newsResultCount, 0);
      assertEquals(results.some((r) => (r.url as string)?.includes("news.example.com")), false);
    });
  });
});

Deno.test("web tools: formatSearchWebResult surfaces source authority tags, recommended source, and retrieval guidance", () => {
  // With high-evidence official source + guidance
  const withGuidance = __testOnlyFormatSearchWebResult({
    query: "deno deploy docs",
    provider: "duckduckgo",
    count: 2,
    results: [
      {
        title: "Deploy on Deno",
        url: "https://deno.com/deploy",
        snippet: "Deno Deploy is a serverless platform",
        passages: ["Deploy your code in seconds with Deno Deploy"],
        evidenceStrength: "high",
        evidenceReason: "page passages",
        sourceAuthority: "official",
        score: 9,
      },
      {
        title: "Deno Deploy Discussion",
        url: "https://reddit.com/r/deno/deploy",
        snippet: "Has anyone tried Deno Deploy?",
        sourceAuthority: "community",
        score: 5,
      },
    ],
    guidance: {
      answerAvailable: true,
      stopReason: "1 high-quality evidence page(s) with extracted passages. Respond from these unless deeper detail is needed.",
    },
  });
  assert(withGuidance !== null);
  // Authority tag on evidence page
  assert(withGuidance!.llmContent.includes("[official]"));
  // Recommended source header
  assert(withGuidance!.llmContent.includes("Recommended source:"));
  assert(withGuidance!.llmContent.includes("Official domain matching the query subject"));
  assert(withGuidance!.llmContent.includes("Action: Check this source first"));
  // Guidance stop signal
  assert(withGuidance!.llmContent.includes("1 high-quality evidence page(s) with extracted passages"));

  // Without guidance (low confidence)
  const noGuidance = __testOnlyFormatSearchWebResult({
    query: "obscure library xyz",
    provider: "duckduckgo",
    count: 1,
    results: [
      {
        title: "Some Page",
        url: "https://example.com/xyz",
        snippet: "vaguely related",
        score: 2,
      },
    ],
  });
  assert(noGuidance !== null);
  assert(!noGuidance!.llmContent.includes("Recommended source:"));
  assert(!noGuidance!.llmContent.includes("Respond from these"));

  // Community authority tag visible
  const communityResult = __testOnlyFormatSearchWebResult({
    query: "react hooks best practices",
    provider: "duckduckgo",
    count: 1,
    results: [
      {
        title: "React Hooks Guide",
        url: "https://stackoverflow.com/q/99999",
        snippet: "Best practices for React hooks",
        passages: ["Use useCallback for memoization"],
        evidenceStrength: "high",
        evidenceReason: "page passages",
        sourceAuthority: "community",
        score: 7,
      },
    ],
  });
  assert(communityResult !== null);
  assert(communityResult!.llmContent.includes("[community]"));
  assert(!communityResult!.llmContent.includes("Recommended source:"));
});

Deno.test("web tools: recommended source comes from ranked results even when not selected as an evidence page", () => {
  const formatted = __testOnlyFormatSearchWebResult({
    query: "latest Bun release notes",
    provider: "duckduckgo",
    count: 3,
    results: [
      {
        title: "Bun v1.3.10",
        url: "https://bun.com/blog/bun-v1.3.10",
        snippet: "Official Bun release notes",
        sourceAuthority: "official",
        publishedDate: "2026-03-01",
        score: 9,
      },
      {
        title: "Bun Releases",
        url: "https://github.com/oven-sh/bun/releases",
        snippet: "Repository releases",
        passages: ["Bun release assets and changelog links."],
        evidenceStrength: "high",
        evidenceReason: "page passages",
        sourceAuthority: "repository",
        score: 8,
      },
      {
        title: "Discussion",
        url: "https://reddit.com/r/bun/comments/abc",
        snippet: "User discussion",
        sourceAuthority: "community",
        score: 3,
      },
    ],
  });

  assert(formatted !== null);
  assert(formatted!.llmContent.includes("Recommended source: Bun v1.3.10"));
  assert(formatted!.llmContent.includes("Official source for a current/release-oriented query."));
  assert(formatted!.llmContent.includes("Action: Check this source first before lower-authority alternatives."));
});
