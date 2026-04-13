/**
 * useViewportScroll — manages scroll state for the fullscreen viewport.
 *
 * Uses "offset from bottom" semantics: offset 0 = pinned to bottom (sticky),
 * positive offset = scrolled up by that many items.
 *
 * Reuses the pure math from conversation-viewport.ts.
 *
 * All scroll action callbacks are stable (never recreated) — they read
 * current itemCount/visibleCount from refs, not closures.  This means
 * the returned `actions` object is safe to store once and call later
 * without stale-closure bugs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clampConversationScrollOffset,
  computeConversationViewport,
} from "../utils/conversation-viewport.ts";

export interface ViewportScrollActions {
  scrollUp(count: number): void;
  scrollDown(count: number): void;
  scrollToTop(): void;
  scrollToBottom(): void;
}

export interface ViewportScrollResult {
  /** True when pinned to bottom — new items auto-scroll into view. */
  isSticky: boolean;
  actions: ViewportScrollActions;
  /** Computed viewport: { start, end, hiddenAbove, hiddenBelow }. */
  viewport: ReturnType<typeof computeConversationViewport>;
}

export function useViewportScroll(
  itemCount: number,
  visibleCount: number,
): ViewportScrollResult {
  const [scrollOffsetFromBottom, setScrollOffsetFromBottom] = useState(0);
  const isSticky = scrollOffsetFromBottom === 0;

  // Refs for current values — callbacks read from these to avoid stale closures
  const itemCountRef = useRef(itemCount);
  const visibleCountRef = useRef(visibleCount);
  itemCountRef.current = itemCount;
  visibleCountRef.current = visibleCount;

  // Auto-reset offset when items are cleared (new conversation)
  const prevItemCount = useRef(itemCount);
  useEffect(() => {
    if (itemCount === 0 && prevItemCount.current > 0) {
      setScrollOffsetFromBottom(0);
    }
    prevItemCount.current = itemCount;
  }, [itemCount]);

  // Stable callbacks — never recreated, always read current values from refs
  const scrollUp = useCallback(
    (count: number) => {
      setScrollOffsetFromBottom((prev: number) =>
        clampConversationScrollOffset(
          prev + count,
          itemCountRef.current,
          visibleCountRef.current,
        )
      );
    },
    [],
  );

  const scrollDown = useCallback(
    (count: number) => {
      setScrollOffsetFromBottom((prev: number) =>
        clampConversationScrollOffset(
          prev - count,
          itemCountRef.current,
          visibleCountRef.current,
        )
      );
    },
    [],
  );

  const scrollToTop = useCallback(() => {
    setScrollOffsetFromBottom(
      clampConversationScrollOffset(
        itemCountRef.current,
        itemCountRef.current,
        visibleCountRef.current,
      ),
    );
  }, []);

  const scrollToBottom = useCallback(() => {
    setScrollOffsetFromBottom(0);
  }, []);

  // Stable actions object — safe to capture once and call later
  const actions = useMemo<ViewportScrollActions>(
    () => ({ scrollUp, scrollDown, scrollToTop, scrollToBottom }),
    [scrollUp, scrollDown, scrollToTop, scrollToBottom],
  );

  const viewport = useMemo(
    () => computeConversationViewport(itemCount, visibleCount, scrollOffsetFromBottom),
    [itemCount, visibleCount, scrollOffsetFromBottom],
  );

  return { isSticky, actions, viewport };
}
