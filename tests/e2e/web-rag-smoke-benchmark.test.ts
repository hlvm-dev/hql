/**
 * Web-RAG smoke benchmark (stable, deterministic, no network).
 * Purpose: catch major regressions in extraction/formatting/query-expansion behavior.
 */

import { assert, assertEquals } from "jsr:@std/assert";
import {
  generateQueryVariants,
} from "../../src/hlvm/agent/tools/web/duckduckgo.ts";
import { extractPublicationDate } from "../../src/hlvm/agent/tools/web/html-parser.ts";
import {
  assessSearchConfidence,
  dedupeSearchResultsStable,
} from "../../src/hlvm/agent/tools/web/search-ranking.ts";

Deno.test("web-rag smoke benchmark (6 checks)", () => {
  // 1) Stable dedupe preserves order while upgrading richer duplicate metadata.
  const merged = dedupeSearchResultsStable([
    { title: "Home", url: "https://docs.example.com/hlvm?id=1&utm_source=feed", snippet: "short" },
    {
      title: "HLVM Docs Canonical",
      url: "https://docs.example.com/hlvm?id=1",
      snippet: "Much richer canonical duplicate",
      publishedDate: "2026-03-01",
    },
    { title: "Other", url: "https://community.example.org/hlvm", snippet: "community guide" },
  ]);
  assertEquals(merged.length, 2);
  assertEquals(merged[0].title, "HLVM Docs Canonical");
  assertEquals(merged[0].publishedDate, "2026-03-01");

  // 2) Publication date extraction from meta.
  assertEquals(
    extractPublicationDate(`<meta property="article:published_time" content="2025-01-01T00:00:00Z">`),
    "2025-01-01T00:00:00Z",
  );

  // 3) Publication date extraction from JSON-LD.
  assertEquals(
    extractPublicationDate(
      `<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2025-03-17"}</script>`,
    ),
    "2025-03-17",
  );

  // 4) Query variants include reorder.
  const variants = generateQueryVariants("deno 2.2 release", 2);
  assert(variants.length > 0);
  assert(variants.some((v) => v.startsWith("release")));

  // 5) Query variants preserve version tokens (guardrail).
  const guardedVariants = generateQueryVariants("deno 2.2 release notes", 2);
  assert(guardedVariants.some((v) => v.includes("2.2")));

  // 6) Confidence fallback works without provider scores.
  const rawConfidence = assessSearchConfidence("react useeffect cleanup", [
    { title: "Home", url: "https://example.com", snippet: "welcome" },
    { title: "React cleanup guide", url: "https://example.com/react-cleanup", snippet: "cleanup patterns" },
  ]);
  assert(rawConfidence.reasons.includes("low_score"));
});
