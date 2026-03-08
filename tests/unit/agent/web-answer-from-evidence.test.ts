import { assert, assertEquals } from "jsr:@std/assert";
import { buildDeterministicAnswer } from "../../../src/hlvm/agent/tools/web/answer-from-evidence.ts";
import type { SearchResult } from "../../../src/hlvm/agent/tools/web/search-provider.ts";

Deno.test("web answer from evidence: builds direct answer from fetched passages", () => {
  const results: SearchResult[] = [
    {
      title: "useEffect - React",
      url: "https://react.dev/reference/react/useEffect",
      passages: [
        "The cleanup function runs before the effect re-runs and after the component unmounts.",
      ],
      selectedForFetch: true,
      evidenceStrength: "high",
    },
    {
      title: "Synchronizing with Effects - React",
      url: "https://react.dev/learn/synchronizing-with-effects",
      passages: [
        "React will call your cleanup function each time before the Effect runs again, and one final time when the component unmounts.",
      ],
      selectedForFetch: true,
      evidenceStrength: "high",
    },
  ];

  const answer = buildDeterministicAnswer({
    query: "What does the useEffect cleanup function do in React?",
    results,
    modelTier: "weak",
  });

  assert(answer);
  assertEquals(answer.mode, "direct");
  assertEquals(answer.strategy, "deterministic");
  assertEquals(answer.confidence, "high");
  assert(answer.text.includes("cleanup function"));
  assertEquals(answer.sources.length, 2);
});

Deno.test("web answer from evidence: builds comparison answer for multi-source query", () => {
  const results: SearchResult[] = [
    {
      title: "Tool A Docs",
      url: "https://a.example.com/docs",
      passages: ["Tool A emphasizes simple setup and a smaller feature surface."],
      selectedForFetch: true,
      evidenceStrength: "high",
    },
    {
      title: "Tool B Docs",
      url: "https://b.example.com/docs",
      passages: ["Tool B emphasizes more advanced workflow control and customization."],
      selectedForFetch: true,
      evidenceStrength: "medium",
    },
  ];

  const answer = buildDeterministicAnswer({
    query: "compare Tool A vs Tool B tradeoffs",
    results,
    intent: {
      wantsOfficialDocs: false,
      wantsComparison: true,
      wantsRecency: false,
      wantsVersionSpecific: false,
      wantsReleaseNotes: false,
      wantsReference: false,
      wantsQueryDecomposition: true,
      wantsFetchFirst: true,
      wantsMultiSourceSynthesis: true,
      wantsAuthoritativeBias: false,
    },
    modelTier: "mid",
  });

  assert(answer);
  assertEquals(answer.mode, "comparison");
  assertEquals(answer.strategy, "llm_polish");
  assert(answer.text.includes("Comparison from fetched evidence"));
  assert(answer.text.includes("Tool A Docs"));
  assert(answer.text.includes("Tool B Docs"));
});

Deno.test("web answer from evidence: builds recency answer with dated rows", () => {
  const results: SearchResult[] = [
    {
      title: "Release 2.0",
      url: "https://example.com/releases/2.0",
      passages: ["Version 2.0 added deterministic answer fallback."],
      selectedForFetch: true,
      evidenceStrength: "high",
      publishedDate: "2026-03-01",
    },
    {
      title: "Release 1.9",
      url: "https://example.com/releases/1.9",
      passages: ["Version 1.9 improved retrieval recall."],
      selectedForFetch: true,
      evidenceStrength: "medium",
      publishedDate: "2026-02-15",
    },
  ];

  const answer = buildDeterministicAnswer({
    query: "latest release notes changes",
    results,
    intent: {
      wantsOfficialDocs: false,
      wantsComparison: false,
      wantsRecency: true,
      wantsVersionSpecific: false,
      wantsReleaseNotes: true,
      wantsReference: false,
      wantsQueryDecomposition: true,
      wantsFetchFirst: true,
      wantsMultiSourceSynthesis: true,
      wantsAuthoritativeBias: true,
    },
    modelTier: "weak",
  });

  assert(answer);
  assertEquals(answer.mode, "recency");
  assert(answer.text.includes("Latest fetched evidence"));
  assert(answer.text.includes("2026-03-01"));
});

Deno.test("web answer from evidence: returns low-confidence insufficient-evidence draft", () => {
  const results: SearchResult[] = [
    {
      title: "Weak result",
      url: "https://example.com/weak",
      snippet: "short generic snippet",
      selectedForFetch: true,
      evidenceStrength: "low",
    },
  ];

  const answer = buildDeterministicAnswer({
    query: "obscure unsupported topic",
    results,
    lowConfidence: true,
    modelTier: "weak",
  });

  assert(answer);
  assertEquals(answer.mode, "insufficient_evidence");
  assertEquals(answer.confidence, "low");
  assert(answer.text.includes("Available evidence is limited"));
});
