import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { ai } from "../../../src/hlvm/api/ai.ts";
import {
  rankFetchedEvidenceDeterministically,
  selectSearchResultsDeterministically,
  selectSearchResultsWithLlm,
} from "../../../src/hlvm/agent/tools/web/search-result-selector.ts";
import type { SearchResult } from "../../../src/hlvm/agent/tools/web/search-provider.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<SearchResult> & { title: string }): SearchResult {
  return {
    url: `https://example.com/${overrides.title.toLowerCase().replace(/\s+/g, "-")}`,
    snippet: `Snippet for ${overrides.title}`,
    ...overrides,
  };
}

function withMockedChatStructured<T>(
  mockFn: typeof ai.chatStructured,
  body: () => T,
): T extends Promise<infer U> ? Promise<U> : T {
  const original = ai.chatStructured;
  (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = mockFn;
  try {
    const result = body();
    if (result instanceof Promise) {
      return result.finally(() => {
        (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = original;
      }) as ReturnType<typeof withMockedChatStructured<T>>;
    }
    (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = original;
    return result as ReturnType<typeof withMockedChatStructured<T>>;
  } catch (err) {
    (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = original;
    throw err;
  }
}

const DEFAULT_INTENT = {
  wantsOfficialDocs: false,
  wantsComparison: false,
  wantsRecency: false,
  wantsVersionSpecific: false,
  wantsReleaseNotes: false,
  wantsReference: false,
  wantsQueryDecomposition: false,
  wantsFetchFirst: false,
  wantsMultiSourceSynthesis: false,
  wantsAuthoritativeBias: false,
};

// ===========================================================================
// Deterministic path — core scoring
// ===========================================================================

Deno.test("deterministic: prioritizes official docs and diversity", () => {
  const results: SearchResult[] = [
    {
      title: "Generic React landing page",
      url: "https://example.com/react",
      snippet: "General overview page",
    },
    {
      title: "useEffect - React",
      url: "https://react.dev/reference/react/useEffect",
      snippet: "Official React reference for useEffect and cleanup.",
    },
    {
      title: "Synchronizing with Effects - React",
      url: "https://react.dev/learn/synchronizing-with-effects",
      snippet: "Official React guide for Effects and cleanup behavior.",
    },
    {
      title: "React useEffect cleanup explained",
      url: "https://blog.example.com/react-cleanup",
      snippet: "Community post about useEffect cleanup.",
    },
  ];

  const selection = selectSearchResultsDeterministically({
    query: "official React docs useEffect cleanup",
    results,
    maxPicks: 3,
    allowedDomains: ["react.dev"],
    intent: {
      ...DEFAULT_INTENT,
      wantsOfficialDocs: true,
      wantsReference: true,
      wantsFetchFirst: true,
      wantsAuthoritativeBias: true,
    },
  });

  assertEquals(selection.strategy, "deterministic");
  // Official reference doc should be ranked first
  assertEquals(selection.pickedIndices[0], 1);
  assertEquals(selection.picks[0].url, "https://react.dev/reference/react/useEffect");
  // Should include the guide from same domain (high relevance)
  assert(selection.picks.some((r) =>
    r.url === "https://react.dev/learn/synchronizing-with-effects"
  ));
  // Diversity: community post included to get a third result
  assert(selection.picks.some((r) =>
    r.url === "https://blog.example.com/react-cleanup"
  ));
  // Confidence should reflect strong query overlap
  assert(
    selection.confidence === "high" || selection.confidence === "medium",
    `Expected high or medium confidence, got ${selection.confidence}`,
  );
  assertEquals(selection.picks.length, 3);
  assertEquals(selection.pickedIndices.length, 3);
});

// ===========================================================================
// Deterministic path — edge cases
// ===========================================================================

Deno.test("deterministic: empty results returns low confidence and no picks", () => {
  const selection = selectSearchResultsDeterministically({
    query: "anything",
    results: [],
    maxPicks: 3,
  });

  assertEquals(selection.strategy, "deterministic");
  assertEquals(selection.picks, []);
  assertEquals(selection.pickedIndices, []);
  assertEquals(selection.confidence, "low");
  assert(selection.reason.length > 0, "reason should be non-empty");
});

Deno.test("deterministic: maxPicks=0 returns no picks", () => {
  const selection = selectSearchResultsDeterministically({
    query: "test",
    results: [makeResult({ title: "A result" })],
    maxPicks: 0,
  });

  assertEquals(selection.picks, []);
  assertEquals(selection.pickedIndices, []);
  assertEquals(selection.confidence, "low");
});

Deno.test("deterministic: maxPicks larger than results returns all results", () => {
  const results: SearchResult[] = [
    makeResult({ title: "Alpha", url: "https://a.example.com/alpha" }),
    makeResult({ title: "Beta", url: "https://b.example.com/beta" }),
  ];

  const selection = selectSearchResultsDeterministically({
    query: "alpha beta",
    results,
    maxPicks: 10,
  });

  assertEquals(selection.picks.length, 2);
  assertEquals(selection.pickedIndices.length, 2);
  // Both results should be present (no more to backfill)
  const urls = new Set(selection.picks.map((p) => p.url));
  assert(urls.has("https://a.example.com/alpha"));
  assert(urls.has("https://b.example.com/beta"));
});

Deno.test("deterministic: results with missing fields do not crash and score lower", () => {
  const results: SearchResult[] = [
    { title: "" },                                    // empty title, no url, no snippet
    { title: "Proper result about testing", url: "https://docs.test.com/testing", snippet: "Full testing guide" },
    { title: "X", url: "http://x.com" },              // very short title, http, no snippet
  ];

  const selection = selectSearchResultsDeterministically({
    query: "testing guide",
    results,
    maxPicks: 3,
  });

  assertEquals(selection.strategy, "deterministic");
  assertEquals(selection.picks.length, 3);
  // The proper result with all fields matching the query should rank first
  assertEquals(selection.picks[0].url, "https://docs.test.com/testing");
  // All three should appear (backfill ensures complete coverage)
  assertEquals(selection.pickedIndices.length, 3);
});

Deno.test("deterministic: duplicate URLs in input are treated as separate candidates (no dedup)", () => {
  const results: SearchResult[] = [
    makeResult({ title: "Page A", url: "https://example.com/page", snippet: "First copy" }),
    makeResult({ title: "Page B", url: "https://example.com/page", snippet: "Second copy" }),
    makeResult({ title: "Page C", url: "https://other.com/page", snippet: "Other domain" }),
  ];

  const selection = selectSearchResultsDeterministically({
    query: "page",
    results,
    maxPicks: 3,
  });

  assertEquals(selection.picks.length, 3);
  // Diversity penalty should push the other-domain result up relative to the second dupe
  const otherIndex = selection.picks.findIndex((r) => r.url === "https://other.com/page");
  assert(otherIndex >= 0, "Other domain result should be included");
});

Deno.test("deterministic: caps candidates at 10", () => {
  const results: SearchResult[] = Array.from({ length: 15 }, (_, i) => ({
    title: `Result ${i}`,
    url: `https://example${i}.com/page`,
    snippet: `Content ${i}`,
  }));

  const selection = selectSearchResultsDeterministically({
    query: "test query",
    results,
    maxPicks: 12,
  });

  // Even with 15 results and maxPicks=12, only first 10 are candidates
  assert(
    selection.picks.length <= 10,
    `Expected at most 10 picks, got ${selection.picks.length}`,
  );
  // Should not include indices >= 10
  for (const idx of selection.pickedIndices) {
    assert(idx < 10, `Index ${idx} should be < 10`);
  }
});

Deno.test("deterministic: allowed domains boost matching results to top", () => {
  const results: SearchResult[] = [
    makeResult({ title: "Python tutorial", url: "https://random-blog.com/python", snippet: "Python tips" }),
    makeResult({ title: "Python tutorial", url: "https://docs.python.org/tutorial", snippet: "Python tips" }),
    makeResult({ title: "Python tutorial", url: "https://realpython.com/python", snippet: "Python tips" }),
  ];

  const selection = selectSearchResultsDeterministically({
    query: "Python tutorial",
    results,
    maxPicks: 2,
    allowedDomains: ["docs.python.org"],
    intent: { ...DEFAULT_INTENT, wantsOfficialDocs: true, wantsAuthoritativeBias: true },
  });

  // The docs.python.org result should be first due to allowedDomains boost
  assertEquals(selection.picks[0].url, "https://docs.python.org/tutorial");
});

Deno.test("deterministic: single result returns it as the sole pick", () => {
  const selection = selectSearchResultsDeterministically({
    query: "unique thing",
    results: [makeResult({ title: "The unique thing", url: "https://unique.com/thing" })],
    maxPicks: 5,
  });

  assertEquals(selection.picks.length, 1);
  assertEquals(selection.pickedIndices, [0]);
  assertEquals(selection.picks[0].url, "https://unique.com/thing");
});

// ===========================================================================
// Deterministic path — intent-driven scoring
// ===========================================================================

Deno.test("deterministic: release-note intent demotes community wrappers", () => {
  const selection = selectSearchResultsDeterministically({
    query: "latest next.js release notes 2025",
    results: [
      {
        title: "Next.js 14 New Features | Latest Updates & Improvements",
        url: "https://mediusware.com/blog/whats-new-in-nextjs-14",
        snippet: "Explore the latest features in Next.js 14.",
        publishedDate: "2025-08-12",
      },
      {
        title: "Next.js: Releases, patches & end-of-life",
        url: "https://www.versio.io/en/product-release-end-of-life-eol-vercel-nextjs.html",
        snippet: "Lifecycle and patch information for Next.js.",
      },
      {
        title: "Getting Started: Upgrading | Next.js",
        url: "https://nextjs.org/docs/app/getting-started/upgrading",
        snippet: "Learn how to upgrade your Next.js application to the latest version.",
      },
      {
        title: "Next.js Changelog",
        url: "https://next-changelog.vercel.app/",
        snippet: "Stay up to date with the latest releases of Next.js.",
      },
      {
        title: "Next.js by Vercel - The React Framework | Blog",
        url: "https://nextjs.org/blog",
        snippet: "Latest Next.js announcements and release posts.",
      },
    ],
    maxPicks: 3,
    intent: {
      ...DEFAULT_INTENT,
      wantsRecency: true,
      wantsReleaseNotes: true,
      wantsFetchFirst: true,
      wantsMultiSourceSynthesis: true,
      wantsAuthoritativeBias: true,
    },
  });

  // Community wrapper should not be first
  assertEquals(selection.picks[0].url === "https://mediusware.com/blog/whats-new-in-nextjs-14", false);
  // First pick should be an authoritative release source
  assertEquals(
    [
      "https://nextjs.org/blog",
      "https://next-changelog.vercel.app/",
      "https://nextjs.org/docs/app/getting-started/upgrading",
    ].includes(String(selection.picks[0].url)),
    true,
  );
});

Deno.test("deterministic: compound product terms prefer Next.js over Node.js", () => {
  const selection = selectSearchResultsDeterministically({
    query: "Next.js latest release notes 2025",
    results: [
      {
        title: "Node.js 25: List Releases, Release Date, End of Life",
        url: "https://versionlog.com/nodejs/25/",
        snippet: "Node.js 25 release notes and release dates.",
      },
      {
        title: "Next.js Changelog",
        url: "https://next-changelog.vercel.app/",
        snippet: "Stay up to date with the latest releases of Next.js.",
      },
      {
        title: "Next.js by Vercel | Blog",
        url: "https://nextjs.org/blog",
        snippet: "Latest Next.js announcements and release posts.",
      },
    ],
    maxPicks: 2,
    intent: {
      ...DEFAULT_INTENT,
      wantsRecency: true,
      wantsReleaseNotes: true,
      wantsFetchFirst: true,
      wantsMultiSourceSynthesis: true,
      wantsAuthoritativeBias: true,
    },
  });

  // Node.js should NOT be first when searching for Next.js
  assertEquals(selection.picks[0].url === "https://versionlog.com/nodejs/25/", false);
  assertEquals(
    [
      "https://next-changelog.vercel.app/",
      "https://nextjs.org/blog",
    ].includes(String(selection.picks[0].url)),
    true,
  );
});

Deno.test("deterministic: live-like Next.js release query rejects unrelated entities", () => {
  const selection = selectSearchResultsDeterministically({
    query: "Next.js latest release notes 2025",
    results: [
      {
        title: "Node.js 25: List Releases, Release Date, End of Life",
        url: "https://versionlog.com/nodejs/25/",
        snippet:
          "Node.js 25 release notes and release dates, with the latest Node.js 25 release details.",
      },
      {
        title: "Getting Started: Upgrading | Next.js",
        url: "https://nextjs.org/docs/app/getting-started/upgrading",
        snippet: "Learn how to upgrade your Next.js application to the latest version or canary.",
      },
      {
        title: "Guides: Upgrading | Next.js",
        url: "https://nextjs.org/docs/app/guides/upgrading",
        snippet: "Learn how to upgrade to the latest versions of Next.js.",
      },
      {
        title: "Next.js: Releases, patches & end-of-life - versio.io",
        url: "https://www.versio.io/en/product-release-end-of-life-eol-vercel-nextjs.html",
        snippet: "Lifecycle information for Next.js releases, patches, and end-of-life.",
      },
      {
        title: "Next.js Changelog",
        url: "https://next-changelog.vercel.app/",
        snippet: "Stay up to date with the latest releases of Next.js.",
      },
      {
        title: "Next.js by Vercel - The React Framework | Blog",
        url: "https://nextjs.org/blog",
        snippet:
          "Latest Next.js news and release announcements from Vercel.",
      },
      {
        title: "Nx Changelog",
        url: "https://nx.dev/changelog",
        snippet: "Nx changelog and release notes.",
      },
      {
        title: "Next.js Weekly #117",
        url: "https://nextjsweekly.com/issues/117",
        snippet: "Weekly roundup of Next.js links and updates.",
      },
    ],
    maxPicks: 4,
    intent: {
      ...DEFAULT_INTENT,
      wantsRecency: true,
      wantsReleaseNotes: true,
      wantsFetchFirst: true,
      wantsMultiSourceSynthesis: true,
      wantsAuthoritativeBias: true,
    },
  });

  assertEquals(selection.picks[0].url, "https://nextjs.org/blog");
  // Node.js and Nx should NOT be in top 3
  assertEquals(
    selection.picks.slice(0, 3).some((r) =>
      r.url === "https://versionlog.com/nodejs/25/"
    ),
    false,
  );
  assertEquals(
    selection.picks.slice(0, 3).some((r) =>
      r.url === "https://nx.dev/changelog"
    ),
    false,
  );
});

Deno.test("deterministic: stable-release query prefers release sources over generic upgrade docs", () => {
  const selection = selectSearchResultsDeterministically({
    query: "Next.js 15.3 stable release notes",
    results: [
      {
        title: "Next.js by Vercel - The React Framework | Blog",
        url: "https://nextjs.org/blog",
        snippet:
          "Next.js 15.5 includes Turbopack builds in beta, stable Node.js middleware, TypeScript improvements, and more.",
      },
      {
        title: "Upgrade Expo SDK - Expo Documentation",
        url: "https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/",
        snippet:
          "Each SDK announcement release notes post contains important upgrade instructions.",
      },
      {
        title: "Release Notes - PostgreSQL",
        url: "https://www.postgresql.org/docs/release/",
        snippet: "Complete archive of PostgreSQL release notes.",
      },
      {
        title: "Upgrading: Version 15 | Next.js",
        url: "https://nextjs.org/docs/app/guides/upgrading/version-15",
        snippet: "Upgrade from Next.js 14 to version 15 using the codemod.",
      },
      {
        title: "Next.js: Releases, patches & end-of-life - versio.io",
        url: "https://www.versio.io/en/product-release-end-of-life-eol-vercel-nextjs.html",
        snippet: "Lifecycle and patch information for Next.js releases.",
      },
    ],
    maxPicks: 3,
    intent: {
      ...DEFAULT_INTENT,
      wantsRecency: true,
      wantsVersionSpecific: true,
      wantsReleaseNotes: true,
      wantsFetchFirst: true,
      wantsMultiSourceSynthesis: true,
      wantsAuthoritativeBias: true,
    },
  });

  assertEquals(selection.picks[0].url, "https://nextjs.org/blog");
  // Unrelated projects (Expo, PostgreSQL) should not be in top 2
  assertEquals(
    selection.picks.slice(0, 2).some((r) =>
      r.url === "https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/"
    ),
    false,
  );
  assertEquals(
    selection.picks.slice(0, 2).some((r) =>
      r.url === "https://www.postgresql.org/docs/release/"
    ),
    false,
  );
});

Deno.test("deterministic: comparison intent spreads across diverse hosts", () => {
  const results: SearchResult[] = [
    makeResult({ title: "React vs Vue 2025", url: "https://blog-a.com/react-vs-vue", snippet: "Comparison of React and Vue frameworks" }),
    makeResult({ title: "React vs Vue detailed analysis", url: "https://blog-a.com/react-vue-analysis", snippet: "In-depth comparison of React versus Vue" }),
    makeResult({ title: "Vue vs React differences", url: "https://blog-b.com/vue-react", snippet: "How Vue and React differ" }),
    makeResult({ title: "React vs Vue comparison", url: "https://blog-c.com/compare", snippet: "Side-by-side comparison" }),
  ];

  const selection = selectSearchResultsDeterministically({
    query: "React vs Vue comparison",
    results,
    maxPicks: 3,
    intent: {
      ...DEFAULT_INTENT,
      wantsComparison: true,
      wantsMultiSourceSynthesis: true,
    },
  });

  // With comparison intent, diversity penalty should spread picks across hosts
  const hosts = new Set(selection.picks.map((p) => {
    try { return new URL(p.url!).hostname; } catch { return "unknown"; }
  }));
  assert(
    hosts.size >= 2,
    `Expected at least 2 distinct hosts for comparison intent, got ${hosts.size}: ${[...hosts].join(", ")}`,
  );
});

// ===========================================================================
// Fetched evidence ranking
// ===========================================================================

Deno.test("evidence ranking: prefers extracted passages over bare snippets", () => {
  const ranked = rankFetchedEvidenceDeterministically({
    query: "react useeffect cleanup official docs",
    allowedDomains: ["react.dev"],
    intent: {
      ...DEFAULT_INTENT,
      wantsOfficialDocs: true,
      wantsReference: true,
      wantsFetchFirst: true,
      wantsAuthoritativeBias: true,
    },
    results: [
      {
        title: "React landing page",
        url: "https://react.dev/",
        snippet: "React homepage",
        selectedForFetch: true,
      },
      {
        title: "useEffect - React",
        url: "https://react.dev/reference/react/useEffect",
        snippet: "Official reference for useEffect.",
        pageDescription: "Reference documentation for React useEffect cleanup behavior.",
        passages: ["The cleanup function runs before the effect re-runs and after the component unmounts."],
        selectedForFetch: true,
      },
      {
        title: "Synchronizing with Effects - React",
        url: "https://react.dev/learn/synchronizing-with-effects",
        snippet: "Guide for synchronizing with effects.",
        pageDescription: "Learn how effects synchronize and when cleanup matters.",
        selectedForFetch: true,
      },
    ],
  });

  // Result with passages + matching query terms should rank highest
  assertEquals(ranked.results[0].url, "https://react.dev/reference/react/useEffect");
  assertEquals(ranked.results[0].evidenceStrength, "high");
  // Result with pageDescription but no passages should rank medium
  assertEquals(ranked.results[1].evidenceStrength, "medium");
  // Bare homepage should rank lowest
  assertEquals(ranked.results[2].evidenceStrength, "low");
  // Evidence reason should mention passage matching
  assert(
    ranked.results[0].evidenceReason?.includes("matched the query") === true,
  );
  assertEquals(ranked.results.length, 3);
});

Deno.test("evidence ranking: empty results returns low confidence", () => {
  const ranked = rankFetchedEvidenceDeterministically({
    query: "anything",
    results: [],
  });

  assertEquals(ranked.results, []);
  assertEquals(ranked.confidence, "low");
  assert(ranked.reason.length > 0);
});

Deno.test("evidence ranking: single result retains all fields", () => {
  const ranked = rankFetchedEvidenceDeterministically({
    query: "testing",
    results: [{
      title: "Testing Guide",
      url: "https://testing.dev/guide",
      snippet: "Complete testing guide",
      passages: ["Unit tests verify individual functions in isolation."],
      pageDescription: "A comprehensive guide to testing.",
    }],
  });

  assertEquals(ranked.results.length, 1);
  assertEquals(ranked.results[0].url, "https://testing.dev/guide");
  assertEquals(ranked.results[0].title, "Testing Guide");
  // Should have been annotated with evidence strength
  assert(ranked.results[0].evidenceStrength !== undefined);
  assert(ranked.results[0].evidenceReason !== undefined);
  assert(ranked.results[0].evidenceReason!.length > 0);
});

Deno.test("evidence ranking: results with missing passages rank lower than those with passages", () => {
  const ranked = rankFetchedEvidenceDeterministically({
    query: "deployment guide kubernetes",
    results: [
      {
        title: "Kubernetes deployment",
        url: "https://a.example.com/k8s",
        snippet: "Deploy with kubernetes",
        // No passages, no pageDescription
      },
      {
        title: "Kubernetes deployment",
        url: "https://b.example.com/k8s",
        snippet: "Deploy with kubernetes",
        passages: ["Use kubectl apply to deploy your kubernetes manifests to the cluster."],
        pageDescription: "Full guide to kubernetes deployment strategies.",
      },
    ],
  });

  // The result WITH passages should rank first
  assertEquals(ranked.results[0].url, "https://b.example.com/k8s");
  // It should have higher evidence strength
  const strengthOrder = { high: 3, medium: 2, low: 1 };
  assert(
    strengthOrder[ranked.results[0].evidenceStrength!] >=
      strengthOrder[ranked.results[1].evidenceStrength!],
    "Result with passages should have equal or higher evidence strength",
  );
});

// ===========================================================================
// LLM path — sanitization, dedup, backfill
// ===========================================================================

Deno.test("llm: sanitizes duplicate and out-of-range indices, backfills remainder", async () => {
  const results: SearchResult[] = [
    { title: "A", url: "https://a.example.com", snippet: "alpha" },
    { title: "B", url: "https://b.example.com", snippet: "beta" },
    { title: "C", url: "https://c.example.com", snippet: "gamma" },
    { title: "D", url: "https://d.example.com", snippet: "delta" },
  ];

  await withMockedChatStructured(
    () =>
      Promise.resolve({
        content: "",
        toolCalls: [{
          function: {
            name: "select_search_results",
            // picks [2, 0, 2, 99]: duplicate 2, out-of-range 99
            arguments: JSON.stringify({
              picks: [2, 0, 2, 99],
              confidence: "high",
              reason: "These cover the direct answer best.",
            }),
          },
        }],
      }),
    async () => {
      const selection = await selectSearchResultsWithLlm({
        query: "best results",
        results,
        maxPicks: 3,
        toolOptions: { modelId: "test-model" },
      });

      assertEquals(selection.strategy, "llm");
      // Dedup removes second 2, out-of-range 99 is dropped, backfill adds index 1
      assertEquals(selection.pickedIndices, [2, 0, 1]);
      assertEquals(selection.picks.map((r) => r.title), ["C", "A", "B"]);
      assertEquals(selection.confidence, "high");
      assertEquals(selection.reason, "These cover the direct answer best.");
    },
  );
});

Deno.test("llm: caps candidates at 10 and throws on missing structured output", async () => {
  const seenMessages: string[] = [];
  const results: SearchResult[] = Array.from({ length: 12 }, (_, index) => ({
    title: `Result ${index}`,
    url: `https://example.com/${index}`,
    snippet: `Snippet ${index}`,
  }));

  await withMockedChatStructured(
    (messages) => {
      seenMessages.push(
        messages.map((m) => String(m.content ?? "")).join("\n"),
      );
      return Promise.resolve({ content: "", toolCalls: [] });
    },
    async () => {
      await assertRejects(
        () =>
          selectSearchResultsWithLlm({
            query: "candidate cap",
            results,
            maxPicks: 2,
            toolOptions: { modelId: "test-model" },
          }),
        Error,
        "LLM selector returned no structured selection.",
      );
      assertEquals(seenMessages.length, 1);
      // Only first 10 candidates should be sent
      assertEquals(seenMessages[0].includes("[9] Result 9"), true);
      assertEquals(seenMessages[0].includes("[10] Result 10"), false);
    },
  );
});

Deno.test("llm: empty results returns low confidence without calling LLM", async () => {
  let called = false;
  await withMockedChatStructured(
    () => {
      called = true;
      return Promise.resolve({ content: "", toolCalls: [] });
    },
    async () => {
      const selection = await selectSearchResultsWithLlm({
        query: "anything",
        results: [],
        maxPicks: 3,
        toolOptions: { modelId: "test-model" },
      });

      assertEquals(called, false, "LLM should not be called for empty results");
      assertEquals(selection.strategy, "llm");
      assertEquals(selection.picks, []);
      assertEquals(selection.pickedIndices, []);
      assertEquals(selection.confidence, "low");
    },
  );
});

Deno.test("llm: maxPicks=0 returns no picks without calling LLM", async () => {
  let called = false;
  await withMockedChatStructured(
    () => {
      called = true;
      return Promise.resolve({ content: "", toolCalls: [] });
    },
    async () => {
      const selection = await selectSearchResultsWithLlm({
        query: "anything",
        results: [makeResult({ title: "Something" })],
        maxPicks: 0,
        toolOptions: { modelId: "test-model" },
      });

      assertEquals(called, false, "LLM should not be called for maxPicks=0");
      assertEquals(selection.picks, []);
      assertEquals(selection.pickedIndices, []);
    },
  );
});

Deno.test("llm: invalid confidence from LLM defaults to medium", async () => {
  const results: SearchResult[] = [
    makeResult({ title: "A", url: "https://a.example.com" }),
    makeResult({ title: "B", url: "https://b.example.com" }),
  ];

  await withMockedChatStructured(
    () =>
      Promise.resolve({
        content: "",
        toolCalls: [{
          function: {
            name: "select_search_results",
            arguments: JSON.stringify({
              picks: [0],
              confidence: "very_high",  // invalid enum value
              reason: "some reason",
            }),
          },
        }],
      }),
    async () => {
      const selection = await selectSearchResultsWithLlm({
        query: "test",
        results,
        maxPicks: 2,
        toolOptions: { modelId: "test-model" },
      });

      // Invalid confidence should default to "medium"
      assertEquals(selection.confidence, "medium");
      // Reason should still come through
      assertEquals(selection.reason, "some reason");
      // Pick 0 selected, backfill adds 1
      assertEquals(selection.pickedIndices, [0, 1]);
    },
  );
});

Deno.test("llm: missing reason from LLM gets default text", async () => {
  const results: SearchResult[] = [
    makeResult({ title: "A", url: "https://a.example.com" }),
  ];

  await withMockedChatStructured(
    () =>
      Promise.resolve({
        content: "",
        toolCalls: [{
          function: {
            name: "select_search_results",
            arguments: JSON.stringify({
              picks: [0],
              confidence: "low",
              reason: "   ",  // whitespace-only reason
            }),
          },
        }],
      }),
    async () => {
      const selection = await selectSearchResultsWithLlm({
        query: "test",
        results,
        maxPicks: 1,
        toolOptions: { modelId: "test-model" },
      });

      assertEquals(selection.confidence, "low");
      // Whitespace-only reason should be replaced with default
      assert(
        selection.reason.includes("LLM selected"),
        `Expected default reason text, got: "${selection.reason}"`,
      );
    },
  );
});

Deno.test("llm: empty picks array from LLM triggers full backfill from index 0", async () => {
  const results: SearchResult[] = [
    makeResult({ title: "X", url: "https://x.example.com" }),
    makeResult({ title: "Y", url: "https://y.example.com" }),
    makeResult({ title: "Z", url: "https://z.example.com" }),
  ];

  await withMockedChatStructured(
    () =>
      Promise.resolve({
        content: "",
        toolCalls: [{
          function: {
            name: "select_search_results",
            arguments: JSON.stringify({
              picks: [],  // LLM returned empty picks
              confidence: "low",
              reason: "Could not determine best results.",
            }),
          },
        }],
      }),
    async () => {
      const selection = await selectSearchResultsWithLlm({
        query: "test",
        results,
        maxPicks: 2,
        toolOptions: { modelId: "test-model" },
      });

      // Empty picks should backfill starting from index 0
      assertEquals(selection.pickedIndices, [0, 1]);
      assertEquals(selection.picks.map((r) => r.title), ["X", "Y"]);
    },
  );
});

Deno.test("llm: pre-parsed object arguments (not JSON string) are handled", async () => {
  const results: SearchResult[] = [
    makeResult({ title: "A", url: "https://a.example.com" }),
    makeResult({ title: "B", url: "https://b.example.com" }),
  ];

  await withMockedChatStructured(
    () =>
      Promise.resolve({
        content: "",
        toolCalls: [{
          function: {
            name: "select_search_results",
            // Already-parsed object instead of JSON string
            arguments: {
              picks: [1],
              confidence: "high",
              reason: "Second result is best.",
            } as unknown as string,
          },
        }],
      }),
    async () => {
      const selection = await selectSearchResultsWithLlm({
        query: "test",
        results,
        maxPicks: 2,
        toolOptions: { modelId: "test-model" },
      });

      // parseToolArguments handles both string and object forms
      assertEquals(selection.pickedIndices, [1, 0]);
      assertEquals(selection.picks[0].title, "B");
      assertEquals(selection.confidence, "high");
    },
  );
});

Deno.test("llm: non-integer picks from LLM are filtered out", async () => {
  const results: SearchResult[] = [
    makeResult({ title: "A", url: "https://a.example.com" }),
    makeResult({ title: "B", url: "https://b.example.com" }),
    makeResult({ title: "C", url: "https://c.example.com" }),
  ];

  await withMockedChatStructured(
    () =>
      Promise.resolve({
        content: "",
        toolCalls: [{
          function: {
            name: "select_search_results",
            arguments: JSON.stringify({
              picks: [1, "two", 0, null, 2.5, -1, 2],
              confidence: "medium",
              reason: "Mixed valid and invalid.",
            }),
          },
        }],
      }),
    async () => {
      const selection = await selectSearchResultsWithLlm({
        query: "test",
        results,
        maxPicks: 3,
        toolOptions: { modelId: "test-model" },
      });

      // Only integer values in range [0, 3) should survive: 1, 0, 2
      // "two" is not an integer, null is not, 2.5 is not integer, -1 is out of range
      assertEquals(selection.pickedIndices, [1, 0, 2]);
      assertEquals(selection.picks.map((r) => r.title), ["B", "A", "C"]);
    },
  );
});

Deno.test("llm: wrong tool name in response throws structured selection error", async () => {
  const results: SearchResult[] = [
    makeResult({ title: "A", url: "https://a.example.com" }),
  ];

  await withMockedChatStructured(
    () =>
      Promise.resolve({
        content: "",
        toolCalls: [{
          function: {
            name: "wrong_tool_name",
            arguments: JSON.stringify({
              picks: [0],
              confidence: "high",
              reason: "irrelevant",
            }),
          },
        }],
      }),
    async () => {
      await assertRejects(
        () =>
          selectSearchResultsWithLlm({
            query: "test",
            results,
            maxPicks: 1,
            toolOptions: { modelId: "test-model" },
          }),
        Error,
        "LLM selector returned no structured selection.",
      );
    },
  );
});
