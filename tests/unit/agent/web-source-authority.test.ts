import { assertEquals } from "jsr:@std/assert";
import { classifySearchResultSource } from "../../../src/hlvm/agent/tools/web/source-authority.ts";
import type { SearchResult } from "../../../src/hlvm/agent/tools/web/search-provider.ts";

Deno.test("web source authority: allowed-domain docs classify as official docs", () => {
  const result: SearchResult = {
    title: "useEffect - React",
    url: "https://react.dev/reference/react/useEffect",
  };

  const authority = classifySearchResultSource(result, ["react.dev"]);

  assertEquals(authority.sourceClass, "official_docs");
  assertEquals(authority.isAuthoritative, true);
});

Deno.test("web source authority: doc-like product pages classify as vendor docs", () => {
  const result: SearchResult = {
    title: "useEffect - React",
    url: "https://react.dev/reference/react/useEffect",
  };

  const authority = classifySearchResultSource(result);

  assertEquals(authority.sourceClass, "vendor_docs");
  assertEquals(authority.isAuthoritative, true);
});

Deno.test("web source authority: community articles and forums stay non-authoritative", () => {
  const article = classifySearchResultSource({
    title: "Understanding React cleanup",
    url: "https://dev.to/example/react-cleanup",
  });
  const forum = classifySearchResultSource({
    title: "How does cleanup work?",
    url: "https://stackoverflow.com/questions/1/react-cleanup",
  });

  assertEquals(article.sourceClass, "technical_article");
  assertEquals(article.isAuthoritative, false);
  assertEquals(forum.sourceClass, "forum");
  assertEquals(forum.isAuthoritative, false);
});

Deno.test("web source authority: article-style docs mirrors stay non-authoritative", () => {
  const mirror = classifySearchResultSource({
    title: "Common async TaskGroup Pitfalls and Solutions",
    url: "https://runebook.dev/en/docs/python/library/asyncio-task/asyncio.TaskGroup.create_task",
    snippet: "How to use asyncio TaskGroup safely in real projects.",
  });

  assertEquals(mirror.sourceClass, "technical_article");
  assertEquals(mirror.isAuthoritative, false);
});

Deno.test("web source authority: first-party release blogs classify as vendor docs", () => {
  const authority = classifySearchResultSource({
    title: "Next.js 15.5",
    url: "https://nextjs.org/blog/next-15-5",
    snippet: "Official Next.js release announcement and changelog.",
  });

  assertEquals(authority.sourceClass, "vendor_docs");
  assertEquals(authority.isAuthoritative, true);
});
