import { assertEquals } from "jsr:@std/assert@1";
import {
  buildToolCallTextLayout,
  buildToolGroupCountSlot,
  buildToolGroupProgressSlot,
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
