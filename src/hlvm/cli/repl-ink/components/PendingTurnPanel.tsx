import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PlanningPhase } from "../../../agent/planning.ts";
import type { TodoState } from "../../../agent/todo-state.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { useSemanticColors } from "../../theme/index.ts";
import {
  type AgentConversationItem,
  type StreamingState,
  StreamingState as ConversationStreamingState,
} from "../types.ts";
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
import { PlanChecklistPanel } from "./conversation/PlanChecklistPanel.tsx";
import { derivePlanSurfaceState } from "./conversation/plan-flow.ts";
import { TranscriptDivider } from "./conversation/TranscriptDivider.tsx";
import { deriveLiveTurnStatus } from "./conversation/turn-activity.ts";
import { getLiveConversationSpacing } from "./conversation/message-spacing.ts";
import { shouldRenderTranscriptDividerBeforeIndex } from "../utils/layout-tokens.ts";
import { filterRenderableTimelineItems } from "../utils/timeline-visibility.ts";

const CONVERSATION_KEYBINDING_CATEGORIES = ["Conversation"] as const;

function LiveStatusRow(
  {
    label,
    tone,
    recentLabels,
  }: { label: string; tone: "active" | "warning"; recentLabels?: string[] },
): React.ReactElement {
  const sc = useSemanticColors();
  const color = tone === "warning" ? sc.status.warning : sc.text.primary;
  const glyph = tone === "warning" ? "!" : "●";
  return (
    <Box marginBottom={1} flexDirection="column">
      <Text color={color}>{`${glyph} ${label}`}</Text>
      {recentLabels?.filter((recent) => recent !== label).slice(0, 2).map((
        recent,
      ) => (
        <Box key={recent}>
          <Text color={sc.text.muted}>{`  · ${recent}`}</Text>
        </Box>
      ))}
    </Box>
  );
}

interface PendingTurnPanelProps {
  items: AgentConversationItem[];
  width: number;
  streamingState?: StreamingState;
  planningPhase?: PlanningPhase;
  todoState?: TodoState;
  compactSpacing?: boolean;
  showLeadingDivider?: boolean;
  allowToggleHotkeys?: boolean;
}

export function PendingTurnPanel(
  {
    items,
    width,
    streamingState,
    planningPhase,
    todoState,
    compactSpacing = false,
    showLeadingDivider = false,
    allowToggleHotkeys = true,
  }: PendingTurnPanelProps,
): React.ReactElement | null {
  const spacing = getLiveConversationSpacing(compactSpacing);
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
  const planSurface = useMemo(
    () =>
      derivePlanSurfaceState({
        items,
        planningPhase,
        todoState,
      }),
    [items, planningPhase, todoState],
  );
  const visibleItems = useMemo(
    () => filterRenderableTimelineItems(planSurface.visibleItems),
    [planSurface.visibleItems],
  );
  const liveStatus = useMemo(
    () => deriveLiveTurnStatus({ items, streamingState, planningPhase }),
    [items, streamingState, planningPhase],
  );
  const renderedItems = useMemo(() => {
    const hidePassiveWaitingSignals = streamingState ===
      ConversationStreamingState.WaitingForConfirmation;
    return visibleItems.filter((item: AgentConversationItem) => {
      if (!hidePassiveWaitingSignals) return true;
      if (item.type === "thinking") return false;
      return !(item.type === "assistant" && item.isPending &&
        item.text.trim().length === 0);
    });
  }, [streamingState, visibleItems]);

  useEffect(() => {
    if (items.length === 0) {
      setExpandedToolIds(new Set());
      setExpandedThinkingIds(new Set());
      setExpandedDelegateIds(new Set());
      setExpandedMemoryIds(new Set());
    }
  }, [items.length]);

  const toggleTargets = useMemo(
    () => getToggleTargets(renderedItems),
    [renderedItems],
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
    if (!allowToggleHotkeys || renderedItems.length === 0) return;
    const binding = inspectHandlerKeybinding(char, key, {
      categories: CONVERSATION_KEYBINDING_CATEGORIES,
    });
    if (binding.kind === "handler") {
      void executeHandler(binding.id);
    }
  });

  if (renderedItems.length === 0 && !planSurface.active && !liveStatus) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      width={width}
      marginTop={spacing.pendingTurnMarginTop}
    >
      {showLeadingDivider && <TranscriptDivider width={width} />}
      {planSurface.active && (
        <PlanChecklistPanel
          planningPhase={planningPhase}
          todoState={todoState}
          items={items}
        />
      )}
      {liveStatus && (
        <LiveStatusRow
          label={liveStatus.label}
          tone={liveStatus.tone}
          recentLabels={liveStatus.recentLabels}
        />
      )}
      {renderedItems.map((item: AgentConversationItem, index: number) => (
        <Box key={item.id}>
          <TimelineItemRenderer
            item={item}
            width={width}
            activeThinkingId={activeThinkingId}
            compactSpacing={compactSpacing}
            showDividerBefore={shouldRenderTranscriptDividerBeforeIndex(
              renderedItems,
              index,
              false,
            )}
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
