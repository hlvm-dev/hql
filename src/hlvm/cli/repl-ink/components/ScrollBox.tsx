/**
 * ScrollBox — windowed scroll container on ink@7 primitives.
 *
 * Renders children inside a clipped outer Box; scroll position shifts the
 * inner Box upward via negative marginTop. Tracks scroll height and
 * viewport height via measureElement on every commit. Sticky-bottom mode
 * auto-pins to the latest content as it grows — the typical chat-streaming
 * pattern. Imperative methods (scrollTo / scrollBy / scrollToBottom /
 * scrollToElement / getters / subscribe / setClampBounds) match the
 * earlier vendored handle so consumers (App, FullscreenLayout,
 * ScrollKeybindingHandler, VirtualTranscript, useVirtualScroll) work
 * unchanged.
 */

import React, {
  forwardRef,
  type ReactNode,
  type Ref,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Box, type DOMElement, measureElement } from "ink";

export type ScrollBoxHandle = {
  scrollTo: (y: number) => void;
  scrollBy: (dy: number) => void;
  scrollToElement: (el: DOMElement, offset?: number) => void;
  scrollToBottom: () => void;
  getScrollTop: () => number;
  getPendingDelta: () => number;
  getScrollHeight: () => number;
  getFreshScrollHeight: () => number;
  getViewportHeight: () => number;
  getViewportTop: () => number;
  isSticky: () => boolean;
  subscribe: (cb: () => void) => () => void;
  setClampBounds: (min: number | undefined, max: number | undefined) => void;
};

export type ScrollBoxSnapshot = {
  scrollTop: number;
  scrollHeight: number;
  viewportHeight: number;
  maxScrollTop: number;
  linesBelow: number;
  isSticky: boolean;
};

type ScrollBoxProps = {
  children?: ReactNode;
  flexGrow?: number;
  flexShrink?: number;
  flexDirection?: "row" | "column";
  stickyScroll?: boolean;
  onScrollStateChange?: (snapshot: ScrollBoxSnapshot) => void;
};

const ScrollBox = forwardRef<ScrollBoxHandle, ScrollBoxProps>(
  function ScrollBox(
    {
      children,
      flexGrow,
      flexShrink,
      stickyScroll = false,
      onScrollStateChange,
    }: ScrollBoxProps,
    ref: Ref<ScrollBoxHandle>,
  ): React.ReactElement {
    const outerRef = useRef<DOMElement | null>(null);
    const innerRef = useRef<DOMElement | null>(null);

    const scrollTopRef = useRef(0);
    const scrollHeightRef = useRef(0);
    const viewportHeightRef = useRef(0);
    const isStickyRef = useRef(stickyScroll);
    const clampMinRef = useRef<number | undefined>(undefined);
    const clampMaxRef = useRef<number | undefined>(undefined);
    const subscribersRef = useRef<Set<() => void>>(new Set());
    const scrollStateCallbackRef = useRef(onScrollStateChange);
    const lastSnapshotSignatureRef = useRef("");
    scrollStateCallbackRef.current = onScrollStateChange;

    const [, forceRender] = useState(0);
    const triggerRender = useCallback(
      () => forceRender((n: number) => n + 1),
      [],
    );

    const notify = useCallback(() => {
      for (const cb of subscribersRef.current) cb();
    }, []);

    const getSnapshot = useCallback((): ScrollBoxSnapshot => {
      const maxScrollTop = Math.max(
        0,
        scrollHeightRef.current - viewportHeightRef.current,
      );
      const scrollTop = Math.max(0, Math.min(scrollTopRef.current, maxScrollTop));
      return {
        scrollTop,
        scrollHeight: scrollHeightRef.current,
        viewportHeight: viewportHeightRef.current,
        maxScrollTop,
        linesBelow: Math.max(0, maxScrollTop - scrollTop),
        isSticky: isStickyRef.current,
      };
    }, []);

    const emitScrollState = useCallback(() => {
      const snapshot = getSnapshot();
      const signature = [
        snapshot.scrollTop,
        snapshot.scrollHeight,
        snapshot.viewportHeight,
        snapshot.maxScrollTop,
        snapshot.linesBelow,
        snapshot.isSticky ? 1 : 0,
      ].join(":");
      if (lastSnapshotSignatureRef.current === signature) return;
      lastSnapshotSignatureRef.current = signature;
      scrollStateCallbackRef.current?.(snapshot);
    }, [getSnapshot]);

    const clamp = useCallback((y: number): number => {
      const max = Math.max(
        0,
        scrollHeightRef.current - viewportHeightRef.current,
      );
      const lo = clampMinRef.current ?? 0;
      const hi = clampMaxRef.current ?? max;
      return Math.max(lo, Math.min(y, hi));
    }, []);

    // Measure on every commit. Yoga can shift values without React knowing,
    // so this runs unconditionally and writes refs (no setState loop).
    useLayoutEffect(() => {
      if (innerRef.current) {
        const inner = measureElement(innerRef.current);
        scrollHeightRef.current = inner.height;
      }
      if (outerRef.current) {
        const outer = measureElement(outerRef.current);
        viewportHeightRef.current = outer.height;
      }

      let changed = false;
      const clampedTop = clamp(scrollTopRef.current);
      if (clampedTop !== scrollTopRef.current) {
        scrollTopRef.current = clampedTop;
        changed = true;
      }

      // Sticky-bottom: pin to bottom when content grew past viewport
      if (
        isStickyRef.current &&
        scrollHeightRef.current > viewportHeightRef.current
      ) {
        const newTop = scrollHeightRef.current - viewportHeightRef.current;
        if (newTop !== scrollTopRef.current) {
          scrollTopRef.current = newTop;
          changed = true;
        }
      }

      emitScrollState();
      if (changed) {
        triggerRender();
        notify();
      }
    });

    useImperativeHandle(
      ref,
      () => ({
        scrollTo: (y: number) => {
          scrollTopRef.current = clamp(y);
          isStickyRef.current = false;
          triggerRender();
          notify();
          emitScrollState();
        },
        scrollBy: (dy: number) => {
          scrollTopRef.current = clamp(scrollTopRef.current + dy);
          isStickyRef.current = false;
          triggerRender();
          notify();
          emitScrollState();
        },
        scrollToBottom: () => {
          const max = Math.max(
            0,
            scrollHeightRef.current - viewportHeightRef.current,
          );
          scrollTopRef.current = max;
          isStickyRef.current = true;
          triggerRender();
          notify();
          emitScrollState();
        },
        scrollToElement: (el: DOMElement, offset = 0) => {
          // Measure target element's position relative to inner content.
          // measureElement returns dimensions only; for vertical position
          // we need the element's top within the scrollable inner box.
          // ink@7 doesn't expose Yoga node positions directly, so we
          // approximate by setting scrollTop to keep the element near top.
          const m = measureElement(el);
          scrollTopRef.current = clamp(Math.max(0, m.height + offset));
          isStickyRef.current = false;
          triggerRender();
          notify();
          emitScrollState();
        },
        getScrollTop: () => scrollTopRef.current,
        getPendingDelta: () => 0,
        getScrollHeight: () => scrollHeightRef.current,
        getFreshScrollHeight: () => {
          if (innerRef.current) {
            const m = measureElement(innerRef.current);
            scrollHeightRef.current = m.height;
          }
          return scrollHeightRef.current;
        },
        getViewportHeight: () => viewportHeightRef.current,
        getViewportTop: () => 0,
        isSticky: () => isStickyRef.current,
        subscribe: (cb: () => void) => {
          subscribersRef.current.add(cb);
          return () => {
            subscribersRef.current.delete(cb);
          };
        },
        setClampBounds: (min: number | undefined, max: number | undefined) => {
          clampMinRef.current = min;
          clampMaxRef.current = max;
          if (
            scrollTopRef.current !== clamp(scrollTopRef.current)
          ) {
            scrollTopRef.current = clamp(scrollTopRef.current);
            triggerRender();
            notify();
            emitScrollState();
          }
        },
      }),
      [clamp, emitScrollState, notify, triggerRender],
    );

    return (
      <Box
        ref={outerRef}
        flexGrow={flexGrow}
        flexShrink={flexShrink}
        flexDirection="column"
        overflow="hidden"
      >
        <Box
          ref={innerRef}
          flexDirection="column"
          flexShrink={0}
          marginTop={-scrollTopRef.current}
        >
          {children}
        </Box>
      </Box>
    );
  },
);

export default ScrollBox;
