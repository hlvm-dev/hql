/**
 * Unit tests for HLVM REPL Suggester
 * Tests: findSuggestion, acceptSuggestion
 */

import { assertEquals } from "jsr:@std/assert";
import { findSuggestion, acceptSuggestion } from "../../../src/hlvm/cli/repl/suggester.ts";

// ============================================================
// findSuggestion() - Basic cases
// ============================================================

Deno.test("findSuggestion: empty input returns null", () => {
  const result = findSuggestion("", ["(+ 1 2)", "(def x 10)"], new Set());
  assertEquals(result, null);
});

Deno.test("findSuggestion: no match returns null", () => {
  const result = findSuggestion("xyz", ["(+ 1 2)", "(def x 10)"], new Set());
  assertEquals(result, null);
});

Deno.test("findSuggestion: matches exact start of history entry", () => {
  const result = findSuggestion("(+ 1", ["(+ 1 2)", "(def x 10)"], new Set());
  assertEquals(result?.full, "(+ 1 2)");
  assertEquals(result?.ghost, " 2)");
});

Deno.test("findSuggestion: skips exact match", () => {
  // Note: "(+ 1 2 3)" does NOT start with "(+ 1 2)" (position 6: space vs close paren)
  // Use inputs that actually match with startsWith
  const result = findSuggestion("(+ 1", ["(+ 1", "(+ 1 2)"], new Set());
  assertEquals(result?.full, "(+ 1 2)");
  assertEquals(result?.ghost, " 2)");
});

// ============================================================
// findSuggestion() - History priority
// ============================================================

Deno.test("findSuggestion: prefers most recent history entry", () => {
  const history = [
    "(def x 1)",  // oldest
    "(def x 2)",  // middle
    "(def x 3)",  // most recent
  ];
  const result = findSuggestion("(def x", history, new Set());
  assertEquals(result?.full, "(def x 3)");
  assertEquals(result?.ghost, " 3)");
});

Deno.test("findSuggestion: searches history backwards", () => {
  const history = [
    "(map inc [1 2])",  // oldest
    "(map dec [1 2])",  // most recent
  ];
  const result = findSuggestion("(map", history, new Set());
  // Should match most recent first
  assertEquals(result?.full, "(map dec [1 2])");
});

// ============================================================
// findSuggestion() - Binding completion
// ============================================================

Deno.test("findSuggestion: matches binding completion", () => {
  const bindings = new Set(["factorial", "fibonacci", "filter"]);
  const result = findSuggestion("fac", [], bindings);
  assertEquals(result?.full, "factorial");
  assertEquals(result?.ghost, "torial");
});

Deno.test("findSuggestion: binding requires 2+ chars", () => {
  const bindings = new Set(["factorial", "fibonacci"]);
  // Single char prefix should NOT match bindings
  const result = findSuggestion("f", [], bindings);
  assertEquals(result, null);
});

Deno.test("findSuggestion: binding exact match returns null", () => {
  const bindings = new Set(["map"]);
  const result = findSuggestion("map", [], bindings);
  assertEquals(result, null);
});

Deno.test("findSuggestion: bindings sorted for consistency", () => {
  const bindings = new Set(["zebra", "apple", "banana"]);
  const result = findSuggestion("ap", [], bindings);
  // Should return "apple" (first alphabetically)
  assertEquals(result?.full, "apple");
});

Deno.test("findSuggestion: binding completion preserves prefix", () => {
  const bindings = new Set(["my-function"]);
  const result = findSuggestion("(call my-fu", [], bindings);
  assertEquals(result?.full, "(call my-function");
  assertEquals(result?.ghost, "nction");
});

// ============================================================
// findSuggestion() - Multi-line handling
// ============================================================

Deno.test("findSuggestion: truncates multi-line suggestion", () => {
  const history = ["(defn foo [x]\n  (* x 2))"];
  const result = findSuggestion("(defn foo", history, new Set());
  // Should truncate at newline and add " ..."
  assertEquals(result?.ghost, " [x] ...");
});

Deno.test("findSuggestion: single line without truncation", () => {
  const history = ["(+ 1 2 3 4 5)"];
  const result = findSuggestion("(+ 1", history, new Set());
  assertEquals(result?.ghost, " 2 3 4 5)");
  // Should NOT contain "..."
  assertEquals(result?.ghost.includes("..."), false);
});

// ============================================================
// findSuggestion() - Binding priority over history
// ============================================================

Deno.test("findSuggestion: bindings checked before history", () => {
  const history = ["(define-foo 1)"];
  const bindings = new Set(["define-bar"]);
  // "define-" matches both, but bindings should be checked first
  const result = findSuggestion("define-", history, bindings);
  assertEquals(result?.full, "define-bar");
});

// ============================================================
// acceptSuggestion()
// ============================================================

Deno.test("acceptSuggestion: returns full text", () => {
  const suggestion = { full: "(+ 1 2)", ghost: " 2)" };
  const result = acceptSuggestion(suggestion);
  assertEquals(result, "(+ 1 2)");
});

Deno.test("acceptSuggestion: handles multi-line full", () => {
  const suggestion = { full: "(defn foo [x]\n  x)", ghost: " [x] ..." };
  const result = acceptSuggestion(suggestion);
  assertEquals(result, "(defn foo [x]\n  x)");
});

// ============================================================
// Edge cases
// ============================================================

Deno.test("findSuggestion: handles empty history", () => {
  const result = findSuggestion("(def", [], new Set(["defn"]));
  // Should still check bindings
  // Binding completion preserves line prefix: "(" + "defn" = "(defn"
  assertEquals(result?.full, "(defn");
  assertEquals(result?.ghost, "n");
});

Deno.test("findSuggestion: handles empty bindings", () => {
  const result = findSuggestion("(def", ["(def x 1)"], new Set());
  assertEquals(result?.full, "(def x 1)");
});

Deno.test("findSuggestion: handles both empty", () => {
  const result = findSuggestion("(def", [], new Set());
  assertEquals(result, null);
});

Deno.test("findSuggestion: whitespace in input", () => {
  const result = findSuggestion("(+ 1 ", ["(+ 1 2 3)"], new Set());
  assertEquals(result?.full, "(+ 1 2 3)");
  assertEquals(result?.ghost, "2 3)");
});

Deno.test("findSuggestion: special characters in history", () => {
  const history = ['(str "hello world")'];
  const result = findSuggestion('(str "hel', history, new Set());
  assertEquals(result?.full, '(str "hello world")');
});
