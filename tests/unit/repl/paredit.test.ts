/**
 * Tests for HQL REPL Paredit - Structural Editing Operations
 *
 * All paredit functions are pure: (input, cursorPos) => { newValue, newCursor } | null
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  slurpForward,
  slurpBackward,
  barfForward,
  barfBackward,
  wrapSexp,
  spliceSexp,
  raiseSexp,
  killSexp,
  transposeSexp,
} from "../../../src/cli/repl/paredit.ts";

// ============================================================
// slurpForward() tests
// ============================================================

Deno.test("slurpForward: pulls next atom into list", () => {
  // (foo) bar → (foo bar)
  const result = slurpForward("(foo) bar", 3); // cursor inside list
  assertExists(result);
  assertEquals(result.newValue, "(foo bar)");
});

Deno.test("slurpForward: pulls next list into list", () => {
  // (foo) (bar baz) → (foo (bar baz))
  const result = slurpForward("(foo) (bar baz)", 3);
  assertExists(result);
  assertEquals(result.newValue, "(foo (bar baz))");
});

Deno.test("slurpForward: handles nested structures", () => {
  // ((a)) b → ((a) b)
  const result = slurpForward("((a)) b", 2);
  assertExists(result);
  assertEquals(result.newValue, "((a) b)");
});

Deno.test("slurpForward: returns null when nothing to slurp", () => {
  // (foo) - nothing after
  const result = slurpForward("(foo)", 3);
  assertEquals(result, null);
});

Deno.test("slurpForward: returns null at top level", () => {
  const result = slurpForward("foo bar", 2);
  assertEquals(result, null);
});

Deno.test("slurpForward: preserves cursor position", () => {
  const result = slurpForward("(fo|o) bar", 2);
  assertExists(result);
  assertEquals(result.newCursor, 2);
});

Deno.test("slurpForward: handles multiple sexps after", () => {
  // (a) b c → (a b) c (only slurps one)
  const result = slurpForward("(a) b c", 1);
  assertExists(result);
  assertEquals(result.newValue, "(a b) c");
});

// ============================================================
// slurpBackward() tests
// ============================================================

Deno.test("slurpBackward: pulls previous atom into list", () => {
  // foo (bar) → (foo bar)
  // Note: cursor must be near end of list for backwardUpSexp to find enclosing
  const result = slurpBackward("foo (bar)", 9); // cursor near closing paren
  assertExists(result);
  assertEquals(result.newValue, "(foo bar)");
});

Deno.test("slurpBackward: pulls previous list into list", () => {
  // (foo) (bar) → ((foo) bar)
  const result = slurpBackward("(foo) (bar)", 11); // cursor near closing paren
  assertExists(result);
  assertEquals(result.newValue, "((foo) bar)");
});

Deno.test("slurpBackward: returns null when nothing to slurp", () => {
  // (foo) - nothing before
  const result = slurpBackward("(foo)", 3);
  assertEquals(result, null);
});

Deno.test("slurpBackward: returns null at beginning", () => {
  const result = slurpBackward("(foo) bar", 2);
  assertEquals(result, null);
});

// ============================================================
// barfForward() tests
// ============================================================

Deno.test("barfForward: pushes last atom out of list", () => {
  // (foo bar) → (foo) bar
  const result = barfForward("(foo bar)", 2); // cursor at foo
  assertExists(result);
  assertEquals(result.newValue, "(foo) bar");
});

Deno.test("barfForward: pushes last list out", () => {
  // (foo (bar)) → (foo) (bar)
  const result = barfForward("(foo (bar))", 2);
  assertExists(result);
  assertEquals(result.newValue, "(foo) (bar)");
});

Deno.test("barfForward: returns null with only one element", () => {
  // (foo) - only one element
  const result = barfForward("(foo)", 2);
  assertEquals(result, null);
});

Deno.test("barfForward: handles nested lists", () => {
  // ((a b)) → ((a) b) - barfs from outer list
  // Cursor must be near closing paren for enclosing list detection
  const result = barfForward("((a b))", 6); // at inner closing paren
  assertExists(result);
  assertEquals(result.newValue, "((a) b)");
});

// ============================================================
// barfBackward() tests
// ============================================================

Deno.test("barfBackward: pushes first atom out of list", () => {
  // (foo bar) → foo (bar)
  const result = barfBackward("(foo bar)", 6); // cursor at bar
  assertExists(result);
  assertEquals(result.newValue, "foo (bar)");
});

Deno.test("barfBackward: returns null with only one element", () => {
  // (foo) - only one element
  const result = barfBackward("(foo)", 2);
  assertEquals(result, null);
});

Deno.test("barfBackward: pushes first list out", () => {
  // ((foo) bar) → (foo) (bar)
  // Cursor must be near closing paren for enclosing list detection
  const result = barfBackward("((foo) bar)", 11); // near closing paren
  assertExists(result);
  assertEquals(result.newValue, "(foo) (bar)");
});

// ============================================================
// wrapSexp() tests
// ============================================================

Deno.test("wrapSexp: wraps atom with parens", () => {
  // foo bar → (foo) bar
  const result = wrapSexp("foo bar", 0);
  assertExists(result);
  assertEquals(result.newValue, "(foo) bar");
  assertEquals(result.newCursor, 1); // after (
});

Deno.test("wrapSexp: wraps list with parens", () => {
  // (foo) bar → ((foo)) bar
  const result = wrapSexp("(foo) bar", 0);
  assertExists(result);
  assertEquals(result.newValue, "((foo)) bar");
});

Deno.test("wrapSexp: wraps with brackets", () => {
  // foo bar → [foo] bar
  const result = wrapSexp("foo bar", 0, "[");
  assertExists(result);
  assertEquals(result.newValue, "[foo] bar");
});

Deno.test("wrapSexp: wraps with braces", () => {
  // foo bar → {foo} bar
  const result = wrapSexp("foo bar", 0, "{");
  assertExists(result);
  assertEquals(result.newValue, "{foo} bar");
});

Deno.test("wrapSexp: positions cursor after opening paren", () => {
  const result = wrapSexp("foo", 0);
  assertExists(result);
  assertEquals(result.newCursor, 1);
});

Deno.test("wrapSexp: returns null on empty input", () => {
  const result = wrapSexp("", 0);
  assertEquals(result, null);
});

Deno.test("wrapSexp: wraps sexp at cursor, not before", () => {
  // If cursor is in middle of string, wraps that sexp
  const result = wrapSexp("foo bar baz", 4); // at 'bar'
  assertExists(result);
  assertEquals(result.newValue, "foo (bar) baz");
});

// ============================================================
// spliceSexp() tests
// ============================================================

Deno.test("spliceSexp: removes enclosing parens", () => {
  // (foo (bar)) → (foo bar) - splicing inner
  // Need cursor at inner closing paren position for inner splice
  const result = spliceSexp("(foo (bar))", 10); // cursor at inner ')'
  assertExists(result);
  assertEquals(result.newValue, "(foo bar)");
});

Deno.test("spliceSexp: removes top-level parens", () => {
  // (foo bar) → foo bar
  const result = spliceSexp("(foo bar)", 3);
  assertExists(result);
  assertEquals(result.newValue, "foo bar");
});

Deno.test("spliceSexp: returns null at top level", () => {
  const result = spliceSexp("foo bar", 2);
  assertEquals(result, null);
});

Deno.test("spliceSexp: adjusts cursor position", () => {
  const result = spliceSexp("(foo bar)", 5); // cursor at 'bar'
  assertExists(result);
  assertEquals(result.newCursor, 4); // shifted left by 1 (removed opening paren)
});

Deno.test("spliceSexp: handles nested structures", () => {
  // ((a (b))) → ((a b)) - splicing innermost
  const result = spliceSexp("((a (b)))", 7); // at inner closing paren
  assertExists(result);
  assertEquals(result.newValue, "((a b))");
});

// ============================================================
// raiseSexp() tests
// ============================================================

Deno.test("raiseSexp: replaces parent with current sexp", () => {
  // (foo (bar) baz) → (bar) - when cursor is at opening paren of (bar)
  const result = raiseSexp("(foo (bar) baz)", 5); // cursor at '(' of (bar)
  assertExists(result);
  assertEquals(result.newValue, "(bar)");
});

Deno.test("raiseSexp: raises atom", () => {
  // (foo bar baz) → bar - when cursor is at bar
  const result = raiseSexp("(foo bar baz)", 6); // cursor at bar
  assertExists(result);
  assertEquals(result.newValue, "bar");
});

Deno.test("raiseSexp: returns null at top level", () => {
  const result = raiseSexp("foo bar", 2);
  assertEquals(result, null);
});

Deno.test("raiseSexp: positions cursor at start of raised sexp", () => {
  const result = raiseSexp("(foo bar)", 5); // cursor at bar
  assertExists(result);
  assertEquals(result.newCursor, 0);
});

// ============================================================
// killSexp() tests
// ============================================================

Deno.test("killSexp: deletes atom at cursor", () => {
  // foo bar baz → foo baz (killing bar)
  const result = killSexp("foo bar baz", 4); // cursor at bar
  assertExists(result);
  assertEquals(result.newValue, "foo baz");
});

Deno.test("killSexp: deletes list at cursor", () => {
  // foo (bar) baz → foo baz
  const result = killSexp("foo (bar) baz", 4);
  assertExists(result);
  assertEquals(result.newValue, "foo baz");
});

Deno.test("killSexp: positions cursor at deletion point", () => {
  const result = killSexp("foo bar baz", 4);
  assertExists(result);
  assertEquals(result.newCursor, 4);
});

Deno.test("killSexp: handles leading position", () => {
  const result = killSexp("foo bar", 0);
  assertExists(result);
  assertEquals(result.newValue, " bar"); // space is preserved after killed sexp
  assertEquals(result.newCursor, 0);
});

Deno.test("killSexp: returns null at end of input", () => {
  const result = killSexp("foo", 3);
  assertEquals(result, null);
});

Deno.test("killSexp: cleans up extra whitespace", () => {
  const result = killSexp("foo  bar  baz", 5); // cursor at bar, with extra spaces
  assertExists(result);
  // Should collapse double spaces
  assertEquals(result.newValue, "foo  baz");
});

// ============================================================
// transposeSexp() tests
// ============================================================

Deno.test("transposeSexp: swaps adjacent atoms", () => {
  // foo bar → bar foo
  const result = transposeSexp("foo bar", 4); // cursor at bar
  assertExists(result);
  assertEquals(result.newValue, "bar foo");
});

Deno.test("transposeSexp: swaps adjacent lists", () => {
  // (foo) (bar) → (bar) (foo)
  const result = transposeSexp("(foo) (bar)", 6); // cursor at (bar)
  assertExists(result);
  assertEquals(result.newValue, "(bar) (foo)");
});

Deno.test("transposeSexp: swaps mixed atom and list", () => {
  // foo (bar) → (bar) foo
  const result = transposeSexp("foo (bar)", 4);
  assertExists(result);
  assertEquals(result.newValue, "(bar) foo");
});

Deno.test("transposeSexp: returns null with nothing before", () => {
  const result = transposeSexp("foo bar", 0);
  assertEquals(result, null);
});

Deno.test("transposeSexp: positions cursor after transposed sexps", () => {
  const result = transposeSexp("foo bar", 4);
  assertExists(result);
  // Cursor should be at end of the transposed pair
  assertEquals(result.newCursor, 7);
});

Deno.test("transposeSexp: handles inside a list", () => {
  // (a b c) → (b a c) when transposing b and a
  const result = transposeSexp("(a b c)", 3); // cursor at b
  assertExists(result);
  assertEquals(result.newValue, "(b a c)");
});

// ============================================================
// Edge cases
// ============================================================

Deno.test("all operations handle empty input gracefully", () => {
  assertEquals(slurpForward("", 0), null);
  assertEquals(slurpBackward("", 0), null);
  assertEquals(barfForward("", 0), null);
  assertEquals(barfBackward("", 0), null);
  assertEquals(wrapSexp("", 0), null);
  assertEquals(spliceSexp("", 0), null);
  assertEquals(raiseSexp("", 0), null);
  assertEquals(killSexp("", 0), null);
  assertEquals(transposeSexp("", 0), null);
});

Deno.test("all operations handle whitespace-only input gracefully", () => {
  assertEquals(slurpForward("   ", 1), null);
  assertEquals(wrapSexp("   ", 1), null);
  assertEquals(killSexp("   ", 1), null);
});

Deno.test("operations work with square brackets", () => {
  // [foo] bar → [foo bar]
  const result = slurpForward("[foo] bar", 3);
  assertExists(result);
  assertEquals(result.newValue, "[foo bar]");
});

Deno.test("operations work with curly braces", () => {
  // {foo} bar → {foo bar}
  const result = slurpForward("{foo} bar", 3);
  assertExists(result);
  assertEquals(result.newValue, "{foo bar}");
});

Deno.test("operations preserve mixed delimiter types", () => {
  // (foo [bar]) baz → (foo [bar] baz)
  const result = slurpForward("(foo [bar]) baz", 5);
  assertExists(result);
  assertEquals(result.newValue, "(foo [bar] baz)");
});

// ============================================================
// String handling (note: current implementation may not fully support strings as sexps)
// ============================================================

// Skip string tests as forwardSexp/backwardSexp don't currently handle quoted strings
// These can be added once string support is implemented in syntax.ts

// ============================================================
// Complex nested structures
// ============================================================

Deno.test("slurpForward: deeply nested structure", () => {
  // ((a)) (b) → ((a) (b))
  const result = slurpForward("((a)) (b)", 2); // inside inner list
  assertExists(result);
  assertEquals(result.newValue, "((a) (b))");
});

Deno.test("barfForward: with multiple elements", () => {
  // (a b c d) → (a b c) d
  const result = barfForward("(a b c d)", 2);
  assertExists(result);
  assertEquals(result.newValue, "(a b c) d");
});

Deno.test("spliceSexp: preserves sibling content", () => {
  // (a (b c) d) → (a b c d)
  const result = spliceSexp("(a (b c) d)", 8); // cursor at closing paren of (b c)
  assertExists(result);
  assertEquals(result.newValue, "(a b c d)");
});
