import { assert, assertEquals } from "jsr:@std/assert";
import {
  annotateEvidenceStrength,
  bestEvidenceSummary,
  rerankForSynthesis,
  selectEvidencePages,
} from "../../../src/hlvm/agent/tools/web/evidence-selection.ts";
import { detectSearchQueryIntent } from "../../../src/hlvm/agent/tools/web/query-strategy.ts";

Deno.test("evidence selection annotates passage-backed authority results as stronger evidence", () => {
  const [annotated] = annotateEvidenceStrength([
    {
      title: "TaskGroup docs",
      url: "https://docs.python.org/3/library/asyncio-task.html",
      snippet: "Official docs for TaskGroup",
      passages: ["TaskGroup provides structured concurrency for asyncio workloads."],
      pageDescription: "Reference page for asyncio.TaskGroup.",
    },
  ], detectSearchQueryIntent("Python asyncio TaskGroup official docs"));

  assertEquals(annotated.evidenceStrength, "high");
  assert(bestEvidenceSummary(annotated)?.includes("structured concurrency"));
});

Deno.test("evidence selection prefers diverse pages for comparison queries", () => {
  const selected = selectEvidencePages([
    {
      title: "FastAPI docs",
      url: "https://fastapi.tiangolo.com/tutorial/",
      snippet: "FastAPI tutorial",
      passages: ["FastAPI emphasizes type hints and async request handling."],
    },
    {
      title: "FastAPI deployment",
      url: "https://fastapi.tiangolo.com/deployment/",
      snippet: "Deployment docs",
      passages: ["FastAPI deployment guidance for production services."],
    },
    {
      title: "Flask docs",
      url: "https://flask.palletsprojects.com/en/stable/",
      snippet: "Flask documentation",
      passages: ["Flask keeps a lightweight synchronous core and extension model."],
    },
  ], {
    maxPages: 2,
    intent: detectSearchQueryIntent("Compare FastAPI vs Flask tradeoffs"),
  });

  assertEquals(selected.length, 2);
  assert(selected.some((result) => result.url?.includes("fastapi")));
  assert(selected.some((result) => result.url?.includes("flask")));
});

Deno.test("evidence selection prefers official docs over thin blog pages when requested", () => {
  const selected = selectEvidencePages([
    {
      title: "Random blog",
      url: "https://blog.example.com/taskgroup",
      snippet: "quick taskgroup intro",
    },
    {
      title: "Python docs",
      url: "https://docs.python.org/3/library/asyncio-task.html",
      snippet: "TaskGroup official docs",
      passages: ["TaskGroup is an asynchronous context manager for grouped tasks."],
    },
  ], {
    maxPages: 1,
    intent: detectSearchQueryIntent("Explain Python asyncio TaskGroup using official docs first"),
  });

  assertEquals(selected[0]?.url, "https://docs.python.org/3/library/asyncio-task.html");
});

Deno.test("evidence selection allows a strong snippet-only second source for comparison queries", () => {
  const selected = selectEvidencePages([
    {
      title: "FastAPI docs",
      url: "https://fastapi.tiangolo.com/tutorial/",
      snippet: "FastAPI tutorial",
      passages: ["FastAPI emphasizes type hints and async request handling."],
    },
    {
      title: "Flask docs",
      url: "https://flask.palletsprojects.com/en/stable/",
      snippet: "Flask keeps a lightweight synchronous core and extension model.",
    },
  ], {
    maxPages: 2,
    intent: detectSearchQueryIntent("Compare FastAPI vs Flask tradeoffs"),
  });

  assertEquals(selected.length, 2);
  assert(selected.some((result) => result.url?.includes("fastapi")));
  assert(selected.some((result) => result.url?.includes("flask")));
});

Deno.test("evidence reranking promotes fetched passages ahead of snippet-only results", () => {
  const reranked = rerankForSynthesis([
    {
      title: "Snippet page",
      url: "https://example.com/blog/react",
      snippet: "React rendering tips",
    },
    {
      title: "Docs page",
      url: "https://react.dev/reference/react/memo",
      snippet: "React memo docs",
      passages: ["memo skips re-rendering when props are unchanged."],
    },
  ], {
    intent: detectSearchQueryIntent("best React rendering tips"),
  });

  assertEquals(reranked[0]?.url, "https://react.dev/reference/react/memo");
});
