import { assert, assertEquals } from "jsr:@std/assert";
import {
  assessSearchConfidence,
  canonicalizeResultUrl,
  dedupeSearchResults,
  dedupeSearchResultsStable,
  deduplicateSnippetPassages,
  estimateResultAgeDays,
  extractRelevantPassages,
  filterSearchResultsForTimeRange,
  scorePassage,
} from "../../../src/hlvm/agent/tools/web/search-ranking.ts";
import { generateQueryVariants } from "../../../src/hlvm/agent/tools/web/duckduckgo.ts";
import { extractPublicationDate } from "../../../src/hlvm/agent/tools/web/html-parser.ts";

Deno.test("web ranking: canonicalizeResultUrl and dedupeSearchResults collapse tracking variants by quality", () => {
  const canonical = canonicalizeResultUrl(
    "https://Example.com/path/?utm_source=newsletter&id=42#section",
  );
  const deduped = dedupeSearchResults([
    {
      title: "Result A",
      url: "https://example.com/post?id=1&utm_source=x",
      snippet: "short",
    },
    {
      title: "Result A (full)",
      url: "https://example.com/post?id=1&utm_source=y",
      snippet: "much longer snippet retained by quality score",
    },
    {
      title: "Result B",
      url: "https://example.com/post?id=2",
      snippet: "different url",
    },
  ]);

  assertEquals(canonical, "https://example.com/path?id=42");
  assertEquals(deduped.length, 2);
  assertEquals(deduped[0].title, "Result A (full)");
});

Deno.test("web ranking: stable dedupe preserves order while upgrading richer duplicate metadata", () => {
  const merged = dedupeSearchResultsStable([
    {
      title: "Home",
      url: "https://example.com/post?id=1&utm_source=feed",
      snippet: "short",
    },
    {
      title: "Much Better Title",
      url: "https://example.com/post?id=1",
      snippet: "A much longer snippet that should replace the earlier thin duplicate.",
      publishedDate: "2026-03-01",
    },
    {
      title: "Other",
      url: "https://example.com/other",
      snippet: "other",
    },
  ]);

  assertEquals(merged.length, 2);
  assertEquals(merged[0].url, "https://example.com/post?id=1&utm_source=feed");
  assertEquals(merged[0].title, "Much Better Title");
  assertEquals(
    merged[0].snippet,
    "A much longer snippet that should replace the earlier thin duplicate.",
  );
  assertEquals(merged[0].publishedDate, "2026-03-01");
});

Deno.test("web ranking: scorePassage and extractRelevantPassages reward coverage, proximity, and truncation", () => {
  const close =
    "the deno release includes typescript support and deno improvements for developers";
  const far =
    "deno is a runtime. many paragraphs later we finally mention the release details";
  const text = [
    "This paragraph is about cooking recipes and has nothing relevant.",
    "Deno 2.2 introduces workspaces and improved npm compatibility for developers using Deno and TypeScript together.",
    "Deno release notes mention TypeScript support, startup improvements, and new tooling for Deno users.",
    "Deno ".repeat(200),
  ].join("\n\n");

  assert(
    scorePassage(close, ["deno", "release", "typescript"]) >
      scorePassage(far, ["deno", "release", "typescript"]),
  );

  const passages = extractRelevantPassages("deno 2.2 release", text);
  assertEquals(passages.length, 3);
  assert(passages[0].includes("Deno"));
  assert(
    passages.some((passage) => passage.length <= 512 && passage.endsWith("…")),
  );
  assertEquals(
    extractRelevantPassages("quantum physics", "Cooking pasta only").length,
    0,
  );
});

Deno.test("web ranking: heading-aware chunking keeps headings attached to body content and preserves atomic code blocks", () => {
  const text = [
    "Installation",
    "",
    "npm install @hlvm/search-web --save-dev",
    "",
    "Usage",
    "",
    "```ts",
    "const runtime = searchWeb({ query: \"react cleanup\" });",
    "const formatted = formatResult(runtime);",
    "```",
    "",
    "The usage section shows how to keep fetched passages attached to their section heading.",
  ].join("\n");

  const installationPassages = extractRelevantPassages(
    "installation npm install",
    text,
  );
  assertEquals(
    installationPassages[0],
    "Installation\n\nnpm install @hlvm/search-web --save-dev",
  );

  const usagePassages = extractRelevantPassages(
    "usage formatResult fetched passages section heading",
    text,
  );
  assertEquals(
    usagePassages.some((passage) =>
      passage.includes("Usage\n\n```ts\nconst runtime = searchWeb({ query: \"react cleanup\" });\nconst formatted = formatResult(runtime);\n```")
    ),
    true,
  );
});

Deno.test("web ranking: generateQueryVariants preserves caps and important numeric tokens", () => {
  const variants = generateQueryVariants(
    "tensorflow 2025 2.2 tutorial updates",
    3,
  );

  assert(variants.length <= 3);
  assert(variants.some((variant) => variant.includes("2025")));
  assert(variants.some((variant) => variant.includes("2.2")));
  assert(variants.every((variant) => variant.split(/\s+/).length >= 2));
});

Deno.test("web ranking: deduplicateSnippetPassages only drops high-overlap passages", () => {
  const filtered = deduplicateSnippetPassages(
    "Deno 2.2 introduces workspaces and improved npm compatibility",
    [
      "Deno 2.2 introduces workspaces and improved npm compatibility for developers",
      "The release also includes faster startup times and better performance tuning.",
    ],
  );

  assertEquals(filtered, [
    "The release also includes faster startup times and better performance tuning.",
  ]);
});

Deno.test("web ranking: extractPublicationDate supports meta, time, json-ld, and missing metadata", () => {
  const cases = [
    [
      `<html><head><meta property="article:published_time" content="2026-02-15T10:00:00Z"></head></html>`,
      "2026-02-15T10:00:00Z",
    ],
    [
      `<html><body><time datetime="2026-01-20">January 20, 2026</time></body></html>`,
      "2026-01-20",
    ],
    [
      `<html><head><script type="application/ld+json">{"@graph":[{"@type":"BreadcrumbList"},{"@type":"BlogPosting","datePublished":"2025-06-01"}]}</script></head></html>`,
      "2025-06-01",
    ],
    [
      `<html><head><title>No dates here</title></head><body><p>Just text</p></body></html>`,
      undefined,
    ],
  ] as const;

  for (const [html, expected] of cases) {
    assertEquals(extractPublicationDate(html), expected);
  }
});

Deno.test("web ranking: estimateResultAgeDays and filterSearchResultsForTimeRange drop explicitly stale results", () => {
  const old = {
    title: "Old release",
    url: "https://example.com/old",
    snippet: "Published 2020-01-01",
  };
  const recent = {
    title: "Recent release",
    url: "https://example.com/new",
    snippet: "published 1 day ago",
  };
  const undated = {
    title: "Undated docs",
    url: "https://example.com/docs",
    snippet: "Reference docs",
  };

  assert(estimateResultAgeDays(old)! > 365);
  assert(estimateResultAgeDays(recent)! <= 2);
  assertEquals(
    filterSearchResultsForTimeRange([old, recent, undated], "week").map((result) =>
      result.title
    ),
    ["Recent release", "Undated docs"],
  );
});

Deno.test("web ranking: assessSearchConfidence flags low diversity and low coverage separately", () => {
  const lowDiversity = assessSearchConfidence("hlvm search", [
    {
      title: "A",
      url: "https://same.com/a",
      snippet: "hlvm search guide",
      score: 8,
    },
    {
      title: "B",
      url: "https://same.com/b",
      snippet: "hlvm search reference",
      score: 8,
    },
    {
      title: "C",
      url: "https://same.com/c",
      snippet: "hlvm search docs",
      score: 8,
    },
  ], { diversityThreshold: 0.5 });
  const lowCoverage = assessSearchConfidence(
    "python asyncio taskgroup cancellation",
    [
      {
        title: "General Python guide",
        url: "https://a.com",
        snippet: "python guide",
        score: 7,
      },
      {
        title: "Python basics",
        url: "https://b.com",
        snippet: "python basics",
        score: 7,
      },
      {
        title: "Python intro",
        url: "https://c.com",
        snippet: "python intro",
        score: 7,
      },
    ],
    { coverageThreshold: 0.8 },
  );

  assertEquals(lowDiversity.lowConfidence, true);
  assert(lowDiversity.reasons.includes("low_diversity"));
  assertEquals(lowCoverage.lowConfidence, true);
  assert(lowCoverage.reasons.includes("low_coverage"));
});

Deno.test("web ranking: assessSearchConfidence falls back to surface quality when provider scores are absent", () => {
  const weak = assessSearchConfidence("react useeffect cleanup", [
    {
      title: "Home",
      url: "https://example.com",
      snippet: "welcome",
    },
    {
      title: "React page",
      url: "https://example.com/react",
      snippet: "cleanup",
    },
  ]);
  const rich = assessSearchConfidence("react useeffect cleanup", [
    {
      title: "React useEffect cleanup reference",
      url: "https://docs.example.com/useeffect-cleanup",
      snippet:
        "Detailed documentation covering cleanup functions, subscriptions, and preventing memory leaks in React effects.",
    },
    {
      title: "React effect cleanup guide",
      url: "https://blog.example.com/react-cleanup",
      snippet:
        "Deep explanation of effect teardown, stale closures, and cleanup patterns with code examples.",
    },
  ]);

  assertEquals(weak.lowConfidence, true);
  assert(weak.reasons.includes("low_score"));
  assertEquals(rich.lowConfidence, false);
  assertEquals(rich.reason, "ok");
});
