/**
 * useAlternateBuffer
 *
 * Toggles terminal alternate buffer mode using ANSI private mode 1049.
 * This gives a fullscreen-like scroll experience for long-running views.
 */

import { useEffect, useRef } from "react";
import { useStdout } from "ink";

const ENTER_ALT_BUFFER = "\x1b[?1049h";
const EXIT_ALT_BUFFER = "\x1b[?1049l";

interface WritableStdout {
  write: (chunk: string) => boolean;
  isTTY?: boolean;
}

export function resolveWritableStdout(value: unknown): WritableStdout | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WritableStdout>;
  if (typeof candidate.write !== "function") return null;
  // Preserve the original stream object so write() keeps its stream receiver.
  return candidate as WritableStdout;
}

export function useAlternateBuffer(enabled: boolean): void {
  const { stdout } = useStdout();
  const isActiveRef = useRef(false);

  useEffect(() => {
    const stream = resolveWritableStdout(stdout);
    if (!stream || stream.isTTY === false) return;

    if (enabled && !isActiveRef.current) {
      stream.write(ENTER_ALT_BUFFER);
      isActiveRef.current = true;
      return;
    }

    if (!enabled && isActiveRef.current) {
      stream.write(EXIT_ALT_BUFFER);
      isActiveRef.current = false;
    }
  }, [enabled, stdout]);

  useEffect(() => {
    return () => {
      const stream = resolveWritableStdout(stdout);
      if (!stream || stream.isTTY === false) return;
      if (!isActiveRef.current) return;
      stream.write(EXIT_ALT_BUFFER);
      isActiveRef.current = false;
    };
  }, [stdout]);
}
