import { assert, assertEquals } from "jsr:@std/assert";
import { buildDeterministicAnswer } from "../../../src/hlvm/agent/tools/web/answer-from-evidence.ts";
import type { SearchResult } from "../../../src/hlvm/agent/tools/web/search-provider.ts";

Deno.test("web answer from evidence: builds direct answer from fetched passages", () => {
  const results: SearchResult[] = [
    {
      title: "Garbage Collection - MDN Web Docs",
      url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Memory_Management",
      passages: [
        "Garbage collection is a form of automatic memory management that reclaims memory occupied by objects that are no longer reachable by the program.",
      ],
      selectedForFetch: true,
      evidenceStrength: "high",
    },
    {
      title: "Memory Management in Programming Languages",
      url: "https://docs.example.com/memory-management",
      passages: [
        "The garbage collector periodically scans the heap to find objects that are no longer referenced, and frees the memory they occupy so it can be reused by future allocations.",
      ],
      selectedForFetch: true,
      evidenceStrength: "high",
    },
  ];

  const answer = buildDeterministicAnswer({
    query: "What does garbage collection do in programming?",
    results,
    modelTier: "weak",
  });

  assert(answer);
  assertEquals(answer.mode, "direct");
  assertEquals(answer.strategy, "deterministic");
  assertEquals(answer.confidence, "high");
  assert(answer.text.includes("memory") || answer.text.includes("garbage collect"));
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

Deno.test("web answer from evidence: direct answers prefer explanatory passages over headline-like intros", () => {
  const results: SearchResult[] = [
    {
      title: "Mastering CSS Grid Layout",
      url: "https://example.com/article",
      passages: [
        "Mastering CSS Grid Layout: 10 Essential Tips CSS Grid is a powerful tool for building modern responsive web layouts.",
        "CSS Grid is a two-dimensional layout system that allows you to organize content into rows and columns, providing control over sizing, positioning, and spacing of child elements.",
      ],
      selectedForFetch: true,
      evidenceStrength: "high",
    },
  ];

  const answer = buildDeterministicAnswer({
    query: "What is CSS grid layout?",
    results,
    modelTier: "weak",
  });

  assert(answer);
  assertEquals(answer.mode, "direct");
  assertEquals(
    answer.text,
    "CSS Grid is a two-dimensional layout system that allows you to organize content into rows and columns, providing control over sizing, positioning, and spacing of child elements.",
  );
});

Deno.test("web answer from evidence: authoritative docs beat community articles when both are fetched", () => {
  const results: SearchResult[] = [
    {
      title: "Mastering Python Asyncio",
      url: "https://dev.to/example/python-asyncio",
      passages: [
        "Mastering Python Asyncio: A Complete Guide Python's asyncio is an incredible tool for handling I/O-bound operations.",
      ],
      selectedForFetch: true,
      evidenceStrength: "high",
    },
    {
      title: "asyncio - Asynchronous I/O",
      url: "https://docs.python.org/3/library/asyncio.html",
      passages: [
        "asyncio is a library to write concurrent code using the async/await syntax, and is used as a foundation for high-performance network and web servers.",
      ],
      selectedForFetch: true,
      evidenceStrength: "high",
    },
  ];

  const answer = buildDeterministicAnswer({
    query: "official Python docs: what is asyncio?",
    results,
    allowedDomains: ["docs.python.org"],
    modelTier: "weak",
  });

  assert(answer);
  assertEquals(
    answer.text,
    "asyncio is a library to write concurrent code using the async/await syntax, and is used as a foundation for high-performance network and web servers.",
  );
  assertEquals(answer.sources[0]?.url, "https://docs.python.org/3/library/asyncio.html");
  assertEquals(answer.sources[0]?.sourceClass, "official_docs");
});

Deno.test("web answer from evidence: direct answers avoid historical or boilerplate sections when a cleaner definition exists", () => {
  const results: SearchResult[] = [
    {
      title: "TaskGroup reference",
      url: "https://docs.python.org/3/library/asyncio-task.html",
      passages: [
        "Before TaskGroup, Python developers often used gather to run several awaitables concurrently and collect their results.",
        "TaskGroup is an asynchronous context manager for managing groups of related tasks and waiting for them to finish together.",
        "Your original request: https://docs.python.org/3/library/asyncio-task.html",
      ],
      selectedForFetch: true,
      evidenceStrength: "high",
    },
  ];

  const answer = buildDeterministicAnswer({
    query: "What does TaskGroup do in Python asyncio?",
    results,
    allowedDomains: ["docs.python.org"],
    modelTier: "weak",
  });

  assert(answer);
  assertEquals(
    answer.text,
    "TaskGroup is an asynchronous context manager for managing groups of related tasks and waiting for them to finish together.",
  );
});
