/**
 * Web-RAG Phase 3 E2E Verification
 * Exercises each upgrade with controlled data via proper Deno.test() blocks.
 */

import { assert, assertEquals } from "jsr:@std/assert";
import { rankSearchResults } from "../../src/hlvm/agent/tools/web/search-ranking.ts";
import {
  __testOnlyFormatSearchWebResult,
  __testOnlySelectDiversePrefetchTargets,
} from "../../src/hlvm/agent/tools/web-tools.ts";
import type { SearchResult } from "../../src/hlvm/agent/tools/web/search-provider.ts";

Deno.test("authority boost ranks docs.python.org, stanford.edu, mozilla.org above SEO blogs", () => {
  const authResults: SearchResult[] = [
    { title: "Python Tutorial", url: "https://seo-spam-blog.com/python-tutorial", snippet: "python asyncio tutorial guide" },
    { title: "Python Tutorial", url: "https://docs.python.org/3/library/asyncio.html", snippet: "python asyncio tutorial guide" },
    { title: "Python Tutorial", url: "https://developer.mozilla.org/en-US/docs/Learn/Python", snippet: "python asyncio tutorial guide" },
    { title: "Python Tutorial", url: "https://cs.stanford.edu/courses/python", snippet: "python asyncio tutorial guide" },
    { title: "Python Tutorial", url: "https://medium.com/python-tips/asyncio", snippet: "python asyncio tutorial guide" },
  ];

  const ranked = rankSearchResults("python asyncio tutorial", authResults, "all");
  const top3Urls = ranked.slice(0, 3).map(r => r.url!);

  assert(top3Urls.some(u => u.includes("docs.python.org")), "docs.python.org should be in top 3");
  assert(top3Urls.some(u => u.includes("stanford.edu")), "stanford.edu should be in top 3");
  assert(top3Urls.some(u => u.includes("developer.mozilla.org")), "developer.mozilla.org should be in top 3");
});

Deno.test("quality hint appears in llmContent only when avg score < 4, not in returnDisplay", () => {
  const lowScoreData = {
    query: "xyzzy obscure topic",
    provider: "duckduckgo",
    count: 3,
    results: [
      { title: "Unrelated A", url: "https://a.com", snippet: "nothing useful", score: 1.5 },
      { title: "Unrelated B", url: "https://b.com", snippet: "also nothing", score: 2.0 },
      { title: "Unrelated C", url: "https://c.com", snippet: "nope", score: 3.0 },
    ],
  };
  const lowFormatted = __testOnlyFormatSearchWebResult(lowScoreData)!;
  assert(!lowFormatted.returnDisplay.includes("Tip:"), "returnDisplay should NOT contain tip");
  assert(lowFormatted.llmContent.includes("Tip:"), "llmContent should contain tip when avg < 4");

  // High scores — no tip anywhere
  const highScoreData = {
    query: "well matched query",
    provider: "duckduckgo",
    count: 2,
    results: [
      { title: "Good A", url: "https://a.com", snippet: "relevant", score: 8 },
      { title: "Good B", url: "https://b.com", snippet: "relevant", score: 6 },
    ],
  };
  const highFormatted = __testOnlyFormatSearchWebResult(highScoreData)!;
  assert(!highFormatted.llmContent.includes("Tip:"), "no tip when avg score >= 4");

  // Mixed: undefined scores excluded from avg
  const mixedData = {
    query: "mixed",
    provider: "duckduckgo",
    count: 3,
    results: [
      { title: "Scored", url: "https://a.com", snippet: "text", score: 8 },
      { title: "Unscored1", url: "https://b.com", snippet: "text" },
      { title: "Unscored2", url: "https://c.com", snippet: "text" },
    ],
  };
  const mixedFormatted = __testOnlyFormatSearchWebResult(mixedData)!;
  assert(!mixedFormatted.llmContent.includes("Tip:"), "avg from defined scores only (8.0 >= 4, no tip)");
});

Deno.test("diverse prefetch selects unique hosts first, backfills to 2", () => {
  // Case A: SO dominates — should pick diverse hosts
  const caseA = __testOnlySelectDiversePrefetchTargets([
    { title: "SO1", url: "https://stackoverflow.com/q/1" },
    { title: "SO2", url: "https://stackoverflow.com/q/2" },
    { title: "SO3", url: "https://stackoverflow.com/q/3" },
    { title: "Docs", url: "https://docs.python.org/asyncio" },
    { title: "RP", url: "https://realpython.com/asyncio" },
  ], 2).map((r) => r.url);
  assertEquals(caseA.length, 2);
  assert(caseA[0]?.includes("stackoverflow.com"), "first pick from top-ranked host");
  assert(caseA[1]?.includes("docs.python.org"), "second pick from different host");

  // Case B: all same host — backfill
  const caseB = __testOnlySelectDiversePrefetchTargets([
    { title: "A", url: "https://same.com/a" },
    { title: "B", url: "https://same.com/b" },
    { title: "C", url: "https://same.com/c" },
  ], 2).map((r) => r.url);
  assertEquals(caseB.length, 2);
  assert(caseB[0]?.includes("/a"), "first from pass 1");
  assert(caseB[1]?.includes("/b"), "second from backfill");

  // Case C: only 1 result — no crash
  const caseC = __testOnlySelectDiversePrefetchTargets([
    { title: "Only", url: "https://only.com/page" },
  ], 2).map((r) => r.url);
  assertEquals(caseC.length, 1);

  // Case D: low-confidence mode can expand to 3 targets.
  const caseD = __testOnlySelectDiversePrefetchTargets([
    { title: "A1", url: "https://a.com/1" },
    { title: "A2", url: "https://a.com/2" },
    { title: "B3", url: "https://b.com/3" },
    { title: "C4", url: "https://c.com/4" },
  ], 3).map((r) => r.url);
  assertEquals(caseD.length, 3);
});
