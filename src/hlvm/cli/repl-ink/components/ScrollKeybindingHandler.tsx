import React from "react";
import type { ScrollBoxHandle } from "../../../vendor/ink/components/ScrollBox.tsx";
import type { Key } from "../../../vendor/ink/events/input-event.ts";
import useInput from "../../../vendor/ink/hooks/use-input.ts";
import { useSelection } from "../../../vendor/ink/hooks/use-selection.ts";
import { isXtermJs } from "../../../vendor/ink/terminal.ts";

type Props = {
  scrollRef: React.RefObject<ScrollBoxHandle | null>;
  isActive: boolean;
  onScroll?: (sticky: boolean, handle: ScrollBoxHandle) => void;
  onSelectionCopied?: (text: string) => void;
};

type WheelAccelState = {
  time: number;
  mult: number;
  dir: 0 | 1 | -1;
  xtermJs: boolean;
  frac: number;
};

const WHEEL_ACCEL_WINDOW_MS = 40;
const WHEEL_ACCEL_STEP = 0.3;
const WHEEL_ACCEL_MAX = 6;
const WHEEL_DECAY_HALFLIFE_MS = 150;
const WHEEL_DECAY_STEP = 5;
const WHEEL_BURST_MS = 5;
const WHEEL_DECAY_GAP_MS = 80;
const WHEEL_DECAY_CAP_SLOW = 3;
const WHEEL_DECAY_CAP_FAST = 6;
const WHEEL_DECAY_IDLE_MS = 500;

function initWheelAccel(): WheelAccelState {
  return {
    time: 0,
    mult: 1,
    dir: 0,
    xtermJs: isXtermJs(),
    frac: 0,
  };
}

function computeWheelStep(
  state: WheelAccelState,
  dir: 1 | -1,
  now: number,
): number {
  if (!state.xtermJs) {
    const gap = now - state.time;
    if (dir !== state.dir || gap > WHEEL_ACCEL_WINDOW_MS) {
      state.mult = 1;
    } else {
      state.mult = Math.min(WHEEL_ACCEL_MAX, state.mult + WHEEL_ACCEL_STEP);
    }
    state.time = now;
    state.dir = dir;
    return Math.floor(state.mult);
  }

  const gap = now - state.time;
  const sameDir = dir === state.dir;
  state.time = now;
  state.dir = dir;

  if (sameDir && gap < WHEEL_BURST_MS) {
    return 1;
  }

  if (!sameDir || gap > WHEEL_DECAY_IDLE_MS) {
    state.mult = 2;
    state.frac = 0;
  } else {
    const momentum = Math.pow(0.5, gap / WHEEL_DECAY_HALFLIFE_MS);
    const cap = gap >= WHEEL_DECAY_GAP_MS
      ? WHEEL_DECAY_CAP_SLOW
      : WHEEL_DECAY_CAP_FAST;
    state.mult = Math.min(
      cap,
      1 + (state.mult - 1) * momentum + WHEEL_DECAY_STEP * momentum,
    );
  }

  const total = state.mult + state.frac;
  const rows = Math.floor(total);
  state.frac = total - rows;
  return rows;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function maxScrollTop(handle: ScrollBoxHandle): number {
  return Math.max(0, handle.getScrollHeight() - handle.getViewportHeight());
}

function currentScrollTop(handle: ScrollBoxHandle): number {
  return handle.getScrollTop() + handle.getPendingDelta();
}

function translateSelectionForJump(
  handle: ScrollBoxHandle,
  selection: ReturnType<typeof useSelection>,
  delta: number,
): void {
  const state = selection.getState();
  if (!state?.anchor || !state.focus) return;

  const top = handle.getViewportTop();
  const bottom = top + handle.getViewportHeight() - 1;

  if (state.anchor.row < top || state.anchor.row > bottom) return;
  if (state.focus.row < top || state.focus.row > bottom) return;

  const max = maxScrollTop(handle);
  const current = currentScrollTop(handle);
  const actual = clamp(current + delta, 0, max) - current;
  if (actual === 0) return;

  if (actual > 0) {
    selection.captureScrolledRows(top, top + actual - 1, "above");
    selection.shiftSelection(-actual, top, bottom);
    return;
  }

  const distance = -actual;
  selection.captureScrolledRows(bottom - distance + 1, bottom, "below");
  selection.shiftSelection(distance, top, bottom);
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

function scrollDown(handle: ScrollBoxHandle, rows: number): boolean {
  if (rows <= 0) return handle.isSticky();
  const max = maxScrollTop(handle);
  if (currentScrollTop(handle) + rows >= max) {
    handle.scrollToBottom();
    return true;
  }
  handle.scrollBy(rows);
  return false;
}

function scrollUp(handle: ScrollBoxHandle, rows: number): boolean {
  if (rows <= 0) return handle.isSticky();
  if (currentScrollTop(handle) - rows <= 0) {
    handle.scrollTo(0);
    return false;
  }
  handle.scrollBy(-rows);
  return false;
}

function isScrollKey(key: Key): boolean {
  return key.pageUp || key.pageDown || key.wheelUp || key.wheelDown;
}

function shouldClearSelectionOnKey(key: Key): boolean {
  if (key.wheelUp || key.wheelDown) return false;
  const isNav = key.leftArrow || key.rightArrow || key.upArrow ||
    key.downArrow || key.home || key.end || key.pageUp || key.pageDown;
  if (isNav && (key.shift || key.meta || key.super)) return false;
  return true;
}

function selectionFocusMoveForKey(
  key: Key,
): "left" | "right" | "up" | "down" | "lineStart" | "lineEnd" | null {
  if (!key.shift || key.meta || key.super) return null;
  if (key.leftArrow) return "left";
  if (key.rightArrow) return "right";
  if (key.upArrow) return "up";
  if (key.downArrow) return "down";
  if (key.home) return "lineStart";
  if (key.end) return "lineEnd";
  return null;
}

export function ScrollKeybindingHandler({
  scrollRef,
  isActive,
  onScroll,
  onSelectionCopied,
}: Props): React.ReactNode {
  const wheelAccelRef = React.useRef<WheelAccelState | null>(null);
  const selection = useSelection();

  useInput((input, key, event) => {
    if (!isActive) return;
    const handle = scrollRef.current;
    if (!handle) return;

    if (key.pageUp) {
      event.stopImmediatePropagation();
      const delta = -Math.max(1, Math.floor(handle.getViewportHeight() / 2));
      translateSelectionForJump(handle, selection, delta);
      const sticky = jumpBy(handle, delta);
      onScroll?.(sticky, handle);
      return;
    }

    if (key.pageDown) {
      event.stopImmediatePropagation();
      const delta = Math.max(1, Math.floor(handle.getViewportHeight() / 2));
      translateSelectionForJump(handle, selection, delta);
      const sticky = jumpBy(handle, delta);
      onScroll?.(sticky, handle);
      return;
    }

    if (key.wheelUp) {
      if (handle.getScrollHeight() <= handle.getViewportHeight()) return;
      event.stopImmediatePropagation();
      selection.clearSelection();
      wheelAccelRef.current ??= initWheelAccel();
      const sticky = scrollUp(
        handle,
        computeWheelStep(wheelAccelRef.current, -1, performance.now()),
      );
      onScroll?.(sticky, handle);
      return;
    }

    if (key.wheelDown) {
      if (handle.getScrollHeight() <= handle.getViewportHeight()) return;
      event.stopImmediatePropagation();
      selection.clearSelection();
      wheelAccelRef.current ??= initWheelAccel();
      const sticky = scrollDown(
        handle,
        computeWheelStep(wheelAccelRef.current, 1, performance.now()),
      );
      onScroll?.(sticky, handle);
      return;
    }

    if (isScrollKey(key) || input.length === 0) {
      return;
    }

    wheelAccelRef.current = null;
  }, { isActive });

  useInput((input, key, event) => {
    if (!isActive || !selection.hasSelection()) return;

    if (key.escape) {
      selection.clearSelection();
      event.stopImmediatePropagation();
      return;
    }

    const normalizedInput = input.toLowerCase();
    if ((key.ctrl || key.super) && normalizedInput === "c") {
      const text = selection.copySelection();
      if (text) onSelectionCopied?.(text);
      event.stopImmediatePropagation();
      return;
    }

    const move = selectionFocusMoveForKey(key);
    if (move) {
      selection.moveFocus(move);
      event.stopImmediatePropagation();
      return;
    }

    if (shouldClearSelectionOnKey(key)) {
      selection.clearSelection();
    }
  }, { isActive });

  return null;
}
