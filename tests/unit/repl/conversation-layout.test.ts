import { assertEquals } from "jsr:@std/assert@1";
import {
  buildToolCallTextLayout,
  buildToolGroupCountSlot,
  buildToolGroupProgressSlot,
  buildTurnStatsTextLayout,
  resolveCollapsedToolList,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/layout.ts";

Deno.test("buildToolGroupCountSlot keeps the count slot width stable across completion states", () => {
  const running = buildToolGroupCountSlot(3, 12, false);
  const complete = buildToolGroupCountSlot(12, 12, true);

  assertEquals(running.length, complete.length);
  assertEquals(running, "(3/12) ");
  assertEquals(complete, "(12)   ");
});

Deno.test("buildToolGroupProgressSlot keeps the progress count width stable", () => {
  const slot = buildToolGroupProgressSlot(7, 12);

  assertEquals(slot, "7/12 ");
});

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

Deno.test("buildTurnStatsTextLayout centers the summary between stable rules", () => {
  const layout = buildTurnStatsTextLayout(40, [
    "sonnet",
    "2 tools",
    "3.2s",
    "in 2.8k tokens",
  ]);

  assertEquals(layout.text, "sonnet · 2 tools · 3.2s · in 2.8k tokens");
  assertEquals(layout.leftRuleWidth, 0);
  assertEquals(layout.rightRuleWidth, 0);
});

Deno.test("buildTurnStatsTextLayout allocates rule width when the line has spare room", () => {
  const layout = buildTurnStatsTextLayout(52, [
    "sonnet",
    "2 tools",
    "3.2s",
  ]);

  assertEquals(layout.text, "sonnet · 2 tools · 3.2s");
  assertEquals(layout.leftRuleWidth + layout.rightRuleWidth, 27);
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
