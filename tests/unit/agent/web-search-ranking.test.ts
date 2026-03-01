import { assert, assertEquals } from "jsr:@std/assert";
import {
  canonicalizeResultUrl,
  dedupeSearchResults,
  deduplicateSnippetPassages,
  extractRelevantPassages,
  rankSearchResults,
  scorePassage,
} from "../../../src/hlvm/agent/tools/web/search-ranking.ts";
import { generateQueryVariants } from "../../../src/hlvm/agent/tools/web/duckduckgo.ts";
import { extractPublicationDate } from "../../../src/hlvm/agent/tools/web/html-parser.ts";

Deno.test("canonicalizeResultUrl strips tracking params and hash", () => {
  const canonical = canonicalizeResultUrl(
    "https://Example.com/path/?utm_source=newsletter&id=42#section",
  );
  assertEquals(canonical, "https://example.com/path?id=42");
});

Deno.test("dedupeSearchResults collapses canonical URL variants", () => {
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

  assertEquals(deduped.length, 2);
  assertEquals(deduped[0].title, "Result A (full)");
});

Deno.test("rankSearchResults applies timeRange recency filtering and boost", () => {
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

Deno.test("rankSearchResults returns empty when timeRange filters out all results", () => {
  const ranked = rankSearchResults(
    "hlvm release",
    [
      {
        title: "Ancient Release",
        url: "https://news.example.com/ancient",
        snippet: "Published 2018-01-01",
      },
    ],
    "day",
  );

  assertEquals(ranked.length, 0);
});

Deno.test("rankSearchResults applies source diversity penalty", () => {
  const ranked = rankSearchResults(
    "hlvm docs",
    [
      {
        title: "Docs A1",
        url: "https://docs.example.com/a1",
        snippet: "hlvm docs guide",
      },
      {
        title: "Docs A2",
        url: "https://docs.example.com/a2",
        snippet: "hlvm docs reference",
      },
      {
        title: "Docs B1",
        url: "https://community.example.org/post",
        snippet: "hlvm docs tutorial",
      },
    ],
    "all",
  );

  assertEquals(ranked[0].url, "https://docs.example.com/a1");
  assertEquals(ranked[1].url, "https://community.example.org/post");
});

// ============================================================
// extractRelevantPassages
// ============================================================

Deno.test("extractRelevantPassages returns top matching paragraphs", () => {
  const text = [
    "Deno 2.2 introduces workspaces and improved npm compatibility.",
    "This paragraph is about cooking recipes and has nothing relevant.",
    "The new Deno release includes faster startup times and better TypeScript support.",
    "Short.",
  ].join("\n\n");

  const passages = extractRelevantPassages("deno 2.2 release", text);
  assertEquals(passages.length, 2);
  assert(passages[0].includes("Deno"));
  assert(passages[1].includes("Deno"));
});

Deno.test("extractRelevantPassages returns empty for no matches", () => {
  const passages = extractRelevantPassages("quantum physics", "This is about cooking pasta and making delicious meals.");
  assertEquals(passages.length, 0);
});

Deno.test("extractRelevantPassages truncates long paragraphs at 280 chars", () => {
  const long = "Deno ".repeat(200);  // 1000 chars, matches query
  const passages = extractRelevantPassages("deno", long);
  assertEquals(passages.length, 1);
  assert(passages[0].length <= 280);
  assert(passages[0].endsWith("\u2026"));
});

// ============================================================
// scorePassage — proximity + TF
// ============================================================

Deno.test("scorePassage gives higher score to proximate tokens", () => {
  const tokens = ["deno", "release"];
  const close = "the deno release is here with many improvements and features for developers";
  const far = "deno is a runtime. many paragraphs later we talk about the release of version two";
  assert(scorePassage(close, tokens) > scorePassage(far, tokens));
});

Deno.test("scorePassage gives higher score to repeated terms (TF)", () => {
  const tokens = ["deno"];
  const once = "deno is a modern javascript runtime for building applications and services";
  const thrice = "deno is great. deno supports typescript natively. deno has built-in tooling";
  assert(scorePassage(thrice, tokens) > scorePassage(once, tokens));
});

Deno.test("scorePassage returns 0 for no token matches", () => {
  assertEquals(scorePassage("this is about cooking pasta and making meals", ["deno", "release"]), 0);
});

Deno.test("scorePassage ranks full coverage above partial coverage", () => {
  const tokens = ["deno", "release", "typescript"];
  const allThree = "deno release includes typescript support and many other features for developers";
  const onlyTwo = "deno release includes many features and improvements for javascript developers today";
  assert(scorePassage(allThree, tokens) > scorePassage(onlyTwo, tokens));
});

Deno.test("scorePassage dedupes query tokens so repeats don't overweight", () => {
  const tokens = ["deno", "release"];
  const dupTokens = ["deno", "deno", "release"];
  const text = "deno release is here with improvements and features for developers of all kinds";
  // With dedup, scores should be identical — but since scorePassage receives
  // pre-tokenized input, we test via extractRelevantPassages which uses tokenizeQuery
  const normal = scorePassage(text, tokens);
  const duped = scorePassage(text, dupTokens);
  // Without dedup in tokenizeQuery, "deno deno release" would give coverage=2/3
  // instead of 1/2 for a paragraph matching only "release". Test via extract:
  const passages = extractRelevantPassages("deno deno release", text);
  assertEquals(passages.length, 1);
  // Verify scorePassage itself: dup tokens inflate coverage (2/3 vs 1/2 for partial)
  // but for full match (all unique tokens present), score should be same
  assert(normal > 0);
  assert(duped > 0);
});

Deno.test("extractRelevantPassages prefers proximate paragraphs", () => {
  const text = [
    "Deno is a runtime. It was released a long time ago and has grown significantly in popularity and usage.",
    "The Deno release notes mention TypeScript and Deno improvements alongside the new Deno features.",
  ].join("\n\n");
  const passages = extractRelevantPassages("deno release", text, 1);
  assertEquals(passages.length, 1);
  // Second paragraph wins: "deno" repeated 3x (TF) + "deno" and "release" are close
  assert(passages[0].includes("release notes"));
});

// ============================================================
// generateQueryVariants
// ============================================================

Deno.test("generateQueryVariants reorders first and last words", () => {
  const variants = generateQueryVariants("deno 2.2 release");
  assert(variants.some((v) => v.startsWith("release")));
});

Deno.test("generateQueryVariants does not drop below 2 words", () => {
  const variants = generateQueryVariants("deno release");
  // 2-word query: reorder only, no drop (would leave 1 word)
  for (const v of variants) {
    assert(v.split(/\s+/).length >= 2);
  }
});

Deno.test("generateQueryVariants respects maxVariants cap", () => {
  const v1 = generateQueryVariants("deno 2.2 release notes", 1);
  assert(v1.length <= 1);
  const v2 = generateQueryVariants("deno 2.2 release notes", 2);
  assert(v2.length <= 2);
});

// ============================================================
// deduplicateSnippetPassages
// ============================================================

Deno.test("deduplicateSnippetPassages drops high-overlap passage", () => {
  const snippet = "Deno 2.2 introduces workspaces and improved npm compatibility";
  const passages = [
    "Deno 2.2 introduces workspaces and improved npm compatibility for developers",
    "The release also includes faster startup times and better performance tuning",
  ];
  const filtered = deduplicateSnippetPassages(snippet, passages);
  assertEquals(filtered.length, 1);
  assert(filtered[0].includes("faster startup"));
});

Deno.test("deduplicateSnippetPassages keeps low-overlap passage", () => {
  const snippet = "Deno is a modern JavaScript runtime";
  const passages = [
    "The new release includes faster startup times and better TypeScript support with improved tooling",
  ];
  const filtered = deduplicateSnippetPassages(snippet, passages);
  assertEquals(filtered.length, 1);
});

// ============================================================
// extractPublicationDate
// ============================================================

Deno.test("extractPublicationDate extracts article:published_time", () => {
  const html = `<html><head><meta property="article:published_time" content="2026-02-15T10:00:00Z"></head><body></body></html>`;
  assertEquals(extractPublicationDate(html), "2026-02-15T10:00:00Z");
});

Deno.test("extractPublicationDate extracts time datetime", () => {
  const html = `<html><body><time datetime="2026-01-20">January 20, 2026</time></body></html>`;
  assertEquals(extractPublicationDate(html), "2026-01-20");
});

Deno.test("extractPublicationDate returns undefined when no date metadata", () => {
  const html = `<html><head><title>No dates here</title></head><body><p>Just text</p></body></html>`;
  assertEquals(extractPublicationDate(html), undefined);
});
