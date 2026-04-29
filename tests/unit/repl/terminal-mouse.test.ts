import { assertEquals } from "jsr:@std/assert@1";
import {
  getWheelScrollRows,
  getWheelScrollRowsFromInput,
  isTerminalMouseInput,
  isTerminalScrollInput,
  parseTerminalScrollAction,
  parseTerminalMouseWheel,
} from "../../../src/hlvm/cli/repl-ink/utils/terminal-mouse.ts";

Deno.test("parseTerminalMouseWheel parses SGR wheel events with or without escape prefix", () => {
  assertEquals(parseTerminalMouseWheel("\x1b[<64;10;5M"), {
    direction: "up",
    x: 10,
    y: 5,
  });
  assertEquals(parseTerminalMouseWheel("[<65;10;5M"), {
    direction: "down",
    x: 10,
    y: 5,
  });
});

Deno.test("parseTerminalMouseWheel ignores non-wheel and release events", () => {
  assertEquals(parseTerminalMouseWheel("[<0;10;5M"), null);
  assertEquals(parseTerminalMouseWheel("[<64;10;5m"), null);
  assertEquals(parseTerminalMouseWheel("hello"), null);
});

Deno.test("getWheelScrollRows maps wheel direction to transcript row deltas", () => {
  assertEquals(getWheelScrollRows("[<64;10;5M", 3), -3);
  assertEquals(getWheelScrollRows("[<65;10;5M", 3), 3);
  assertEquals(getWheelScrollRows("[<66;10;5M", 3), 0);
});

Deno.test("isTerminalMouseInput detects SGR mouse packets", () => {
  assertEquals(isTerminalMouseInput("\x1b[<64;10;5M"), true);
  assertEquals(isTerminalMouseInput("[<64;10;5M"), true);
  assertEquals(isTerminalMouseInput("[64;10;5M"), false);
});

Deno.test("getWheelScrollRowsFromInput sums batched SGR wheel packets", () => {
  assertEquals(
    getWheelScrollRowsFromInput("\x1b[<64;10;5M\x1b[<64;10;5M", 3),
    -6,
  );
  assertEquals(
    getWheelScrollRowsFromInput("\x1b[<65;10;5M\x1b[<64;10;5M", 3),
    0,
  );
});

Deno.test("parseTerminalScrollAction recognizes raw terminal paging keys", () => {
  assertEquals(parseTerminalScrollAction("\x1b[5~"), "page-up");
  assertEquals(parseTerminalScrollAction("[6~"), "page-down");
  assertEquals(parseTerminalScrollAction("\x1b[H"), "home");
  assertEquals(parseTerminalScrollAction("\x1bOH"), "home");
  assertEquals(parseTerminalScrollAction("\x1b[F"), "end");
  assertEquals(parseTerminalScrollAction("\x1bOF"), "end");
  assertEquals(parseTerminalScrollAction("x"), null);
});

Deno.test("isTerminalScrollInput detects paging keys and mouse packets", () => {
  assertEquals(isTerminalScrollInput("\x1b[5~"), true);
  assertEquals(isTerminalScrollInput("[<65;10;5M"), true);
  assertEquals(isTerminalScrollInput("normal text"), false);
});
