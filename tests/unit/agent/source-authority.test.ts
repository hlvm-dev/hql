import { assertEquals } from "jsr:@std/assert";
import { classifySearchResultSource } from "../../../src/hlvm/agent/tools/web/source-authority.ts";
import { SOURCE_AUTHORITY_FIXTURES } from "./source-authority-fixtures.ts";

Deno.test("source authority heuristics: fixture corpus stays stable", () => {
  for (const fixture of SOURCE_AUTHORITY_FIXTURES) {
    const classified = classifySearchResultSource(fixture.result);
    assertEquals(
      classified.sourceClass,
      fixture.expectedClass,
      fixture.name,
    );
  }
});

Deno.test("source authority heuristics: allowed domains promote official docs", () => {
  const classified = classifySearchResultSource(
    {
      title: "asyncio Task and TaskGroup",
      url: "https://docs.python.org/3/library/asyncio-task.html",
      snippet: "TaskGroup provides structured concurrency and cancels sibling tasks on failure.",
    },
    ["python.org"],
  );
  assertEquals(classified.sourceClass, "official_docs");
});
