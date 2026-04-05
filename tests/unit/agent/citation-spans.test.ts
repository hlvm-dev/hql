import { assert, assertEquals } from "jsr:@std/assert";
import {
  attributeCitationSpans,
  buildCitationSourceIndex,
  buildRetrievalCitations,
  mapLlmSourcesToCitations,
  mapProviderMetadataToCitations,
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
            snippet:
              "NIST AI RMF update introduces governance and measurement changes.",
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
  assertEquals(
    first.citation.url,
    "https://docs.python.org/3/library/asyncio-task.html",
  );
  assert(first.startIndex >= 0);
  assert(first.endIndex > first.startIndex);
  assert(first.confidence >= 0.3);
  assertEquals(
    response.slice(first.startIndex, first.endIndex),
    first.spanText,
  );
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
            snippet:
              "This page discusses coffee brewing methods and espresso extraction.",
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

Deno.test("attributeCitationSpans supports localized text", () => {
  const sourceIndex = buildCitationSourceIndex([
    {
      toolName: "search_web",
      result: {
        provider: "duckduckgo",
        results: [
          {
            title: "파이썬 TaskGroup",
            url: "https://docs.python.org/ko/3/library/asyncio-task.html",
            snippet:
              "파이썬 태스크그룹은 구조적 동시성을 제공하고 실패 시 형제 작업을 취소합니다.",
          },
        ],
      },
    },
  ]);

  const response =
    "파이썬 태스크그룹은 구조적 동시성을 제공하고 실패 시 형제 작업을 취소합니다.";
  const spans = attributeCitationSpans(response, sourceIndex);

  assertEquals(spans.length, 1);
  assertEquals(
    spans[0]?.citation.url,
    "https://docs.python.org/ko/3/library/asyncio-task.html",
  );
});

Deno.test("attributeCitationSpans prefers stronger evidence-backed sources when overlap is similar", () => {
  const sourceIndex = buildCitationSourceIndex([
    {
      toolName: "search_web",
      result: {
        provider: "duckduckgo",
        results: [
          {
            title: "Weak blog",
            url: "https://blog.example.com/taskgroup",
            snippet:
              "TaskGroup provides structured concurrency for asyncio programs.",
            evidenceStrength: "low",
          },
          {
            title: "Python docs",
            url: "https://docs.python.org/3/library/asyncio-task.html",
            snippet:
              "TaskGroup provides structured concurrency for asyncio programs.",
            passages: [
              "TaskGroup provides structured concurrency for asyncio programs and cancels sibling tasks on failure.",
            ],
            evidenceStrength: "high",
            evidenceReason: "page passages",
          },
        ],
      },
    },
  ]);

  const spans = attributeCitationSpans(
    "TaskGroup provides structured concurrency for asyncio programs.",
    sourceIndex,
  );

  assertEquals(spans.length, 1);
  assertEquals(
    spans[0]?.citation.url,
    "https://docs.python.org/3/library/asyncio-task.html",
  );
});

Deno.test("attributeCitationSpans omits ambiguous ties instead of forcing a citation", () => {
  const sourceIndex = buildCitationSourceIndex([
    {
      toolName: "search_web",
      result: {
        provider: "duckduckgo",
        results: [
          {
            title: "Source A",
            url: "https://example.com/a",
            snippet:
              "Structured concurrency in TaskGroup handles grouped asyncio tasks.",
          },
          {
            title: "Source B",
            url: "https://example.com/b",
            snippet:
              "Structured concurrency in TaskGroup handles grouped asyncio tasks.",
          },
        ],
      },
    },
  ]);

  const spans = attributeCitationSpans(
    "Structured concurrency in TaskGroup handles grouped asyncio tasks.",
    sourceIndex,
  );

  assertEquals(spans.length, 0);
});

Deno.test("mapLlmSourcesToCitations keeps provider-native URL sources and drops non-URLs", () => {
  const citations = mapLlmSourcesToCitations([
    {
      id: "src_1",
      sourceType: "url",
      url: "https://ai.google.dev/gemini-api/docs/google-search",
      title: "Google Search grounding",
      providerMetadata: { google: { groundingMetadata: { ok: true } } },
    },
    {
      id: "src_2",
      sourceType: "document",
      title: "Internal PDF",
      mediaType: "application/pdf",
    },
  ]);

  assertEquals(citations.length, 1);
  assertEquals(
    citations[0]?.url,
    "https://ai.google.dev/gemini-api/docs/google-search",
  );
  assertEquals(citations[0]?.provenance, "provider");
  assertEquals(citations[0]?.sourceId, "src_1");
});

Deno.test("mapProviderMetadataToCitations extracts Google grounding chunk URLs", () => {
  const citations = mapProviderMetadataToCitations({
    google: {
      groundingMetadata: {
        groundingChunks: [
          {
            web: {
              uri: "https://deno.com/blog/introducing-deno-sandbox",
              title: "Introducing Deno Sandbox",
            },
          },
          {
            retrievedContext: {
              uri: "https://docs.deno.com/runtime/manual",
              title: "Deno Manual",
            },
          },
          {
            image: {
              sourceUri: "https://example.com/image-source",
              title: "Image source",
            },
          },
          {
            maps: {
              uri: "not-a-http-url",
              title: "Ignored non-http source",
            },
          },
        ],
      },
    },
  });

  assertEquals(citations.length, 3);
  assertEquals(
    citations.map((citation) => citation.url),
    [
      "https://deno.com/blog/introducing-deno-sandbox",
      "https://docs.deno.com/runtime/manual",
      "https://example.com/image-source",
    ],
  );
  assertEquals(
    citations.every((citation) => citation.provenance === "provider"),
    true,
  );
});

Deno.test("buildRetrievalCitations prefers the strongest passage-backed source per URL", () => {
  const sourceIndex = buildCitationSourceIndex([
    {
      toolName: "search_web",
      result: {
        provider: "duckduckgo",
        results: [
          {
            title: "Weak snippet",
            url: "https://docs.python.org/3/library/asyncio-task.html",
            snippet:
              "TaskGroup provides structured concurrency for asyncio programs.",
            evidenceStrength: "low",
          },
          {
            title: "Strong docs",
            url: "https://docs.python.org/3/library/asyncio-task.html",
            snippet:
              "TaskGroup provides structured concurrency for asyncio programs.",
            passages: [
              "TaskGroup provides structured concurrency for asyncio programs and cancels sibling tasks on failure.",
            ],
            evidenceStrength: "high",
          },
        ],
      },
    },
  ]);

  const citations = buildRetrievalCitations(sourceIndex);

  assertEquals(citations.length, 1);
  assertEquals(
    citations[0]?.url,
    "https://docs.python.org/3/library/asyncio-task.html",
  );
  assertEquals(citations[0]?.provenance, "retrieval");
  assertEquals(citations[0]?.sourceKind, "passage");
});
