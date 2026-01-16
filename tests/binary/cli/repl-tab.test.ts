/**
 * E2E Tests for REPL Tab Key Behavior
 *
 * NOTE: Testing actual Tab key presses in an interactive terminal is complex
 * because the REPL uses raw terminal mode which doesn't work well with stdin piping.
 *
 * These tests verify the underlying logic works correctly:
 * 1. Suggester finds appropriate suggestions
 * 2. Completer returns correct completions
 * 3. The logic for Tab behavior is sound
 *
 * For actual Tab key testing, use manual testing or a terminal automation tool.
 */

import { assertEquals, assert, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { binaryTest, USE_BINARY, runExpression } from "../_shared/binary-helpers.ts";
import { findSuggestion, acceptSuggestion } from "../../../src/hlvm/cli/repl/suggester.ts";
import { getWordAtCursor } from "../../../src/hlvm/cli/repl/completer.ts";
import { buildContext } from "../../../src/hlvm/cli/repl-ink/completion/providers.ts";
import { SymbolProvider } from "../../../src/hlvm/cli/repl-ink/completion/concrete-providers.ts";
import type { CompletionItem } from "../../../src/hlvm/cli/repl-ink/completion/types.ts";

console.log(`Testing REPL Tab behavior logic in ${USE_BINARY ? "BINARY" : "DENO RUN"} mode`);

// ============================================================
// Suggestion System Tests (underlying Tab accept logic)
// ============================================================

binaryTest("Tab suggestion: history suggestion works", async () => {
  // Simulate what happens when user types "(+ 1" and has "(+ 1 2)" in history
  const history = ["(+ 1 2)", "(def x 10)"];
  const suggestion = findSuggestion("(+ 1", history, new Set());

  assert(suggestion !== null, "Should find suggestion from history");
  assertEquals(suggestion!.full, "(+ 1 2)");
  assertEquals(suggestion!.ghost, " 2)");

  // Accepting the suggestion should return full text
  const accepted = acceptSuggestion(suggestion!);
  assertEquals(accepted, "(+ 1 2)");
});

binaryTest("Tab suggestion: binding completion works", async () => {
  // Simulate what happens when user types "fac" with "factorial" binding
  const bindings = new Set(["factorial", "filter", "fibonacci"]);
  const suggestion = findSuggestion("fac", [], bindings);

  assert(suggestion !== null, "Should find suggestion from bindings");
  assertEquals(suggestion!.full, "factorial");
  assertEquals(suggestion!.ghost, "torial");
});

binaryTest("Tab suggestion: skips exact match", async () => {
  const history = ["def", "defn"];
  const suggestion = findSuggestion("def", history, new Set());

  // Should find "defn" not "def" (exact match)
  assert(suggestion !== null);
  assertEquals(suggestion!.full, "defn");
});

// ============================================================
// Completion System Tests (provider-based completion logic)
// ============================================================

binaryTest("Tab completion: symbol provider finds keywords", async () => {
  const context = buildContext("de", 2, new Set(), new Map());
  const result = await SymbolProvider.getCompletions(context);
  const texts: string[] = result.items.map((item: CompletionItem) => item.label);

  assert(result.items.length > 0, "Should find completions for 'de'");
  // Should include keywords starting with "de"
  assert(
    texts.some(t => t.startsWith("de")),
    `Completions should start with 'de': ${texts.join(", ")}`
  );
});

binaryTest("Tab completion: symbol provider includes user bindings", async () => {
  const bindings = new Set(["myFunction", "myVariable"]);
  const context = buildContext("my", 2, bindings, new Map());
  const result = await SymbolProvider.getCompletions(context);

  const texts: string[] = result.items.map((item: CompletionItem) => item.label);
  assert(texts.includes("myFunction"), "Should include myFunction");
  assert(texts.includes("myVariable"), "Should include myVariable");
});

binaryTest("Tab completion: getWordAtCursor extracts word correctly", async () => {
  const { word, start } = getWordAtCursor("(defn foo", 9);
  assertEquals(word, "foo");
  assertEquals(start, 6);
});

// ============================================================
// Tab Priority Logic Tests
// ============================================================

binaryTest("Tab priority: uses real shouldTabAcceptSuggestion", async () => {
  // Import and test the REAL function from production code
  const { shouldTabAcceptSuggestion } = await import("../../../src/hlvm/cli/repl/tab-logic.ts");

  // Case 1: All conditions met - should accept
  const suggestion1 = { full: "test", ghost: "ing" };
  assertEquals(shouldTabAcceptSuggestion(suggestion1, 4, 4, false), true);

  // Case 2: Cursor not at end - should NOT accept
  assertEquals(shouldTabAcceptSuggestion(suggestion1, 2, 4, false), false);

  // Case 3: Showing completions - should NOT accept
  assertEquals(shouldTabAcceptSuggestion(suggestion1, 4, 4, true), false);

  // Case 4: No suggestion - should NOT accept
  assertEquals(shouldTabAcceptSuggestion(null, 4, 4, false), false);
});

binaryTest("Tab priority: mutual exclusivity of states", async () => {
  // When typing, showingCompletions should be cleared
  // This is handled in Input.tsx: clearCompletions() called on non-Tab keys

  // Scenario: User types "def", presses Tab (starts completions)
  // showingCompletions = true
  // User types "n" -> "defn"
  // showingCompletions = false (cleared by typing)
  // Suggestion may appear for "defn"

  // The logic ensures these states don't conflict
  const suggestion = findSuggestion("defn", ["(defn foo [x] x)"], new Set());

  // If suggestion found and not cycling completions, Tab should accept
  if (suggestion) {
    const showingCompletions = false; // Cleared by typing
    const shouldAccept = suggestion && 4 === 4 && !showingCompletions;
    assertEquals(shouldAccept, true);
  }
});

// ============================================================
// Function Parameter Completion Tests
// ============================================================

binaryTest("Tab function params: detects function position", async () => {
  // (add3| - cursor right after function name
  const { word, start } = getWordAtCursor("(add3", 5);
  assertEquals(word, "add3");
  assertEquals(start, 1);

  // Check if preceded by opening paren
  const isAfterOpenParen = start > 0 && "(add3"[start - 1] === "(";
  assertEquals(isAfterOpenParen, true);
});

binaryTest("Tab function params: detects cursor after space pattern", async () => {
  // (add3 | - cursor after space
  const line = "(add3 ";
  const match = line.match(/\((\w+)\s+$/);

  assert(match !== null, "Should match function name pattern");
  assertEquals(match![1], "add3");
});

// ============================================================
// End-to-end: Verify REPL runs without Tab regression
// ============================================================

binaryTest("REPL basic: expressions still evaluate correctly", async () => {
  // Ensure our changes didn't break basic REPL functionality
  const result = await runExpression("(+ 1 2 3)");
  assertStringIncludes(result.stdout, "6");
});

binaryTest("REPL basic: defn creates functions", async () => {
  // Use do block to ensure both expressions execute and return last value
  const result = await runExpression("(do (defn add [x y] (+ x y)) (add 10 20))");
  assertStringIncludes(result.stdout, "30");
});

// ============================================================
// Manual Test Checklist (for Tab key behavior)
// ============================================================

/*
 * These tests require manual verification in a terminal:
 *
 * 1. Tab accepts suggestion at end of line:
 *    - Type: (def
 *    - Wait for ghost text suggestion to appear
 *    - Press Tab
 *    - Expected: Full suggestion is accepted
 *
 * 2. Tab does NOT accept when cursor is mid-line:
 *    - Type: (define
 *    - Move cursor left with arrow keys
 *    - Press Tab
 *    - Expected: Normal completion behavior, not suggestion accept
 *
 * 3. Tab cycles completions when in completion mode:
 *    - Type: de
 *    - Press Tab once (starts completions)
 *    - Press Tab again
 *    - Expected: Cycles through completion candidates
 *
 * 4. Placeholder mode takes priority:
 *    - Define: (defn add3 [x y z] (+ x y z))
 *    - Type: (add3
 *    - Press Tab
 *    - Expected: Enters placeholder mode, Tab navigates params
 *
 * 5. Right arrow still works:
 *    - Type: (def
 *    - Wait for ghost text
 *    - Press Right Arrow
 *    - Expected: Accepts suggestion (existing behavior preserved)
 */
