import type { RefObject } from "react";
import React from "react";
import {
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useVirtualScroll } from "../hooks/useVirtualScroll.ts";
import Box from "../ink/components/Box.tsx";
import type { ScrollBoxHandle } from "../ink/components/ScrollBox.tsx";
import type { DOMElement } from "../ink/dom.ts";
import type { MatchPosition } from "../ink/render-to-screen.ts";
import {
  isNavigableMessage,
  type MessageActionsNav,
  type MessageActionsState,
  stripSystemReminders,
  toolCallOf,
} from "./compat/messageActions.ts";
import { ScrollChromeContext } from "./compat/ScrollChromeContext.tsx";
import { TextHoverColorContext } from "./compat/TextHoverColorContext.tsx";
import { renderableSearchText } from "./compat/transcriptSearch.ts";
import type { RenderableTranscriptMessage } from "./types.ts";

const NOOP_UNSUB = () => {};
const STICKY_TEXT_CAP = 500;
const HEADROOM = 3;

type StickyPrompt = {
  text: string;
  scrollTo: () => void;
};

export type JumpHandle = {
  jumpToIndex: (index: number) => void;
  setSearchQuery: (query: string) => void;
  nextMatch: () => void;
  prevMatch: () => void;
  setAnchor: () => void;
  warmSearchIndex: () => Promise<number>;
  disarmSearch: () => void;
};

type Props = {
  messages: RenderableTranscriptMessage[];
  scrollRef: RefObject<ScrollBoxHandle | null>;
  columns: number;
  itemKey: (msg: RenderableTranscriptMessage) => string;
  renderItem: (
    msg: RenderableTranscriptMessage,
    index: number,
  ) => React.ReactNode;
  onItemClick?: (msg: RenderableTranscriptMessage) => void;
  isItemClickable?: (msg: RenderableTranscriptMessage) => boolean;
  isItemExpanded?: (msg: RenderableTranscriptMessage) => boolean;
  extractSearchText?: (msg: RenderableTranscriptMessage) => string;
  trackStickyPrompt?: boolean;
  selectedIndex?: number;
  cursorNavRef?: React.Ref<MessageActionsNav | null>;
  setCursor?: (cursor: MessageActionsState | null) => void;
  jumpRef?: RefObject<JumpHandle | null>;
  onSearchMatchesChange?: (count: number, current: number) => void;
  scanElement?: (el: DOMElement) => MatchPosition[];
  setPositions?: (
    state: {
      positions: MatchPosition[];
      rowOffset: number;
      currentIdx: number;
    } | null,
  ) => void;
};

type VirtualItemProps = {
  key?: React.Key;
  itemKey: string;
  msg: RenderableTranscriptMessage;
  idx: number;
  measureRef: (key: string) => (el: DOMElement | null) => void;
  expanded: boolean | undefined;
  hovered: boolean;
  clickable: boolean;
  onClickK: (
    msg: RenderableTranscriptMessage,
    cellIsBlank: boolean,
  ) => void;
  onEnterK: (key: string) => void;
  onLeaveK: (key: string) => void;
  renderItem: (
    msg: RenderableTranscriptMessage,
    index: number,
  ) => React.ReactNode;
};

const fallbackLowerCache = new WeakMap<RenderableTranscriptMessage, string>();

function defaultExtractSearchText(msg: RenderableTranscriptMessage): string {
  const cached = fallbackLowerCache.get(msg);
  if (cached !== undefined) return cached;

  const lowered = renderableSearchText(msg);
  fallbackLowerCache.set(msg, lowered);
  return lowered;
}

const promptTextCache = new WeakMap<
  RenderableTranscriptMessage,
  string | null
>();

function stickyPromptText(msg: RenderableTranscriptMessage): string | null {
  const cached = promptTextCache.get(msg);
  if (cached !== undefined) return cached;

  const result = computeStickyPromptText(msg);
  promptTextCache.set(msg, result);
  return result;
}

function computeStickyPromptText(
  msg: RenderableTranscriptMessage,
): string | null {
  let raw: string | null = msg.stickyText ?? null;

  if (raw === null) {
    if (msg.type === "user" && !msg.isMeta && !msg.isVisibleInTranscriptOnly) {
      raw = msg.lines.join("\n");
    } else if (
      msg.type === "attachment" && msg.attachmentType === "queued_command" &&
      msg.commandMode !== "task-notification" &&
      !msg.isMeta
    ) {
      raw = msg.attachmentPrompt ?? null;
    }
  }

  if (raw === null) return null;

  const normalized = stripSystemReminders(raw);
  if (!normalized || normalized.startsWith("<")) return null;
  return normalized;
}

function VirtualItem({
  itemKey,
  msg,
  idx,
  measureRef,
  expanded,
  hovered,
  clickable,
  onClickK,
  onEnterK,
  onLeaveK,
  renderItem,
}: VirtualItemProps): React.ReactNode {
  const hoverColor = hovered && !expanded ? "cyan" : undefined;
  const backgroundColor = expanded ? "ansi:236" : undefined;

  return (
    <Box
      ref={measureRef(itemKey)}
      flexDirection="column"
      backgroundColor={backgroundColor}
      paddingBottom={expanded ? 1 : undefined}
      onClick={clickable
        ? (
          // deno-lint-ignore no-explicit-any
          event: any,
        ) => onClickK(msg, Boolean(event?.cellIsBlank))
        : undefined}
      onMouseEnter={clickable ? () => onEnterK(itemKey) : undefined}
      onMouseLeave={clickable ? () => onLeaveK(itemKey) : undefined}
    >
      <TextHoverColorContext.Provider value={hoverColor}>
        {renderItem(msg, idx)}
      </TextHoverColorContext.Provider>
    </Box>
  );
}

export function VirtualMessageList({
  messages,
  scrollRef,
  columns,
  itemKey,
  renderItem,
  onItemClick,
  isItemClickable,
  isItemExpanded,
  extractSearchText = defaultExtractSearchText,
  trackStickyPrompt,
  selectedIndex,
  cursorNavRef,
  setCursor,
  jumpRef,
  onSearchMatchesChange,
  scanElement,
  setPositions,
}: Props): React.ReactNode {
  const keysRef = useRef<string[]>([]);
  const prevMessagesRef = useRef(messages);
  const prevItemKeyRef = useRef(itemKey);

  if (
    prevItemKeyRef.current !== itemKey ||
    messages.length < keysRef.current.length ||
    messages[0] !== prevMessagesRef.current[0]
  ) {
    keysRef.current = messages.map((msg) => itemKey(msg));
  } else {
    for (let index = keysRef.current.length; index < messages.length; index++) {
      keysRef.current.push(itemKey(messages[index]!));
    }
  }

  prevMessagesRef.current = messages;
  prevItemKeyRef.current = itemKey;
  const keys = keysRef.current;

  const {
    range,
    topSpacer,
    bottomSpacer,
    measureRef,
    spacerRef,
    offsets,
    getItemTop,
    getItemElement,
    getItemHeight,
    scrollToIndex,
  } = useVirtualScroll(scrollRef, keys, columns);

  const [start, end] = range;

  const isVisible = useCallback((index: number) => {
    const height = getItemHeight(index);
    if (height === 0) return false;
    return isNavigableMessage(messages[index]!);
  }, [getItemHeight, messages]);

  useImperativeHandle(cursorNavRef, (): MessageActionsNav => {
    const select = (message: RenderableTranscriptMessage) => {
      setCursor?.({
        uuid: message.uuid,
        msgType: message.type,
        expanded: false,
        toolName: toolCallOf(message)?.name,
      });
    };

    const selected = selectedIndex ?? -1;
    const scan = (
      from: number,
      direction: 1 | -1,
      predicate: (index: number) => boolean = isVisible,
    ) => {
      for (
        let index = from;
        index >= 0 && index < messages.length;
        index += direction
      ) {
        if (predicate(index)) {
          select(messages[index]!);
          return true;
        }
      }
      return false;
    };

    const isUser = (index: number) =>
      isVisible(index) && messages[index]!.type === "user";

    return {
      enterCursor: () => scan(messages.length - 1, -1, isUser),
      navigatePrev: () => scan(selected - 1, -1),
      navigateNext: () => {
        if (scan(selected + 1, 1)) return;
        scrollRef.current?.scrollToBottom();
        setCursor?.(null);
      },
      navigatePrevUser: () => scan(selected - 1, -1, isUser),
      navigateNextUser: () => scan(selected + 1, 1, isUser),
      navigateTop: () => scan(0, 1),
      navigateBottom: () => scan(messages.length - 1, -1),
      getSelected: () => selected >= 0 ? messages[selected] ?? null : null,
    };
  }, [isVisible, messages, scrollRef, selectedIndex, setCursor]);

  const jumpState = useRef({
    offsets,
    start,
    getItemElement,
    getItemTop,
    messages,
    scrollToIndex,
  });
  jumpState.current = {
    offsets,
    start,
    getItemElement,
    getItemTop,
    messages,
    scrollToIndex,
  };

  useEffect(() => {
    if (selectedIndex === undefined) return;
    const state = jumpState.current;
    const element = state.getItemElement(selectedIndex);
    if (element) {
      scrollRef.current?.scrollToElement(element, 1);
    } else {
      state.scrollToIndex(selectedIndex);
    }
  }, [selectedIndex, scrollRef]);

  const scanRequestRef = useRef<
    {
      idx: number;
      wantLast: boolean;
      tries: number;
    } | null
  >(null);
  const elementPositions = useRef<{
    msgIdx: number;
    positions: MatchPosition[];
  }>({
    msgIdx: -1,
    positions: [],
  });
  const startPtrRef = useRef(-1);
  const phantomBurstRef = useRef(0);
  const pendingStepRef = useRef<1 | -1 | 0>(0);
  const stepRef = useRef<(direction: 1 | -1) => void>(() => {});
  const highlightRef = useRef<(ord: number) => void>(() => {});
  const searchState = useRef({
    matches: [] as number[],
    ptr: 0,
    screenOrd: 0,
    prefixSum: [] as number[],
  });
  const searchAnchor = useRef(-1);
  const indexWarmed = useRef(false);

  function targetFor(index: number): number {
    const top = jumpState.current.getItemTop(index);
    return Math.max(0, top - HEADROOM);
  }

  function highlight(ord: number): void {
    const scroll = scrollRef.current;
    const { msgIdx, positions } = elementPositions.current;
    if (!scroll || positions.length === 0 || msgIdx < 0) {
      setPositions?.(null);
      return;
    }

    const safeOrd = Math.max(0, Math.min(ord, positions.length - 1));
    const match = positions[safeOrd]!;
    const top = jumpState.current.getItemTop(msgIdx);
    const viewportTop = scroll.getViewportTop();
    let localTop = top - scroll.getScrollTop();
    let screenRow = viewportTop + localTop + match.row;
    const viewportHeight = scroll.getViewportHeight();

    if (screenRow < viewportTop || screenRow >= viewportTop + viewportHeight) {
      scroll.scrollTo(Math.max(0, top + match.row - HEADROOM));
      localTop = top - scroll.getScrollTop();
    }

    setPositions?.({
      positions,
      rowOffset: viewportTop + localTop,
      currentIdx: safeOrd,
    });

    const current = searchState.current;
    const total = current.prefixSum.at(-1) ?? 0;
    const ordinal = (current.prefixSum[current.ptr] ?? 0) + safeOrd + 1;
    onSearchMatchesChange?.(total, ordinal);
  }
  highlightRef.current = highlight;

  const [seekGen, setSeekGen] = useState(0);
  const bumpSeek = useCallback(
    () => setSeekGen((value: number) => value + 1),
    [],
  );

  useEffect(() => {
    const request = scanRequestRef.current;
    if (!request) return;

    const { idx, wantLast, tries } = request;
    const scroll = scrollRef.current;
    if (!scroll) return;

    const { getItemElement, getItemTop, scrollToIndex } = jumpState.current;
    const element = getItemElement(idx);
    const height = element?.yogaNode?.getComputedHeight() ?? 0;

    if (!element || height === 0) {
      if (tries > 1) {
        scanRequestRef.current = null;
        stepRef.current(wantLast ? -1 : 1);
        return;
      }

      scanRequestRef.current = { idx, wantLast, tries: tries + 1 };
      scrollToIndex(idx);
      bumpSeek();
      return;
    }

    scanRequestRef.current = null;
    scroll.scrollTo(Math.max(0, getItemTop(idx) - HEADROOM));
    const positions = scanElement?.(element) ?? [];
    elementPositions.current = { msgIdx: idx, positions };

    if (positions.length === 0) {
      if (++phantomBurstRef.current > 20) {
        phantomBurstRef.current = 0;
        return;
      }
      stepRef.current(wantLast ? -1 : 1);
      return;
    }

    phantomBurstRef.current = 0;
    const ord = wantLast ? positions.length - 1 : 0;
    searchState.current.screenOrd = ord;
    startPtrRef.current = -1;
    highlightRef.current(ord);

    const pending = pendingStepRef.current;
    if (pending) {
      pendingStepRef.current = 0;
      stepRef.current(pending);
    }
  }, [bumpSeek, scanElement, scrollRef, seekGen, setPositions]);

  function jump(index: number, wantLast: boolean): void {
    const scroll = scrollRef.current;
    if (!scroll) return;

    const state = jumpState.current;
    if (index < 0 || index >= state.messages.length) return;

    setPositions?.(null);
    elementPositions.current = {
      msgIdx: -1,
      positions: [],
    };
    scanRequestRef.current = { idx: index, wantLast, tries: 0 };

    const element = state.getItemElement(index);
    const height = element?.yogaNode?.getComputedHeight() ?? 0;
    if (element && height > 0) {
      scroll.scrollTo(targetFor(index));
    } else {
      state.scrollToIndex(index);
    }
    bumpSeek();
  }

  function step(direction: 1 | -1): void {
    const current = searchState.current;
    const { matches, prefixSum } = current;
    const total = prefixSum.at(-1) ?? 0;
    if (matches.length === 0) return;

    if (scanRequestRef.current) {
      pendingStepRef.current = direction;
      return;
    }

    if (startPtrRef.current < 0) {
      startPtrRef.current = current.ptr;
    }

    const { positions } = elementPositions.current;
    const nextOrd = current.screenOrd + direction;
    if (nextOrd >= 0 && nextOrd < positions.length) {
      current.screenOrd = nextOrd;
      highlight(nextOrd);
      startPtrRef.current = -1;
      return;
    }

    const nextPtr = (current.ptr + direction + matches.length) % matches.length;
    if (nextPtr === startPtrRef.current) {
      setPositions?.(null);
      startPtrRef.current = -1;
      return;
    }

    current.ptr = nextPtr;
    current.screenOrd = 0;
    jump(matches[nextPtr]!, direction < 0);

    const placeholder = direction < 0
      ? prefixSum[nextPtr + 1] ?? total
      : prefixSum[nextPtr]! + 1;
    onSearchMatchesChange?.(total, placeholder);
  }
  stepRef.current = step;

  useImperativeHandle(jumpRef, () => ({
    jumpToIndex: (index: number) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      scroll.scrollTo(targetFor(index));
    },
    setSearchQuery: (query: string) => {
      scanRequestRef.current = null;
      elementPositions.current = { msgIdx: -1, positions: [] };
      startPtrRef.current = -1;
      setPositions?.(null);

      const normalized = query.toLowerCase();
      const matches: number[] = [];
      const prefixSum: number[] = [0];

      if (normalized) {
        const currentMessages = jumpState.current.messages;
        for (let index = 0; index < currentMessages.length; index++) {
          const text = extractSearchText(currentMessages[index]!);
          let pos = text.indexOf(normalized);
          let count = 0;
          while (pos >= 0) {
            count++;
            pos = text.indexOf(normalized, pos + normalized.length);
          }
          if (count > 0) {
            matches.push(index);
            prefixSum.push(prefixSum.at(-1)! + count);
          }
        }
      }

      const total = prefixSum.at(-1)!;
      let ptr = 0;
      const scroll = scrollRef.current;
      const { offsets, start, getItemTop } = jumpState.current;
      const firstTop = getItemTop(start);
      const origin = firstTop >= 0 ? firstTop - offsets[start]! : 0;

      if (matches.length > 0 && scroll) {
        const currentTop = searchAnchor.current >= 0
          ? searchAnchor.current
          : scroll.getScrollTop();
        let best = Infinity;
        for (let index = 0; index < matches.length; index++) {
          const distance = Math.abs(
            origin + offsets[matches[index]!]! - currentTop,
          );
          if (distance <= best) {
            best = distance;
            ptr = index;
          }
        }
      }

      searchState.current = {
        matches,
        ptr,
        screenOrd: 0,
        prefixSum,
      };

      if (matches.length > 0) {
        jump(matches[ptr]!, true);
      } else if (searchAnchor.current >= 0 && scroll) {
        scroll.scrollTo(searchAnchor.current);
      }

      onSearchMatchesChange?.(
        total,
        matches.length > 0 ? prefixSum[ptr + 1] ?? total : 0,
      );
    },
    nextMatch: () => step(1),
    prevMatch: () => step(-1),
    setAnchor: () => {
      const scroll = scrollRef.current;
      if (scroll) searchAnchor.current = scroll.getScrollTop();
    },
    disarmSearch: () => {
      setPositions?.(null);
      scanRequestRef.current = null;
      elementPositions.current = {
        msgIdx: -1,
        positions: [],
      };
      startPtrRef.current = -1;
    },
    warmSearchIndex: async () => {
      if (indexWarmed.current) return 0;
      const currentMessages = jumpState.current.messages;
      const chunkSize = 500;
      let workMs = 0;

      for (let index = 0; index < currentMessages.length; index += chunkSize) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const started = performance.now();
        const endIndex = Math.min(index + chunkSize, currentMessages.length);
        for (
          let currentIndex = index;
          currentIndex < endIndex;
          currentIndex++
        ) {
          extractSearchText(currentMessages[currentIndex]!);
        }
        workMs += performance.now() - started;
      }

      indexWarmed.current = true;
      return Math.round(workMs);
    },
  }), [
    bumpSeek,
    extractSearchText,
    onSearchMatchesChange,
    scrollRef,
    setPositions,
  ]);

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const handlersRef = useRef({
    onItemClick,
    setHoveredKey,
  });
  handlersRef.current = {
    onItemClick,
    setHoveredKey,
  };

  const onClickK = useCallback(
    (msg: RenderableTranscriptMessage, cellIsBlank: boolean) => {
      const handlers = handlersRef.current;
      if (!cellIsBlank && handlers.onItemClick) {
        handlers.onItemClick(msg);
      }
    },
    [],
  );
  const onEnterK = useCallback((key: string) => {
    handlersRef.current.setHoveredKey(key);
  }, []);
  const onLeaveK = useCallback((key: string) => {
    handlersRef.current.setHoveredKey((previous: string | null) =>
      previous === key ? null : previous
    );
  }, []);

  useEffect(() => {
    for (let index = start; index < end; index++) {
      extractSearchText(messages[index]!);
    }
  }, [end, extractSearchText, messages, start]);

  return (
    <>
      <Box ref={spacerRef} height={topSpacer} flexShrink={0} />
      {messages.slice(start, end).map((msg, localIndex) => {
        const idx = start + localIndex;
        const key = keys[idx]!;
        const clickable = Boolean(
          onItemClick && (isItemClickable?.(msg) ?? true),
        );
        const hovered = clickable && hoveredKey === key;
        const expanded = isItemExpanded?.(msg);

        return (
          <VirtualItem
            key={key}
            itemKey={key}
            msg={msg}
            idx={idx}
            measureRef={measureRef}
            expanded={expanded}
            hovered={hovered}
            clickable={clickable}
            onClickK={onClickK}
            onEnterK={onEnterK}
            onLeaveK={onLeaveK}
            renderItem={renderItem}
          />
        );
      })}
      {bottomSpacer > 0 && <Box height={bottomSpacer} flexShrink={0} />}
      {trackStickyPrompt && (
        <StickyTracker
          messages={messages}
          start={start}
          end={end}
          offsets={offsets}
          getItemTop={getItemTop}
          getItemElement={getItemElement}
          scrollRef={scrollRef}
        />
      )}
    </>
  );
}

function StickyTracker({
  messages,
  start,
  end,
  offsets,
  getItemTop,
  getItemElement,
  scrollRef,
}: {
  messages: RenderableTranscriptMessage[];
  start: number;
  end: number;
  offsets: ArrayLike<number>;
  getItemTop: (index: number) => number;
  getItemElement: (index: number) => DOMElement | null;
  scrollRef: RefObject<ScrollBoxHandle | null>;
}): null {
  const { setStickyPrompt } = useContext(ScrollChromeContext);

  const subscribe = useCallback(
    (listener: () => void) =>
      scrollRef.current?.subscribe(listener) ?? NOOP_UNSUB,
    [scrollRef],
  );

  useSyncExternalStore(subscribe, () => {
    const scroll = scrollRef.current;
    if (!scroll) return NaN;
    const target = scroll.getScrollTop() + scroll.getPendingDelta();
    return scroll.isSticky() ? -1 - target : target;
  });

  const isSticky = scrollRef.current?.isSticky() ?? true;
  const target = Math.max(
    0,
    (scrollRef.current?.getScrollTop() ?? 0) +
      (scrollRef.current?.getPendingDelta() ?? 0),
  );

  let firstVisible = start;
  let firstVisibleTop = -1;
  for (let index = end - 1; index >= start; index--) {
    const top = getItemTop(index);
    if (top >= 0) {
      if (top < target) break;
      firstVisibleTop = top;
    }
    firstVisible = index;
  }

  let stickyIndex = -1;
  let stickyText: string | null = null;

  if (firstVisible > 0 && !isSticky) {
    for (let index = firstVisible - 1; index >= 0; index--) {
      const text = stickyPromptText(messages[index]!);
      if (text === null) continue;
      const top = getItemTop(index);
      if (top >= 0 && top + 1 >= target) continue;
      stickyIndex = index;
      stickyText = text;
      break;
    }
  }

  const baseOffset = firstVisibleTop >= 0
    ? firstVisibleTop - offsets[firstVisible]!
    : 0;
  const estimate = stickyIndex >= 0
    ? Math.max(0, baseOffset + offsets[stickyIndex]!)
    : -1;

  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (isSticky || stickyIndex < 0 || stickyText === null) {
      lastKeyRef.current = null;
      setStickyPrompt(null);
      return;
    }

    const identity = `${stickyIndex}:${stickyText}`;
    if (lastKeyRef.current === identity) return;
    lastKeyRef.current = identity;

    const cappedText = stickyText.length > STICKY_TEXT_CAP
      ? `${stickyText.slice(0, STICKY_TEXT_CAP)}...`
      : stickyText;

    const scrollTo = () => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const element = getItemElement(stickyIndex);
      if (element) {
        scroll.scrollToElement(element, 0);
      } else if (estimate >= 0) {
        scroll.scrollTo(Math.max(0, estimate - 3));
      }
    };

    setStickyPrompt(
      {
        text: cappedText,
        scrollTo,
      } satisfies StickyPrompt,
    );
  }, [
    estimate,
    getItemElement,
    isSticky,
    scrollRef,
    setStickyPrompt,
    stickyIndex,
    stickyText,
  ]);

  return null;
}
