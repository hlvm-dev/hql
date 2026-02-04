/**
 * Planning Tests
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  extractStepDoneId,
  formatPlanForContext,
  parsePlanResponse,
  shouldPlanRequest,
  stripStepMarkers,
  type Plan,
} from "../../../src/hlvm/agent/planning.ts";

Deno.test({
  name: "Planning: parse PLAN envelope",
  fn() {
    const response = `PLAN
{"goal":"Test goal","steps":[{"id":"step-1","title":"Search","tools":["search_code"]}]}
END_PLAN`;
    const parsed = parsePlanResponse(response);
    assertEquals(parsed.plan?.goal, "Test goal");
    assertEquals(parsed.plan?.steps.length, 1);
    assertEquals(parsed.plan?.steps[0].id, "step-1");
  },
});

Deno.test({
  name: "Planning: strip STEP_DONE marker",
  fn() {
    const response = "Done.\nSTEP_DONE step-2";
    assertEquals(stripStepMarkers(response), "Done.");
    assertEquals(extractStepDoneId(response), "step-2");
  },
});

Deno.test({
  name: "Planning: formatPlanForContext includes steps",
  fn() {
    const plan: Plan = {
      goal: "Summarize file",
      steps: [
        { id: "step-1", title: "Search", tools: ["search_code"] },
        { id: "step-2", title: "Read", tools: ["read_file"] },
      ],
    };
    const formatted = formatPlanForContext(plan, { requireStepMarkers: true });
    assertStringIncludes(formatted, "Plan:");
    assertStringIncludes(formatted, "step-1");
    assertStringIncludes(formatted, "STEP_DONE");
  },
});

Deno.test({
  name: "Planning: shouldPlanRequest auto heuristic",
  fn() {
    assertEquals(shouldPlanRequest("First do A, then B", "auto"), true);
    assertEquals(shouldPlanRequest("short task", "auto"), false);
    assertEquals(shouldPlanRequest("short task", "always"), true);
  },
});
