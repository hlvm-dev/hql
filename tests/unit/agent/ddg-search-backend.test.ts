import { assertEquals } from "jsr:@std/assert";
import { __testOnlyEnsureDistinctTopHosts } from "../../../src/hlvm/agent/tools/web/ddg-search-backend.ts";
import type { SearchResult } from "../../../src/hlvm/agent/tools/web/search-provider.ts";

function makeResult(url: string, title = url): SearchResult {
  return { url, title, snippet: title };
}

Deno.test("ddg backend: distinct-host fallback replaces duplicate top host", () => {
  const targets = [
    makeResult("https://docs.example.com/guide"),
    makeResult("https://docs.example.com/reference"),
  ];
  const candidates = [
    ...targets,
    makeResult("https://community.example.org/guide"),
  ];

  const distinct = __testOnlyEnsureDistinctTopHosts(targets, candidates, 2);

  assertEquals(
    distinct.map((result) => result.url),
    [
      "https://docs.example.com/guide",
      "https://community.example.org/guide",
    ],
  );
});

Deno.test("ddg backend: distinct-host fallback is a no-op without alternate host", () => {
  const targets = [
    makeResult("https://docs.example.com/guide"),
    makeResult("https://docs.example.com/reference"),
  ];
  const candidates = [
    ...targets,
    makeResult("https://docs.example.com/tutorial"),
  ];

  const distinct = __testOnlyEnsureDistinctTopHosts(targets, candidates, 2);

  assertEquals(
    distinct.map((result) => result.url),
    targets.map((result) => result.url),
  );
});
