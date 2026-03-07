import { assertEquals } from "jsr:@std/assert";
import { decideFetchEscalation } from "../../../src/hlvm/agent/tools/web/fetch-escalation.ts";
import { detectSearchQueryIntent } from "../../../src/hlvm/agent/tools/web/query-strategy.ts";

Deno.test("fetch escalation prioritizes docs queries", () => {
  const decision = decideFetchEscalation({
    intent: detectSearchQueryIntent("Explain Python asyncio TaskGroup using official docs first"),
    results: [
      { title: "Docs", url: "https://docs.python.org/3/library/asyncio-task.html", snippet: "Official docs" },
    ],
  });

  assertEquals(decision.shouldEscalate, true);
  assertEquals(decision.reason, "official_docs");
  assertEquals(decision.maxFetches, 3);
});

Deno.test("fetch escalation prioritizes comparison queries with multi-source fetch", () => {
  const decision = decideFetchEscalation({
    intent: detectSearchQueryIntent("Compare FastAPI vs Flask production tradeoffs"),
    results: [
      { title: "FastAPI", url: "https://fastapi.tiangolo.com", snippet: "FastAPI docs" },
      { title: "Flask", url: "https://flask.palletsprojects.com", snippet: "Flask docs" },
    ],
  });

  assertEquals(decision.shouldEscalate, true);
  assertEquals(decision.reason, "comparison");
  assertEquals(decision.maxFetches, 3);
});

Deno.test("fetch escalation uses thin snippets as generic fallback", () => {
  const decision = decideFetchEscalation({
    intent: detectSearchQueryIntent("best React rendering tips"),
    results: [
      { title: "A", url: "https://example.com/a", snippet: "tips" },
      { title: "B", url: "https://example.com/b", snippet: "guide" },
    ],
  });

  assertEquals(decision.shouldEscalate, true);
  assertEquals(decision.reason, "thin_snippets");
  assertEquals(decision.maxFetches, 2);
});
