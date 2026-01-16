/**
 * Unified Completion System - Dropdown State Hook
 *
 * React hook wrapping the pure reducer for dropdown state management.
 * Provides a clean API for components to interact with dropdown state.
 */

import { useReducer, useCallback, useMemo } from "npm:react@18";
import type { DropdownState, CompletionItem, ProviderId } from "./types.ts";
import { INITIAL_DROPDOWN_STATE } from "./types.ts";
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
  toggleDocPanelAction,
} from "./state.ts";
import {
  handleNavigationKey,
  calculateScrollWindow,
  hasItemsAbove,
  hasItemsBelow,
  getRelativeIndex,
} from "./navigation.ts";
import type { NavigationResult, ScrollWindow } from "./types.ts";

// ============================================================
// Hook Return Type
// ============================================================

export interface UseDropdownStateReturn {
  /** Current dropdown state */
  readonly state: DropdownState;

  /** Whether the dropdown is currently active (open with items) */
  readonly isDropdownActive: boolean;

  /** Currently selected item, or null */
  readonly selectedItem: CompletionItem | null;

  /** Scroll window for virtualization */
  readonly scrollWindow: ScrollWindow;

  /** Whether there are items above the visible window */
  readonly hasMoreAbove: boolean;

  /** Whether there are items below the visible window */
  readonly hasMoreBelow: boolean;

  /** Open the dropdown with items (also stores original text/cursor for cycling) */
  readonly open: (items: readonly CompletionItem[], anchor: number, providerId: ProviderId, originalText: string, originalCursor: number) => void;

  /** Close the dropdown */
  readonly close: () => void;

  /** Update items (for filtering/async loading) */
  readonly setItems: (items: readonly CompletionItem[]) => void;

  /** Select the next item (with wrap-around) */
  readonly selectNext: () => void;

  /** Select the previous item (with wrap-around) */
  readonly selectPrev: () => void;

  /** Select a specific index */
  readonly selectIndex: (index: number) => void;

  /** Set loading state */
  readonly setLoading: (loading: boolean) => void;

  /** Toggle documentation panel visibility (Ctrl+D shortcut) */
  readonly toggleDocPanel: () => void;

  /** Handle a navigation key press, returns action to take */
  readonly handleKey: (key: string, shiftKey?: boolean) => NavigationResult;

  /** Get relative index within visible window */
  readonly getVisibleIndex: (absoluteIndex: number) => number;
}

// ============================================================
// Hook Implementation
// ============================================================

/**
 * React hook for managing dropdown state.
 *
 * Uses a pure reducer under the hood for predictable state transitions.
 * Memoizes derived values and callbacks for performance.
 *
 * @example
 * ```tsx
 * const dropdown = useDropdownState();
 *
 * // Open with items
 * dropdown.open(completionItems, cursorPosition, "symbol");
 *
 * // Handle keyboard navigation
 * const result = dropdown.handleKey("ArrowDown");
 * if (result.action === "confirm") {
 *   applyCompletion(dropdown.selectedItem);
 *   dropdown.close();
 * }
 * ```
 */
export function useDropdownState(): UseDropdownStateReturn {
  const [state, dispatch] = useReducer(dropdownReducer, INITIAL_DROPDOWN_STATE);

  // ============================================================
  // Derived State (memoized)
  // ============================================================

  const isDropdownActive = useMemo(() => isActive(state), [state]);

  const selectedItem = useMemo(() => getSelectedItem(state), [state]);

  const scrollWindow = useMemo(
    () => calculateScrollWindow(state.selectedIndex, state.items.length),
    [state.selectedIndex, state.items.length]
  );

  const hasMoreAbove = useMemo(
    () => hasItemsAbove(scrollWindow),
    [scrollWindow]
  );

  const hasMoreBelow = useMemo(
    () => hasItemsBelow(scrollWindow, state.items.length),
    [scrollWindow, state.items.length]
  );

  // ============================================================
  // Actions (stable callbacks)
  // ============================================================

  const open = useCallback(
    (items: readonly CompletionItem[], anchor: number, providerId: ProviderId, originalText: string, originalCursor: number) => {
      dispatch(openAction(items, anchor, providerId, originalText, originalCursor));
    },
    []
  );

  const close = useCallback(() => {
    dispatch(closeAction());
  }, []);

  const setItems = useCallback((items: readonly CompletionItem[]) => {
    dispatch(setItemsAction(items));
  }, []);

  const selectNext = useCallback(() => {
    dispatch(selectNextAction());
  }, []);

  const selectPrev = useCallback(() => {
    dispatch(selectPrevAction());
  }, []);

  const selectIndex = useCallback((index: number) => {
    dispatch(selectIndexAction(index));
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    dispatch(setLoadingAction(loading));
  }, []);

  const toggleDocPanel = useCallback(() => {
    dispatch(toggleDocPanelAction());
  }, []);

  // ============================================================
  // Navigation Handler
  // ============================================================

  const handleKey = useCallback(
    (key: string, shiftKey: boolean = false): NavigationResult => {
      const result = handleNavigationKey(
        key,
        state.selectedIndex,
        state.items.length,
        state.isOpen,
        shiftKey
      );

      // Apply selection change if needed (for both navigate and select actions)
      if (result.newIndex !== state.selectedIndex && result.newIndex >= 0) {
        dispatch(selectIndexAction(result.newIndex));
      }

      return result;
    },
    [state.selectedIndex, state.items.length, state.isOpen]
  );

  // ============================================================
  // Index Helpers
  // ============================================================

  const getVisibleIndex = useCallback(
    (absoluteIndex: number): number => {
      return getRelativeIndex(absoluteIndex, scrollWindow);
    },
    [scrollWindow]
  );

  // ============================================================
  // Return Object
  // ============================================================

  return useMemo(
    () => ({
      state,
      isDropdownActive,
      selectedItem,
      scrollWindow,
      hasMoreAbove,
      hasMoreBelow,
      open,
      close,
      setItems,
      selectNext,
      selectPrev,
      selectIndex,
      setLoading,
      toggleDocPanel,
      handleKey,
      getVisibleIndex,
    }),
    [
      state,
      isDropdownActive,
      selectedItem,
      scrollWindow,
      hasMoreAbove,
      hasMoreBelow,
      open,
      close,
      setItems,
      selectNext,
      selectPrev,
      selectIndex,
      setLoading,
      toggleDocPanel,
      handleKey,
      getVisibleIndex,
    ]
  );
}
