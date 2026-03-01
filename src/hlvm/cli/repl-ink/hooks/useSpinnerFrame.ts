/**
 * useSpinnerFrame
 *
 * Shared spinner-frame animation hook for REPL/TUI components.
 * Keeps spinner behavior consistent and avoids duplicated interval logic.
 */

import { useEffect, useState } from "react";
import {
  BRAILLE_SPINNER_FRAMES,
  SPINNER_FRAME_MS,
} from "../ui-constants.ts";

export function useSpinnerFrame(isActive = true): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setFrame(0);
      return;
    }

    const interval = setInterval(() => {
      setFrame((current: number) => (current + 1) % BRAILLE_SPINNER_FRAMES.length);
    }, SPINNER_FRAME_MS);

    return () => clearInterval(interval);
  }, [isActive]);

  return frame;
}
