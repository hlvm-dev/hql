import React, { useMemo } from "react";
import { Box } from "ink";
import type { PlanningPhase } from "../../../agent/planning.ts";
import type { TodoState } from "../../../agent/todo-state.ts";
import type {
  AgentConversationItem,
  ShellHistoryEntry,
  StreamingState,
} from "../types.ts";
import {
  filterDuplicateWaitingIndicators,
  getActiveThinkingId,
  TimelineItemRenderer,
} from "./TimelineItemRenderer.tsx";
import { useExpansionState } from "../hooks/useExpansionState.ts";
import { PlanChecklistPanel } from "./conversation/PlanChecklistPanel.tsx";
import { derivePlanSurfaceState } from "./conversation/plan-flow.ts";
import { shouldRenderTranscriptDividerBeforeIndex } from "../utils/layout-tokens.ts";
import { filterRenderableTimelineItems } from "../utils/timeline-visibility.ts";
import { StreamingState as ConversationStreamingState } from "../types.ts";
import type { ScrollBoxHandle } from "../../../vendor/ink/components/ScrollBox.tsx";
import { useVirtualScroll } from "../hooks/useVirtualScroll.ts";

interface VirtualTranscriptProps {
  items?: AgentConversationItem[];
  scrollRef: React.RefObject<ScrollBoxHandle | null>;
  width: number;
  compactSpacing?: boolean;
  streamingState?: StreamingState;
  planningPhase?: PlanningPhase;
  todoState?: TodoState;
  showPlanChecklist?: boolean;
  showLeadingDivider?: boolean;
}

export function VirtualTranscript(
  {
    items: rawItems = [],
    scrollRef,
    width,
    compactSpacing = true,
    streamingState,
    planningPhase,
    todoState,
    showPlanChecklist = false,
    showLeadingDivider = false,
  }: VirtualTranscriptProps,
): React.ReactElement | null {
  const planSurface = useMemo(
    () => derivePlanSurfaceState({ items: rawItems, planningPhase, todoState }),
    [rawItems, planningPhase, todoState],
  );

  const displayItems = useMemo(() => {
    const baseItems = filterRenderableTimelineItems(planSurface.visibleItems);
    const hidePassiveWaitingSignals = streamingState ===
      ConversationStreamingState.WaitingForConfirmation;

    return filterDuplicateWaitingIndicators(baseItems).filter((item) => {
      if (!hidePassiveWaitingSignals) return true;
      if (item.type === "thinking") return false;
      return !(item.type === "assistant" && item.isPending && item.text.trim().length === 0);
    });
  }, [planSurface.visibleItems, streamingState]);

  const activeThinkingId = useMemo(
    () => getActiveThinkingId(rawItems, streamingState),
    [rawItems, streamingState],
  );
  const expansion = useExpansionState(displayItems.length);

  const itemKeys = useMemo(
    () =>
      displayItems.map((item: ShellHistoryEntry, index: number) =>
        getTranscriptItemKey(
          item,
          width,
          shouldRenderTranscriptDividerBeforeIndex(
            displayItems,
            index,
            showLeadingDivider && index === 0,
          ),
          {
            isToolExpanded: expansion.isToolExpanded,
            isThinkingExpanded: expansion.isThinkingExpanded,
            isMemoryExpanded: expansion.isMemoryExpanded,
          },
        )
      ),
    [
      displayItems,
      expansion.isMemoryExpanded,
      expansion.isThinkingExpanded,
      expansion.isToolExpanded,
      showLeadingDivider,
      width,
    ],
  );

  const {
    range,
    topSpacer,
    bottomSpacer,
    measureRef,
    spacerRef,
  } = useVirtualScroll(scrollRef, itemKeys, width);
  const [start, end] = range;

  if (displayItems.length === 0 && !planSurface.active) {
    return null;
  }

  return (
    <Box flexDirection="column" width={width}>
      {showPlanChecklist && planSurface.active && (
        <PlanChecklistPanel
          planningPhase={planningPhase}
          todoState={todoState}
          items={rawItems}
        />
      )}

      <Box ref={spacerRef} height={topSpacer} flexShrink={0} />

      {displayItems.slice(start, end).map((
        item: ShellHistoryEntry,
        localIndex: number,
      ) => {
        const globalIndex = start + localIndex;
        const showDividerBefore = shouldRenderTranscriptDividerBeforeIndex(
          displayItems,
          globalIndex,
          showLeadingDivider && globalIndex === 0,
        );
        const itemKey = itemKeys[globalIndex]!;

        return (
          <Box key={itemKey} ref={measureRef(itemKey)} flexDirection="column">
            <TimelineItemRenderer
              item={item}
              width={width}
              activeThinkingId={activeThinkingId}
              compactSpacing={compactSpacing}
              showDividerBefore={showDividerBefore}
              isToolExpanded={expansion.isToolExpanded}
              isThinkingExpanded={expansion.isThinkingExpanded}
              isMemoryExpanded={expansion.isMemoryExpanded}
            />
          </Box>
        );
      })}

      {bottomSpacer > 0 && <Box height={bottomSpacer} flexShrink={0} />}
    </Box>
  );
}

interface TranscriptItemKeyOptions {
  isToolExpanded: (toolId: string) => boolean;
  isThinkingExpanded: (thinkingId: string) => boolean;
  isMemoryExpanded: (memoryId: string) => boolean;
}

function getTranscriptItemKey(
  item: ShellHistoryEntry,
  width: number,
  showDividerBefore: boolean,
  options: TranscriptItemKeyOptions,
): string {
  switch (item.type) {
    case "thinking":
      return `${item.id}:${width}:${showDividerBefore ? 1 : 0}:${
        options.isThinkingExpanded(item.id) ? "expanded" : "collapsed"
      }`;
    case "memory_updated":
      return `${item.id}:${width}:${showDividerBefore ? 1 : 0}`;
    case "tool_group": {
      const expandedSignature = item.tools.map((tool) =>
        options.isToolExpanded(tool.id) ? "1" : "0"
      ).join("");
      return `${item.id}:${width}:${showDividerBefore ? 1 : 0}:${expandedSignature}`;
    }
    default:
      return `${item.id}:${width}:${showDividerBefore ? 1 : 0}`;
  }
}
