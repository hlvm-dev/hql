import { assertEquals } from "jsr:@std/assert@1";
import {
  buildToolCallTextLayout,
  resolveCollapsedToolList,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/layout.ts";

Deno.test("buildToolCallTextLayout reserves the duration as a fixed suffix slot", () => {
  const layout = buildToolCallTextLayout(
    32,
    "search_web",
    "query=refine overlay chrome alignment",
    1500,
  );
  const totalWidth = "search_web".length +
    (layout.argsText ? 1 + layout.argsText.length : 0) +
    layout.gapWidth + layout.durationText.length;

  assertEquals(layout.durationText, "· (1.5s)");
  assertEquals(totalWidth, 32);
});

Deno.test("buildToolCallTextLayout omits the duration slot when there is no room", () => {
  const layout = buildToolCallTextLayout(
    12,
    "search_web",
    "query=abc",
    1500,
  );

  assertEquals(layout.durationText, "");
  assertEquals(layout.gapWidth, 0);
});

Deno.test("buildToolCallTextLayout hides sub-second durations to keep the row quiet", () => {
  const layout = buildToolCallTextLayout(
    40,
    "TaskCreate",
    "Remove screenshots from ~/Desktop",
    15,
  );

  assertEquals(layout.durationText, "");
  assertEquals(layout.gapWidth, 0);
});

Deno.test("resolveCollapsedToolList returns null for small groups", () => {
  const tools = Array.from({ length: 5 }, () => ({ status: "success" }));
  assertEquals(resolveCollapsedToolList(tools), null);
});

Deno.test("resolveCollapsedToolList returns null for running groups", () => {
  const tools = Array.from({ length: 8 }, (_, i) => ({
    status: i === 3 ? "running" : "success",
  }));
  assertEquals(resolveCollapsedToolList(tools), null);
});

Deno.test("resolveCollapsedToolList collapses large completed groups", () => {
  const tools = Array.from({ length: 10 }, () => ({ status: "success" }));
  const result = resolveCollapsedToolList(tools);
  assertEquals(result !== null, true);
  assertEquals(result!.visibleTools.length, 5);
  assertEquals(result!.hiddenCount, 5);
  assertEquals(result!.visibleTools.includes(0), true);
  assertEquals(result!.visibleTools.includes(1), true);
  assertEquals(result!.visibleTools.includes(9), true);
});

Deno.test("resolveCollapsedToolList always keeps error tools visible", () => {
  const tools = Array.from({ length: 8 }, (_, i) => ({
    status: i === 5 ? "error" : "success",
  }));
  const result = resolveCollapsedToolList(tools);
  assertEquals(result !== null, true);
  assertEquals(result!.visibleTools.includes(5), true);
});
