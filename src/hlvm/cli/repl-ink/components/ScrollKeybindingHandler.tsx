import React, { useCallback } from "react";
import { type Key, useInput } from "ink";
import type { ScrollBoxHandle } from "./ScrollBox.tsx";
import {
  getWheelScrollRows,
  getWheelScrollRowsFromInput,
  parseTerminalScrollAction,
  type TerminalScrollAction,
} from "../utils/terminal-mouse.ts";

type Props = {
  scrollRef: React.RefObject<ScrollBoxHandle | null>;
  isActive: boolean;
  onScroll?: (sticky: boolean, handle: ScrollBoxHandle) => void;
};

const WHEEL_ROWS_PER_NOTCH = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function maxScrollTop(handle: ScrollBoxHandle): number {
  return Math.max(0, handle.getScrollHeight() - handle.getViewportHeight());
}

function currentScrollTop(handle: ScrollBoxHandle): number {
  return handle.getScrollTop() + handle.getPendingDelta();
}

function jumpBy(handle: ScrollBoxHandle, delta: number): boolean {
  const max = maxScrollTop(handle);
  const target = clamp(currentScrollTop(handle) + delta, 0, max);
  if (target >= max) {
    handle.scrollTo(max);
    handle.scrollToBottom();
    return true;
  }
  handle.scrollTo(target);
  return false;
}

function isScrollKey(key: Key): boolean {
  return Boolean(
    key.pageUp || key.pageDown || key.home || key.end ||
      (key.shift && (key.upArrow || key.downArrow)),
  );
}

function getActionDelta(
  action: TerminalScrollAction,
  handle: ScrollBoxHandle,
): number | null {
  switch (action) {
    case "page-up":
      return -Math.max(1, Math.floor(handle.getViewportHeight() / 2));
    case "page-down":
      return Math.max(1, Math.floor(handle.getViewportHeight() / 2));
    case "home":
    case "end":
      return null;
  }
}

export function ScrollKeybindingHandler({
  scrollRef,
  isActive,
  onScroll,
}: Props): React.ReactNode {
  const applyScrollInput = useCallback(
    (input: string, key?: Key): boolean => {
      if (!isActive) return false;
      const handle = scrollRef.current;
      if (!handle) return false;

      const action = parseTerminalScrollAction(input);
      if (action === "home" || key?.home) {
        handle.scrollTo(0);
        onScroll?.(false, handle);
        return true;
      }
      if (action === "end" || key?.end) {
        handle.scrollToBottom();
        onScroll?.(true, handle);
        return true;
      }
      if (action) {
        const delta = getActionDelta(action, handle);
        if (delta !== null) {
          const sticky = jumpBy(handle, delta);
          onScroll?.(sticky, handle);
          return true;
        }
      }

      const rawWheelRows = getWheelScrollRowsFromInput(
        input,
        WHEEL_ROWS_PER_NOTCH,
      );
      if (rawWheelRows !== 0) {
        const sticky = jumpBy(handle, rawWheelRows);
        onScroll?.(sticky, handle);
        return true;
      }

      const wheelRows = getWheelScrollRows(input, WHEEL_ROWS_PER_NOTCH);
      if (wheelRows !== 0) {
        const sticky = jumpBy(handle, wheelRows);
        onScroll?.(sticky, handle);
        return true;
      }

      if (key?.pageUp) {
        const delta = -Math.max(1, Math.floor(handle.getViewportHeight() / 2));
        const sticky = jumpBy(handle, delta);
        onScroll?.(sticky, handle);
        return true;
      }

      if (key?.pageDown) {
        const delta = Math.max(1, Math.floor(handle.getViewportHeight() / 2));
        const sticky = jumpBy(handle, delta);
        onScroll?.(sticky, handle);
        return true;
      }

      if (key?.shift && key.upArrow) {
        const sticky = jumpBy(handle, -1);
        onScroll?.(sticky, handle);
        return true;
      }

      if (key?.shift && key.downArrow) {
        const sticky = jumpBy(handle, 1);
        onScroll?.(sticky, handle);
        return true;
      }

      return false;
    },
    [isActive, onScroll, scrollRef],
  );

  useInput((input, key) => {
    if (applyScrollInput(input, key)) return;

    if (isScrollKey(key) || input.length === 0) {
      return;
    }
  }, { isActive });

  return null;
}
