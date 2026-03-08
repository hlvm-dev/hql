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
