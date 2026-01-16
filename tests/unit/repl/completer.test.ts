/**
 * Unit tests for HLVM REPL Completer
 * Tests: getWordAtCursor
 *
 * Note: getCompletions and applyCompletion were legacy functions that have been
 * removed. The completion system now uses the unified provider architecture.
 */

import { assertEquals } from "jsr:@std/assert";
import { getWordAtCursor } from "../../../src/hlvm/cli/repl/completer.ts";

// ============================================================
// getWordAtCursor()
// (Also implicitly tests word boundary detection)
// ============================================================

Deno.test("getWordAtCursor: empty line returns empty word", () => {
  const result = getWordAtCursor("", 0);
  assertEquals(result.word, "");
  assertEquals(result.start, 0);
});

Deno.test("getWordAtCursor: cursor at start returns empty word", () => {
  const result = getWordAtCursor("hello", 0);
  assertEquals(result.word, "");
  assertEquals(result.start, 0);
});

Deno.test("getWordAtCursor: cursor at end of word", () => {
  const result = getWordAtCursor("hello", 5);
  assertEquals(result.word, "hello");
  assertEquals(result.start, 0);
});

Deno.test("getWordAtCursor: cursor in middle of word", () => {
  const result = getWordAtCursor("hello", 3);
  assertEquals(result.word, "hel");
  assertEquals(result.start, 0);
});

Deno.test("getWordAtCursor: respects word boundaries (parens)", () => {
  const result = getWordAtCursor("(defn foo", 9);
  assertEquals(result.word, "foo");
  assertEquals(result.start, 6);
});

Deno.test("getWordAtCursor: respects word boundaries (spaces)", () => {
  const result = getWordAtCursor("hello world", 11);
  assertEquals(result.word, "world");
  assertEquals(result.start, 6);
});

Deno.test("getWordAtCursor: after opening paren", () => {
  const result = getWordAtCursor("(def", 4);
  assertEquals(result.word, "def");
  assertEquals(result.start, 1);
});

Deno.test("getWordAtCursor: handles hyphenated names", () => {
  const result = getWordAtCursor("my-func-name", 12);
  assertEquals(result.word, "my-func-name");
  assertEquals(result.start, 0);
});

Deno.test("getWordAtCursor: cursor after space returns empty", () => {
  const result = getWordAtCursor("hello ", 6);
  assertEquals(result.word, "");
  assertEquals(result.start, 6);
});

Deno.test("getWordAtCursor: nested parens", () => {
  const result = getWordAtCursor("((nested))", 8);
  assertEquals(result.word, "nested");
  assertEquals(result.start, 2);
});

Deno.test("getWordAtCursor: multiple spaces", () => {
  const result = getWordAtCursor("hello   world", 8);
  assertEquals(result.word, "");
  assertEquals(result.start, 8);
});
