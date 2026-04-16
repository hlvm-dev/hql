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

  const resetPasteTimeout = React.useCallback(
    (currentTimeoutId: ReturnType<typeof setTimeout> | null) => {
      if (currentTimeoutId) {
        clearTimeout(currentTimeoutId);
      }

      return setTimeout(() => {
        pastePendingRef.current = false;
        setPasteState(({ chunks }) => {
          const pastedText = chunks.join("").replace(/\[I$/, "").replace(
            /\[O$/,
            "",
          );

          if (onPaste) {
            onPaste(pastedText);
          }

          setIsPasting(false);
          return { chunks: [], timeoutId: null };
        });
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
      setPasteState(({ chunks, timeoutId }) => ({
        chunks: [...chunks, input],
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
