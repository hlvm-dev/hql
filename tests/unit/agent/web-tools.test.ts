import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "jsr:@std/assert";
import {
  __testOnlyBuildSearchWebCacheKey,
  __testOnlyFormatSearchWebResult,
  resetWebToolBudget,
  WEB_TOOLS,
} from "../../../src/hlvm/agent/tools/web-tools.ts";
import {
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
import { withTempHlvmDir } from "../helpers.ts";

async function withIsolatedSearchRegistry(
  fn: () => Promise<void>,
): Promise<void> {
  await withTempHlvmDir(async () => {
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
  });
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

Deno.test("web tools: input validation and network policy denial are enforced", async () => {
  await withIsolatedSearchRegistry(async () => {
    const denyAll: AgentPolicy = { version: 1, networkRules: { deny: ["*"] } };

    await assertRejects(() => WEB_TOOLS.search_web.fn({} as Record<string, unknown>, "/tmp"), ValidationError);
    await assertRejects(() => WEB_TOOLS.fetch_url.fn({} as Record<string, unknown>, "/tmp"), ValidationError);
    await assertRejects(() => WEB_TOOLS.web_fetch.fn({} as Record<string, unknown>, "/tmp"), ValidationError);
    await assertRejects(() => WEB_TOOLS.search_web.fn({ query: "hlvm" }, "/tmp", { policy: denyAll }), ValidationError);
    await assertRejects(() => WEB_TOOLS.fetch_url.fn({ url: "https://example.com" }, "/tmp", { policy: denyAll }), ValidationError);
  });
});

Deno.test("web tools: search_web recovers nested JSON args embedded in query", async () => {
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
});

Deno.test("web tools: cache keys stay order-invariant and ignore model-specific dimensions", () => {
  const base = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5);
  const allowA = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5, ["a.com", "b.com"]);
  const allowB = __testOnlyBuildSearchWebCacheKey("duckduckgo", "bitcoin", 5, ["b.com", "a.com"]);
  const dayRange = __testOnlyBuildSearchWebCacheKey(
    "duckduckgo",
    "bitcoin",
    5,
    undefined,
    undefined,
    "day",
  );
  const noPrefetch = __testOnlyBuildSearchWebCacheKey(
    "duckduckgo",
    "bitcoin",
    5,
    undefined,
    undefined,
    "all",
    undefined,
    "medium",
    false,
    false,
  );

  assertEquals(allowA, allowB);
  assertNotEquals(base, allowA);
  assertNotEquals(base, dayRange);
  assertNotEquals(base, noPrefetch);
});

Deno.test("web tools: search_web enables reformulation by default for medium depth", async () => {
  await withIsolatedSearchRegistry(async () => {
    const seenReformulate: boolean[] = [];

    registerSearchProvider({
      name: "duckduckgo",
      displayName: "reformulate-defaults",
      requiresApiKey: false,
      search(query: string, opts: SearchCallOptions) {
        seenReformulate.push(Boolean(opts.reformulate));
        return Promise.resolve({
          query,
          provider: "duckduckgo",
          count: 1,
          results: [{
            title: "Reformulation defaults",
            url: "https://example.com/reformulate",
            snippet: "Default reformulation wiring",
          }],
        });
      },
    });

    resetWebToolBudget();
    const raw = await WEB_TOOLS.search_web.fn(
      {
        query: "react useeffect cleanup",
        maxResults: 1,
        prefetch: false,
      },
      "/tmp",
    ) as Record<string, unknown>;

    const diagnostics = raw.diagnostics as Record<string, unknown>;
    const profile = diagnostics.profile as Record<string, unknown>;
    const resolvedOptions = profile.resolvedOptions as Record<string, unknown>;

    assertEquals(seenReformulate, [true]);
    assertEquals(resolvedOptions.reformulate, true);
  });
});

Deno.test("web tools: domain filters keep relevant domains only", () => {
  assertEquals(isAllowedByDomainFilters("api.github.com", ["github.com"]), true);
  assertEquals(isAllowedByDomainFilters("docs.python.org", ["python.org"]), true);
  assertEquals(isAllowedByDomainFilters("example.com", ["github.com"]), false);
});

Deno.test("web tools: DuckDuckGo and Bing parsing extract urls and snippets", () => {
  const duck = parseDuckDuckGoSearchResults(`
    <html><body>
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freact.dev%2Freference%2Freact%2FuseEffect">useEffect - React</a>
      <a class="result__snippet">Official React reference for cleanup.</a>
      <a class="result-link" rel="nofollow" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fsame">Same Result</a>
      <td class="result-snippet">First snippet</td>
      <a class="result-link" rel="nofollow" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fsame">Same Result Duplicate</a>
      <td class="result-snippet">Second snippet</td>
    </body></html>
  `, 5);
  const bing = parseBingSearchResults(`
    <html><body>
      <li class="b_algo">
        <h2><a href="https://react.dev/reference/react/useEffect">useEffect - React</a></h2>
        <div class="b_caption"><p>Official React reference for useEffect cleanup.</p></div>
      </li>
    </body></html>
  `, 5);

  assertEquals(duck[0].url, "https://react.dev/reference/react/useEffect");
  assertEquals(duck[0].snippet, "Official React reference for cleanup.");
  assertEquals(duck[1].url, "https://example.com/same");
  assertEquals(bing[0].url, "https://react.dev/reference/react/useEffect");
  assertEquals(bing[0].snippet, "Official React reference for useEffect cleanup.");
});

Deno.test("web tools: formatting surfaces fetched evidence without deterministic answer drafts", () => {
  const highConfidence = __testOnlyFormatSearchWebResult({
    query: "deno 2.2 release",
    provider: "duckduckgo",
    count: 2,
    results: [
      {
        title: "Deno 2.2 Release Notes",
        url: "https://deno.com/blog/v2.2",
        snippet: "Deno 2.2 introduces workspaces",
        pageDescription: "A longer description extracted from page metadata",
        publishedDate: "2026-02-15",
        passages: ["The new release includes faster startup."],
        selectedForFetch: true,
        score: 8,
      },
      {
        title: "What's New in Deno",
        url: "https://blog.example.com/deno-22",
        snippet: "Deno adds monorepo support",
        score: 6,
      },
    ],
    citations: [{ url: "https://deno.com/blog/v2.2", title: "Deno 2.2 Release Notes" }],
  });
  assert(highConfidence !== null);
  assert(highConfidence!.returnDisplay.includes('Search: "deno 2.2 release"'));
  assert(!highConfidence!.returnDisplay.includes("Deterministic answer draft"));
  assert(highConfidence!.llmContent.includes("Fetched sources:"));
  assert(highConfidence!.llmContent.includes("Use fetched sources as primary evidence."));
  assert(!highConfidence!.llmContent.includes("grounded baseline"));

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
  assert(lowConfidence!.llmContent.includes("Related links to check:"));
});

Deno.test({
  name: "web tools: search_web retries DuckDuckGo page 2 when first-pass confidence is low",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      const offsets: number[] = [];

      await withStubbedFetch(async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.startsWith("https://html.duckduckgo.com/html/?")) {
          throw new Error(`Unexpected fetch: ${url}`);
        }

        const parsed = new URL(url);
        const offset = Number(parsed.searchParams.get("s") ?? "0");
        offsets.push(offset);

        if (offset === 0) {
          return new Response(
            `<html><body>
              <a class="result__a" href="/l/?uddg=https%3A%2F%2Fgeneric.example.com%2Fhome">Generic home page</a>
              <a class="result__snippet">Welcome portal for general browsing.</a>
            </body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }

        return new Response(
          `<html><body>
            <a class="result__a" href="/l/?uddg=https%3A%2F%2Freact.dev%2Freference%2Freact%2FuseEffect">useEffect - React</a>
            <a class="result__snippet">Official React reference for useEffect cleanup and effect reruns.</a>
          </body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }, async () => {
        resetWebToolBudget();
        const raw = await WEB_TOOLS.search_web.fn(
          {
            query: "official react useeffect cleanup",
            maxResults: 3,
            prefetch: false,
            reformulate: false,
          },
          "/tmp",
        ) as Record<string, unknown>;

        const diagnostics = raw.diagnostics as Record<string, unknown>;
        const provider = diagnostics.provider as Record<string, unknown>;
        const secondPage = provider.secondPage as Record<string, unknown>;
        const results = raw.results as Array<Record<string, unknown>>;

        assertEquals(offsets, [0, 30]);
        assertEquals(secondPage.attempted, true);
        assertEquals(secondPage.fetched, true);
        assertEquals(secondPage.initialLowConfidence, true);
        assertEquals(secondPage.mergedFilteredCount, 2);
        assertEquals(
          results.some((result) => result.url === "https://react.dev/reference/react/useEffect"),
          true,
        );
      });
    });
  },
});

Deno.test({
  name: "web tools: search_web preserves table evidence as markdown in extracted passages and llm content",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      registerSearchProvider({
        name: "duckduckgo",
        displayName: "table-preservation",
        requiresApiKey: false,
        search(query: string, opts: SearchCallOptions) {
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 1,
            results: [{
              title: "Runtime support matrix",
              url: "https://docs.example.com/runtime-matrix",
              snippet: "Runtime support matrix for Deno and Node.",
            }],
            diagnostics: { limit: opts.limit },
          });
        },
      });

      await withStubbedFetch(async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url !== "https://docs.example.com/runtime-matrix") {
          return new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } });
        }
        return new Response(
          `<html><body><article>
            <h2>Runtime support</h2>
            <table>
              <thead>
                <tr><th>Runtime</th><th>Support</th></tr>
              </thead>
              <tbody>
                <tr><td>Deno</td><td>Full</td></tr>
                <tr><td>Node</td><td>Partial</td></tr>
              </tbody>
            </table>
            <p>Deno has full support for the web search pipeline.</p>
          </article></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }, async () => {
        resetWebToolBudget();
        const raw = await WEB_TOOLS.search_web.fn(
          {
            query: "runtime support deno node",
            maxResults: 1,
            prefetch: true,
            reformulate: false,
          },
          "/tmp",
          { modelId: "test-model" },
        ) as Record<string, unknown>;

        const results = raw.results as Array<Record<string, unknown>>;
        const passages = results[0]?.passages as string[] | undefined;
        assertEquals(
          passages?.some((passage) =>
            passage.includes("| Runtime | Support |") &&
            passage.includes("| Deno | Full |") &&
            passage.includes("| Node | Partial |")
          ),
          true,
        );

        const formatted = __testOnlyFormatSearchWebResult(raw);
        assert(formatted !== null);
        assertEquals(formatted!.llmContent.includes("| Runtime | Support |"), true);
        assertEquals(formatted!.llmContent.includes("| Deno | Full |"), true);
        assertEquals(formatted!.llmContent.includes("| Node | Partial |"), true);
      });
    });
  },
});

Deno.test({
  name: "web tools: search_web uses deterministic selection and returns fetched evidence with source labels",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const originalChatStructured = ai.chatStructured;
    let llmChooserCalls = 0;

    try {
      (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = () => {
        llmChooserCalls += 1;
        return Promise.resolve({ content: "", toolCalls: [] });
      };

      await withIsolatedSearchRegistry(async () => {
        registerSearchProvider({
          name: "duckduckgo",
          displayName: "thin-prefetch",
          requiresApiKey: false,
          search(query: string, opts: SearchCallOptions) {
            return Promise.resolve({
              query,
              provider: "duckduckgo",
              count: 3,
              results: [
                {
                  title: "React homepage",
                  url: "https://react.dev/",
                  snippet: "The library for web interfaces",
                },
                {
                  title: "useEffect - React",
                  url: "https://react.dev/reference/react/useEffect",
                  snippet: "Official React reference for useEffect cleanup.",
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

        await withStubbedFetch(async (input) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/reference/react/useEffect")) {
            return new Response(
              `<html><head><meta name="description" content="Reference documentation for React useEffect cleanup." /></head><body><article><p>The cleanup function runs before the effect re-runs and after the component unmounts.</p></article></body></html>`,
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
              maxResults: 3,
              prefetch: true,
              reformulate: false,
              allowedDomains: ["react.dev"],
            },
            "/tmp",
            { modelId: "test-model" },
          ) as Record<string, unknown>;

          const diagnostics = raw.diagnostics as Record<string, unknown>;
          const prefetch = diagnostics.prefetch as Record<string, unknown>;
          const retrieval = diagnostics.retrieval as Record<string, unknown>;
          const results = raw.results as Array<Record<string, unknown>>;
          const citations = raw.citations as Array<Record<string, unknown>>;

          assertEquals(llmChooserCalls, 0);
          assertEquals(prefetch.selectionStrategy, "deterministic");
          assertEquals((prefetch.targetUrls as string[])[0], "https://react.dev/reference/react/useEffect");
          assertEquals((retrieval.fetchEvidenceCount as number) >= 1, true);
          assertEquals(results[0].url, "https://react.dev/reference/react/useEffect");
          assertEquals(results[0].selectedForFetch, true);
          assertEquals(results[0].evidenceStrength, "high");
          assertEquals(results[0].sourceClass, "official_docs");
          assertEquals(citations[0]?.sourceClass, "official_docs");
          assertEquals(citations[0]?.sourceKind, "passage");
          assertEquals("answerDraft" in raw, false);
          assertEquals("guidance" in raw, false);
        });
      });
    } finally {
      (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = originalChatStructured;
    }
  },
});

Deno.test({
  name: "web tools: search_web keeps the top two fetched hosts diverse for generic docs tutorial queries",
  ignore: true, // LLM-dependent: host diversity scoring uses local LLM classifier (non-deterministic)
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withStubbedFetch(async () => {
      return new Response(
        "<html><head><meta name=\"description\" content=\"tutorial\" /></head><body><article><p>tutorial body</p></article></body></html>",
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }, async () => {
      await withIsolatedSearchRegistry(async () => {
        registerSearchProvider({
          name: "duckduckgo",
          displayName: "docs-diversity",
          requiresApiKey: false,
          search(query: string) {
            return Promise.resolve({
              query,
              provider: "duckduckgo",
              count: 4,
              results: [
                {
                  title: "HLVM Docs A",
                  url: "https://docs.example.com/a",
                  snippet: "hlvm docs tutorial one",
                },
                {
                  title: "HLVM Docs B",
                  url: "https://docs.example.com/b",
                  snippet: "hlvm docs tutorial two",
                },
                {
                  title: "HLVM Community Tutorial",
                  url: "https://community.example.org/hlvm",
                  snippet: "hlvm docs community tutorial",
                },
                {
                  title: "HLVM GitHub",
                  url: "https://github.com/example/hlvm",
                  snippet: "source repository",
                },
              ],
            });
          },
        });

        resetWebToolBudget();
        const raw = await WEB_TOOLS.search_web.fn(
          {
            query: "hlvm docs tutorial",
            maxResults: 5,
            prefetch: true,
            reformulate: false,
          },
          "/tmp",
          { modelId: "test-model" },
        ) as Record<string, unknown>;

        const results = raw.results as Array<Record<string, unknown>>;
        const topHosts = results.slice(0, 2).map((result) =>
          new URL(String(result.url ?? "")).hostname
        );
        assertEquals(new Set(topHosts).size, 2);
      });
    });
  },
});

Deno.test({
  name: "web tools: search_web applies release-note intent to prioritize canonical sources",
  ignore: true, // LLM-dependent: intent classification and source prioritization use local LLM (non-deterministic)
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      registerSearchProvider({
        name: "duckduckgo",
        displayName: "release-intent",
        requiresApiKey: false,
        search(query: string, opts: SearchCallOptions) {
          return Promise.resolve({
            query,
            provider: "duckduckgo",
            count: 3,
            results: [
              {
                title: "Latest Next.js release notes roundup",
                url: "https://blog.example.com/nextjs-release-notes",
                snippet: "Community recap of the latest Next.js release notes.",
              },
              {
                title: "Releases · vercel/next.js",
                url: "https://github.com/vercel/next.js/releases",
                snippet: "Official GitHub releases for Next.js.",
              },
              {
                title: "Next.js 15.5",
                url: "https://nextjs.org/blog/next-15-5",
                snippet: "Official Next.js release announcement.",
              },
            ],
            diagnostics: { limit: opts.limit },
          });
        },
      });

      await withStubbedFetch(async (input) => {
        const url = typeof input === "string"
          ? input
          : input instanceof URL
          ? input.href
          : input.url;
        if (url.includes("github.com/vercel/next.js/releases")) {
          return new Response(
            `<html><body><article><p>Next.js releases and changelog entries.</p></article></body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }
        if (url.includes("nextjs.org/blog/next-15-5")) {
          return new Response(
            `<html><body><article><p>Official Next.js 15.5 release notes.</p></article></body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response(
          `<html><body><article><p>Community recap of Next.js release notes.</p></article></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }, async () => {
        resetWebToolBudget();
        const raw = await WEB_TOOLS.search_web.fn(
          {
            query: "latest next.js release notes",
            maxResults: 3,
            prefetch: true,
            reformulate: false,
          },
          "/tmp",
        ) as Record<string, unknown>;

        const results = raw.results as Array<Record<string, unknown>>;
        const citations = raw.citations as Array<Record<string, unknown>>;
        assertEquals(results[0]?.url === "https://blog.example.com/nextjs-release-notes", false);
        assertEquals(
          [
            "https://github.com/vercel/next.js/releases",
            "https://nextjs.org/blog/next-15-5",
          ].includes(String(results[0]?.url)),
          true,
        );
        assertEquals(
          citations.some((citation) =>
            citation.url === "https://blog.example.com/nextjs-release-notes"
          ),
          false,
        );
        assertEquals(
          citations.some((citation) =>
            citation.url === "https://nextjs.org/blog/next-15-5"
          ),
          true,
        );
      });
    });
  },
});

Deno.test({
  name: "web tools: custom provider path stays single-pass and omits deep query diagnostics",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withIsolatedSearchRegistry(async () => {
      const queriesSeen: string[] = [];
      registerSearchProvider({
        name: "duckduckgo",
        displayName: "single-pass",
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

      assertEquals(queriesSeen.length, 1);
      assertEquals("deep" in diagnostics, false);
      assertEquals("queryTrail" in (diagnostics.retrieval as Record<string, unknown>), false);
    });
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
          { modelId: "test-model" },
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
