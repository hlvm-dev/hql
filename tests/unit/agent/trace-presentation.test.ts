import { assertEquals } from "jsr:@std/assert";
import {
  formatTraceLineForTerminal,
  presentTraceEvent,
} from "../../../src/hlvm/agent/trace-presentation.ts";

Deno.test("presentTraceEvent expands plan_created into trace rows", () => {
  const lines = presentTraceEvent({
    type: "plan_created",
    plan: {
      goal: "Ship the debug view",
      steps: [
        { id: "step-1", title: "Wire the flag" },
        { id: "step-2", title: "Render trace rows" },
      ],
    },
  });

  assertEquals(lines.length, 3);
  assertEquals(lines[0]?.text.includes("Plan created"), true);
  assertEquals(lines[1]?.text, "1. Wire the flag");
  assertEquals(lines[2]?.text, "2. Render trace rows");
});

Deno.test("formatTraceLineForTerminal indents nested trace rows", () => {
  const formatted = formatTraceLineForTerminal({
    depth: 2,
    text: "Tool search_code",
    tone: "active",
  });

  assertEquals(formatted, "    - Tool search_code");
});
