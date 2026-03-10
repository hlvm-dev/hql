import { assertEquals } from "jsr:@std/assert";
import {
  normalizeBufferedTextInput,
  stripTerminalControlBytes,
} from "../../../src/hlvm/cli/repl/input-normalization.ts";

Deno.test("input normalization: strips ANSI escapes while preserving text layout controls", () => {
  assertEquals(
    stripTerminalControlBytes("\x1b[31mhello\x1b[0m\rworld\n"),
    "hello\rworld\n",
  );
});

Deno.test("input normalization: multiline mode treats bare carriage returns as pasted line breaks", () => {
  assertEquals(
    normalizeBufferedTextInput("hello\rworld\rthird", "multiline"),
    "hello\nworld\nthird",
  );
});

Deno.test("input normalization: batched mode applies carriage-return overwrite semantics", () => {
  assertEquals(
    normalizeBufferedTextInput("h\rhe\rhel\rhelp", "batched"),
    "help",
  );
  assertEquals(
    normalizeBufferedTextInput("hello\rhe", "batched"),
    "hello",
  );
});

Deno.test("input normalization: batched mode keeps explicit newlines while resolving carriage returns", () => {
  assertEquals(
    normalizeBufferedTextInput("ab\rcd\ne\ref", "batched"),
    "cd\nef",
  );
});
