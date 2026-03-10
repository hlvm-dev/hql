import { assertEquals } from "jsr:@std/assert";
import { getHighlightSegments } from "../../../src/hlvm/cli/repl/syntax.ts";

Deno.test("syntax highlight: exposes function-position and bracket-emphasis segments for Ink rendering", () => {
  assertEquals(
    getHighlightSegments("(foo)", [0, 4]),
    [
      { value: "(", colorKey: "functionCall", bold: true },
      { value: "foo", colorKey: "functionCall" },
      { value: ")", colorKey: "functionCall", bold: true },
    ],
  );
});
