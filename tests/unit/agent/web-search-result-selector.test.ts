import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { ai } from "../../../src/hlvm/api/ai.ts";
import {
  rankFetchedEvidenceDeterministically,
  selectSearchResultsDeterministically,
  selectSearchResultsWithLlm,
} from "../../../src/hlvm/agent/tools/web/search-result-selector.ts";
import type { SearchResult } from "../../../src/hlvm/agent/tools/web/search-provider.ts";

Deno.test("search result selector: deterministic path prioritizes official docs and diversity", () => {
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
      wantsOfficialDocs: true,
      wantsComparison: false,
      wantsRecency: false,
      wantsVersionSpecific: false,
      wantsReleaseNotes: false,
      wantsReference: true,
      wantsQueryDecomposition: false,
      wantsFetchFirst: true,
      wantsMultiSourceSynthesis: false,
      wantsAuthoritativeBias: true,
    },
  });

  assertEquals(selection.strategy, "deterministic");
  assertEquals(selection.pickedIndices[0], 1);
  assertEquals(selection.picks[0].url, "https://react.dev/reference/react/useEffect");
  assert(selection.picks.some((result) =>
    result.url === "https://react.dev/learn/synchronizing-with-effects"
  ));
  assert(selection.picks.some((result) =>
    result.url === "https://blog.example.com/react-cleanup"
  ));
});

Deno.test("search result selector: llm path sanitizes indices and backfills from raw order", async () => {
  const originalChatStructured = ai.chatStructured;
  const results: SearchResult[] = [
    { title: "A", url: "https://a.example.com", snippet: "alpha" },
    { title: "B", url: "https://b.example.com", snippet: "beta" },
    { title: "C", url: "https://c.example.com", snippet: "gamma" },
    { title: "D", url: "https://d.example.com", snippet: "delta" },
  ];

  (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = () =>
    Promise.resolve({
      content: "",
      toolCalls: [{
        function: {
          name: "select_search_results",
          arguments: JSON.stringify({
            picks: [2, 0, 2, 99],
            confidence: "high",
            reason: "These cover the direct answer best.",
          }),
        },
      }],
    });

  try {
    const selection = await selectSearchResultsWithLlm({
      query: "best results",
      results,
      maxPicks: 3,
      toolOptions: { modelId: "test-model" },
    });

    assertEquals(selection.strategy, "llm");
    assertEquals(selection.pickedIndices, [2, 0, 1]);
    assertEquals(selection.picks.map((result) => result.title), ["C", "A", "B"]);
    assertEquals(selection.confidence, "high");
  } finally {
    (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = originalChatStructured;
  }
});

Deno.test("search result selector: llm path caps candidates at ten and requires structured output", async () => {
  const originalChatStructured = ai.chatStructured;
  const seenMessages: string[] = [];
  const results: SearchResult[] = Array.from({ length: 12 }, (_, index) => ({
    title: `Result ${index}`,
    url: `https://example.com/${index}`,
    snippet: `Snippet ${index}`,
  }));

  (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = (messages) => {
    seenMessages.push(
      messages.map((message) => String(message.content ?? "")).join("\n"),
    );
    return Promise.resolve({ content: "", toolCalls: [] });
  };

  try {
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
    assertEquals(seenMessages[0].includes("[9] Result 9"), true);
    assertEquals(seenMessages[0].includes("[10] Result 10"), false);
  } finally {
    (ai as { chatStructured: typeof ai.chatStructured }).chatStructured = originalChatStructured;
  }
});

Deno.test("search result selector: deterministic fetched evidence ranking prefers extracted passages", () => {
  const ranked = rankFetchedEvidenceDeterministically({
    query: "react useeffect cleanup official docs",
    allowedDomains: ["react.dev"],
    intent: {
      wantsOfficialDocs: true,
      wantsComparison: false,
      wantsRecency: false,
      wantsVersionSpecific: false,
      wantsReleaseNotes: false,
      wantsReference: true,
      wantsQueryDecomposition: false,
      wantsFetchFirst: true,
      wantsMultiSourceSynthesis: false,
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

  assertEquals(ranked.results[0].url, "https://react.dev/reference/react/useEffect");
  assertEquals(ranked.results[0].evidenceStrength, "high");
  assertEquals(ranked.results[1].evidenceStrength, "medium");
  assertEquals(ranked.results[2].evidenceStrength, "low");
  assert(
    ranked.results[0].evidenceReason?.includes("matched the query") === true,
  );
});

Deno.test("search result selector: release-note intent demotes community wrappers below first-party sources", () => {
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
      wantsOfficialDocs: false,
      wantsComparison: false,
      wantsRecency: true,
      wantsVersionSpecific: false,
      wantsReleaseNotes: true,
      wantsReference: false,
      wantsQueryDecomposition: false,
      wantsFetchFirst: true,
      wantsMultiSourceSynthesis: true,
      wantsAuthoritativeBias: true,
    },
  });

  assertEquals(selection.picks[0].url === "https://mediusware.com/blog/whats-new-in-nextjs-14", false);
  assertEquals(
    [
      "https://nextjs.org/blog",
      "https://next-changelog.vercel.app/",
      "https://nextjs.org/docs/app/getting-started/upgrading",
    ].includes(String(selection.picks[0].url)),
    true,
  );
});

Deno.test("search result selector: compound product terms prefer Next.js over unrelated .js release pages", () => {
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
      wantsOfficialDocs: false,
      wantsComparison: false,
      wantsRecency: true,
      wantsVersionSpecific: false,
      wantsReleaseNotes: true,
      wantsReference: false,
      wantsQueryDecomposition: false,
      wantsFetchFirst: true,
      wantsMultiSourceSynthesis: true,
      wantsAuthoritativeBias: true,
    },
  });

  assertEquals(selection.picks[0].url === "https://versionlog.com/nodejs/25/", false);
  assertEquals(
    [
      "https://next-changelog.vercel.app/",
      "https://nextjs.org/blog",
    ].includes(String(selection.picks[0].url)),
    true,
  );
});

Deno.test("search result selector: live-like Next.js release query rejects unrelated entity release pages", () => {
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
      wantsOfficialDocs: false,
      wantsComparison: false,
      wantsRecency: true,
      wantsVersionSpecific: false,
      wantsReleaseNotes: true,
      wantsReference: false,
      wantsQueryDecomposition: false,
      wantsFetchFirst: true,
      wantsMultiSourceSynthesis: true,
      wantsAuthoritativeBias: true,
    },
  });

  assertEquals(selection.picks[0].url, "https://nextjs.org/blog");
  assertEquals(
    selection.picks.slice(0, 3).some((result) =>
      result.url === "https://versionlog.com/nodejs/25/"
    ),
    false,
  );
  assertEquals(
    selection.picks.slice(0, 3).some((result) =>
      result.url === "https://nx.dev/changelog"
    ),
    false,
  );
});

Deno.test("search result selector: stable-release query prefers release sources over generic upgrade docs", () => {
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
      wantsOfficialDocs: false,
      wantsComparison: false,
      wantsRecency: true,
      wantsVersionSpecific: true,
      wantsReleaseNotes: true,
      wantsReference: false,
      wantsQueryDecomposition: false,
      wantsFetchFirst: true,
      wantsMultiSourceSynthesis: true,
      wantsAuthoritativeBias: true,
    },
  });

  assertEquals(selection.picks[0].url, "https://nextjs.org/blog");
  assertEquals(
    selection.picks.slice(0, 2).some((result) =>
      result.url === "https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/"
    ),
    false,
  );
  assertEquals(
    selection.picks.slice(0, 2).some((result) =>
      result.url === "https://www.postgresql.org/docs/release/"
    ),
    false,
  );
});
