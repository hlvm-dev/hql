/**
 * Unit tests for HQL REPL Tab Handler Logic
 *
 * Tests the REAL shouldTabAcceptSuggestion function from tab-logic.ts
 * NOT a mock - this tests actual production code.
 */

import { assertEquals, assert } from "jsr:@std/assert";
import { shouldTabAcceptSuggestion } from "../../../src/cli/repl/tab-logic.ts";
import { findSuggestion, acceptSuggestion } from "../../../src/cli/repl/suggester.ts";
import { getCompletions, getWordAtCursor } from "../../../src/cli/repl/completer.ts";

// ============================================================
// shouldTabAcceptSuggestion() - Testing REAL production code
// ============================================================

Deno.test("shouldTabAcceptSuggestion: accepts when all conditions met", () => {
  const suggestion = { full: "(+ 1 2)", ghost: " 2)" };
  const result = shouldTabAcceptSuggestion(suggestion, 4, 4, false);
  assertEquals(result, true);
});

Deno.test("shouldTabAcceptSuggestion: rejects when cursor not at end", () => {
  const suggestion = { full: "(+ 1 2)", ghost: " 2)" };
  const result = shouldTabAcceptSuggestion(suggestion, 2, 4, false);
  assertEquals(result, false);
});

Deno.test("shouldTabAcceptSuggestion: rejects when in completion mode", () => {
  const suggestion = { full: "(+ 1 2)", ghost: " 2)" };
  const result = shouldTabAcceptSuggestion(suggestion, 4, 4, true);
  assertEquals(result, false);
});

Deno.test("shouldTabAcceptSuggestion: rejects when no suggestion", () => {
  const result = shouldTabAcceptSuggestion(null, 4, 4, false);
  assertEquals(result, false);
});

Deno.test("shouldTabAcceptSuggestion: all condition combinations", () => {
  // Exhaustive test of condition logic
  const testCases = [
    // suggestion, cursor, length, showing, expected
    { suggestion: { full: "a", ghost: "b" }, cursor: 1, length: 1, showing: false, expected: true },
    { suggestion: { full: "a", ghost: "b" }, cursor: 0, length: 1, showing: false, expected: false },
    { suggestion: { full: "a", ghost: "b" }, cursor: 1, length: 1, showing: true, expected: false },
    { suggestion: null, cursor: 1, length: 1, showing: false, expected: false },
    { suggestion: null, cursor: 0, length: 0, showing: false, expected: false },
    { suggestion: null, cursor: 0, length: 0, showing: true, expected: false },
  ];

  for (const tc of testCases) {
    const result = shouldTabAcceptSuggestion(tc.suggestion, tc.cursor, tc.length, tc.showing);
    assertEquals(result, tc.expected,
      `suggestion=${tc.suggestion !== null}, cursor=${tc.cursor}, length=${tc.length}, showing=${tc.showing}`);
  }
});

// ============================================================
// Integration: shouldTabAcceptSuggestion with real suggester
// ============================================================

Deno.test("integration: Tab decision with real findSuggestion", () => {
  // Real scenario: user types "(defn", history has "(defn foo [x] x)"
  // Note: findSuggestion uses startsWith, so input must be prefix of history
  const value = "(defn";
  const suggestion = findSuggestion(value, ["(defn foo [x] x)"], new Set());

  // Verify suggestion was found
  assert(suggestion !== null, "findSuggestion should find history match");

  // Verify Tab decision logic
  const shouldAccept = shouldTabAcceptSuggestion(
    suggestion,
    value.length,  // cursor at end
    value.length,  // value length
    false          // not showing completions
  );
  assertEquals(shouldAccept, true);
});

Deno.test("integration: Tab rejects during completion cycling", () => {
  // Note: findSuggestion uses startsWith, so input must be prefix of history
  const value = "(def";
  const suggestion = findSuggestion(value, ["(def x 1)"], new Set());

  assert(suggestion !== null);

  // User is already in completion cycling mode
  const shouldAccept = shouldTabAcceptSuggestion(
    suggestion,
    value.length,
    value.length,
    true  // showingCompletions = true
  );
  assertEquals(shouldAccept, false, "Should NOT accept when cycling completions");
});

// ============================================================
// Real acceptSuggestion tests (not mocked)
// ============================================================

Deno.test("acceptSuggestion: returns full suggestion text", () => {
  const suggestion = { full: "(defn factorial [n] (* n 1))", ghost: "n factorial [n] (* n 1))" };
  const result = acceptSuggestion(suggestion);
  assertEquals(result, "(defn factorial [n] (* n 1))");
});

Deno.test("acceptSuggestion: end-to-end with findSuggestion", () => {
  const bindings = new Set(["my-awesome-function"]);
  const suggestion = findSuggestion("my-aw", [], bindings);

  assert(suggestion !== null);
  const accepted = acceptSuggestion(suggestion!);
  assertEquals(accepted, "my-awesome-function");
});

// ============================================================
// Real getWordAtCursor tests (validates Tab context detection)
// ============================================================

Deno.test("getWordAtCursor: function position detection", () => {
  const { word, start } = getWordAtCursor("(add3", 5);
  assertEquals(word, "add3");
  assertEquals(start, 1);
  // Verify it's after opening paren (function position)
  assertEquals("(add3"[start - 1], "(");
});

Deno.test("getWordAtCursor: cursor after space pattern", () => {
  const { word, start } = getWordAtCursor("(add3 ", 6);
  assertEquals(word, "");
  assertEquals(start, 6);
  // Verify pattern match works
  const match = "(add3 ".match(/\((\w+)\s+$/);
  assert(match !== null);
  assertEquals(match![1], "add3");
});

// ============================================================
// Real getCompletions tests (validates completion system)
// ============================================================

Deno.test("getCompletions: returns real completions", () => {
  const completions = getCompletions("de", new Set());
  assert(completions.length > 0, "Should find completions for 'de'");
  // Verify they're real keyword completions
  const hasKeyword = completions.some(c => c.type === "keyword");
  assert(hasKeyword, "Should include keyword completions");
});

Deno.test("getCompletions: includes user bindings", () => {
  const bindings = new Set(["define-my-thing"]);
  const completions = getCompletions("define", bindings);
  const found = completions.find(c => c.text === "define-my-thing");
  assert(found !== undefined, "Should include user binding");
  assertEquals(found!.type, "variable");
});

// ============================================================
// Suggestion and Completion are separate systems
// ============================================================

Deno.test("suggestion vs completion: independent systems", () => {
  const input = "ma";
  const bindings = new Set(["map-fn", "max-value"]);

  // Get suggestion (fish-style autosuggestion)
  const suggestion = findSuggestion(input, [], bindings);

  // Get completions (tab completion)
  const completions = getCompletions(input, bindings);

  // Both work independently
  assert(suggestion !== null, "Should have suggestion");
  assert(completions.length > 0, "Should have completions");

  // Suggestion returns single best match
  assertEquals(suggestion?.full, "map-fn");

  // Completions return all matches
  assert(completions.some(c => c.text === "map-fn"));
  assert(completions.some(c => c.text === "max-value"));
});
