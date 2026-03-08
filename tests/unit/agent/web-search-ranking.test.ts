import { assert, assertEquals } from "jsr:@std/assert";
import {
  assessSearchConfidence,
  canonicalizeResultUrl,
  classifySourceAuthority,
  dedupeSearchResults,
  deduplicateSnippetPassages,
  extractRelevantPassages,
  rankSearchResults,
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

Deno.test("web ranking: rankSearchResults enforces recency filtering when requested", () => {
  const ranked = rankSearchResults(
    "hlvm release",
    [
      {
        title: "Old Release",
        url: "https://news.example.com/old",
        snippet: "Published 2020-01-01",
      },
      {
        title: "Recent Release",
        url: "https://news.example.com/new",
        snippet: "published 1 day ago",
      },
    ],
    "week",
  );

  assertEquals(ranked.length, 1);
  assertEquals(ranked[0].title, "Recent Release");
});

Deno.test("web ranking: rankSearchResults favors authoritative rich pages and penalizes duplicate thin hosts", () => {
  const ranked = rankSearchResults(
    "python asyncio taskgroup",
    [
      {
        title: "Thin SEO Page",
        url: "https://blog.example.com/tag/python-asyncio-taskgroup",
        snippet: "python asyncio taskgroup python asyncio taskgroup python asyncio taskgroup",
      },
      {
        title: "Another Thin SEO Page",
        url: "https://blog.example.com/page/python-asyncio-taskgroup",
        snippet: "python asyncio taskgroup python asyncio taskgroup python asyncio taskgroup",
      },
      {
        title: "TaskGroup guide",
        url: "https://docs.python.org/tutorial/asyncio/taskgroup",
        snippet: "Detailed guide to TaskGroup cancellation behavior, exceptions, and structured concurrency.",
      },
    ],
    "all",
  );

  assertEquals(ranked[0].url, "https://docs.python.org/tutorial/asyncio/taskgroup");
  assert(ranked[0].score! > ranked[1].score!);
});

Deno.test("web ranking: scorePassage and extractRelevantPassages reward coverage, proximity, and truncation", () => {
  const close = "the deno release includes typescript support and deno improvements for developers";
  const far = "deno is a runtime. many paragraphs later we finally mention the release details";
  const text = [
    "This paragraph is about cooking recipes and has nothing relevant.",
    "Deno 2.2 introduces workspaces and improved npm compatibility for developers using Deno and TypeScript together.",
    "Deno release notes mention TypeScript support, startup improvements, and new tooling for Deno users.",
    "Deno ".repeat(200),
  ].join("\n\n");

  assert(scorePassage(close, ["deno", "release", "typescript"]) >
    scorePassage(far, ["deno", "release", "typescript"]));

  const passages = extractRelevantPassages("deno 2.2 release", text);
  assertEquals(passages.length, 3);
  assert(passages[0].includes("Deno"));
  assert(passages.some((passage) => passage.length <= 280 && passage.endsWith("…")));
  assertEquals(extractRelevantPassages("quantum physics", "Cooking pasta only").length, 0);
});

Deno.test("web ranking: generateQueryVariants preserves caps and important numeric tokens", () => {
  const variants = generateQueryVariants("tensorflow 2025 2.2 tutorial updates", 3);

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

Deno.test("web ranking: assessSearchConfidence flags low diversity and low coverage separately", () => {
  const lowDiversity = assessSearchConfidence("hlvm search", [
    { title: "A", url: "https://same.com/a", snippet: "hlvm search guide", score: 8 },
    { title: "B", url: "https://same.com/b", snippet: "hlvm search reference", score: 8 },
    { title: "C", url: "https://same.com/c", snippet: "hlvm search docs", score: 8 },
  ], { diversityThreshold: 0.5 });
  const lowCoverage = assessSearchConfidence("python asyncio taskgroup cancellation", [
    { title: "General Python guide", url: "https://a.com", snippet: "python guide", score: 7 },
    { title: "Python basics", url: "https://b.com", snippet: "python basics", score: 7 },
    { title: "Python intro", url: "https://c.com", snippet: "python intro", score: 7 },
  ], { coverageThreshold: 0.8 });

  assertEquals(lowDiversity.lowConfidence, true);
  assert(lowDiversity.reasons.includes("low_diversity"));
  assertEquals(lowCoverage.lowConfidence, true);
  assert(lowCoverage.reasons.includes("low_coverage"));
});

Deno.test("web ranking: classifySourceAuthority detects official, repo, community, authoritative, and unknown", () => {
  // Official: domain contains query term
  assertEquals(classifySourceAuthority("https://bun.sh/blog/release", "bun release"), "official");
  assertEquals(classifySourceAuthority("https://deno.com/blog", "deno docs"), "official");
  assertEquals(classifySourceAuthority("https://react.dev/learn", "react hooks"), "official");
  assertEquals(classifySourceAuthority("https://docs.python.org/3/", "python docs"), "official");

  // Repository: GitHub/GitLab
  assertEquals(classifySourceAuthority("https://github.com/oven-sh/bun", "bun"), "repository");
  assertEquals(classifySourceAuthority("https://gitlab.com/foo/bar", "bar lib"), "repository");

  // Community: Reddit, StackOverflow, etc.
  assertEquals(classifySourceAuthority("https://reddit.com/r/node", "bun"), "community");
  assertEquals(classifySourceAuthority("https://stackoverflow.com/q/12345", "deno deploy"), "community");
  assertEquals(classifySourceAuthority("https://dev.to/post/abc", "react tutorial"), "community");

  // Authoritative: .edu/.gov with authority boost >= 0.3
  assertEquals(classifySourceAuthority("https://developer.mozilla.org/en-US/docs/Web/CSS/Grid", "css grid"), "authoritative");

  // Unknown: no match
  assertEquals(classifySourceAuthority("https://example.com/page", "widgets"), "unknown");
  assertEquals(classifySourceAuthority("https://randomsite.io/stuff", "something else"), "unknown");

  // Invalid URL → unknown
  assertEquals(classifySourceAuthority("not-a-url", "query"), "unknown");
});
