/**
 * Unified Completion System - Main Orchestration Hook
 *
 * Combines dropdown state, providers, and navigation into a single hook.
 * This is the primary hook for components to use.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
  ApplyContext,
  ApplyResult,
  CompletionAction,
  CompletionContext,
  CompletionItem,
  ProviderId,
} from "./types.ts";
import { useDropdownState } from "./useDropdownState.ts";
import { buildContext } from "./providers.ts";
import { ALL_PROVIDERS, getActiveProvider } from "./concrete-providers.ts";
import { isNavigationKey, shouldCloseOnInput } from "./navigation.ts";

// ============================================================
// Hook Configuration
// ============================================================

export interface UseCompletionOptions {
  /** User-defined bindings from ReplState */
  readonly userBindings: ReadonlySet<string>;
  /** Function signatures from ReplState */
  readonly signatures: ReadonlyMap<string, readonly string[]>;
  /** Docstrings from comments (name -> description) */
  readonly docstrings?: ReadonlyMap<string, string>;
  /** Names of definitions in persistent memory (for context-aware completions) */
  readonly bindingNames?: ReadonlySet<string>;
  /** Paths of files already attached (to filter from @ picker) */
  readonly attachedPaths?: ReadonlySet<string>;
  /** Debounce delay for async providers (ms) */
  readonly debounceMs?: number;
  /** Whether completion is disabled */
  readonly disabled?: boolean;
}

// ============================================================
// Render Props Interface (for encapsulated dropdown rendering)
// ============================================================

export interface DropdownRenderProps {
  readonly items: readonly CompletionItem[];
  readonly selectedIndex: number;
  readonly isLoading: boolean;
  readonly helpText: string;
  readonly providerId: ProviderId;
  readonly anchorPosition: number;
  /** Whether to show DocPanel (toggled with Ctrl+D shortcut) */
  readonly showDocPanel: boolean;
}

// ============================================================
// Hook Return Type
// ============================================================

export interface UseCompletionReturn {
  /** Trigger completion at current position */
  readonly triggerCompletion: (
    text: string,
    cursorPosition: number,
    force?: boolean,
  ) => void;

  /**
   * HYBRID: Trigger completion AND apply first item immediately.
   * Opens dropdown with all items, returns the first item applied to input.
   * Returns null if no completions available.
   */
  readonly triggerAndApply: (
    text: string,
    cursorPosition: number,
  ) => Promise<ApplyResult | null>;

  /** Handle a key press - returns true if handled */
  readonly handleKey: (
    key: string,
    text: string,
    cursorPosition: number,
    shiftKey?: boolean,
  ) => boolean;

  /** Apply the currently selected completion using stored original values (does NOT close dropdown for cycling) */
  readonly applySelected: () => ApplyResult | null;

  /** Apply selected and close dropdown (for final confirmation) */
  readonly confirmSelected: (action?: CompletionAction) => ApplyResult | null;

  /** Whether completion dropdown is currently visible */
  readonly isVisible: boolean;

  /** Current provider ID (for UI customization) */
  readonly activeProviderId: ProviderId | null;

  /** Help text from the active provider (for dropdown display) */
  readonly activeProviderHelpText: string;

  /** Navigate to previous item, returns new text if cycling behavior applies */
  readonly navigateUp: () => void;

  /** Navigate to next item, returns new text if cycling behavior applies */
  readonly navigateDown: () => void;

  /** Get render props for dropdown (encapsulates all state access for rendering) */
  readonly renderProps: DropdownRenderProps | null;

  /** Toggle documentation panel visibility (Ctrl+D) */
  readonly toggleDocPanel: () => void;

  /** Close the dropdown */
  readonly close: () => void;

  /** Get apply context for executing actions (encapsulates state access) */
  readonly getApplyContext: () => ApplyContext | null;

  /** Get the currently selected item (for executing custom actions) */
  readonly selectedItem: CompletionItem | null;
}

// ============================================================
// Hook Implementation
// ============================================================

/**
 * Main hook for completion functionality.
 *
 * Orchestrates:
 * - Provider detection (which provider handles current input)
 * - Dropdown state management
 * - Keyboard navigation
 * - Completion application
 *
 * @example
 * ```tsx
 * const completion = useCompletion({
 *   userBindings: repl.userBindings,
 *   signatures: repl.signatures,
 * });
 *
 * // In key handler:
 * if (completion.handleKey(key, text, cursorPos, shiftKey)) {
 *   return; // Key was handled by completion
 * }
 *
 * // To apply selected:
 * const result = completion.applySelected(text, cursorPos);
 * if (result) {
 *   setValue(result.text);
 *   setCursor(result.cursorPosition);
 * }
 * ```
 */
export function useCompletion(
  options: UseCompletionOptions,
): UseCompletionReturn {
  const {
    userBindings,
    signatures,
    docstrings = new Map(),
    bindingNames = new Set(),
    attachedPaths,
    debounceMs = 150,
    disabled = false,
  } = options;

  const dropdown = useDropdownState();
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  // FIX NEW-4: Cleanup debounce timer on unmount OR when dependencies change
  // This prevents stale completions when bindings/signatures change mid-debounce
  useEffect(() => {
    return () => {
      clearDebounce();
    };
  }, [clearDebounce, userBindings, signatures, docstrings, debounceMs]);

  // ============================================================
  // Trigger Completion
  // ============================================================

  const triggerCompletion = useCallback(
    async (text: string, cursorPosition: number, force: boolean = false) => {
      const requestId = ++requestIdRef.current;
      clearDebounce();

      if (disabled) {
        dropdown.close();
        return;
      }

      // Build context
      const context: CompletionContext = buildContext(
        text,
        cursorPosition,
        userBindings,
        signatures,
        docstrings,
        bindingNames,
        attachedPaths,
      );

      // Find active provider
      const provider = getActiveProvider(context);

      if (!provider) {
        // No provider matches - close dropdown
        dropdown.close();
        return;
      }

      // Check if we should use debounce (GENERIC: use provider.isAsync instead of hardcoded check)
      const isAsyncProvider = provider.isAsync ?? false;
      const providerDebounceMs = provider.debounceMs ?? debounceMs;

      if (isAsyncProvider && !force) {
        // Always refresh loading session with latest anchor + original text/cursor.
        // This prevents stale items from previous async queries being selectable.
        dropdown.open([], context.wordStart, provider.id, text, cursorPosition);
        dropdown.setLoading(true);

        // Debounce the actual fetch (use provider's debounce setting)
        debounceTimerRef.current = setTimeout(async () => {
          try {
            const result = await provider.getCompletions(context);
            if (requestId !== requestIdRef.current) {
              return;
            }
            // GENERIC: Close dropdown if no items, open if items exist
            if (result.items.length === 0) {
              dropdown.close();
            } else {
              dropdown.open(
                result.items,
                result.anchor,
                provider.id,
                text,
                cursorPosition,
              );
            }
          } catch {
            if (requestId === requestIdRef.current) {
              dropdown.close();
            }
          } finally {
            debounceTimerRef.current = null;
          }
        }, providerDebounceMs);
        return;
      }

      // Sync or forced - fetch immediately
      try {
        const result = await provider.getCompletions(context);
        if (requestId !== requestIdRef.current) {
          return;
        }
        // GENERIC: Close dropdown if no items, open if items exist
        if (result.items.length === 0) {
          dropdown.close();
          return;
        }
        dropdown.open(
          result.items,
          result.anchor,
          provider.id,
          text,
          cursorPosition,
        );
      } catch {
        if (requestId === requestIdRef.current) {
          dropdown.close();
        }
      }
    },
    [
      clearDebounce,
      disabled,
      userBindings,
      signatures,
      docstrings,
      bindingNames,
      debounceMs,
      dropdown,
    ],
  );

  // ============================================================
  // Key Handler
  // ============================================================

  const handleKey = useCallback(
    (
      key: string,
      _text: string,
      _cursorPosition: number,
      shiftKey: boolean = false,
    ): boolean => {
      if (disabled) return false;

      // If dropdown is open, handle navigation keys
      if (dropdown.isDropdownActive) {
        if (isNavigationKey(key)) {
          const result = dropdown.handleKey(key, shiftKey);

          if (result.action === "cancel") {
            requestIdRef.current += 1;
            clearDebounce();
            dropdown.close();
            return true;
          }

          // Navigate: visual only (Up/Down), handled by component
          if (result.action === "navigate") {
            return true;
          }

          // Select: Enter action (choose and close)
          if (result.action === "select") {
            // Let the component handle executing the SELECT action
            return true;
          }
        }

        // Check if input should close dropdown
        if (shouldCloseOnInput(key, "")) {
          dropdown.close();
          return false; // Let input handle the character
        }
      }

      return false;
    },
    [clearDebounce, disabled, dropdown],
  );

  // ============================================================
  // Trigger And Apply (Hybrid Behavior)
  // ============================================================

  const triggerAndApply = useCallback(
    async (
      text: string,
      cursorPosition: number,
    ): Promise<ApplyResult | null> => {
      if (disabled) return null;

      // Build context
      const context: CompletionContext = buildContext(
        text,
        cursorPosition,
        userBindings,
        signatures,
        docstrings,
        bindingNames,
        attachedPaths,
      );

      // Find active provider (for Tab, use symbol provider)
      const provider = getActiveProvider(context);
      if (!provider) return null;

      // Get completions synchronously for Tab behavior
      const result = await provider.getCompletions(context);

      if (result.items.length === 0) return null;

      // Open dropdown with all items - pass original text/cursor for session
      dropdown.open(
        result.items,
        result.anchor,
        provider.id,
        text,
        cursorPosition,
      );

      // Apply the first item immediately (using original text/cursor)
      const firstItem = result.items[0];
      const applyResult = firstItem.applyAction("SELECT", {
        text,
        cursorPosition,
        anchorPosition: result.anchor,
      });
      return applyResult;
    },
    [
      disabled,
      userBindings,
      signatures,
      docstrings,
      bindingNames,
      attachedPaths,
      dropdown,
    ],
  );

  // ============================================================
  // Apply Selected Completion (does NOT close - for cycling)
  // Uses ORIGINAL text/cursor stored when session started!
  // ============================================================

  const applySelected = useCallback(
    (): ApplyResult | null => {
      const selected = dropdown.selectedItem;
      if (!selected) return null;

      // KEY FIX: Use stored original text/cursor, NOT current values
      // This allows Tab cycling to correctly replace the original word
      const applyResult = selected.applyAction("SELECT", {
        text: dropdown.state.originalText,
        cursorPosition: dropdown.state.originalCursor,
        anchorPosition: dropdown.state.anchorPosition,
      });
      return applyResult;
    },
    [dropdown],
  );

  // ============================================================
  // Confirm Selected (applies AND closes dropdown)
  // ============================================================

  const confirmSelected = useCallback(
    (action: CompletionAction = "SELECT"): ApplyResult | null => {
      const selected = dropdown.selectedItem;
      if (!selected) return null;

      // Use stored original values
      const applyResult = selected.applyAction(action, {
        text: dropdown.state.originalText,
        cursorPosition: dropdown.state.originalCursor,
        anchorPosition: dropdown.state.anchorPosition,
      });

      dropdown.close();
      return applyResult;
    },
    [dropdown],
  );

  // ============================================================
  // Computed Values
  // ============================================================

  // Direct pass-throughs — dropdown already memoizes these
  const isVisible = dropdown.isDropdownActive;
  const activeProviderId = dropdown.state.providerId;

  // Get help text from active provider (GENERIC: provider defines its own help text)
  // Includes docs toggle status indicator
  const activeProviderHelpText = useMemo(() => {
    const providerId = dropdown.state.providerId;
    if (!providerId) return "";
    const docsStatus = dropdown.state.showDocPanel ? "on" : "off";
    if (providerId === "file") {
      return `Enter select • Tab drill • Esc close • docs ${docsStatus}`;
    }
    return `Enter select • Tab next • Esc close • docs ${docsStatus}`;
  }, [dropdown.state.providerId, dropdown.state.showDocPanel]);

  // ============================================================
  // Navigation Methods (encapsulates cycling behavior)
  // ============================================================

  const navigateUp = useCallback(
    (): void => {
      if (!dropdown.isDropdownActive) return;
      dropdown.selectPrev();
    },
    [dropdown],
  );

  const navigateDown = useCallback(
    (): void => {
      if (!dropdown.isDropdownActive) return;
      dropdown.selectNext();
    },
    [dropdown],
  );

  // ============================================================
  // Render Props (encapsulates all state access for dropdown rendering)
  // ============================================================

  const renderProps = useMemo(
    (): DropdownRenderProps | null => {
      if (!dropdown.isDropdownActive) return null;
      return {
        items: dropdown.state.items,
        selectedIndex: dropdown.state.selectedIndex,
        isLoading: dropdown.state.isLoading,
        helpText: activeProviderHelpText,
        providerId: dropdown.state.providerId!,
        anchorPosition: dropdown.state.anchorPosition,
        showDocPanel: dropdown.state.showDocPanel,
      };
    },
    [
      dropdown.isDropdownActive,
      dropdown.state.items,
      dropdown.state.selectedIndex,
      dropdown.state.isLoading,
      dropdown.state.providerId,
      dropdown.state.anchorPosition,
      dropdown.state.showDocPanel,
      activeProviderHelpText,
    ],
  );

  // Direct pass-through — dropdown.toggleDocPanel is already stable
  const toggleDocPanel = dropdown.toggleDocPanel;

  // ============================================================
  // Close Helper (direct pass-through)
  // ============================================================

  const close = useCallback(() => {
    requestIdRef.current += 1;
    clearDebounce();
    dropdown.close();
  }, [clearDebounce, dropdown]);

  // ============================================================
  // Apply Context Helper (encapsulates state access for custom actions)
  // ============================================================

  const getApplyContext = useCallback((): ApplyContext | null => {
    if (!dropdown.isDropdownActive) return null;
    return {
      text: dropdown.state.originalText,
      cursorPosition: dropdown.state.originalCursor,
      anchorPosition: dropdown.state.anchorPosition,
    };
  }, [
    dropdown.isDropdownActive,
    dropdown.state.originalText,
    dropdown.state.originalCursor,
    dropdown.state.anchorPosition,
  ]);

  // ============================================================
  // Selected Item Helper (encapsulates state access)
  // ============================================================

  // Direct pass-through — dropdown already memoizes this
  const selectedItem = dropdown.selectedItem;

  // ============================================================
  // Return
  // ============================================================

  return useMemo(
    () => ({
      triggerCompletion,
      triggerAndApply,
      handleKey,
      applySelected,
      confirmSelected,
      isVisible,
      activeProviderId,
      activeProviderHelpText,
      navigateUp,
      navigateDown,
      renderProps,
      toggleDocPanel,
      close,
      getApplyContext,
      selectedItem,
    }),
    [
      triggerCompletion,
      triggerAndApply,
      handleKey,
      applySelected,
      confirmSelected,
      isVisible,
      activeProviderId,
      activeProviderHelpText,
      navigateUp,
      navigateDown,
      renderProps,
      toggleDocPanel,
      close,
      getApplyContext,
      selectedItem,
    ],
  );
}
