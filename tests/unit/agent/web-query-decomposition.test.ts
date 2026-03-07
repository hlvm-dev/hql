import { assert, assertEquals } from "jsr:@std/assert";
import { planSearchQueries } from "../../../src/hlvm/agent/tools/web/query-decomposition.ts";

Deno.test("web query decomposition plans compare queries into bounded subqueries", () => {
  const plan = planSearchQueries({
    userQuery: "Compare FastAPI vs Flask production tradeoffs",
  });

  assertEquals(plan.mode, "decomposed");
  assertEquals(plan.primaryQuery, "Compare FastAPI vs Flask production tradeoffs");
  assertEquals(plan.subqueries.length <= 2, true);
  assert(plan.subqueries.some((query) => /FastAPI/i.test(query)));
  assert(plan.subqueries.some((query) => /Flask/i.test(query)));
});

Deno.test("web query decomposition preserves quoted phrases and years for docs queries", () => {
  const plan = planSearchQueries({
    userQuery: "\"Python asyncio TaskGroup\" changes in 2025 using official docs first",
  });

  assertEquals(plan.mode, "decomposed");
  assert(plan.subqueries.every((query) => query.includes("\"Python asyncio TaskGroup\"")));
  assert(plan.subqueries.every((query) => query.includes("2025")));
});

Deno.test("web query decomposition stays single for narrow direct queries", () => {
  const plan = planSearchQueries({
    userQuery: "hlvm project",
  });

  assertEquals(plan.mode, "single");
  assertEquals(plan.subqueries.length, 0);
});
