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

interface TranscriptSurfaceProps {
  liveItems?: AgentConversationItem[];
  width: number;
  compactSpacing?: boolean;
  interactive?: boolean;
  allowToggleHotkeys?: boolean;
  streamingState?: StreamingState;
  planningPhase?: PlanningPhase;
  todoState?: TodoState;
  showPlanChecklist?: boolean;
  showLeadingDivider?: boolean;
}

export function TranscriptSurface(
  {
    liveItems = [],
    width,
    compactSpacing = true,
    interactive = true,
    allowToggleHotkeys = true,
    streamingState,
    planningPhase,
    todoState,
    showPlanChecklist = false,
    showLeadingDivider = false,
  }: TranscriptSurfaceProps,
): React.ReactElement | null {
  const planSurface = useMemo(
    () => derivePlanSurfaceState({ items: liveItems, planningPhase, todoState }),
    [liveItems, planningPhase, todoState],
  );
  const liveDisplayItems = useMemo(() => {
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
    () => getActiveThinkingId(liveItems, streamingState),
    [liveItems, streamingState],
  );
  const expansion = useExpansionState(liveDisplayItems.length);

  if (liveDisplayItems.length === 0 && !planSurface.active) {
    return null;
  }

  return (
    <Box flexDirection="column" width={width}>
      {showPlanChecklist && planSurface.active && (
        <PlanChecklistPanel
          planningPhase={planningPhase}
          todoState={todoState}
          items={liveItems}
        />
      )}
      {liveDisplayItems.map((item: ShellHistoryEntry, index: number) => (
        <Box key={item.id}>
          <TimelineItemRenderer
            item={item}
            width={width}
            activeThinkingId={activeThinkingId}
            compactSpacing={compactSpacing}
            showDividerBefore={shouldRenderTranscriptDividerBeforeIndex(
              liveDisplayItems,
              index,
              showLeadingDivider && index === 0,
            )}
            isToolExpanded={expansion.isToolExpanded}
            isThinkingExpanded={expansion.isThinkingExpanded}
            isDelegateExpanded={expansion.isDelegateExpanded}
            isDelegateGroupExpanded={expansion.isDelegateGroupExpanded}
            isMemoryExpanded={expansion.isMemoryExpanded}
          />
        </Box>
      ))}
    </Box>
  );
}
