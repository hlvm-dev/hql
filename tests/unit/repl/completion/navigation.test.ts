/**
 * Unit tests for Unified Completion System - Navigation Logic
 *
 * Tests keyboard navigation, scroll windowing, and key detection.
 */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  handleNavigationKey,
  calculateScrollWindow,
  hasItemsAbove,
  hasItemsBelow,
  getRelativeIndex,
  isNavigationKey,
  shouldCloseOnInput,
} from "../../../../src/hlvm/cli/repl-ink/completion/navigation.ts";
import type { ScrollWindow } from "../../../../src/hlvm/cli/repl-ink/completion/types.ts";

// ============================================================
// handleNavigationKey Tests
// ============================================================

Deno.test("Navigation: ArrowDown navigates to next item", () => {
  const result = handleNavigationKey("ArrowDown", 0, 5, true);

  assertEquals(result.newIndex, 1);
  assertEquals(result.action, "navigate");
});

Deno.test("Navigation: ArrowDown wraps from last to first", () => {
  const result = handleNavigationKey("ArrowDown", 4, 5, true);

  assertEquals(result.newIndex, 0);
  assertEquals(result.action, "navigate");
});

Deno.test("Navigation: ArrowUp navigates to previous item", () => {
  const result = handleNavigationKey("ArrowUp", 2, 5, true);

  assertEquals(result.newIndex, 1);
  assertEquals(result.action, "navigate");
});

Deno.test("Navigation: ArrowUp wraps from first to last", () => {
  const result = handleNavigationKey("ArrowUp", 0, 5, true);

  assertEquals(result.newIndex, 4);
  assertEquals(result.action, "navigate");
});

Deno.test("Navigation: Tab drills into selection", () => {
  const result = handleNavigationKey("Tab", 1, 5, true, false);

  assertEquals(result.newIndex, 1); // Tab doesn't change index, it drills
  assertEquals(result.action, "drill");
});

Deno.test("Navigation: Shift+Tab also drills", () => {
  const result = handleNavigationKey("Tab", 2, 5, true, true);

  assertEquals(result.newIndex, 2); // Tab doesn't change index, it drills
  assertEquals(result.action, "drill");
});

Deno.test("Navigation: Enter selects current item", () => {
  const result = handleNavigationKey("Enter", 3, 5, true);

  assertEquals(result.newIndex, 3);
  assertEquals(result.action, "select");
});

Deno.test("Navigation: Escape cancels dropdown", () => {
  const result = handleNavigationKey("Escape", 2, 5, true);

  assertEquals(result.newIndex, -1);
  assertEquals(result.action, "cancel");
});

Deno.test("Navigation: unknown key returns no-op", () => {
  const result = handleNavigationKey("a", 2, 5, true);

  assertEquals(result.newIndex, 2);
  assertEquals(result.action, "none");
});

Deno.test("Navigation: no-op when dropdown hidden", () => {
  const result = handleNavigationKey("ArrowDown", 0, 5, false);

  assertEquals(result.newIndex, 0);
  assertEquals(result.action, "none");
});

Deno.test("Navigation: no-op when item count is zero", () => {
  const result = handleNavigationKey("ArrowDown", 0, 0, true);

  assertEquals(result.newIndex, 0);
  assertEquals(result.action, "none");
});

// ============================================================
// calculateScrollWindow Tests
// ============================================================

Deno.test("Navigation: scroll window returns all items when fits", () => {
  const window = calculateScrollWindow(0, 5, 8);

  assertEquals(window.start, 0);
  assertEquals(window.end, 5);
});

Deno.test("Navigation: scroll window centers on selected item", () => {
  const window = calculateScrollWindow(10, 20, 8);

  // Should center on index 10, showing indices 6-13
  assertEquals(window.start, 6);
  assertEquals(window.end, 14);
});

Deno.test("Navigation: scroll window clamps at start", () => {
  const window = calculateScrollWindow(1, 20, 8);

  // Can't center on 1, so start at 0
  assertEquals(window.start, 0);
  assertEquals(window.end, 8);
});

Deno.test("Navigation: scroll window clamps at end", () => {
  const window = calculateScrollWindow(18, 20, 8);

  // Can't center on 18, so end at 20
  assertEquals(window.start, 12);
  assertEquals(window.end, 20);
});

Deno.test("Navigation: scroll window handles edge case of exact fit", () => {
  const window = calculateScrollWindow(4, 8, 8);

  assertEquals(window.start, 0);
  assertEquals(window.end, 8);
});

// ============================================================
// hasItemsAbove / hasItemsBelow Tests
// ============================================================

Deno.test("Navigation: hasItemsAbove returns true when start > 0", () => {
  const window: ScrollWindow = { start: 5, end: 13 };
  assert(hasItemsAbove(window));
});

Deno.test("Navigation: hasItemsAbove returns false when start is 0", () => {
  const window: ScrollWindow = { start: 0, end: 8 };
  assert(!hasItemsAbove(window));
});

Deno.test("Navigation: hasItemsBelow returns true when end < total", () => {
  const window: ScrollWindow = { start: 0, end: 8 };
  assert(hasItemsBelow(window, 20));
});

Deno.test("Navigation: hasItemsBelow returns false when end equals total", () => {
  const window: ScrollWindow = { start: 12, end: 20 };
  assert(!hasItemsBelow(window, 20));
});

// ============================================================
// getRelativeIndex Tests
// ============================================================

Deno.test("Navigation: getRelativeIndex returns offset from window start", () => {
  const window: ScrollWindow = { start: 5, end: 13 };

  assertEquals(getRelativeIndex(7, window), 2);
});

Deno.test("Navigation: getRelativeIndex returns -1 when out of window", () => {
  const window: ScrollWindow = { start: 5, end: 13 };

  assertEquals(getRelativeIndex(3, window), -1);
  assertEquals(getRelativeIndex(15, window), -1);
});

// Note: getAbsoluteIndex was removed as dead code (inverse of getRelativeIndex, never used)

// ============================================================
// isNavigationKey Tests
// ============================================================

Deno.test("Navigation: isNavigationKey returns true for navigation keys", () => {
  assert(isNavigationKey("ArrowUp"));
  assert(isNavigationKey("ArrowDown"));
  assert(isNavigationKey("Tab"));
  assert(isNavigationKey("Enter"));
  assert(isNavigationKey("Escape"));
});

Deno.test("Navigation: isNavigationKey returns false for other keys", () => {
  assert(!isNavigationKey("a"));
  assert(!isNavigationKey("Backspace"));
  assert(!isNavigationKey("Delete"));
  assert(!isNavigationKey(" "));
});

// ============================================================
// shouldCloseOnInput Tests
// ============================================================

Deno.test("Navigation: shouldCloseOnInput returns false for navigation keys", () => {
  assert(!shouldCloseOnInput("ArrowUp", ""));
  assert(!shouldCloseOnInput("ArrowDown", ""));
  assert(!shouldCloseOnInput("Tab", ""));
  assert(!shouldCloseOnInput("Enter", ""));
  assert(!shouldCloseOnInput("Escape", ""));
});

Deno.test("Navigation: shouldCloseOnInput returns true for character input", () => {
  assert(shouldCloseOnInput("a", "a"));
  assert(shouldCloseOnInput("1", "1"));
  assert(shouldCloseOnInput(" ", " "));
});

Deno.test("Navigation: shouldCloseOnInput returns true for Backspace", () => {
  assert(shouldCloseOnInput("Backspace", ""));
});

Deno.test("Navigation: shouldCloseOnInput returns true for Delete", () => {
  assert(shouldCloseOnInput("Delete", ""));
});
