import { assertEquals, assert } from "jsr:@std/assert";
import {
  parseGoogleNewsRss,
  fetchGoogleNewsResults,
} from "../../../src/hlvm/agent/tools/web/google-news.ts";

// ============================================================
// Helpers
// ============================================================

function wrapRss(items: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Test</title>${items}</channel></rss>`;
}

function makeItem(opts: {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  source?: string;
}): string {
  const parts = [
    `<title>${opts.title}</title>`,
    `<link>${opts.link}</link>`,
  ];
  if (opts.description) parts.push(`<description>${opts.description}</description>`);
  if (opts.pubDate) parts.push(`<pubDate>${opts.pubDate}</pubDate>`);
  if (opts.source) parts.push(`<source url="https://example.com">${opts.source}</source>`);
  return `<item>${parts.join("")}</item>`;
}

function withStubbedFetch(
  stub: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof globalThis.fetch;
  return fn().finally(() => { globalThis.fetch = original; });
}

// ============================================================
// parseGoogleNewsRss
// ============================================================

Deno.test("parseGoogleNewsRss extracts items from valid RSS", () => {
  const xml = wrapRss([
    makeItem({ title: "AI Advances", link: "https://example.com/1", description: "New breakthroughs", pubDate: "Sat, 01 Mar 2025 12:00:00 GMT", source: "TechNews" }),
    makeItem({ title: "Deno 2.0 Released", link: "https://example.com/2", description: "Major update", pubDate: "Fri, 28 Feb 2025 10:00:00 GMT" }),
    makeItem({ title: "TypeScript 6.0", link: "https://example.com/3", description: "New features" }),
  ].join(""));

  const results = parseGoogleNewsRss(xml);
  assertEquals(results.length, 3);
  assertEquals(results[0].title, "AI Advances");
  assertEquals(results[0].url, "https://example.com/1");
  assert(results[0].snippet?.includes("TechNews"));
  assertEquals(results[0].publishedDate, "Sat, 01 Mar 2025 12:00:00 GMT");
  assertEquals(results[1].title, "Deno 2.0 Released");
  assertEquals(results[2].title, "TypeScript 6.0");
});

Deno.test("parseGoogleNewsRss handles HTML-encoded description", () => {
  const xml = wrapRss(
    makeItem({
      title: "Test &amp; Results",
      link: "https://example.com/encoded",
      description: "&lt;b&gt;Bold&lt;/b&gt; text &amp; more",
    }),
  );

  const results = parseGoogleNewsRss(xml);
  assertEquals(results.length, 1);
  assertEquals(results[0].title, "Test & Results");
  assert(results[0].snippet?.includes("Bold"));
  assert(results[0].snippet?.includes("text & more"));
  assert(!results[0].snippet?.includes("&lt;"));
});

Deno.test("parseGoogleNewsRss handles CDATA-wrapped fields", () => {
  const xml = wrapRss(
    `<item>
      <title><![CDATA[CDATA Title Here]]></title>
      <link>https://example.com/cdata</link>
      <description><![CDATA[Some <b>rich</b> description]]></description>
    </item>`,
  );

  const results = parseGoogleNewsRss(xml);
  assertEquals(results.length, 1);
  assertEquals(results[0].title, "CDATA Title Here");
  assert(results[0].snippet?.includes("rich"));
  assert(!results[0].snippet?.includes("<b>"));
});

Deno.test("parseGoogleNewsRss returns empty for malformed input", () => {
  assertEquals(parseGoogleNewsRss("").length, 0);
  assertEquals(parseGoogleNewsRss("not xml at all").length, 0);
  assertEquals(parseGoogleNewsRss("<rss></rss>").length, 0);
  assertEquals(parseGoogleNewsRss("<rss><channel></channel></rss>").length, 0);
});

Deno.test("parseGoogleNewsRss skips items without title or link", () => {
  const xml = wrapRss([
    `<item><title>Has title only</title></item>`,
    `<item><link>https://example.com/noTitle</link></item>`,
    makeItem({ title: "Valid", link: "https://example.com/valid" }),
  ].join(""));

  const results = parseGoogleNewsRss(xml);
  assertEquals(results.length, 1);
  assertEquals(results[0].title, "Valid");
});

// ============================================================
// fetchGoogleNewsResults
// ============================================================

Deno.test("fetchGoogleNewsResults returns empty on HTTP error", async () => {
  await withStubbedFetch(
    () => Promise.resolve(new Response("Forbidden", { status: 403 })),
    async () => {
      const results = await fetchGoogleNewsResults("test query");
      assertEquals(results.length, 0);
    },
  );
});

Deno.test("fetchGoogleNewsResults returns parsed results on success", async () => {
  const rssXml = wrapRss([
    makeItem({ title: "Result One", link: "https://news.example.com/1", description: "First item" }),
    makeItem({ title: "Result Two", link: "https://news.example.com/2", description: "Second item" }),
  ].join(""));

  await withStubbedFetch(
    () => Promise.resolve(new Response(rssXml, { status: 200, headers: { "content-type": "application/rss+xml" } })),
    async () => {
      const results = await fetchGoogleNewsResults("test query", { limit: 5 });
      assertEquals(results.length, 2);
      assertEquals(results[0].title, "Result One");
      assertEquals(results[0].url, "https://news.example.com/1");
      assertEquals(results[1].title, "Result Two");
    },
  );
});

Deno.test("fetchGoogleNewsResults respects locale when building the feed URL", async () => {
  let requestedUrl = "";
  const rssXml = wrapRss(
    makeItem({ title: "Localized Result", link: "https://news.example.com/localized", description: "Localized item" }),
  );

  await withStubbedFetch(
    (input) => {
      requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(
        new Response(rssXml, { status: 200, headers: { "content-type": "application/rss+xml" } }),
      );
    },
    async () => {
      const results = await fetchGoogleNewsResults("test query", { locale: "kr-ko" });
      assertEquals(results.length, 1);
    },
  );

  const parsed = new URL(requestedUrl);
  assertEquals(parsed.hostname, "news.google.com");
  assertEquals(parsed.searchParams.get("hl"), "ko");
  assertEquals(parsed.searchParams.get("gl"), "KR");
  assertEquals(parsed.searchParams.get("ceid"), "KR:ko");
});
