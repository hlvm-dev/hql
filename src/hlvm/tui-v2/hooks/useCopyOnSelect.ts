import { useEffect, useRef } from "react";
import { useSelection } from "../ink/hooks/use-selection.ts";
import { useTheme } from "../../cli/theme/index.ts";

// Auto-copy-on-select for v2 — direct port of CC's `useCopyOnSelect`
// (`~/dev/ClaudeCode-main/hooks/useCopyOnSelect.ts`). When the user
// finishes a drag (mouse-up with a non-empty range) OR completes a
// multi-click (double-click word, triple-click line), write the
// selection to the system clipboard. The visible highlight is left
// intact so the user can see what was copied.
//
// Why this is needed: v2 hard-copies the CC donor ink engine, which
// enables mouse tracking. That tracking prevents Terminal.app / iTerm2
// from performing native text selection, so a plain drag + Cmd+C ends
// with nothing selected in the host terminal — macOS Terminal beeps
// because the Edit > Copy menu item is disabled. CC's fix is to write
// the clipboard at mouse-up so that when Cmd+C is intercepted by the
// terminal (and the beep fires), the clipboard already contains the
// right text and Cmd+V pastes the expected content.
//
// Contract (matches CC exactly):
//   - On every selection notification, read isDragging + hasSelection.
//   - isDragging=true   → reset copiedRef (a new drag is in progress).
//   - !hasSelection     → reset copiedRef (cleared / click-without-drag).
//   - Otherwise (settled with selection, first time) → copy once and
//     invoke `onCopied`.
//
// The `copiedRef` guard prevents duplicate toasts on spurious notifies.

export interface UseCopyOnSelectOptions {
  /** Invoked with the copied text when a fresh copy happens. */
  readonly onCopied?: (text: string) => void;
  /** Toggle off (e.g. when the shell is not visible). */
  readonly isActive?: boolean;
}

export function useCopyOnSelect(options: UseCopyOnSelectOptions = {}): void {
  const { onCopied, isActive = true } = options;
  const selection = useSelection();

  // Whether the previous settled selection was already copied. Reset
  // when a new drag starts or when the selection clears.
  const copiedRef = useRef(false);
  // onCopied may be a fresh closure each render — read via ref so the
  // effect doesn't re-subscribe (which would reset copiedRef).
  const onCopiedRef = useRef(onCopied);
  onCopiedRef.current = onCopied;

  useEffect(() => {
    if (!isActive) return;

    const unsubscribe = selection.subscribe(() => {
      const sel = selection.getState();
      const has = selection.hasSelection();

      if (sel?.isDragging) {
        copiedRef.current = false;
        return;
      }
      if (!has) {
        copiedRef.current = false;
        return;
      }
      if (copiedRef.current) return;

      const text = selection.copySelectionNoClear();
      if (!text || !text.trim()) {
        copiedRef.current = true;
        return;
      }
      copiedRef.current = true;
      onCopiedRef.current?.(text);
    });
    return unsubscribe;
  }, [isActive, selection]);
}

export function useSelectionBgColor(isActive = true): void {
  const selection = useSelection();
  const { theme } = useTheme();

  useEffect(() => {
    if (!isActive) return;
    selection.setSelectionBgColor(theme.primary);
  }, [isActive, selection, theme.primary]);
}
