import { assertEquals } from "jsr:@std/assert";
import { getTerminalClearSequence } from "../../../src/hlvm/cli/ansi.ts";

Deno.test("getTerminalClearSequence clears viewport without scrollback by default override", () => {
  assertEquals(
    getTerminalClearSequence({ clearScrollback: false }),
    "\x1b[2J\x1b[H",
  );
});

Deno.test("getTerminalClearSequence clears viewport and scrollback by default", () => {
  assertEquals(
    getTerminalClearSequence(),
    "\x1b[3J\x1b[2J\x1b[H",
  );
});
