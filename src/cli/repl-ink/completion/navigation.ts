/**
 * Unified Completion System - Navigation Logic
 *
 * Pure functions for keyboard navigation and scroll windowing.
 * No side effects - easily testable.
 */

import type { NavigationResult, ScrollWindow } from "./types.ts";
import { MAX_VISIBLE_ITEMS } from "./types.ts";

// ============================================================
// Keyboard Navigation
// ============================================================

/**
 * Handle a keyboard navigation event.
 *
 * @param key - The key pressed (ArrowUp, ArrowDown, Tab, Enter, Escape)
 * @param currentIndex - Current selected index
 * @param itemCount - Total number of items
 * @param isDropdownVisible - Whether dropdown is currently visible
 * @param shiftKey - Whether shift is held (for Shift+Tab)
 * @returns Navigation result with new index and action
 */
export function handleNavigationKey(
  key: string,
  currentIndex: number,
  itemCount: number,
  isDropdownVisible: boolean,
  _shiftKey: boolean = false
): NavigationResult {
  // No-op if dropdown is hidden or empty
  if (!isDropdownVisible || itemCount === 0) {
    return { newIndex: currentIndex, action: "none" };
  }

  switch (key) {
    case "ArrowUp":
      return {
        newIndex: wrapIndex(currentIndex - 1, itemCount),
        action: "navigate", // Visual navigation only - no selection applied
      };

    case "ArrowDown":
      return {
        newIndex: wrapIndex(currentIndex + 1, itemCount),
        action: "navigate", // Visual navigation only - no selection applied
      };

    case "Tab":
      // Tab = DRILL intent (go deeper or smart select with params)
      // Shift+Tab also drills (no cycling - use Up/Down to navigate)
      return {
        newIndex: currentIndex,
        action: "drill",
      };

    case "Enter":
      // Enter = SELECT intent (always choose and close)
      return {
        newIndex: currentIndex,
        action: "select",
      };

    case "Escape":
      return {
        newIndex: -1,
        action: "cancel",
      };

    default:
      return { newIndex: currentIndex, action: "none" };
  }
}

/**
 * Wrap index within bounds (for circular navigation).
 */
function wrapIndex(index: number, count: number): number {
  if (count === 0) return -1;
  return ((index % count) + count) % count;
}

// ============================================================
// Scroll Window Calculation
// ============================================================

/**
 * Calculate the visible window for virtualization.
 * Keeps the selected item visible by centering it when possible.
 *
 * @param selectedIndex - Currently selected index
 * @param itemCount - Total number of items
 * @param visibleCount - Number of items that can be displayed (default 8)
 * @returns Start and end indices for the visible window
 */
export function calculateScrollWindow(
  selectedIndex: number,
  itemCount: number,
  visibleCount: number = MAX_VISIBLE_ITEMS
): ScrollWindow {
  // All items fit - no scrolling needed
  if (itemCount <= visibleCount) {
    return { start: 0, end: itemCount };
  }

  // Calculate window centered on selected item
  const halfVisible = Math.floor(visibleCount / 2);
  let start = Math.max(0, selectedIndex - halfVisible);
  let end = start + visibleCount;

  // Adjust if we've gone past the end
  if (end > itemCount) {
    end = itemCount;
    start = Math.max(0, end - visibleCount);
  }

  return { start, end };
}

/**
 * Check if there are items above the visible window.
 */
export function hasItemsAbove(window: ScrollWindow): boolean {
  return window.start > 0;
}

/**
 * Check if there are items below the visible window.
 */
export function hasItemsBelow(window: ScrollWindow, totalCount: number): boolean {
  return window.end < totalCount;
}

// ============================================================
// Selection Helpers
// ============================================================

/**
 * Get the index within the visible window.
 * Useful for rendering highlight in the correct position.
 *
 * @param absoluteIndex - Index in the full item list
 * @param window - Current scroll window
 * @returns Index relative to window start, or -1 if not visible
 */
export function getRelativeIndex(
  absoluteIndex: number,
  window: ScrollWindow
): number {
  if (absoluteIndex < window.start || absoluteIndex >= window.end) {
    return -1;
  }
  return absoluteIndex - window.start;
}

// Note: getAbsoluteIndex was removed as unused (inverse of getRelativeIndex)

// ============================================================
// Key Detection Helpers
// ============================================================

/**
 * Check if a key is a navigation key that the dropdown should handle.
 */
export function isNavigationKey(key: string): boolean {
  return (
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "Tab" ||
    key === "Enter" ||
    key === "Escape"
  );
}

/**
 * Check if input should close the dropdown.
 * Any character input (not navigation) should close dropdown.
 */
export function shouldCloseOnInput(key: string, input: string): boolean {
  // Don't close on navigation keys
  if (isNavigationKey(key)) {
    return false;
  }

  // Close on any printable character input
  if (input && input.length === 1) {
    return true;
  }

  // Close on backspace/delete
  if (key === "Backspace" || key === "Delete") {
    return true;
  }

  return false;
}
