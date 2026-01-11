/**
 * Unit tests for Unified Completion System - State Management
 *
 * Tests the pure reducer and state helpers.
 */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  dropdownReducer,
  getSelectedItem,
  isActive,
  openAction,
  closeAction,
  setItemsAction,
  selectNextAction,
  selectPrevAction,
  selectIndexAction,
  setLoadingAction,
} from "../../../../src/cli/repl-ink/completion/state.ts";
import type { DropdownState, CompletionItem, CompletionType, ApplyResult, ApplyContext, ItemRenderSpec } from "../../../../src/cli/repl-ink/completion/types.ts";
import { INITIAL_DROPDOWN_STATE, TYPE_ICONS } from "../../../../src/cli/repl-ink/completion/types.ts";

// ============================================================
// Test Data
// ============================================================

/** Create a mock CompletionItem with all required properties for testing */
function createMockItem(
  id: string,
  label: string,
  type: CompletionType,
  score: number
): CompletionItem {
  return {
    id,
    label,
    type,
    score,
    availableActions: ["SELECT"],
    applyAction: (_action: "DRILL" | "SELECT", context: ApplyContext): ApplyResult => ({
      text: context.text.slice(0, context.anchorPosition) + label + context.text.slice(context.cursorPosition),
      cursorPosition: context.anchorPosition + label.length,
      closeDropdown: true,
    }),
    getRenderSpec: (): ItemRenderSpec => ({
      icon: TYPE_ICONS[type],
      label,
      truncate: "end",
      maxWidth: 40,
    }),
  };
}

function createTestItems(count: number): CompletionItem[] {
  return Array.from({ length: count }, (_, i) =>
    createMockItem(`item-${i}`, `item${i}`, "function", 100 - i)
  );
}

const sampleItems: CompletionItem[] = [
  createMockItem("1", "def", "keyword", 100),
  createMockItem("2", "defn", "keyword", 90),
  createMockItem("3", "default", "function", 80),
];

// Helper to create a valid state with session tracking fields
function createOpenState(overrides: Partial<DropdownState> = {}): DropdownState {
  return {
    isOpen: true,
    items: sampleItems,
    selectedIndex: 0,
    anchorPosition: 0,
    providerId: "symbol",
    isLoading: false,
    hasNavigated: false,
    originalText: "de",
    originalCursor: 2,
    ...overrides,
  };
}

// ============================================================
// OPEN Action Tests
// ============================================================

Deno.test("State: OPEN sets isOpen to true", () => {
  const state = INITIAL_DROPDOWN_STATE;
  const next = dropdownReducer(state, openAction(sampleItems, 0, "symbol", "de", 2));

  assertEquals(next.isOpen, true);
});

Deno.test("State: OPEN sets items", () => {
  const state = INITIAL_DROPDOWN_STATE;
  const next = dropdownReducer(state, openAction(sampleItems, 0, "symbol", "de", 2));

  assertEquals(next.items, sampleItems);
  assertEquals(next.items.length, 3);
});

Deno.test("State: OPEN sets selectedIndex to 0 when items exist", () => {
  const state = INITIAL_DROPDOWN_STATE;
  const next = dropdownReducer(state, openAction(sampleItems, 0, "symbol", "de", 2));

  assertEquals(next.selectedIndex, 0);
});

Deno.test("State: OPEN sets selectedIndex to -1 when empty items", () => {
  const state = INITIAL_DROPDOWN_STATE;
  const next = dropdownReducer(state, openAction([], 0, "symbol", "", 0));

  assertEquals(next.selectedIndex, -1);
});

Deno.test("State: OPEN sets anchorPosition", () => {
  const state = INITIAL_DROPDOWN_STATE;
  const next = dropdownReducer(state, openAction(sampleItems, 5, "symbol", "de", 7));

  assertEquals(next.anchorPosition, 5);
});

Deno.test("State: OPEN sets providerId", () => {
  const state = INITIAL_DROPDOWN_STATE;
  const next = dropdownReducer(state, openAction(sampleItems, 0, "file", "@", 1));

  assertEquals(next.providerId, "file");
});

Deno.test("State: OPEN sets isLoading to false", () => {
  const state = { ...INITIAL_DROPDOWN_STATE, isLoading: true };
  const next = dropdownReducer(state, openAction(sampleItems, 0, "symbol", "de", 2));

  assertEquals(next.isLoading, false);
});

Deno.test("State: OPEN stores original text and cursor for session tracking", () => {
  const state = INITIAL_DROPDOWN_STATE;
  const next = dropdownReducer(state, openAction(sampleItems, 0, "symbol", "original text", 8));

  assertEquals(next.originalText, "original text");
  assertEquals(next.originalCursor, 8);
});

// ============================================================
// CLOSE Action Tests
// ============================================================

Deno.test("State: CLOSE resets to initial state", () => {
  const state = createOpenState({ selectedIndex: 1, anchorPosition: 5 });

  const next = dropdownReducer(state, closeAction());
  assertEquals(next, INITIAL_DROPDOWN_STATE);
});

Deno.test("State: CLOSE on already closed state is no-op", () => {
  const state = INITIAL_DROPDOWN_STATE;
  const next = dropdownReducer(state, closeAction());

  assertEquals(next, state);
});

// ============================================================
// SET_ITEMS Action Tests
// ============================================================

Deno.test("State: SET_ITEMS updates items", () => {
  const state = createOpenState();

  const newItems: CompletionItem[] = [
    createMockItem("a", "alpha", "function", 100),
  ];

  const next = dropdownReducer(state, setItemsAction(newItems));
  assertEquals(next.items, newItems);
});

Deno.test("State: SET_ITEMS preserves valid selection", () => {
  const state = createOpenState({ items: createTestItems(5), selectedIndex: 2 });

  const next = dropdownReducer(state, setItemsAction(createTestItems(5)));
  assertEquals(next.selectedIndex, 2);
});

Deno.test("State: SET_ITEMS resets selection when index out of bounds", () => {
  const state = createOpenState({ items: createTestItems(10), selectedIndex: 9 }); // Last item

  // Reduce to 5 items - index 9 is now invalid
  const next = dropdownReducer(state, setItemsAction(createTestItems(5)));
  assertEquals(next.selectedIndex, 0);
});

Deno.test("State: SET_ITEMS with empty items closes dropdown", () => {
  const state = createOpenState();

  const next = dropdownReducer(state, setItemsAction([]));
  assertEquals(next, INITIAL_DROPDOWN_STATE);
});

Deno.test("State: SET_ITEMS clears isLoading", () => {
  const state = createOpenState({ items: [], providerId: "file", isLoading: true });

  const next = dropdownReducer(state, setItemsAction(sampleItems));
  assertEquals(next.isLoading, false);
});

// ============================================================
// SELECT_NEXT Action Tests
// ============================================================

Deno.test("State: SELECT_NEXT increments selectedIndex", () => {
  const state = createOpenState({ selectedIndex: 0 });

  const next = dropdownReducer(state, selectNextAction());
  assertEquals(next.selectedIndex, 1);
});

Deno.test("State: SELECT_NEXT wraps from last to first", () => {
  const state = createOpenState({ selectedIndex: 2 }); // Last item (3 items)

  const next = dropdownReducer(state, selectNextAction());
  assertEquals(next.selectedIndex, 0);
});

Deno.test("State: SELECT_NEXT with empty items is no-op", () => {
  const state = createOpenState({ items: [], selectedIndex: -1 });

  const next = dropdownReducer(state, selectNextAction());
  assertEquals(next.selectedIndex, -1);
});

// ============================================================
// SELECT_PREV Action Tests
// ============================================================

Deno.test("State: SELECT_PREV decrements selectedIndex", () => {
  const state = createOpenState({ selectedIndex: 2 });

  const next = dropdownReducer(state, selectPrevAction());
  assertEquals(next.selectedIndex, 1);
});

Deno.test("State: SELECT_PREV wraps from first to last", () => {
  const state = createOpenState({ selectedIndex: 0 }); // 3 items

  const next = dropdownReducer(state, selectPrevAction());
  assertEquals(next.selectedIndex, 2);
});

Deno.test("State: SELECT_PREV with empty items is no-op", () => {
  const state = createOpenState({ items: [], selectedIndex: -1 });

  const next = dropdownReducer(state, selectPrevAction());
  assertEquals(next.selectedIndex, -1);
});

// ============================================================
// SELECT_INDEX Action Tests
// ============================================================

Deno.test("State: SELECT_INDEX sets specific index", () => {
  const state = createOpenState({ selectedIndex: 0 });

  const next = dropdownReducer(state, selectIndexAction(2));
  assertEquals(next.selectedIndex, 2);
});

Deno.test("State: SELECT_INDEX with negative index is no-op", () => {
  const state = createOpenState({ selectedIndex: 1 });

  const next = dropdownReducer(state, selectIndexAction(-1));
  assertEquals(next.selectedIndex, 1); // Unchanged
});

Deno.test("State: SELECT_INDEX with out-of-bounds index is no-op", () => {
  const state = createOpenState({ selectedIndex: 1 }); // 3 items

  const next = dropdownReducer(state, selectIndexAction(10));
  assertEquals(next.selectedIndex, 1); // Unchanged
});

// ============================================================
// SET_LOADING Action Tests
// ============================================================

Deno.test("State: SET_LOADING sets loading to true", () => {
  const state = INITIAL_DROPDOWN_STATE;
  const next = dropdownReducer(state, setLoadingAction(true));

  assertEquals(next.isLoading, true);
});

Deno.test("State: SET_LOADING sets loading to false", () => {
  const state = { ...INITIAL_DROPDOWN_STATE, isLoading: true };
  const next = dropdownReducer(state, setLoadingAction(false));

  assertEquals(next.isLoading, false);
});

// ============================================================
// Helper Function Tests
// ============================================================

Deno.test("State: getSelectedItem returns item at selectedIndex", () => {
  const state = createOpenState({ selectedIndex: 1 });

  const item = getSelectedItem(state);
  assertEquals(item?.label, "defn");
});

Deno.test("State: getSelectedItem returns null for invalid index", () => {
  const state = createOpenState({ selectedIndex: -1 });

  const item = getSelectedItem(state);
  assertEquals(item, null);
});

// Note: hasItems was removed as dead code (unused helper)

Deno.test("State: isActive returns true when open with items", () => {
  const state = createOpenState();

  assert(isActive(state));
});

Deno.test("State: isActive returns false when closed", () => {
  const state = INITIAL_DROPDOWN_STATE;
  assert(!isActive(state));
});

Deno.test("State: isActive returns false when open but empty", () => {
  const state = createOpenState({ items: [], selectedIndex: -1 });

  assert(!isActive(state));
});
