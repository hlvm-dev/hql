/**
 * Unified Completion System - Main Orchestration Hook
 *
 * Combines dropdown state, providers, and navigation into a single hook.
 * This is the primary hook for components to use.
 */

import { useCallback, useRef, useEffect, useMemo } from "npm:react@18";
import type { CompletionContext, CompletionItem, ProviderId } from "./types.ts";
import { useDropdownState } from "./useDropdownState.ts";
import { buildContext, applyCompletionItem } from "./providers.ts";
import { getActiveProvider, ALL_PROVIDERS } from "./concrete-providers.ts";
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
  /** Debounce delay for async providers (ms) */
  readonly debounceMs?: number;
  /** Whether completion is disabled */
  readonly disabled?: boolean;
}

// ============================================================
// Hook Return Type
// ============================================================

export interface UseCompletionReturn {
  /** Dropdown state and helpers */
  readonly dropdown: ReturnType<typeof useDropdownState>;

  /** Trigger completion at current position */
  readonly triggerCompletion: (text: string, cursorPosition: number, force?: boolean) => void;

  /**
   * HYBRID: Trigger completion AND apply first item immediately.
   * Opens dropdown with all items, returns the first item applied to input.
   * Returns null if no completions available.
   */
  readonly triggerAndApply: (text: string, cursorPosition: number) => Promise<{ text: string; cursorPosition: number } | null>;

  /** Handle a key press - returns true if handled */
  readonly handleKey: (key: string, text: string, cursorPosition: number, shiftKey?: boolean) => boolean;

  /** Apply the currently selected completion using stored original values (does NOT close dropdown for cycling) */
  readonly applySelected: () => { text: string; cursorPosition: number } | null;

  /** Apply selected and close dropdown (for final confirmation) */
  readonly confirmSelected: () => { text: string; cursorPosition: number } | null;

  /** Whether completion dropdown is currently visible */
  readonly isVisible: boolean;

  /** Current provider ID (for UI customization) */
  readonly activeProviderId: ProviderId | null;

  /** Help text from the active provider (for dropdown display) */
  readonly activeProviderHelpText: string;
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
export function useCompletion(options: UseCompletionOptions): UseCompletionReturn {
  const {
    userBindings,
    signatures,
    docstrings = new Map(),
    debounceMs = 150,
    disabled = false,
  } = options;

  const dropdown = useDropdownState();
  const debounceTimerRef = useRef<number | null>(null);
  const lastQueryRef = useRef<string>("");

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // ============================================================
  // Trigger Completion
  // ============================================================

  const triggerCompletion = useCallback(
    async (text: string, cursorPosition: number, force: boolean = false) => {
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
        docstrings
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
        // Cancel previous debounce
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current);
        }

        // Set loading state immediately
        dropdown.setLoading(true);

        // Debounce the actual fetch (use provider's debounce setting)
        debounceTimerRef.current = setTimeout(async () => {
          const result = await provider.getCompletions(context);
          // Pass original text/cursor for session tracking
          dropdown.open(result.items, result.anchor, provider.id, text, cursorPosition);
          debounceTimerRef.current = null;
        }, providerDebounceMs) as unknown as number;
      } else {
        // Sync or forced - fetch immediately
        const result = await provider.getCompletions(context);
        // Pass original text/cursor for session tracking
        dropdown.open(result.items, result.anchor, provider.id, text, cursorPosition);
      }
    },
    [disabled, userBindings, signatures, docstrings, debounceMs, dropdown]
  );

  // ============================================================
  // Key Handler
  // ============================================================

  const handleKey = useCallback(
    (key: string, text: string, cursorPosition: number, shiftKey: boolean = false): boolean => {
      if (disabled) return false;

      // If dropdown is open, handle navigation keys
      if (dropdown.isDropdownActive) {
        if (isNavigationKey(key)) {
          const result = dropdown.handleKey(key, shiftKey);

          if (result.action === "cancel") {
            dropdown.close();
            return true;
          }

          // Navigate: visual only (Up/Down), handled by component
          if (result.action === "navigate") {
            return true;
          }

          // Drill: Tab action (go deeper or smart select)
          if (result.action === "drill") {
            // Let the component handle executing the DRILL action
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
    [disabled, dropdown]
  );

  // ============================================================
  // Trigger And Apply (Hybrid Behavior)
  // ============================================================

  const triggerAndApply = useCallback(
    async (text: string, cursorPosition: number): Promise<{ text: string; cursorPosition: number } | null> => {
      if (disabled) return null;

      // Build context
      const context: CompletionContext = buildContext(
        text,
        cursorPosition,
        userBindings,
        signatures,
        docstrings
      );

      // Find active provider (for Tab, use symbol provider)
      const provider = getActiveProvider(context);
      if (!provider) return null;

      // Get completions synchronously for Tab behavior
      const result = await provider.getCompletions(context);

      if (result.items.length === 0) return null;

      // Open dropdown with all items - pass original text/cursor for session
      dropdown.open(result.items, result.anchor, provider.id, text, cursorPosition);

      // Apply the first item immediately (using original text/cursor)
      const firstItem = result.items[0];
      return applyCompletionItem(
        firstItem,
        text,
        cursorPosition,
        result.anchor
      );
    },
    [disabled, userBindings, signatures, docstrings, dropdown]
  );

  // ============================================================
  // Apply Selected Completion (does NOT close - for cycling)
  // Uses ORIGINAL text/cursor stored when session started!
  // ============================================================

  const applySelected = useCallback(
    (): { text: string; cursorPosition: number } | null => {
      const selected = dropdown.selectedItem;
      if (!selected) return null;

      // KEY FIX: Use stored original text/cursor, NOT current values
      // This allows Tab cycling to correctly replace the original word
      return applyCompletionItem(
        selected,
        dropdown.state.originalText,
        dropdown.state.originalCursor,
        dropdown.state.anchorPosition
      );
    },
    [dropdown]
  );

  // ============================================================
  // Confirm Selected (applies AND closes dropdown)
  // ============================================================

  const confirmSelected = useCallback(
    (): { text: string; cursorPosition: number } | null => {
      const selected = dropdown.selectedItem;
      if (!selected) return null;

      // Use stored original values
      const result = applyCompletionItem(
        selected,
        dropdown.state.originalText,
        dropdown.state.originalCursor,
        dropdown.state.anchorPosition
      );

      dropdown.close();
      return result;
    },
    [dropdown]
  );

  // ============================================================
  // Computed Values
  // ============================================================

  const isVisible = useMemo(
    () => dropdown.isDropdownActive,
    [dropdown.isDropdownActive]
  );

  const activeProviderId = useMemo(
    () => dropdown.state.providerId,
    [dropdown.state.providerId]
  );

  // Get help text from active provider (GENERIC: provider defines its own help text)
  const activeProviderHelpText = useMemo(() => {
    const providerId = dropdown.state.providerId;
    if (!providerId) return "";
    const provider = ALL_PROVIDERS.find((p) => p.id === providerId);
    return provider?.helpText ?? "↑↓ navigate • Tab drill • Enter select • Esc cancel";
  }, [dropdown.state.providerId]);

  // ============================================================
  // Return
  // ============================================================

  return useMemo(
    () => ({
      dropdown,
      triggerCompletion,
      triggerAndApply,
      handleKey,
      applySelected,
      confirmSelected,
      isVisible,
      activeProviderId,
      activeProviderHelpText,
    }),
    [dropdown, triggerCompletion, triggerAndApply, handleKey, applySelected, confirmSelected, isVisible, activeProviderId, activeProviderHelpText]
  );
}
