import { assertEquals } from "jsr:@std/assert@1";
import {
  isTerminalMouseInput,
  isTerminalScrollInput,
  parseTerminalScrollAction,
} from "../../../src/hlvm/cli/repl-ink/utils/terminal-scroll.ts";

Deno.test("parseTerminalScrollAction recognizes raw terminal paging keys", () => {
  assertEquals(parseTerminalScrollAction("\x1b[5~"), "page-up");
  assertEquals(parseTerminalScrollAction("[6~"), "page-down");
  assertEquals(parseTerminalScrollAction("\x1b[H"), "home");
  assertEquals(parseTerminalScrollAction("\x1bOH"), "home");
  assertEquals(parseTerminalScrollAction("\x1b[F"), "end");
  assertEquals(parseTerminalScrollAction("\x1bOF"), "end");
  assertEquals(parseTerminalScrollAction("x"), null);
});

Deno.test("isTerminalScrollInput detects paging keys and stale mouse packets", () => {
  assertEquals(isTerminalScrollInput("\x1b[5~"), true);
  assertEquals(isTerminalScrollInput("[<65;10;5M"), true);
  assertEquals(isTerminalScrollInput("normal text"), false);
});

Deno.test("isTerminalMouseInput detects SGR mouse packets without enabling mouse mode", () => {
  assertEquals(isTerminalMouseInput("\x1b[<64;10;5M"), true);
  assertEquals(isTerminalMouseInput("[<64;10;5M"), true);
  assertEquals(isTerminalMouseInput("[64;10;5M"), false);
});
