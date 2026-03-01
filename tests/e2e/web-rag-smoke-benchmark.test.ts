/**
 * Web-RAG smoke benchmark (stable, deterministic, no network).
 * Purpose: catch major regressions in ranking/extraction/formatting behavior.
 */

import { assert, assertEquals } from "jsr:@std/assert";
import {
  generateQueryVariants,
} from "../../src/hlvm/agent/tools/web/duckduckgo.ts";
import { extractPublicationDate } from "../../src/hlvm/agent/tools/web/html-parser.ts";
import {
  domainAuthorityBoost,
  rankSearchResults,
} from "../../src/hlvm/agent/tools/web/search-ranking.ts";
import {
  __testOnlyFormatSearchWebResult,
  __testOnlySelectDiversePrefetchTargets,
} from "../../src/hlvm/agent/tools/web-tools.ts";

Deno.test("web-rag smoke benchmark (10 checks)", () => {
  // 1) Authority boost: docs url should outrank equivalent SEO blog.
  const authRanked = rankSearchResults("python tutorial", [
    { title: "Python Tutorial", url: "https://seo-blog.example.com/python", snippet: "python tutorial" },
    { title: "Python Tutorial", url: "https://docs.python.org/3/tutorial/index.html", snippet: "python tutorial" },
  ]);
  assertEquals(authRanked[0].url, "https://docs.python.org/3/tutorial/index.html");

  // 2) .gov/.edu boosts are non-zero.
  assert(domainAuthorityBoost("https://nist.gov/ai") > 0);
  assert(domainAuthorityBoost("https://cs.stanford.edu/class") > 0);

  // 3) Diversity penalty keeps multiple hosts represented near the top.
  const diversified = rankSearchResults("hlvm docs", [
    { title: "Docs A1", url: "https://docs.example.com/a1", snippet: "hlvm docs" },
    { title: "Docs A2", url: "https://docs.example.com/a2", snippet: "hlvm docs" },
    { title: "Docs B1", url: "https://community.example.org/post", snippet: "hlvm docs" },
  ]);
  assert(new Set(diversified.slice(0, 3).map((r) => new URL(r.url!).hostname)).size >= 2);

  // 4) Time-range filtering keeps only fresh results.
  const freshOnly = rankSearchResults("hlvm release", [
    { title: "Old", url: "https://a.com/old", snippet: "Published 2018-01-01" },
    { title: "New", url: "https://a.com/new", snippet: "published 1 day ago" },
  ], "week");
  assertEquals(freshOnly.length, 1);
  assertEquals(freshOnly[0].title, "New");

  // 5) Publication date extraction from meta.
  assertEquals(
    extractPublicationDate(`<meta property="article:published_time" content="2025-01-01T00:00:00Z">`),
    "2025-01-01T00:00:00Z",
  );

  // 6) Publication date extraction from JSON-LD.
  assertEquals(
    extractPublicationDate(
      `<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2025-03-17"}</script>`,
    ),
    "2025-03-17",
  );

  // 7) Query variants include reorder.
  const variants = generateQueryVariants("deno 2.2 release", 2);
  assert(variants.length > 0);
  assert(variants.some((v) => v.startsWith("release")));

  // 8) Query variants preserve version tokens (guardrail).
  const guardedVariants = generateQueryVariants("deno 2.2 release notes", 2);
  assert(guardedVariants.some((v) => v.includes("2.2")));

  // 9) Low-quality hint goes to llmContent only.
  const lowQuality = __testOnlyFormatSearchWebResult({
    query: "obscure",
    provider: "duckduckgo",
    count: 2,
    results: [
      { title: "A", url: "https://a.com", snippet: "x", score: 2 },
      { title: "B", url: "https://b.com", snippet: "y", score: 3 },
    ],
  });
  assert(lowQuality);
  assert(!lowQuality.returnDisplay.includes("Tip:"));
  assert(lowQuality.llmContent.includes("Tip:"));

  // 10) Diverse prefetch selector prefers unique hosts then backfills.
  const prefetch = __testOnlySelectDiversePrefetchTargets([
    { title: "A", url: "https://same.com/a" },
    { title: "B", url: "https://same.com/b" },
    { title: "C", url: "https://other.com/c" },
  ], 2);
  assertEquals(prefetch.length, 2);
  assertEquals(prefetch[0].url, "https://same.com/a");
  assertEquals(prefetch[1].url, "https://other.com/c");
});
