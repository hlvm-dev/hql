import { useEffect, useRef } from "react";
import { useSelection } from "../../../vendor/ink/hooks/use-selection.ts";
import { useTheme } from "../../theme/index.ts";

// Auto-copy-on-select. The vendored ink engine enables mouse tracking,
// which prevents Terminal.app / iTerm2 from doing native text selection.
// To keep Cmd+C feeling natural we write the selection to the system
// clipboard at mouse-up, so the clipboard already holds the right text
// when the terminal intercepts the copy keystroke.
//
// Selection contract:
//   - isDragging=true            → reset copiedRef (new drag).
//   - !hasSelection              → reset copiedRef (cleared).
//   - settled selection, first   → copy once, invoke `onCopied`.
//
// `copiedRef` guards against duplicate toasts on spurious notifies.

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
