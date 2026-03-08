import { assert, assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert";
import {
  __testOnlyBuildSearchWebCacheKey,
  __testOnlyFormatSearchWebResult,
  resetWebToolBudget,
  WEB_TOOLS,
} from "../../../src/hlvm/agent/tools/web-tools.ts";
import {
  duckDuckGoSearch,
  generateQueryVariants,
  parseBingSearchResults,
  parseDuckDuckGoSearchResults,
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
import { ai } from "../../../src/hlvm/api/ai.ts";
import { __testOnlyResetWebCache } from "../../../src/hlvm/agent/web-cache.ts";

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

Deno.test({
  name: "web tools: search_web recovers nested JSON args embedded in query",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      const seenQueries: string[] = [];
      let seenAllowedDomains: string[] | undefined;

      registerSearchProvider({
        name: "duckduckgo",
        displayName: "embedded-arg-recovery",
        requiresApiKey: false,
        search(query: string, opts: SearchCallOptions) {
          seenQueries.push(query);
          seenAllowedDomains = opts.allowedDomains;
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 1,
            results: [{
              title: "Recovered",
              url: "https://react.dev/reference/react/useEffect",
              snippet: "Recovered query path",
            }],
          });
        },
      });

      resetWebToolBudget();
      await WEB_TOOLS.search_web.fn(
        {
          query: JSON.stringify({
            query: "cleanup in useEffect",
            allowedDomains: ["react.dev"],
            maxResults: 3,
            prefetch: false,
            reformulate: false,
          }),
        },
        "/tmp",
      );

      assertEquals(seenQueries[0], "cleanup in useEffect");
      assertEquals(seenAllowedDomains, ["react.dev"]);
    });
  },
});

Deno.test("web tools: cache keys stay order-invariant but change across behavioral dimensions", () => {
  const base = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5);
  const allowA = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5, ["a.com", "b.com"]);
  const allowB = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5, ["b.com", "a.com"]);
  const dayRange = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5, undefined, undefined, "day");
  const withModel = __testOnlyBuildSearchWebCacheKey(
    "duckduckgo",
    "bitcoin",
    5,
    undefined,
    undefined,
    "all",
    undefined,
    "medium",
    true,
    true,
    "ollama/llama3.1:8b",
  );
  const withWeakTier = __testOnlyBuildSearchWebCacheKey(
    "duckduckgo",
    "bitcoin",
    5,
    undefined,
    undefined,
    "all",
    undefined,
    "medium",
    true,
    true,
    "ollama/llama3.1:8b",
    "weak",
  );
  const withExpandedYear = __testOnlyBuildSearchWebCacheKey(
    "duckduckgo",
    "bitcoin",
    5,
    undefined,
    undefined,
    "all",
    undefined,
    "medium",
    true,
    true,
    "ollama/llama3.1:8b",
    "weak",
    "2026",
  );

  assertEquals(allowA, allowB);
  assertNotEquals(base, allowA);
  assertNotEquals(base, dayRange);
  assertNotEquals(base, withModel);
  assertNotEquals(withModel, withWeakTier);
  assertNotEquals(withWeakTier, withExpandedYear);
});

Deno.test("web tools: domain filters keep relevant domains only", () => {
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

Deno.test("web tools: Bing HTML parsing extracts titles, urls, and snippets", () => {
  const parsed = parseBingSearchResults(`
    <html><body>
      <li class="b_algo">
        <h2><a href="https://react.dev/reference/react/useEffect">useEffect - React</a></h2>
        <div class="b_caption"><p>Official React reference for useEffect cleanup.</p></div>
      </li>
      <li class="b_algo">
        <h2><a href="https://react.dev/learn/synchronizing-with-effects">Synchronizing with Effects - React</a></h2>
        <div class="b_caption"><p>Guide for syncing effects with external systems.</p></div>
      </li>
    </body></html>
  `, 5);

  assertEquals(parsed.length, 2);
  assertEquals(parsed[0].url, "https://react.dev/reference/react/useEffect");
  assertEquals(parsed[0].snippet, "Official React reference for useEffect cleanup.");
});

Deno.test("web tools: formatting keeps compact displays, preserves raw results, and annotates low-confidence output", () => {
  const highConfidence = __testOnlyFormatSearchWebResult({
    query: "deno 2.2 release",
    provider: "duckduckgo",
    count: 2,
    answerDraft: {
      text: "Deno 2.2 added faster startup based on the fetched release notes.",
      confidence: "high",
      mode: "recency",
      strategy: "llm_polish",
      sources: [{
        title: "Deno 2.2 Release Notes",
        url: "https://deno.com/blog/v2.2",
        evidenceStrength: "high",
        publishedDate: "2026-02-15",
      }],
    },
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
        selectedForFetch: true,
        score: 8,
      },
      { title: "What's New in Deno", url: "https://blog.example.com/deno-22", snippet: "Deno adds monorepo support", score: 6 },
    ],
    citations: [{ url: "https://deno.com/blog/v2.2", title: "Deno 2.2 Release Notes" }],
  });
  assert(highConfidence !== null);
  assert(highConfidence!.returnDisplay.includes('Search: "deno 2.2 release"'));
  assert(highConfidence!.returnDisplay.includes("Deterministic answer draft:"));
  assert(highConfidence!.llmContent.includes("The new release includes faster startup"));
  assert(highConfidence!.llmContent.includes("Fetched sources:"));
  assert(highConfidence!.llmContent.includes("Use fetched sources as primary evidence."));
  assert(highConfidence!.llmContent.includes("Use it as the grounded baseline answer."));
  assert(!highConfidence!.llmContent.includes("Detailed search results:"));
  assert(!highConfidence!.llmContent.includes("Supporting results:"));
  assert(!highConfidence!.summaryDisplay.includes("{"));
  assert(highConfidence!.summaryDisplay.includes("Deno 2.2 added faster startup"));

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
  assert(lowConfidence!.llmContent.includes("Tip: Search confidence is low."));
  assert(lowConfidence!.llmContent.includes("Related links to check:"));
});

Deno.test({
  name: "web tools: duckDuckGoSearch stays raw and does not run provider-side reformulation",
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
      const results = raw.results as Array<{ url?: string }>;

      assertEquals(queriesSeen, ["deno 2.2 release"]);
      assert(results.some((result) => result.url === "https://example.com/original"));
      assertEquals(results.some((result) => result.url?.includes("variant")), false);
    });
  },
});

Deno.test({
  name: "web tools: duckDuckGoSearch does not perform hidden low-confidence retries",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const query = "obscure 2026 signal";
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
      assertEquals(diagnostics.lowConfidenceRetryTriggered, undefined);
      assertEquals(queriesSeen, [query]);
    });
  },
});

Deno.test({
  name: "web tools: duckDuckGoSearch falls back to Bing HTML when DDG returns anti-bot challenge",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withStubbedFetch(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("html.duckduckgo.com")) {
        return new Response(
          `<html><body><div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      if (url.includes("bing.com/search")) {
        return new Response(
          `<html><body>
            <li class="b_algo">
              <h2><a href="https://react.dev/reference/react/useEffect">useEffect - React</a></h2>
              <div class="b_caption"><p>Official React reference for useEffect cleanup.</p></div>
            </li>
          </body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      return new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } });
    }, async () => {
      const raw = await duckDuckGoSearch(
        "react useeffect cleanup",
        5,
        10_000,
        "all",
        undefined,
        undefined,
        ["react.dev"],
        undefined,
        true,
      );

      const diagnostics = raw.diagnostics as Record<string, unknown>;
      const results = raw.results as Array<Record<string, unknown>>;
      assertEquals(raw.provider, "bing-html");
      assertEquals(diagnostics.anomalyBlocked, true);
      assertEquals(diagnostics.fallbackProvider, "bing-html");
      assertEquals(results[0].url, "https://react.dev/reference/react/useEffect");
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
      const lowResult = await WEB_TOOLS.search_web.fn({ query: lowQuery, maxResults: 3, prefetch: false, reformulate: true }, "/tmp") as Record<string, unknown>;
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
  name: "web tools: reformulate=false disables decomposition and follow-up expansion",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      const queriesSeen: string[] = [];
      registerSearchProvider({
        name: "duckduckgo",
        displayName: "deterministic-no-reformulation",
        requiresApiKey: false,
        search(query: string, opts: SearchCallOptions) {
          queriesSeen.push(query);
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 1,
            results: [{ title: "Home", url: "https://generic.example.com/home", snippet: "welcome page" }],
            diagnostics: { limit: opts.limit },
          });
        },
      });

      resetWebToolBudget();
      const raw = await WEB_TOOLS.search_web.fn(
        { query: "react useeffect cleanup", maxResults: 3, prefetch: false, reformulate: false },
        "/tmp",
      ) as Record<string, unknown>;
      const diagnostics = raw.diagnostics as Record<string, unknown>;
      const deep = diagnostics.deep as Record<string, unknown>;
      const retrieval = diagnostics.retrieval as Record<string, unknown>;

      assertEquals(queriesSeen.length, 1);
      assertEquals(deep.autoTriggered, false);
      assertEquals(deep.decompositionApplied, false);
      assertEquals(retrieval.decompositionApplied, false);
      assertEquals(retrieval.subqueries, []);
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
        assert(results.some((result) => result.selectedForFetch === true));
      });
    });
  },
});

Deno.test({
  name: "web tools: search_web uses the LLM chooser when modelId is available",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const originalChatStructured = ai.chatStructured;
    try {
      await withIsolatedSearchRegistry(async () => {
        registerSearchProvider({
          name: "duckduckgo",
          displayName: "deterministic-llm-prefetch",
          requiresApiKey: false,
          search(query: string, opts: SearchCallOptions) {
            return Promise.resolve({
              query,
              provider: "duckduckgo",
              count: 3,
              results: [
                { title: "First result", url: "https://example.com/first", snippet: "first" },
                { title: "Second result", url: "https://example.com/second", snippet: "second" },
                { title: "Third result", url: "https://example.com/third", snippet: "third" },
              ],
              diagnostics: { limit: opts.limit },
            });
          },
        });

        (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = () =>
          Promise.resolve({
            content: "",
            toolCalls: [{
              function: {
                name: "select_search_results",
                arguments: JSON.stringify({
                  picks: [2, 0],
                  confidence: "high",
                  reason: "Third then first are best.",
                }),
              },
            }],
          });

        await withStubbedFetch(async (input) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          return new Response(
            `<html><body><article><p>Fetched ${url}</p></article></body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }, async () => {
          resetWebToolBudget();
          const raw = await WEB_TOOLS.search_web.fn(
            {
              query: "choose the right pages",
              maxResults: 3,
              prefetch: true,
              reformulate: false,
            },
            "/tmp",
            { modelId: "test-model" },
          ) as Record<string, unknown>;

          const diagnostics = raw.diagnostics as Record<string, unknown>;
          const prefetch = diagnostics.prefetch as Record<string, unknown>;
          const results = raw.results as Array<Record<string, unknown>>;

          assertEquals(prefetch.chooserUsed, true);
          assertEquals(prefetch.chooserStrategy, "llm");
          assertEquals(prefetch.fallbackUsed, false);
          assertEquals(prefetch.chooserConfidence, "high");
          assertEquals(prefetch.targetUrls, [
            "https://example.com/third",
            "https://example.com/first",
            "https://example.com/second",
          ]);
          assertEquals(results[0].url, "https://example.com/third");
          assertEquals(results[0].selectedForFetch, true);
          assertEquals(results[1].url, "https://example.com/first");
          assertEquals(results[1].selectedForFetch, true);
          assertEquals(results[2].url, "https://example.com/second");
          assertEquals(results[2].selectedForFetch, true);
        });
      });
    } finally {
      (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = originalChatStructured;
    }
  },
});

Deno.test({
  name: "web tools: search_web uses deterministic chooser when no modelId is available",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      registerSearchProvider({
        name: "duckduckgo",
        displayName: "deterministic-fallback-primary",
        requiresApiKey: false,
        search(query: string, opts: SearchCallOptions) {
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 4,
            results: [
              {
                title: "Generic overview",
                url: "https://example.com/react",
                snippet: "General React page",
              },
              {
                title: "useEffect - React",
                url: "https://react.dev/reference/react/useEffect",
                snippet: "Official React reference for useEffect cleanup.",
              },
              {
                title: "Synchronizing with Effects - React",
                url: "https://react.dev/learn/synchronizing-with-effects",
                snippet: "Official React guide for Effects and cleanup.",
              },
              {
                title: "Community cleanup article",
                url: "https://blog.example.com/react-cleanup",
                snippet: "Community write-up about cleanup in useEffect.",
              },
            ],
            diagnostics: { limit: opts.limit },
          });
        },
      });

      await withStubbedFetch(async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return new Response(
          `<html><body><article><p>Fetched ${url}</p></article></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }, async () => {
        resetWebToolBudget();
        const raw = await WEB_TOOLS.search_web.fn(
          {
            query: "official React docs useEffect cleanup",
            maxResults: 4,
            prefetch: true,
            reformulate: false,
            allowedDomains: ["react.dev"],
          },
          "/tmp",
        ) as Record<string, unknown>;

        const diagnostics = raw.diagnostics as Record<string, unknown>;
        const prefetch = diagnostics.prefetch as Record<string, unknown>;
        const results = raw.results as Array<Record<string, unknown>>;

        assertEquals(prefetch.chooserUsed, false);
        assertEquals(prefetch.chooserStrategy, "deterministic");
        assertEquals(prefetch.fallbackUsed, false);
        assertEquals((prefetch.targetUrls as string[])[0], "https://react.dev/reference/react/useEffect");
        assertEquals([...(prefetch.targetUrls as string[])].sort(), [
          "https://react.dev/reference/react/useEffect",
          "https://react.dev/learn/synchronizing-with-effects",
          "https://blog.example.com/react-cleanup",
        ].sort());
        assertEquals(results[0].url, "https://react.dev/reference/react/useEffect");
        assert(
          results.slice(1, 3).some((result) =>
            result.url === "https://react.dev/learn/synchronizing-with-effects"
          ),
        );
      });
    });
  },
});

Deno.test({
  name: "web tools: weak-tier models skip llm chooser and rank fetched evidence deterministically",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const originalChatStructured = ai.chatStructured;
    try {
      await withIsolatedSearchRegistry(async () => {
        let llmChooserCalls = 0;
        registerSearchProvider({
          name: "duckduckgo",
          displayName: "weak-tier-deterministic-path",
          requiresApiKey: false,
          search(query: string, opts: SearchCallOptions) {
            return Promise.resolve({
              query,
              provider: "duckduckgo",
              count: 4,
              results: [
                {
                  title: "React homepage",
                  url: "https://react.dev/",
                  snippet: "The library for web interfaces",
                },
                {
                  title: "useEffect - React",
                  url: "https://react.dev/reference/react/useEffect",
                  snippet: "Official React reference for useEffect cleanup and synchronization details in depth.",
                },
                {
                  title: "Synchronizing with Effects - React",
                  url: "https://react.dev/learn/synchronizing-with-effects",
                  snippet: "Learn how effects synchronize with outside systems.",
                },
                {
                  title: "Community cleanup article",
                  url: "https://blog.example.com/react-cleanup",
                  snippet: "Community write-up about useEffect cleanup.",
                },
              ],
              diagnostics: { limit: opts.limit },
            });
          },
        });

        (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = () => {
          llmChooserCalls += 1;
          return Promise.resolve({
            content: "",
            toolCalls: [{
              function: {
                name: "select_search_results",
                arguments: JSON.stringify({
                  picks: [0],
                  confidence: "low",
                  reason: "This should not be used for weak-tier routing.",
                }),
              },
            }],
          });
        };

        await withStubbedFetch(async (input) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/reference/react/useEffect")) {
            return new Response(
              `<html><head><meta name="description" content="Reference documentation for React useEffect cleanup." /></head><body><article><p>The cleanup function runs before the effect re-runs and after the component unmounts.</p></article></body></html>`,
              { status: 200, headers: { "Content-Type": "text/html" } },
            );
          }
          if (url.includes("/learn/synchronizing-with-effects")) {
            return new Response(
              `<html><head><meta name="description" content="Guide for synchronizing with effects." /></head><body><article><p>Effects synchronize a component with an external system.</p></article></body></html>`,
              { status: 200, headers: { "Content-Type": "text/html" } },
            );
          }
          return new Response(
            `<html><head><meta name="description" content="React homepage overview." /></head><body><article><p>React lets you build user interfaces.</p></article></body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }, async () => {
          resetWebToolBudget();
          const raw = await WEB_TOOLS.search_web.fn(
            {
              query: "official React docs useEffect cleanup",
              maxResults: 4,
              prefetch: true,
              reformulate: false,
              allowedDomains: ["react.dev"],
            },
            "/tmp",
            { modelId: "ollama/llama3.2:1b", modelTier: "weak" },
          ) as Record<string, unknown>;

          const diagnostics = raw.diagnostics as Record<string, unknown>;
          const prefetch = diagnostics.prefetch as Record<string, unknown>;
          const retrieval = diagnostics.retrieval as Record<string, unknown>;
          const results = raw.results as Array<Record<string, unknown>>;

          assertEquals(llmChooserCalls, 0);
          assertEquals(prefetch.chooserUsed, false);
          assertEquals(prefetch.chooserStrategy, "deterministic");
          assertEquals(prefetch.fallbackUsed, false);
          assertEquals(retrieval.evidenceStrategy, "deterministic");
          assertEquals(retrieval.answerDraftAvailable, true);
          assertEquals(retrieval.answerStrategy, "deterministic");
          assertEquals(results[0].url, "https://react.dev/reference/react/useEffect");
          assertEquals(results[0].evidenceStrength, "high");
          assertEquals(results[1].evidenceStrength, "high");
          assertEquals(
            ((raw.answerDraft as Record<string, unknown>).strategy),
            "deterministic",
          );
        });
      });
    } finally {
      (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = originalChatStructured;
    }
  },
});

Deno.test({
  name: "web tools: weak-tier search_web discovers official docs from allowed domains when provider recall is empty",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      const seenQueries: string[] = [];
      registerSearchProvider({
        name: "duckduckgo",
        displayName: "allowed-domain-discovery",
        requiresApiKey: false,
        search(query: string) {
          seenQueries.push(query);
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 0,
            results: [],
          });
        },
      });

      await withStubbedFetch(async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

        if (url === "https://react.dev/robots.txt") {
          return new Response(
            "User-agent: *\nSitemap: https://react.dev/sitemap.xml\n",
            { status: 200, headers: { "Content-Type": "text/plain" } },
          );
        }

        if (url === "https://react.dev/sitemap.xml") {
          return new Response(
            `<?xml version="1.0" encoding="UTF-8"?>
             <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
               <url><loc>https://react.dev/reference/react/useEffect</loc></url>
               <url><loc>https://react.dev/reference/react/useState</loc></url>
               <url><loc>https://react.dev/learn/synchronizing-with-effects</loc></url>
               <url><loc>https://react.dev/learn/removing-effect-dependencies</loc></url>
             </urlset>`,
            { status: 200, headers: { "Content-Type": "application/xml" } },
          );
        }

        if (url === "https://react.dev/reference/react/useEffect") {
          return new Response(
            `<html><head><title>useEffect - React</title><meta name="description" content="Official useEffect reference." /></head><body><article><p>The cleanup function runs before the effect re-runs and after the component unmounts.</p></article></body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }

        if (url === "https://react.dev/learn/synchronizing-with-effects") {
          return new Response(
            `<html><head><title>Synchronizing with Effects - React</title><meta name="description" content="Guide to Effects." /></head><body><article><p>Effects synchronize a component with external systems.</p></article></body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }

        return new Response("not found", {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        });
      }, async () => {
        resetWebToolBudget();
        const raw = await WEB_TOOLS.search_web.fn(
          {
            query: "react useEffect cleanup",
            maxResults: 4,
            prefetch: true,
            reformulate: false,
            allowedDomains: ["react.dev"],
          },
          "/tmp",
          { modelId: "ollama/llama3.2:1b", modelTier: "weak" },
        ) as Record<string, unknown>;

        const diagnostics = raw.diagnostics as Record<string, unknown>;
        const prefetch = diagnostics.prefetch as Record<string, unknown>;
        const retrieval = diagnostics.retrieval as Record<string, unknown>;
        const domainDiscovery = diagnostics.domainDiscovery as Record<string, unknown>;
        const results = raw.results as Array<Record<string, unknown>>;

        assert(seenQueries.some((query) => query.startsWith("site:react.dev ")));
        assertEquals(domainDiscovery.triggered, true);
        assertEquals(domainDiscovery.discoveredResultCount, 4);
        assertEquals(prefetch.chooserStrategy, "deterministic");
        assertEquals((prefetch.targetUrls as string[])[0], "https://react.dev/reference/react/useEffect");
        assertEquals([...(prefetch.targetUrls as string[])].sort(), [
          "https://react.dev/reference/react/useEffect",
          "https://react.dev/learn/synchronizing-with-effects",
          "https://react.dev/reference/react/useState",
          "https://react.dev/learn/removing-effect-dependencies",
        ].sort());
        assertEquals(retrieval.domainDiscoveryTriggered, true);
        assertEquals(retrieval.evidenceUrls, [
          "https://react.dev/reference/react/useEffect",
          "https://react.dev/learn/synchronizing-with-effects",
        ]);
        assertEquals(results[0].url, "https://react.dev/reference/react/useEffect");
        assertEquals(results[0].evidenceStrength, "high");
      });
    });
  },
});

Deno.test({
  name: "web tools: allowed-domain discovery falls back to homepage links when robots and sitemap are unavailable",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      registerSearchProvider({
        name: "duckduckgo",
        displayName: "allowed-domain-homepage-fallback",
        requiresApiKey: false,
        search(query: string) {
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 0,
            results: [],
          });
        },
      });

      await withStubbedFetch(async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

        if (url === "https://react.dev/robots.txt" || url === "https://react.dev/sitemap.xml" ||
          url === "https://react.dev/sitemap_index.xml") {
          return new Response("not found", {
            status: 404,
            headers: { "Content-Type": "text/plain" },
          });
        }

        if (url === "https://react.dev") {
          return new Response(
            `<html><head><title>React</title><meta name="description" content="React docs homepage." /></head><body>
              <nav>
                <a href="/reference/react/useEffect">useEffect</a>
                <a href="/learn/synchronizing-with-effects">Synchronizing with Effects</a>
              </nav>
            </body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }

        if (url === "https://react.dev/reference/react/useEffect") {
          return new Response(
            `<html><head><title>useEffect - React</title><meta name="description" content="Official useEffect reference." /></head><body><article><p>The cleanup function runs before the effect re-runs and after unmount.</p></article></body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }

        if (url === "https://react.dev/learn/synchronizing-with-effects") {
          return new Response(
            `<html><head><title>Synchronizing with Effects - React</title><meta name="description" content="Guide to Effects." /></head><body><article><p>Effects synchronize a component with external systems.</p></article></body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }

        return new Response("not found", {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        });
      }, async () => {
        resetWebToolBudget();
        const raw = await WEB_TOOLS.search_web.fn(
          {
            query: "react useEffect cleanup",
            maxResults: 3,
            prefetch: true,
            reformulate: false,
            allowedDomains: ["react.dev"],
          },
          "/tmp",
          { modelId: "ollama/llama3.2:1b", modelTier: "weak" },
        ) as Record<string, unknown>;

        const diagnostics = raw.diagnostics as Record<string, unknown>;
        const domainDiscovery = diagnostics.domainDiscovery as Record<string, unknown>;
        const prefetch = diagnostics.prefetch as Record<string, unknown>;
        const results = raw.results as Array<Record<string, unknown>>;

        assertEquals(domainDiscovery.triggered, true);
        assertEquals(domainDiscovery.discoveredResultCount, 2);
        assertEquals(prefetch.chooserStrategy, "deterministic");
        assertEquals(results[0].url, "https://react.dev/reference/react/useEffect");
      });
    });
  },
});

Deno.test({
  name: "web tools: search_web falls back from llm chooser to deterministic chooser",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const originalChatStructured = ai.chatStructured;
    try {
      await withIsolatedSearchRegistry(async () => {
        registerSearchProvider({
          name: "duckduckgo",
          displayName: "deterministic-llm-fallback",
          requiresApiKey: false,
          search(query: string, opts: SearchCallOptions) {
            return Promise.resolve({
              query,
              provider: "duckduckgo",
              count: 4,
              results: [
                {
                  title: "Generic overview",
                  url: "https://example.com/react",
                  snippet: "General React page",
                },
                {
                  title: "useEffect - React",
                  url: "https://react.dev/reference/react/useEffect",
                  snippet: "Official React reference for useEffect cleanup.",
                },
                {
                  title: "Synchronizing with Effects - React",
                  url: "https://react.dev/learn/synchronizing-with-effects",
                  snippet: "Official React guide for Effects and cleanup.",
                },
                {
                  title: "Community cleanup article",
                  url: "https://blog.example.com/react-cleanup",
                  snippet: "Community write-up about cleanup in useEffect.",
                },
              ],
              diagnostics: { limit: opts.limit },
            });
          },
        });

        (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = () =>
          Promise.reject(new Error("chooser unavailable"));

        await withStubbedFetch(async (input) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          return new Response(
            `<html><body><article><p>Fetched ${url}</p></article></body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }, async () => {
          resetWebToolBudget();
          const raw = await WEB_TOOLS.search_web.fn(
            {
              query: "official React docs useEffect cleanup",
              maxResults: 4,
              prefetch: true,
              reformulate: false,
              allowedDomains: ["react.dev"],
            },
            "/tmp",
            { modelId: "test-model" },
          ) as Record<string, unknown>;

          const diagnostics = raw.diagnostics as Record<string, unknown>;
          const prefetch = diagnostics.prefetch as Record<string, unknown>;
          const results = raw.results as Array<Record<string, unknown>>;

          assertEquals(prefetch.chooserUsed, true);
          assertEquals(prefetch.chooserStrategy, "deterministic");
          assertEquals(prefetch.fallbackUsed, true);
          assertEquals(
            String(prefetch.chooserReason).includes("chooser unavailable"),
            true,
          );
          assertEquals((prefetch.targetUrls as string[])[0], "https://react.dev/reference/react/useEffect");
          assertEquals([...(prefetch.targetUrls as string[])].sort(), [
            "https://react.dev/reference/react/useEffect",
            "https://react.dev/learn/synchronizing-with-effects",
            "https://blog.example.com/react-cleanup",
          ].sort());
          assertEquals(results[0].url, "https://react.dev/reference/react/useEffect");
          assert(
            results.slice(1, 3).some((result) =>
              result.url === "https://react.dev/learn/synchronizing-with-effects"
            ),
          );
        });
      });
    } finally {
      (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = originalChatStructured;
    }
  },
});

Deno.test({
  name: "web tools: prefetch preserves finalUrl after redirects and filters related links by final host",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      registerSearchProvider({
        name: "duckduckgo",
        displayName: "redirect-prefetch",
        requiresApiKey: false,
        search(query: string, opts: SearchCallOptions) {
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 1,
            results: [{
              title: "Redirecting doc",
              url: "https://short.example.com/react-cleanup",
              snippet: "Short redirect URL for React cleanup docs.",
              score: 9,
            }],
            diagnostics: { limit: opts.limit },
          });
        },
      });

      await withStubbedFetch(async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

        if (url === "https://short.example.com/react-cleanup") {
          return new Response(null, {
            status: 302,
            headers: {
              "Location": "https://react.dev/reference/react/useEffect",
            },
          });
        }

        if (url === "https://react.dev/reference/react/useEffect") {
          return new Response(
            `<html><head><title>useEffect - React</title><meta name="description" content="Official useEffect reference." /></head><body>
              <article>
                <p>The cleanup function runs before the effect re-runs and after unmount.</p>
                <p>See also <a href="https://react.dev/reference/react/useState">useState</a> and
                <a href="https://developer.mozilla.org/docs/Web/API/AbortController">AbortController</a>.</p>
              </article>
            </body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }

        return new Response("not found", {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        });
      }, async () => {
        resetWebToolBudget();
        const raw = await WEB_TOOLS.search_web.fn(
          {
            query: "react useeffect cleanup",
            maxResults: 1,
            prefetch: true,
            reformulate: false,
          },
          "/tmp",
          { modelId: "ollama/llama3.2:1b", modelTier: "weak" },
        ) as Record<string, unknown>;

        const diagnostics = raw.diagnostics as Record<string, unknown>;
        const retrieval = diagnostics.retrieval as Record<string, unknown>;
        const fetchedUrls = retrieval.fetchedUrls as string[];
        const results = raw.results as Array<Record<string, unknown>>;

        assertEquals(fetchedUrls, ["https://react.dev/reference/react/useEffect"]);
        assertEquals(results[0].relatedLinks, [
          "https://developer.mozilla.org/docs/Web/API/AbortController",
        ]);
      });
    });
  },
});

Deno.test({
  name: "web tools: fetched page descriptions are preserved even when search snippets are longer",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      registerSearchProvider({
        name: "duckduckgo",
        displayName: "page-description-preserved",
        requiresApiKey: false,
        search(query: string, opts: SearchCallOptions) {
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 1,
            results: [
              {
                title: "useEffect - React",
                url: "https://react.dev/reference/react/useEffect",
                snippet:
                  "Very long search snippet that is longer than the page description but still less authoritative than fetched metadata.",
              },
            ],
            diagnostics: { limit: opts.limit },
          });
        },
      });

      await withStubbedFetch(async () =>
        new Response(
          `<html><head><meta name="description" content="Short fetched metadata description." /></head><body><article><p>The cleanup function runs before the effect re-runs.</p></article></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        ), async () => {
          resetWebToolBudget();
          const raw = await WEB_TOOLS.search_web.fn(
            {
              query: "react useeffect cleanup",
              maxResults: 1,
              prefetch: true,
              reformulate: false,
            },
            "/tmp",
          ) as Record<string, unknown>;

          const results = raw.results as Array<Record<string, unknown>>;
          assertEquals(results[0].pageDescription, "Short fetched metadata description.");
        });
    });
  },
});

Deno.test({
  name: "web tools: title-only fetch enrichment does not become fetched page evidence",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      registerSearchProvider({
        name: "duckduckgo",
        displayName: "title-only-fetch",
        requiresApiKey: false,
        search(query: string, opts: SearchCallOptions) {
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 1,
            results: [{
              title: "Original Search Result",
              url: "https://example.com/title-only",
              snippet: "Provider snippet only.",
              score: 8,
            }],
            diagnostics: { limit: opts.limit },
          });
        },
      });

      await withStubbedFetch(async () =>
        new Response(
          `<html><head><title>Canonical Page Title</title></head><body></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        ), async () => {
          resetWebToolBudget();
          const raw = await WEB_TOOLS.search_web.fn(
            {
              query: "title only result",
              maxResults: 1,
              prefetch: true,
              reformulate: false,
            },
            "/tmp",
            { modelId: "ollama/llama3.2:1b", modelTier: "weak" },
          ) as Record<string, unknown>;

          const results = raw.results as Array<Record<string, unknown>>;
          assertEquals(results[0].title, "Original Search Result");
          assertEquals(results[0].pageDescription, undefined);
        });
    });
  },
});

Deno.test({
  name: "web tools: allowed-domain recall retries with site-pinned queries when initial results are empty",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      const queriesSeen: string[] = [];
      registerSearchProvider({
        name: "duckduckgo",
        displayName: "allowed-domain-recall",
        requiresApiKey: false,
        search(query: string, opts: SearchCallOptions) {
          queriesSeen.push(query);
          if (query.startsWith("site:react.dev ")) {
            return Promise.resolve({
              query,
              provider: "duckduckgo",
              count: 2,
              results: [
                {
                  title: "useEffect - React",
                  url: "https://react.dev/reference/react/useEffect",
                  snippet: "Official React reference for cleanup.",
                },
                {
                  title: "Synchronizing with Effects - React",
                  url: "https://react.dev/learn/synchronizing-with-effects",
                  snippet: "Official React guide for effects.",
                },
              ],
              diagnostics: { limit: opts.limit },
            });
          }
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 0,
            results: [],
            diagnostics: { limit: opts.limit },
          });
        },
      });

      await withStubbedFetch(async () =>
        new Response(
          `<html><head><meta name="description" content="React effect cleanup docs." /></head><body><article><p>The cleanup function runs before re-running an effect and after unmount.</p></article></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        ), async () => {
          resetWebToolBudget();
          const raw = await WEB_TOOLS.search_web.fn(
            {
              query: "react useeffect cleanup",
              maxResults: 3,
              prefetch: true,
              reformulate: true,
              allowedDomains: ["react.dev"],
            },
            "/tmp",
          ) as Record<string, unknown>;

          const diagnostics = raw.diagnostics as Record<string, unknown>;
          const retrieval = diagnostics.retrieval as Record<string, unknown>;
          const results = raw.results as Array<Record<string, unknown>>;

          assertEquals(
            queriesSeen.some((query) => query.startsWith("site:react.dev ")),
            true,
          );
          assertEquals(results.length > 0, true);
          assertEquals(results[0].url, "https://react.dev/reference/react/useEffect");
          assertEquals(Array.isArray(retrieval.queryTrail), true);
          assertEquals(
            (retrieval.queryTrail as string[]).some((query) =>
              query.startsWith("site:react.dev ")
            ),
            true,
          );
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
        assertEquals(queriesSeen.length >= 2, true);
        assert(results.some((result) => result.selectedForFetch === true));
        assert(formatted?.llmContent.includes("Fetched sources:"));
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

Deno.test("web tools: formatSearchWebResult surfaces fetched sources and retrieval guidance", () => {
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
        selectedForFetch: true,
        score: 9,
      },
      {
        title: "Deno Deploy Discussion",
        url: "https://reddit.com/r/deno/deploy",
        snippet: "Has anyone tried Deno Deploy?",
        score: 5,
      },
    ],
    guidance: {
      answerAvailable: true,
      stopReason: "1 fetched source(s) include extracted evidence. Prefer these before unfetched search results.",
    },
  });
  assert(withGuidance !== null);
  assert(withGuidance!.llmContent.includes("Fetched sources:"));
  assert(withGuidance!.llmContent.includes("Deploy on Deno"));
  assert(withGuidance!.llmContent.includes("1 fetched source(s) include extracted evidence"));
  assert(withGuidance!.llmContent.includes("Use fetched sources as primary evidence."));
  assert(!withGuidance!.llmContent.includes("Detailed search results:"));

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
  assert(!noGuidance!.llmContent.includes("Fetched sources:"));
  assert(!noGuidance!.llmContent.includes("Respond from these"));
});
