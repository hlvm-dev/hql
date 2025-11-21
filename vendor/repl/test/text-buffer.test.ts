import {
  deleteWordLeft,
  deleteWordRight,
  findWordBoundaryLeft,
  findWordBoundaryRight,
} from "../src/text-buffer.ts";
import { assertEquals } from "@std/assert";

Deno.test("findWordBoundaryLeft handles whitespace and punctuation", () => {
  const line = "foo.bar baz";
  assertEquals(findWordBoundaryLeft(line, line.length), 8); // before baz
  assertEquals(findWordBoundaryLeft(line, 8), 4); // before bar
  assertEquals(findWordBoundaryLeft(line, 4), 3); // before dot
  assertEquals(findWordBoundaryLeft(line, 3), 0); // start of foo
});

Deno.test("findWordBoundaryRight handles whitespace and punctuation", () => {
  const line = "foo.bar baz";
  assertEquals(findWordBoundaryRight(line, 0), 3); // end of foo
  assertEquals(findWordBoundaryRight(line, 3), 4); // skip punctuation
  assertEquals(findWordBoundaryRight(line, 4), 7); // end of bar
  assertEquals(findWordBoundaryRight(line, 7), line.length); // whitespace jumps to next word end
  assertEquals(findWordBoundaryRight(line, line.length), line.length);
});

Deno.test("deleteWordLeft removes previous token", () => {
  const line = "set! value";
  const { line: out, cursor } = deleteWordLeft(line, 4);
  assertEquals(out, " value");
  assertEquals(cursor, 0);
});

Deno.test("deleteWordRight removes next token", () => {
  const line = "foo bar";
  const { line: out, cursor } = deleteWordRight(line, 3);
  assertEquals(out, "foo");
  assertEquals(cursor, 3);
});
