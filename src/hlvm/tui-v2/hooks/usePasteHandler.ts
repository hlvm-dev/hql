import React from "react";
import type { InputEvent, Key } from "../ink/events/input-event.ts";

const PASTE_THRESHOLD = 800;
const PASTE_COMPLETION_TIMEOUT_MS = 100;

type PasteHandlerProps = {
  onPaste?: (text: string) => void;
  onInput: (input: string, key: Key) => void;
  onImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: { width: number; height: number },
    sourcePath?: string,
  ) => void;
};

export function usePasteHandler({
  onPaste,
  onInput,
}: PasteHandlerProps): {
  wrappedOnInput: (input: string, key: Key, event: InputEvent) => void;
  pasteState: {
    chunks: string[];
    timeoutId: ReturnType<typeof setTimeout> | null;
  };
  isPasting: boolean;
} {
  const [pasteState, setPasteState] = React.useState<{
    chunks: string[];
    timeoutId: ReturnType<typeof setTimeout> | null;
  }>({ chunks: [], timeoutId: null });
  const [isPasting, setIsPasting] = React.useState(false);
  const pastePendingRef = React.useRef(false);
  // Mirror chunks into a ref so the paste-completion timeout can read the
  // final text WITHOUT performing side-effects inside the `setPasteState`
  // updater. Calling the parent `onPaste` (which setValue's PromptInput)
  // from inside a React state-updater callback triggered the warning:
  //   "Cannot update a component (`PromptInput`) while rendering a different
  //    component (`BaseTextInput`). …setstate-in-render"
  // The stderr text for that warning then leaked into the tmux PTY and
  // corrupted the ink-drawn screen. Moving side-effects out of the updater
  // eliminates the warning at its source.
  const chunksRef = React.useRef<string[]>([]);

  const resetPasteTimeout = React.useCallback(
    (currentTimeoutId: ReturnType<typeof setTimeout> | null) => {
      if (currentTimeoutId) {
        clearTimeout(currentTimeoutId);
      }

      return setTimeout(() => {
        pastePendingRef.current = false;
        const pastedText = chunksRef.current
          .join("")
          .replace(/\[I$/, "")
          .replace(/\[O$/, "");
        chunksRef.current = [];
        setPasteState({ chunks: [], timeoutId: null });
        setIsPasting(false);
        if (onPaste) {
          onPaste(pastedText);
        }
      }, PASTE_COMPLETION_TIMEOUT_MS);
    },
    [onPaste],
  );

  const wrappedOnInput = React.useCallback((
    input: string,
    key: Key,
    event: InputEvent,
  ): void => {
    const isFromPaste = event.keypress.isPasted;

    if (isFromPaste) {
      setIsPasting(true);
    }

    const shouldHandleAsPaste = Boolean(
      onPaste &&
        (input.length > PASTE_THRESHOLD || pastePendingRef.current || isFromPaste),
    );

    if (shouldHandleAsPaste) {
      pastePendingRef.current = true;
      chunksRef.current = [...chunksRef.current, input];
      setPasteState(({ timeoutId }) => ({
        chunks: chunksRef.current,
        timeoutId: resetPasteTimeout(timeoutId),
      }));
      return;
    }

    onInput(input, key);

    if (input.length > 10) {
      setIsPasting(false);
    }
  }, [onInput, onPaste, resetPasteTimeout]);

  return {
    wrappedOnInput,
    pasteState,
    isPasting,
  };
}
