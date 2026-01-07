/**
 * Unit tests for HQL REPL Keyboard Handling
 *
 * Tests cross-platform keyboard shortcuts:
 * - macOS: Option+Arrow (meta=true, input='b'/'f')
 * - Linux: Alt+Arrow (meta=true, input='b'/'f' or modified arrows)
 * - Windows: Ctrl+Arrow (ctrl=true, leftArrow/rightArrow)
 * - ESC sequences: Two-event fallback
 */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  calculateWordBackPosition,
  calculateWordForwardPosition,
  mapKeyToAction,
  createMockKeyEvent,
  isWordNavigationKey,
  type KeyEvent,
} from "../../../src/cli/repl/keyboard.ts";

// ============================================================
// calculateWordBackPosition() tests
// ============================================================

Deno.test("calculateWordBackPosition: from end of single word", () => {
  assertEquals(calculateWordBackPosition("hello", 5), 0);
});

Deno.test("calculateWordBackPosition: from middle of word", () => {
  assertEquals(calculateWordBackPosition("hello", 3), 0);
});

Deno.test("calculateWordBackPosition: with leading space", () => {
  assertEquals(calculateWordBackPosition("  hello", 7), 2);
});

Deno.test("calculateWordBackPosition: multiple words - from end", () => {
  assertEquals(calculateWordBackPosition("hello world", 11), 6);
});

Deno.test("calculateWordBackPosition: multiple words - skip word", () => {
  assertEquals(calculateWordBackPosition("hello world test", 16), 12);
});

Deno.test("calculateWordBackPosition: at start returns 0", () => {
  assertEquals(calculateWordBackPosition("hello", 0), 0);
});

Deno.test("calculateWordBackPosition: from space after word", () => {
  assertEquals(calculateWordBackPosition("hello ", 6), 0);
});

Deno.test("calculateWordBackPosition: multiple spaces between words", () => {
  assertEquals(calculateWordBackPosition("hello   world", 13), 8);
});

Deno.test("calculateWordBackPosition: empty string", () => {
  assertEquals(calculateWordBackPosition("", 0), 0);
});

Deno.test("calculateWordBackPosition: cursor in middle of multi-word", () => {
  // "hello world" cursor at 'o' in 'world' (pos 8)
  assertEquals(calculateWordBackPosition("hello world", 8), 6);
});

// ============================================================
// calculateWordForwardPosition() tests
// ============================================================

Deno.test("calculateWordForwardPosition: from start of single word", () => {
  assertEquals(calculateWordForwardPosition("hello", 0), 5);
});

Deno.test("calculateWordForwardPosition: from middle of word", () => {
  assertEquals(calculateWordForwardPosition("hello", 2), 5);
});

Deno.test("calculateWordForwardPosition: multiple words - to next word", () => {
  assertEquals(calculateWordForwardPosition("hello world", 0), 6);
});

Deno.test("calculateWordForwardPosition: at end returns length", () => {
  assertEquals(calculateWordForwardPosition("hello", 5), 5);
});

Deno.test("calculateWordForwardPosition: from space to next word", () => {
  assertEquals(calculateWordForwardPosition("hello world", 5), 6);
});

Deno.test("calculateWordForwardPosition: multiple spaces", () => {
  assertEquals(calculateWordForwardPosition("hello   world", 5), 8);
});

Deno.test("calculateWordForwardPosition: empty string", () => {
  assertEquals(calculateWordForwardPosition("", 0), 0);
});

Deno.test("calculateWordForwardPosition: skip to third word", () => {
  assertEquals(calculateWordForwardPosition("one two three", 4), 8);
});

// ============================================================
// mapKeyToAction() - macOS Option+Arrow tests
// ============================================================

Deno.test("mapKeyToAction: macOS Option+Left (meta=true, input='b')", () => {
  const key = createMockKeyEvent({ meta: true });
  assertEquals(mapKeyToAction("b", key), "move-word-back");
});

Deno.test("mapKeyToAction: macOS Option+Right (meta=true, input='f')", () => {
  const key = createMockKeyEvent({ meta: true });
  assertEquals(mapKeyToAction("f", key), "move-word-forward");
});

Deno.test("mapKeyToAction: macOS Option+Enter (meta=true, return=true)", () => {
  const key = createMockKeyEvent({ meta: true, return: true });
  assertEquals(mapKeyToAction("", key), "insert-newline");
});

Deno.test("mapKeyToAction: macOS Option+Backspace (meta=true, backspace=true)", () => {
  const key = createMockKeyEvent({ meta: true, backspace: true });
  assertEquals(mapKeyToAction("", key), "delete-word-back");
});

// ============================================================
// mapKeyToAction() - Windows/Linux Ctrl+Arrow tests
// ============================================================

Deno.test("mapKeyToAction: Windows Ctrl+Left (ctrl=true, leftArrow=true)", () => {
  const key = createMockKeyEvent({ ctrl: true, leftArrow: true });
  assertEquals(mapKeyToAction("", key), "move-word-back");
});

Deno.test("mapKeyToAction: Windows Ctrl+Right (ctrl=true, rightArrow=true)", () => {
  const key = createMockKeyEvent({ ctrl: true, rightArrow: true });
  assertEquals(mapKeyToAction("", key), "move-word-forward");
});

Deno.test("mapKeyToAction: Ctrl+A (move to line start)", () => {
  const key = createMockKeyEvent({ ctrl: true });
  assertEquals(mapKeyToAction("a", key), "move-line-start");
});

Deno.test("mapKeyToAction: Ctrl+E (move to line end)", () => {
  const key = createMockKeyEvent({ ctrl: true });
  assertEquals(mapKeyToAction("e", key), "move-line-end");
});

Deno.test("mapKeyToAction: Ctrl+W (delete word back)", () => {
  const key = createMockKeyEvent({ ctrl: true });
  assertEquals(mapKeyToAction("w", key), "delete-word-back");
});

Deno.test("mapKeyToAction: Ctrl+U (delete to line start)", () => {
  const key = createMockKeyEvent({ ctrl: true });
  assertEquals(mapKeyToAction("u", key), "delete-to-start");
});

Deno.test("mapKeyToAction: Ctrl+K (delete to line end)", () => {
  const key = createMockKeyEvent({ ctrl: true });
  assertEquals(mapKeyToAction("k", key), "delete-to-end");
});

Deno.test("mapKeyToAction: Ctrl+L (clear screen)", () => {
  const key = createMockKeyEvent({ ctrl: true });
  assertEquals(mapKeyToAction("l", key), "clear-screen");
});

// ============================================================
// mapKeyToAction() - ESC sequences (same event)
// ============================================================

Deno.test("mapKeyToAction: ESC+Left in same event", () => {
  const key = createMockKeyEvent({ escape: true, leftArrow: true });
  assertEquals(mapKeyToAction("", key), "move-word-back");
});

Deno.test("mapKeyToAction: ESC+Right in same event", () => {
  const key = createMockKeyEvent({ escape: true, rightArrow: true });
  assertEquals(mapKeyToAction("", key), "move-word-forward");
});

Deno.test("mapKeyToAction: ESC+b in same event", () => {
  const key = createMockKeyEvent({ escape: true });
  assertEquals(mapKeyToAction("b", key), "move-word-back");
});

Deno.test("mapKeyToAction: ESC+f in same event", () => {
  const key = createMockKeyEvent({ escape: true });
  assertEquals(mapKeyToAction("f", key), "move-word-forward");
});

Deno.test("mapKeyToAction: ESC+Enter in same event", () => {
  const key = createMockKeyEvent({ escape: true, return: true });
  assertEquals(mapKeyToAction("", key), "insert-newline");
});

Deno.test("mapKeyToAction: pure ESC returns escape action", () => {
  const key = createMockKeyEvent({ escape: true });
  assertEquals(mapKeyToAction("", key), "escape");
});

// ============================================================
// mapKeyToAction() - ESC sequences (two events)
// ============================================================

Deno.test("mapKeyToAction: ESC then Left (two events)", () => {
  const key = createMockKeyEvent({ leftArrow: true });
  assertEquals(mapKeyToAction("", key, true), "move-word-back");
});

Deno.test("mapKeyToAction: ESC then Right (two events)", () => {
  const key = createMockKeyEvent({ rightArrow: true });
  assertEquals(mapKeyToAction("", key, true), "move-word-forward");
});

Deno.test("mapKeyToAction: ESC then 'b' (two events)", () => {
  const key = createMockKeyEvent();
  assertEquals(mapKeyToAction("b", key, true), "move-word-back");
});

Deno.test("mapKeyToAction: ESC then 'f' (two events)", () => {
  const key = createMockKeyEvent();
  assertEquals(mapKeyToAction("f", key, true), "move-word-forward");
});

Deno.test("mapKeyToAction: ESC then Enter (two events)", () => {
  const key = createMockKeyEvent({ return: true });
  assertEquals(mapKeyToAction("", key, true), "insert-newline");
});

// ============================================================
// mapKeyToAction() - Basic navigation keys
// ============================================================

Deno.test("mapKeyToAction: Left arrow (no modifier)", () => {
  const key = createMockKeyEvent({ leftArrow: true });
  assertEquals(mapKeyToAction("", key), "move-char-left");
});

Deno.test("mapKeyToAction: Right arrow (no modifier)", () => {
  const key = createMockKeyEvent({ rightArrow: true });
  assertEquals(mapKeyToAction("", key), "move-char-right");
});

Deno.test("mapKeyToAction: Up arrow (history back)", () => {
  const key = createMockKeyEvent({ upArrow: true });
  assertEquals(mapKeyToAction("", key), "history-back");
});

Deno.test("mapKeyToAction: Down arrow (history forward)", () => {
  const key = createMockKeyEvent({ downArrow: true });
  assertEquals(mapKeyToAction("", key), "history-forward");
});

// ============================================================
// mapKeyToAction() - Editing keys
// ============================================================

Deno.test("mapKeyToAction: Backspace", () => {
  const key = createMockKeyEvent({ backspace: true });
  assertEquals(mapKeyToAction("", key), "delete-char-back");
});

Deno.test("mapKeyToAction: Delete", () => {
  const key = createMockKeyEvent({ delete: true });
  assertEquals(mapKeyToAction("", key), "delete-char-forward");
});

Deno.test("mapKeyToAction: Enter (submit)", () => {
  const key = createMockKeyEvent({ return: true });
  assertEquals(mapKeyToAction("", key), "submit");
});

Deno.test("mapKeyToAction: Tab", () => {
  const key = createMockKeyEvent({ tab: true });
  assertEquals(mapKeyToAction("", key), "tab");
});

Deno.test("mapKeyToAction: Shift+Tab", () => {
  const key = createMockKeyEvent({ tab: true, shift: true });
  assertEquals(mapKeyToAction("", key), "shift-tab");
});

// ============================================================
// mapKeyToAction() - Regular character input
// ============================================================

Deno.test("mapKeyToAction: regular character returns null", () => {
  const key = createMockKeyEvent();
  assertEquals(mapKeyToAction("a", key), null);
});

Deno.test("mapKeyToAction: number returns null", () => {
  const key = createMockKeyEvent();
  assertEquals(mapKeyToAction("5", key), null);
});

Deno.test("mapKeyToAction: special character returns null", () => {
  const key = createMockKeyEvent();
  assertEquals(mapKeyToAction("@", key), null);
});

Deno.test("mapKeyToAction: space returns null", () => {
  const key = createMockKeyEvent();
  assertEquals(mapKeyToAction(" ", key), null);
});

// ============================================================
// isWordNavigationKey() tests
// ============================================================

Deno.test("isWordNavigationKey: macOS Option+Left is word nav", () => {
  const key = createMockKeyEvent({ meta: true });
  assert(isWordNavigationKey("b", key, false));
});

Deno.test("isWordNavigationKey: macOS Option+Right is word nav", () => {
  const key = createMockKeyEvent({ meta: true });
  assert(isWordNavigationKey("f", key, false));
});

Deno.test("isWordNavigationKey: Windows Ctrl+Left is word nav", () => {
  const key = createMockKeyEvent({ ctrl: true, leftArrow: true });
  assert(isWordNavigationKey("", key, false));
});

Deno.test("isWordNavigationKey: Windows Ctrl+Right is word nav", () => {
  const key = createMockKeyEvent({ ctrl: true, rightArrow: true });
  assert(isWordNavigationKey("", key, false));
});

Deno.test("isWordNavigationKey: plain Left is NOT word nav", () => {
  const key = createMockKeyEvent({ leftArrow: true });
  assertEquals(isWordNavigationKey("", key, false), false);
});

Deno.test("isWordNavigationKey: plain Right is NOT word nav", () => {
  const key = createMockKeyEvent({ rightArrow: true });
  assertEquals(isWordNavigationKey("", key, false), false);
});

Deno.test("isWordNavigationKey: ESC then Left is word nav", () => {
  const key = createMockKeyEvent({ leftArrow: true });
  assert(isWordNavigationKey("", key, true));
});

// ============================================================
// createMockKeyEvent() tests
// ============================================================

Deno.test("createMockKeyEvent: default has all false", () => {
  const key = createMockKeyEvent();
  assertEquals(key.ctrl, false);
  assertEquals(key.meta, false);
  assertEquals(key.shift, false);
  assertEquals(key.escape, false);
  assertEquals(key.leftArrow, false);
  assertEquals(key.rightArrow, false);
});

Deno.test("createMockKeyEvent: overrides work", () => {
  const key = createMockKeyEvent({ meta: true, leftArrow: true });
  assertEquals(key.meta, true);
  assertEquals(key.leftArrow, true);
  assertEquals(key.ctrl, false);
});

// ============================================================
// Edge cases and regression tests
// ============================================================

Deno.test("regression: Option+Arrow must check input='b'/'f', not leftArrow/rightArrow", () => {
  // This is the exact bug we fixed - macOS sends input='b' with meta=true
  // NOT meta=true with leftArrow=true
  const macOSOptionLeft = createMockKeyEvent({ meta: true });
  const input = "b"; // This is what macOS actually sends
  assertEquals(mapKeyToAction(input, macOSOptionLeft), "move-word-back");

  // Verify that meta+leftArrow (which macOS doesn't send) also works
  const alternativeStyle = createMockKeyEvent({ meta: true, leftArrow: true });
  assertEquals(mapKeyToAction("", alternativeStyle), "move-word-back");
});

Deno.test("regression: Option+Arrow forward must work with input='f'", () => {
  const macOSOptionRight = createMockKeyEvent({ meta: true });
  const input = "f";
  assertEquals(mapKeyToAction(input, macOSOptionRight), "move-word-forward");
});

Deno.test("edge: meta + unrelated key returns null", () => {
  const key = createMockKeyEvent({ meta: true });
  assertEquals(mapKeyToAction("x", key), null);
});

Deno.test("edge: ctrl + unrelated key returns null", () => {
  const key = createMockKeyEvent({ ctrl: true });
  assertEquals(mapKeyToAction("x", key), null);
});

Deno.test("edge: empty input with no special keys returns null", () => {
  const key = createMockKeyEvent();
  assertEquals(mapKeyToAction("", key), null);
});

// ============================================================
// Priority tests - verify correct precedence
// ============================================================

Deno.test("priority: Ctrl takes precedence for Ctrl+Left", () => {
  // Both ctrl and meta true - ctrl should win
  const key = createMockKeyEvent({ ctrl: true, meta: true, leftArrow: true });
  assertEquals(mapKeyToAction("", key), "move-word-back");
});

Deno.test("priority: meta+b takes precedence over two-event ESC", () => {
  // If meta=true and escapePressed=true, meta should handle it
  const key = createMockKeyEvent({ meta: true });
  assertEquals(mapKeyToAction("b", key, true), "move-word-back");
});
