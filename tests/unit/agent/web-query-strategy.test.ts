import { assert, assertEquals } from "jsr:@std/assert";
import {
  buildFollowupQueries,
  detectSearchQueryIntent,
} from "../../../src/hlvm/agent/tools/web/query-strategy.ts";

Deno.test("web query strategy detects docs, comparison, and recency intent", () => {
  const intent = detectSearchQueryIntent(
    "Compare Python asyncio TaskGroup official docs changes in 2025",
  );
  assertEquals(intent.wantsOfficialDocs, true);
  assertEquals(intent.wantsComparison, true);
  assertEquals(intent.wantsRecency, true);
  assertEquals(intent.wantsVersionSpecific, false);
  assertEquals(intent.wantsQueryDecomposition, true);
  assertEquals(intent.wantsFetchFirst, true);
});

Deno.test("web query strategy distinguishes version-specific queries from recency queries", () => {
  const intent = detectSearchQueryIntent("Python 3.11 TaskGroup");
  assertEquals(intent.wantsRecency, false);
  assertEquals(intent.wantsVersionSpecific, true);
});

Deno.test("web query strategy preserves structured queries while building bounded followups", () => {
  const query = "\"Python asyncio TaskGroup\" 2025";
  const followups = buildFollowupQueries({
    userQuery: query,
    confidenceReason: "low_coverage",
    currentResults: [],
    maxQueries: 2,
  });

  assertEquals(followups.length <= 2, true);
  assert(followups.every((candidate) => candidate.includes("\"Python asyncio TaskGroup\"")));
  assert(followups.every((candidate) => candidate.includes("2025")));
});

Deno.test("web query strategy adds independent-source bias for low-diversity results", () => {
  const followups = buildFollowupQueries({
    userQuery: "python asyncio taskgroup tutorial",
    confidenceReason: "low_diversity",
    currentResults: [
      { title: "A", url: "https://blog.example.com/a", snippet: "taskgroup tutorial" },
      { title: "B", url: "https://blog.example.com/b", snippet: "taskgroup guide" },
    ],
    maxQueries: 2,
  });

  assert(followups.some((query) => /independent sources|comparison tradeoffs/i.test(query)));
  assertEquals(new Set(followups.map((query) => query.toLowerCase())).size, followups.length);
});

Deno.test("web query strategy keeps generic weak queries neutral by default", () => {
  const followups = buildFollowupQueries({
    userQuery: "best React rendering tips",
    confidenceReason: "low_coverage",
    currentResults: [],
    maxQueries: 2,
  });

  assert(followups.length > 0);
  assertEquals(followups.some((query) => /official docs|official reference/i.test(query)), false);
  assert(followups.some((query) => /overview guide/i.test(query)));
});

Deno.test("web query strategy decomposes simple comparison queries into per-entity followups", () => {
  const followups = buildFollowupQueries({
    userQuery: "bun vs deno sqlite windows path issue",
    confidenceReason: "low_coverage",
    currentResults: [],
    maxQueries: 2,
  });

  assertEquals(followups, [
    "bun sqlite windows path issue",
    "deno sqlite windows path issue",
  ]);
});
