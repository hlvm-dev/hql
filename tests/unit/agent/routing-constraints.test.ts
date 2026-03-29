import { assertEquals } from "jsr:@std/assert";
import {
  extractRoutingConstraintsFromTaskText,
  normalizeRoutingConstraintSet,
} from "../../../src/hlvm/agent/routing-constraints.ts";

Deno.test("routing constraints: extracts hard constraints from explicit task text", () => {
  assertEquals(
    extractRoutingConstraintsFromTaskText(
      "Use latest docs but keep it local and do not upload anything.",
    ),
    {
      hardConstraints: ["local-only", "no-upload"],
      preferenceConflict: false,
      source: "task-text",
    },
  );
});

Deno.test("routing constraints: extracts soft preference from explicit task text", () => {
  assertEquals(
    extractRoutingConstraintsFromTaskText(
      "Answer this, cheap if possible.",
    ),
    {
      hardConstraints: [],
      preference: "cheap",
      preferenceConflict: false,
      source: "task-text",
    },
  );
  assertEquals(
    extractRoutingConstraintsFromTaskText(
      "Quality matters here, prioritize quality.",
    ),
    {
      hardConstraints: [],
      preference: "quality",
      preferenceConflict: false,
      source: "task-text",
    },
  );
});

Deno.test("routing constraints: conflicting soft preferences are surfaced instead of chosen", () => {
  assertEquals(
    extractRoutingConstraintsFromTaskText(
      "Be cheap if possible, but quality matters too.",
    ),
    {
      hardConstraints: [],
      preferenceConflict: true,
      source: "task-text",
    },
  );
});

Deno.test("routing constraints: normalizer ignores invalid values", () => {
  assertEquals(
    normalizeRoutingConstraintSet({
      hardConstraints: ["local-only", "ignored"],
      preference: "invalid",
      preferenceConflict: true,
      source: "task-text",
    }),
    {
      hardConstraints: ["local-only"],
      preferenceConflict: true,
      source: "task-text",
    },
  );
});
