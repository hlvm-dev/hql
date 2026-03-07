import { assertEquals } from "jsr:@std/assert";
import { getWordAtCursor } from "../../../src/hlvm/cli/repl/string-utils.ts";

Deno.test("completer: empty and start-of-line cursors produce no current word", () => {
  assertEquals(getWordAtCursor("", 0), { word: "", start: 0 });
  assertEquals(getWordAtCursor("hello", 0), { word: "", start: 0 });
  assertEquals(getWordAtCursor("hello ", 6), { word: "", start: 6 });
  assertEquals(getWordAtCursor("hello   world", 8), { word: "", start: 8 });
});

Deno.test("completer: word extraction respects cursor position within simple identifiers", () => {
  assertEquals(getWordAtCursor("hello", 5), { word: "hello", start: 0 });
  assertEquals(getWordAtCursor("hello", 3), { word: "hel", start: 0 });
  assertEquals(getWordAtCursor("my-func-name", 12), { word: "my-func-name", start: 0 });
});

Deno.test("completer: word extraction honors paren and space boundaries", () => {
  assertEquals(getWordAtCursor("(defn foo", 9), { word: "foo", start: 6 });
  assertEquals(getWordAtCursor("(def", 4), { word: "def", start: 1 });
  assertEquals(getWordAtCursor("hello world", 11), { word: "world", start: 6 });
  assertEquals(getWordAtCursor("((nested))", 8), { word: "nested", start: 2 });
});
