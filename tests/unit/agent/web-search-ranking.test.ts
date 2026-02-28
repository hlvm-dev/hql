import { assertEquals } from "jsr:@std/assert";
import {
  canonicalizeResultUrl,
  dedupeSearchResults,
  rankSearchResults,
} from "../../../src/hlvm/agent/tools/web/search-ranking.ts";

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
