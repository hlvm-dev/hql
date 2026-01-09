/**
 * Unified Completion System - Public API
 *
 * Re-exports all public types, functions, and constants.
 */

// Types
export type {
  CompletionType,
  ProviderId,
  CompletionItem,
  CompletionContext,
  DropdownState,
  DropdownAction,
  NavigationResult,
  ScrollWindow,
  CompletionResult,
  CompletionProvider,
  // New action semantics
  CompletionAction,
  ApplyContext,
  ApplyResult,
  ItemRenderSpec,
  CompletionSideEffect,
} from "./types.ts";

export {
  MAX_VISIBLE_ITEMS,
  INITIAL_DROPDOWN_STATE,
  TYPE_ICONS,
} from "./types.ts";

// State management
export {
  dropdownReducer,
  createInitialState,
  getSelectedItem,
  hasItems,
  isActive,
  openAction,
  closeAction,
  setItemsAction,
  selectNextAction,
  selectPrevAction,
  selectIndexAction,
  setLoadingAction,
} from "./state.ts";

// Navigation
export {
  handleNavigationKey,
  calculateScrollWindow,
  hasItemsAbove,
  hasItemsBelow,
  getRelativeIndex,
  getAbsoluteIndex,
  isNavigationKey,
  shouldCloseOnInput,
} from "./navigation.ts";

// Provider helpers
export {
  getWordAtCursor,
  buildContext,
  filterByPrefix,
  filterBySubstring,
  rankCompletions,
  generateItemId,
  resetItemIdCounter,
  createCompletionItem,
  shouldTriggerFileMention,
  extractMentionQuery,
  shouldTriggerCommand,
  extractCommandQuery,
  shouldTriggerSymbol,
  applyCompletionItem,
} from "./providers.ts";

// React hooks
export { useDropdownState } from "./useDropdownState.ts";
export type { UseDropdownStateReturn } from "./useDropdownState.ts";

export { useCompletion } from "./useCompletion.ts";
export type { UseCompletionOptions, UseCompletionReturn } from "./useCompletion.ts";

// UI Components
export { Dropdown, GenericItem } from "./Dropdown.tsx";
export type { DropdownProps, GenericItemProps } from "./Dropdown.tsx";

// Concrete Providers
export {
  SymbolProvider,
  FileProvider,
  CommandProvider,
  ALL_PROVIDERS,
  getActiveProvider,
} from "./concrete-providers.ts";
