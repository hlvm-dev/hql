/**
 * VirtualTranscript — viewport-aware transcript that only mounts visible items.
 *
 * Primary conversation rendering surface with viewport-aware item slicing.
 * Uses useViewportScroll for item-count-based virtual scrolling with
 * "offset from bottom" semantics and sticky auto-follow.
 */

import React, { useMemo } from "react";
import { Box, Text, useStdout } from "ink";
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
import { useViewportScroll, type ViewportScrollActions } from "../hooks/useViewportScroll.ts";
import { getConversationVisibleCount } from "../utils/conversation-viewport.ts";
import { useSemanticColors } from "../../theme/index.ts";
import { DEFAULT_TERMINAL_HEIGHT } from "../ui-constants.ts";

/**
 * Minimum reserved rows when chrome is minimal (no banner, no dialog).
 * Composer (~2) + status line (1) + footer hint (1) + gutter (1).
 */
export const MIN_RESERVED_ROWS = 5;

export interface ScrollReadyPayload {
  actions: ViewportScrollActions;
  /** Number of items visible in the viewport (for page-size scroll). */
  visibleCount: number;
}

interface VirtualTranscriptProps {
  items?: AgentConversationItem[];
  width: number;
  compactSpacing?: boolean;
  streamingState?: StreamingState;
  planningPhase?: PlanningPhase;
  todoState?: TodoState;
  showPlanChecklist?: boolean;
  showLeadingDivider?: boolean;
  /** Rows consumed by chrome outside the transcript (banner, composer, etc.). */
  reservedRows?: number;
  /** Expose scroll actions + visibleCount to parent for keybinding wiring. */
  onScrollReady?: (payload: ScrollReadyPayload) => void;
}

export function VirtualTranscript(
  {
    items: rawItems = [],
    width,
    compactSpacing = true,
    streamingState,
    planningPhase,
    todoState,
    showPlanChecklist = false,
    showLeadingDivider = false,
    reservedRows = MIN_RESERVED_ROWS,
    onScrollReady,
  }: VirtualTranscriptProps,
): React.ReactElement | null {
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? DEFAULT_TERMINAL_HEIGHT;
  const sc = useSemanticColors();

  // Filter and prepare display items
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

  // Compute visible capacity and scroll state
  const visibleCount = useMemo(
    () => getConversationVisibleCount(terminalRows, { reservedRows }),
    [terminalRows, reservedRows],
  );

  const { viewport, isSticky, actions } = useViewportScroll(
    displayItems.length,
    visibleCount,
  );

  // Expose scroll actions + visibleCount to parent for keybinding wiring.
  // `actions` is stable (ref-based callbacks in useViewportScroll), so the
  // initial payload remains valid.  Re-fire when visibleCount changes
  // (terminal resize) so the parent gets the updated page size.
  React.useEffect(() => {
    onScrollReady?.({ actions, visibleCount });
  }, [onScrollReady, actions, visibleCount]);

  // Slice to visible window
  const visibleItems = useMemo(
    () => displayItems.slice(viewport.start, viewport.end),
    [displayItems, viewport.start, viewport.end],
  );

  if (displayItems.length === 0 && !planSurface.active) {
    return null;
  }

  return (
    <Box flexDirection="column" width={width} flexGrow={1}>
      {/* Plan checklist (above transcript) */}
      {showPlanChecklist && planSurface.active && (
        <PlanChecklistPanel
          planningPhase={planningPhase}
          todoState={todoState}
          items={rawItems}
        />
      )}

      {/* Hidden-above indicator */}
      {viewport.hiddenAbove > 0 && (
        <Box flexShrink={0}>
          <Text color={sc.text.muted} dimColor>
            {`  ↑ ${viewport.hiddenAbove} earlier item${viewport.hiddenAbove !== 1 ? "s" : ""}`}
          </Text>
        </Box>
      )}

      {/* Visible items */}
      {visibleItems.map((item: ShellHistoryEntry, localIndex: number) => {
        const globalIndex = viewport.start + localIndex;
        return (
          <Box key={item.id}>
            <TimelineItemRenderer
              item={item}
              width={width}
              activeThinkingId={activeThinkingId}
              compactSpacing={compactSpacing}
              showDividerBefore={shouldRenderTranscriptDividerBeforeIndex(
                displayItems,
                globalIndex,
                showLeadingDivider && globalIndex === 0,
              )}
              isToolExpanded={expansion.isToolExpanded}
              isThinkingExpanded={expansion.isThinkingExpanded}
              isMemoryExpanded={expansion.isMemoryExpanded}
            />
          </Box>
        );
      })}

      {/* Hidden-below indicator */}
      {viewport.hiddenBelow > 0 && (
        <Box flexShrink={0}>
          <Text color={sc.text.muted} dimColor>
            {`  ↓ ${viewport.hiddenBelow} newer item${viewport.hiddenBelow !== 1 ? "s" : ""}${!isSticky ? "  (PageDown to scroll)" : ""}`}
          </Text>
        </Box>
      )}
    </Box>
  );
}
