import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { getPlatform } from "../../../../platform/platform.ts";
import type {
  AgentConversationItem,
  HqlEvalItem,
  ShellHistoryEntry,
} from "../types.ts";
import { useSemanticColors } from "../../theme/index.ts";
import {
  clampConversationScrollOffset,
  computeConversationViewport,
  getConversationVisibleCount,
} from "../utils/conversation-viewport.ts";
import {
  executeHandler,
  HandlerIds,
  inspectHandlerKeybinding,
  registerHandler,
  unregisterHandler,
} from "../keybindings/index.ts";
import {
  getLatestCitation,
  getToggleTargets,
  TimelineItemRenderer,
  type ToggleTarget,
} from "./TimelineItemRenderer.tsx";
import { compactPlanTranscriptItems } from "./conversation/plan-flow.ts";

const CONVERSATION_KEYBINDING_CATEGORIES = ["Conversation"] as const;

interface TranscriptHistoryProps {
  historyItems: AgentConversationItem[];
  evalHistory: HqlEvalItem[];
  width: number;
  reservedRows?: number;
  compactPlanTranscript?: boolean;
  allowToggleHotkeys?: boolean;
}

export function TranscriptHistory(
  {
    historyItems,
    evalHistory,
    width,
    reservedRows = 8,
    compactPlanTranscript = false,
    allowToggleHotkeys = true,
  }: TranscriptHistoryProps,
): React.ReactElement | null {
  const sc = useSemanticColors();
  const { stdout } = useStdout();
  const items = useMemo<ShellHistoryEntry[]>(
    () => [
      ...(compactPlanTranscript
        ? compactPlanTranscriptItems(historyItems)
        : historyItems),
      ...evalHistory,
    ],
    [compactPlanTranscript, evalHistory, historyItems],
  );
  const [scrollOffsetFromBottom, setScrollOffsetFromBottom] = useState(0);
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedDelegateIds, setExpandedDelegateIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedMemoryIds, setExpandedMemoryIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (items.length === 0) {
      setScrollOffsetFromBottom(0);
      setExpandedToolIds(new Set());
      setExpandedThinkingIds(new Set());
      setExpandedDelegateIds(new Set());
      setExpandedMemoryIds(new Set());
    }
  }, [items.length]);

  const terminalRows = stdout?.rows ?? 24;
  const visibleCount = useMemo(
    () => getConversationVisibleCount(terminalRows, { reservedRows }),
    [reservedRows, terminalRows],
  );
  const viewport = useMemo(
    () =>
      computeConversationViewport(
        items.length,
        visibleCount,
        scrollOffsetFromBottom,
      ),
    [items.length, visibleCount, scrollOffsetFromBottom],
  );
  const visibleItems = useMemo(
    () => items.slice(viewport.start, viewport.end),
    [items, viewport.end, viewport.start],
  );

  useEffect(() => {
    setScrollOffsetFromBottom((prev: number) =>
      prev === 0
        ? 0
        : clampConversationScrollOffset(prev, items.length, visibleCount)
    );
  }, [items.length, visibleCount]);

  const toggleTargets = useMemo(
    () => getToggleTargets(visibleItems),
    [visibleItems],
  );

  const isToolExpanded = useCallback(
    (toolId: string): boolean => expandedToolIds.has(toolId),
    [expandedToolIds],
  );
  const isThinkingExpanded = useCallback(
    (thinkingId: string): boolean => expandedThinkingIds.has(thinkingId),
    [expandedThinkingIds],
  );
  const isDelegateExpanded = useCallback(
    (delegateId: string): boolean => expandedDelegateIds.has(delegateId),
    [expandedDelegateIds],
  );
  const isMemoryExpanded = useCallback(
    (memoryId: string): boolean => expandedMemoryIds.has(memoryId),
    [expandedMemoryIds],
  );

  const toggleTarget = useCallback((target: ToggleTarget): void => {
    const toggle = (
      setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    ) => {
      setter((prev: Set<string>) => {
        const next = new Set(prev);
        if (next.has(target.id)) next.delete(target.id);
        else next.add(target.id);
        return next;
      });
    };
    if (target.kind === "tool") return toggle(setExpandedToolIds);
    if (target.kind === "delegate") return toggle(setExpandedDelegateIds);
    if (target.kind === "memory") return toggle(setExpandedMemoryIds);
    toggle(setExpandedThinkingIds);
  }, []);

  useEffect(() => {
    if (!allowToggleHotkeys) return;
    registerHandler(
      HandlerIds.CONVERSATION_TOGGLE_LATEST,
      () => {
        const target = toggleTargets[toggleTargets.length - 1];
        if (target) toggleTarget(target);
      },
      "TranscriptHistory",
    );
    registerHandler(
      HandlerIds.CONVERSATION_OPEN_LATEST_SOURCE,
      async () => {
        const citation = getLatestCitation(items);
        if (citation?.url) {
          await getPlatform().openUrl(citation.url).catch(() => {});
        }
      },
      "TranscriptHistory",
    );
    return () => {
      unregisterHandler(HandlerIds.CONVERSATION_TOGGLE_LATEST);
      unregisterHandler(HandlerIds.CONVERSATION_OPEN_LATEST_SOURCE);
    };
  }, [allowToggleHotkeys, items, toggleTarget, toggleTargets]);

  useInput((char, key) => {
    if (!items.length) return;
    if (key.pageUp) {
      const pageSize = Math.max(1, visibleCount - 1);
      setScrollOffsetFromBottom((prev: number) =>
        clampConversationScrollOffset(
          prev + pageSize,
          items.length,
          visibleCount,
        )
      );
      return;
    }
    if (key.pageDown) {
      const pageSize = Math.max(1, visibleCount - 1);
      setScrollOffsetFromBottom((prev: number) =>
        clampConversationScrollOffset(
          prev - pageSize,
          items.length,
          visibleCount,
        )
      );
      return;
    }
    const binding = inspectHandlerKeybinding(char, key, {
      categories: CONVERSATION_KEYBINDING_CATEGORIES,
    });
    if (!allowToggleHotkeys) return;
    if (binding.kind === "handler") {
      void executeHandler(binding.id);
    }
  });

  if (items.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" width={width}>
      {viewport.hiddenAbove > 0 && (
        <Text color={sc.text.muted}>
          ↑ {viewport.hiddenAbove}{" "}
          earlier item{viewport.hiddenAbove === 1 ? "" : "s"}
        </Text>
      )}
      {visibleItems.map((item: ShellHistoryEntry) => (
        <Box key={item.id}>
          <TimelineItemRenderer
            item={item}
            width={width}
            compactSpacing
            isToolExpanded={isToolExpanded}
            isThinkingExpanded={isThinkingExpanded}
            isDelegateExpanded={isDelegateExpanded}
            isMemoryExpanded={isMemoryExpanded}
          />
        </Box>
      ))}
      {viewport.hiddenBelow > 0 && (
        <Text color={sc.text.muted}>
          ↓ {viewport.hiddenBelow}{" "}
          newer item{viewport.hiddenBelow === 1 ? "" : "s"}
        </Text>
      )}
    </Box>
  );
}
