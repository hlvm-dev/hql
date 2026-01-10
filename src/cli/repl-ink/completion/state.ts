/**
 * Unified Completion System - State Management
 *
 * Pure reducer for dropdown state transitions.
 * No side effects - easily testable.
 */

import type {
  DropdownState,
  DropdownAction,
  CompletionItem,
} from "./types.ts";
import { INITIAL_DROPDOWN_STATE } from "./types.ts";

// ============================================================
// State Reducer
// ============================================================

/**
 * Pure reducer for dropdown state.
 * All state transitions are handled here.
 */
export function dropdownReducer(
  state: DropdownState,
  action: DropdownAction
): DropdownState {
  switch (action.type) {
    case "OPEN":
      return {
        isOpen: true,
        items: action.items,
        selectedIndex: action.items.length > 0 ? 0 : -1,
        anchorPosition: action.anchor,
        providerId: action.providerId,
        isLoading: false,
        // Session tracking - remember original state for cycling
        originalText: action.originalText,
        originalCursor: action.originalCursor,
      };

    case "CLOSE":
      return INITIAL_DROPDOWN_STATE;

    case "SET_ITEMS": {
      if (action.items.length === 0) {
        // No items - close dropdown
        return INITIAL_DROPDOWN_STATE;
      }

      // Preserve selection if still valid, otherwise reset to 0
      const newSelectedIndex =
        state.selectedIndex >= 0 && state.selectedIndex < action.items.length
          ? state.selectedIndex
          : 0;

      return {
        ...state,
        items: action.items,
        selectedIndex: newSelectedIndex,
        isLoading: false,
      };
    }

    case "SELECT_NEXT": {
      if (state.items.length === 0) {
        return state;
      }
      const nextIndex = (state.selectedIndex + 1) % state.items.length;
      return {
        ...state,
        selectedIndex: nextIndex,
      };
    }

    case "SELECT_PREV": {
      if (state.items.length === 0) {
        return state;
      }
      const prevIndex =
        (state.selectedIndex - 1 + state.items.length) % state.items.length;
      return {
        ...state,
        selectedIndex: prevIndex,
      };
    }

    case "SELECT_INDEX": {
      if (action.index < 0 || action.index >= state.items.length) {
        return state;
      }
      return {
        ...state,
        selectedIndex: action.index,
      };
    }

    case "SET_LOADING":
      return {
        ...state,
        isLoading: action.loading,
      };

    default:
      return state;
  }
}

// ============================================================
// State Helpers
// ============================================================

/**
 * Create initial dropdown state.
 */
export function createInitialState(): DropdownState {
  return INITIAL_DROPDOWN_STATE;
}

/**
 * Get the currently selected item.
 */
export function getSelectedItem(state: DropdownState): CompletionItem | null {
  if (state.selectedIndex < 0 || state.selectedIndex >= state.items.length) {
    return null;
  }
  return state.items[state.selectedIndex];
}

/**
 * Check if dropdown has items.
 */
export function hasItems(state: DropdownState): boolean {
  return state.items.length > 0;
}

/**
 * Check if the dropdown is currently active (open with items).
 */
export function isActive(state: DropdownState): boolean {
  return state.isOpen && state.items.length > 0;
}

// ============================================================
// Action Creators
// ============================================================

/**
 * Create an OPEN action.
 */
export function openAction(
  items: readonly CompletionItem[],
  anchor: number,
  providerId: DropdownState["providerId"],
  originalText: string,
  originalCursor: number
): DropdownAction {
  return {
    type: "OPEN",
    items,
    anchor,
    providerId: providerId!,
    originalText,
    originalCursor,
  };
}

/**
 * Create a CLOSE action.
 */
export function closeAction(): DropdownAction {
  return { type: "CLOSE" };
}

/**
 * Create a SET_ITEMS action.
 */
export function setItemsAction(items: readonly CompletionItem[]): DropdownAction {
  return { type: "SET_ITEMS", items };
}

/**
 * Create a SELECT_NEXT action.
 */
export function selectNextAction(): DropdownAction {
  return { type: "SELECT_NEXT" };
}

/**
 * Create a SELECT_PREV action.
 */
export function selectPrevAction(): DropdownAction {
  return { type: "SELECT_PREV" };
}

/**
 * Create a SELECT_INDEX action.
 */
export function selectIndexAction(index: number): DropdownAction {
  return { type: "SELECT_INDEX", index };
}

/**
 * Create a SET_LOADING action.
 */
export function setLoadingAction(loading: boolean): DropdownAction {
  return { type: "SET_LOADING", loading };
}
