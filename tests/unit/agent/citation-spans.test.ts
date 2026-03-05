import { assert, assertEquals } from "jsr:@std/assert";
import {
  attributeCitationSpans,
  buildCitationSourceIndex,
} from "../../../src/hlvm/agent/tools/web/citation-spans.ts";

Deno.test("buildCitationSourceIndex extracts snippets and passages from search_web payload", () => {
  const index = buildCitationSourceIndex([
    {
      toolName: "search_web",
      result: {
        provider: "duckduckgo",
        results: [
          {
            title: "NIST AI RMF",
            url: "https://nist.gov/ai/rmf",
            snippet: "NIST AI RMF update introduces governance and measurement changes.",
            passages: [
              "The update emphasizes governance, map, measure, and manage functions.",
            ],
          },
        ],
      },
    },
  ]);

  assertEquals(index.length, 2);
  assert(index.some((entry) => entry.sourceKind === "snippet"));
  assert(index.some((entry) => entry.sourceKind === "passage"));
});

Deno.test("attributeCitationSpans maps matching sentences with offsets and confidence", () => {
  const sourceIndex = buildCitationSourceIndex([
    {
      toolName: "search_web",
      result: {
        provider: "duckduckgo",
        results: [
          {
            title: "Python TaskGroup",
            url: "https://docs.python.org/3/library/asyncio-task.html",
            snippet:
              "TaskGroup provides structured concurrency and cancels sibling tasks on failure.",
          },
        ],
      },
    },
  ]);

  const response =
    "TaskGroup provides structured concurrency for asyncio. It also cancels sibling tasks when one fails.";
  const spans = attributeCitationSpans(response, sourceIndex);

  assertEquals(spans.length >= 1, true);
  const first = spans[0];
  assertEquals(first.citation.url, "https://docs.python.org/3/library/asyncio-task.html");
  assert(first.startIndex >= 0);
  assert(first.endIndex > first.startIndex);
  assert(first.confidence >= 0.3);
  assertEquals(response.slice(first.startIndex, first.endIndex), first.spanText);
});

Deno.test("attributeCitationSpans skips weak overlap", () => {
  const sourceIndex = buildCitationSourceIndex([
    {
      toolName: "search_web",
      result: {
        provider: "duckduckgo",
        results: [
          {
            title: "Unrelated",
            url: "https://example.com/unrelated",
            snippet: "This page discusses coffee brewing methods and espresso extraction.",
          },
        ],
      },
    },
  ]);

  const spans = attributeCitationSpans(
    "TensorFlow 2.20 improves Keras APIs and model export defaults.",
    sourceIndex,
  );
  assertEquals(spans.length, 0);
});
