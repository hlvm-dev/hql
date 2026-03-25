import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { TodoState } from "../../../agent/todo-state.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import type { AgentConversationItem, StreamingState } from "../types.ts";
import { STATUS_GLYPHS } from "../ui-constants.ts";
import { useSemanticColors } from "../../theme/index.ts";
import {
  executeHandler,
  HandlerIds,
  inspectHandlerKeybinding,
  registerHandler,
  unregisterHandler,
} from "../keybindings/index.ts";
import {
  getActiveThinkingId,
  getLatestCitation,
  getToggleTargets,
  TimelineItemRenderer,
  type ToggleTarget,
} from "./TimelineItemRenderer.tsx";

const CONVERSATION_KEYBINDING_CATEGORIES = ["Conversation"] as const;

interface PendingTurnPanelProps {
  items: AgentConversationItem[];
  width: number;
  streamingState?: StreamingState;
  todoState?: TodoState;
  allowToggleHotkeys?: boolean;
}

export function PendingTurnPanel(
  {
    items,
    width,
    streamingState,
    todoState,
    allowToggleHotkeys = true,
  }: PendingTurnPanelProps,
): React.ReactElement | null {
  const sc = useSemanticColors();
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
  const activeThinkingId = useMemo(
    () => getActiveThinkingId(items, streamingState),
    [items, streamingState],
  );

  useEffect(() => {
    if (items.length === 0) {
      setExpandedToolIds(new Set());
      setExpandedThinkingIds(new Set());
      setExpandedDelegateIds(new Set());
      setExpandedMemoryIds(new Set());
    }
  }, [items.length]);

  const toggleTargets = useMemo(
    () => getToggleTargets(items),
    [items],
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
      "PendingTurnPanel",
    );
    registerHandler(
      HandlerIds.CONVERSATION_OPEN_LATEST_SOURCE,
      async () => {
        const citation = getLatestCitation(items);
        if (citation?.url) {
          await getPlatform().openUrl(citation.url).catch(() => {});
        }
      },
      "PendingTurnPanel",
    );
    return () => {
      unregisterHandler(HandlerIds.CONVERSATION_TOGGLE_LATEST);
      unregisterHandler(HandlerIds.CONVERSATION_OPEN_LATEST_SOURCE);
    };
  }, [allowToggleHotkeys, items, toggleTarget, toggleTargets]);

  useInput((char, key) => {
    if (!allowToggleHotkeys || items.length === 0) return;
    const binding = inspectHandlerKeybinding(char, key, {
      categories: CONVERSATION_KEYBINDING_CATEGORIES,
    });
    if (binding.kind === "handler") {
      void executeHandler(binding.id);
    }
  });

  if (items.length === 0 && !(todoState && todoState.items.length > 0)) {
    return null;
  }

  return (
    <Box flexDirection="column" width={width} marginTop={1}>
      {todoState && todoState.items.length > 0 && (
        <Box marginBottom={1} flexDirection="column" paddingLeft={2}>
          {todoState.items.map((item) => {
            const glyph = item.status === "completed"
              ? STATUS_GLYPHS.success
              : item.status === "in_progress"
              ? STATUS_GLYPHS.running
              : STATUS_GLYPHS.pending;
            const glyphColor = item.status === "completed"
              ? sc.status.success
              : item.status === "in_progress"
              ? sc.status.warning
              : sc.text.muted;
            const textColor = item.status === "pending"
              ? sc.text.muted
              : sc.text.primary;
            return (
              <Box key={item.id}>
                <Text color={glyphColor}>{glyph} </Text>
                <Text color={textColor}>{item.content}</Text>
              </Box>
            );
          })}
        </Box>
      )}
      {items.map((item: AgentConversationItem) => (
        <Box key={item.id}>
          <TimelineItemRenderer
            item={item}
            width={width}
            activeThinkingId={activeThinkingId}
            isToolExpanded={isToolExpanded}
            isThinkingExpanded={isThinkingExpanded}
            isDelegateExpanded={isDelegateExpanded}
            isMemoryExpanded={isMemoryExpanded}
          />
        </Box>
      ))}
    </Box>
  );
}
