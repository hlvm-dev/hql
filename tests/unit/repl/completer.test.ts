/**
 * Unit tests for HQL REPL Completer
 * Tests: getWordAtCursor, isWordBoundary, getCompletions, applyCompletion
 */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  getWordAtCursor,
  isWordBoundary,
  getCompletions,
  applyCompletion,
} from "../../../src/cli/repl/completer.ts";

// ============================================================
// isWordBoundary()
// ============================================================

Deno.test("isWordBoundary: space is boundary", () => {
  assertEquals(isWordBoundary(" "), true);
});

Deno.test("isWordBoundary: parentheses are boundaries", () => {
  assertEquals(isWordBoundary("("), true);
  assertEquals(isWordBoundary(")"), true);
});

Deno.test("isWordBoundary: brackets are boundaries", () => {
  assertEquals(isWordBoundary("["), true);
  assertEquals(isWordBoundary("]"), true);
});

Deno.test("isWordBoundary: braces are boundaries", () => {
  assertEquals(isWordBoundary("{"), true);
  assertEquals(isWordBoundary("}"), true);
});

Deno.test("isWordBoundary: quotes are boundaries", () => {
  assertEquals(isWordBoundary('"'), true);
  assertEquals(isWordBoundary("'"), true);
});

Deno.test("isWordBoundary: semicolon is boundary", () => {
  assertEquals(isWordBoundary(";"), true);
});

Deno.test("isWordBoundary: comma is boundary", () => {
  assertEquals(isWordBoundary(","), true);
});

Deno.test("isWordBoundary: letters are NOT boundaries", () => {
  assertEquals(isWordBoundary("a"), false);
  assertEquals(isWordBoundary("Z"), false);
});

Deno.test("isWordBoundary: numbers are NOT boundaries", () => {
  assertEquals(isWordBoundary("0"), false);
  assertEquals(isWordBoundary("9"), false);
});

Deno.test("isWordBoundary: hyphen is NOT boundary (Lisp names)", () => {
  assertEquals(isWordBoundary("-"), false);
});

Deno.test("isWordBoundary: underscore is NOT boundary", () => {
  assertEquals(isWordBoundary("_"), false);
});

// ============================================================
// getWordAtCursor()
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

// ============================================================
// getCompletions()
// ============================================================

Deno.test("getCompletions: empty prefix returns empty", () => {
  const result = getCompletions("", new Set());
  assertEquals(result.length, 0);
});

Deno.test("getCompletions: matches keywords", () => {
  const result = getCompletions("de", new Set());
  // Should find keywords starting with "de" like "def", "defn"
  const texts = result.map(r => r.text);
  assert(texts.includes("def") || texts.includes("defn") || texts.includes("default"));
});

Deno.test("getCompletions: matches user bindings", () => {
  const bindings = new Set(["myCustomFunc", "myOtherFunc"]);
  const result = getCompletions("myC", bindings);
  const texts = result.map(r => r.text);
  assert(texts.includes("myCustomFunc"));
});

Deno.test("getCompletions: filters to prefix only", () => {
  const result = getCompletions("def", new Set());
  // All results should start with "def"
  for (const item of result) {
    assert(item.text.startsWith("def"), `${item.text} should start with "def"`);
  }
});

Deno.test("getCompletions: excludes exact match", () => {
  const result = getCompletions("def", new Set(["def"]));
  // Should NOT include exact match "def"
  const texts = result.map(r => r.text);
  assertEquals(texts.includes("def"), false);
});

Deno.test("getCompletions: limits results to 15", () => {
  // Use a prefix that matches many items
  const result = getCompletions("a", new Set());
  assert(result.length <= 15);
});

Deno.test("getCompletions: keywords sorted first", () => {
  const bindings = new Set(["definitelyCustom"]);
  const result = getCompletions("def", bindings);
  // If there are both keywords and variables, keywords should come first
  let sawVariable = false;
  for (const item of result) {
    if (item.type === "variable") sawVariable = true;
    if (item.type === "keyword" && sawVariable) {
      // Keyword after variable - wrong order
      assert(false, "Keywords should come before variables");
    }
  }
});

Deno.test("getCompletions: classifies types correctly", () => {
  const result = getCompletions("if", new Set());
  const ifItem = result.find(r => r.text === "if");
  if (ifItem) {
    assertEquals(ifItem.type, "keyword");
  }
});

// ============================================================
// applyCompletion()
// ============================================================

Deno.test("applyCompletion: replaces partial word", () => {
  const result = applyCompletion("(def", 4, { text: "defn", type: "keyword" });
  assertEquals(result.line, "(defn");
  assertEquals(result.cursorPos, 5);
});

Deno.test("applyCompletion: preserves text after cursor", () => {
  const result = applyCompletion("(de foo)", 3, { text: "defn", type: "keyword" });
  assertEquals(result.line, "(defn foo)");
  assertEquals(result.cursorPos, 5);
});

Deno.test("applyCompletion: handles cursor at end", () => {
  const result = applyCompletion("map", 3, { text: "mapcat", type: "function" });
  assertEquals(result.line, "mapcat");
  assertEquals(result.cursorPos, 6);
});

Deno.test("applyCompletion: handles completion with hyphen", () => {
  const result = applyCompletion("(when-", 6, { text: "when-let", type: "macro" });
  assertEquals(result.line, "(when-let");
  assertEquals(result.cursorPos, 9);
});

Deno.test("applyCompletion: updates cursor position correctly", () => {
  // Start: "(fi|)" cursor at position 3
  // Complete with "filter"
  const result = applyCompletion("(fi)", 3, { text: "filter", type: "function" });
  // Result: "(filter)"
  assertEquals(result.line, "(filter)");
  // Cursor should be after "filter" = 7
  assertEquals(result.cursorPos, 7);
});

// ============================================================
// Edge cases
// ============================================================

Deno.test("getCompletions: single character prefix", () => {
  // Single char should still work
  const result = getCompletions("d", new Set());
  assert(result.length > 0);
});

Deno.test("getCompletions: no matches returns empty", () => {
  const result = getCompletions("xyznonexistent", new Set());
  assertEquals(result.length, 0);
});

Deno.test("getWordAtCursor: multiple spaces", () => {
  const result = getWordAtCursor("hello   world", 8);
  assertEquals(result.word, "");
  assertEquals(result.start, 8);
});

Deno.test("applyCompletion: empty prefix completion", () => {
  // Completing from empty word (after space)
  const result = applyCompletion("(call ", 6, { text: "map", type: "function" });
  assertEquals(result.line, "(call map");
  assertEquals(result.cursorPos, 9);
});
