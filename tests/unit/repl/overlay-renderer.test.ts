import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildOverlayFrameText } from "../../../src/hlvm/cli/repl-ink/overlay/renderer.ts";

Deno.test("buildOverlayFrameText returns full-width borders", () => {
  const frame = buildOverlayFrameText(12);

  assertEquals(frame.top.length, 12);
  assertEquals(frame.bottom.length, 12);
  assertEquals(frame.top, "╭──────────╮");
  assertEquals(frame.bottom, "╰──────────╯");
});

Deno.test("buildOverlayFrameText can embed title and right text without changing width", () => {
  const frame = buildOverlayFrameText(24, {
    title: "Commands",
    rightText: "esc",
  });

  assertEquals(frame.top.length, 24);
  assertStringIncludes(frame.top, "Commands");
  assertStringIncludes(frame.top, "esc");
});
