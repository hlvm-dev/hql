/**
 * ConversationPanel Component
 *
 * Renders a list of ConversationItems by dispatching to appropriate
 * message components. Used during agent mode in the REPL.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import {
  type AgentConversationItem,
  type AssistantCitation,
  type ConversationItem,
  type StreamingState,
  StreamingState as ConversationStreamingState,
} from "../types.ts";
import type { Plan, PlanningPhase } from "../../../agent/planning.ts";
import type { TodoState } from "../../../agent/todo-state.ts";
import type {
  InteractionRequestEvent,
  InteractionResponse,
} from "../../../agent/registry.ts";
import { findCurrentTurnStartIndex } from "../../agent-transcript-state.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import {
  estimateInteractionDialogRows,
  isPickerInteractionRequest,
} from "./conversation/interaction-dialog-layout.ts";
import {
  clampConversationScrollOffset,
  computeConversationViewport,
  getConversationVisibleCount,
} from "../utils/conversation-viewport.ts";
import { shouldRenderTimelineItem } from "../utils/timeline-visibility.ts";
import {
  executeHandler,
  HandlerIds,
  inspectHandlerKeybinding,
  registerHandler,
  unregisterHandler,
} from "../keybindings/index.ts";
import {
  AssistantMessage,
  ConfirmationDialog,
  DelegateItem,
  ErrorMessage,
  HqlEvalDisplay,
  InfoMessage,
  MemoryActivityLine,
  QuestionDialog,
  TeamEventItem,
  ThinkingIndicator,
  ToolGroup,
  TurnStats,
  UserMessage,
} from "./conversation/index.ts";
import { useSemanticColors } from "../../theme/index.ts";
import { RenderErrorBoundary } from "./ErrorBoundary.tsx";
import { PlanChecklistPanel } from "./conversation/PlanChecklistPanel.tsx";

const CONVERSATION_KEYBINDING_CATEGORIES = ["Conversation"] as const;

interface ConversationPanelProps {
  items: ConversationItem[];
  width: number;
  streamingState?: StreamingState;
  activePlan?: Plan;
  planningPhase?: PlanningPhase;
  todoState?: TodoState;
  pendingPlanReview?: { plan: Plan };
  /** Whether section toggle hotkeys should be active (avoid conflicts with input editing) */
  allowToggleHotkeys?: boolean;
  /** Pending interaction request (permission or question) */
  interactionRequest?: InteractionRequestEvent;
  /** Number of queued interactions (permission/question) */
  interactionQueueLength?: number;
  /** Additional rows to reserve in viewport (e.g. queue preview bar) */
  extraReservedRows?: number;
  /** Callback to respond to interaction request */
  onInteractionResponse?: (
    requestId: string,
    response: InteractionResponse,
  ) => void;
  /** Interrupt the current question flow entirely (Esc on clarification picker) */
  onQuestionInterrupt?: () => void;
}

type ToggleTarget =
  | { kind: "tool"; id: string }
  | { kind: "thinking"; id: string }
  | { kind: "delegate"; id: string }
  | { kind: "memory"; id: string };

function estimateWrappedRows(text: string, width: number): number {
  if (text.length === 0) return 0;
  const usableWidth = Math.max(1, width);
  return text.split("\n").reduce((rows: number, line: string) => {
    return rows + Math.max(1, Math.ceil(Array.from(line).length / usableWidth));
  }, 0);
}

function getToggleTargets(items: ConversationItem[]): ToggleTarget[] {
  const targets: ToggleTarget[] = [];
  for (const item of items) {
    if (item.type === "thinking") {
      const lines = item.summary.split("\n");
      if (lines.length > 1) {
        targets.push({ kind: "thinking", id: item.id });
      }
      continue;
    }
    if (item.type === "tool_group") {
      for (const tool of item.tools) {
        if (tool.resultText) {
          targets.push({ kind: "tool", id: tool.id });
        }
      }
    }
    if (item.type === "delegate" && item.snapshot?.events.length) {
      targets.push({ kind: "delegate", id: item.id });
    }
    if (item.type === "memory_activity" && item.details.length > 0) {
      targets.push({ kind: "memory", id: item.id });
    }
  }
  return targets;
}

function getLatestCitation(
  items: ConversationItem[],
): AssistantCitation | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type !== "assistant") continue;
    const citations = Array.isArray(item.citations) ? item.citations : [];
    if (citations.length === 0) continue;
    return citations[0];
  }
  return undefined;
}

export function getActiveThinkingId(
  items: ConversationItem[],
  streamingState: StreamingState | undefined,
): string | undefined {
  if (streamingState !== ConversationStreamingState.Responding) {
    return undefined;
  }
  const turnStartIdx = findCurrentTurnStartIndex(items);
  for (let i = items.length - 1; i > turnStartIdx; i--) {
    const item = items[i];
    if (item?.type === "thinking") return item.id;
  }
  return undefined;
}

function shouldCompactPlanTranscript(
  planningPhase: PlanningPhase | undefined,
  activePlan: Plan | undefined,
  pendingPlanReview: { plan: Plan } | undefined,
): boolean {
  return Boolean(
    (planningPhase && planningPhase !== "done") || activePlan ||
      pendingPlanReview,
  );
}

export function shouldHideConversationTextInCompactPlanFlow(
  compactPlanTranscript: boolean,
  planningPhase: PlanningPhase | undefined,
  streamingState: StreamingState | undefined,
  hasInteractionRequest: boolean,
): boolean {
  if (!compactPlanTranscript) return false;
  if (planningPhase === "done") return false;
  return streamingState !== ConversationStreamingState.Idle ||
    hasInteractionRequest;
}

export function getConversationDisplayItems(
  items: ConversationItem[],
  options?: {
    compactPlanTranscript?: boolean;
    suppressCurrentTurnPrompt?: boolean;
    hideConversationText?: boolean;
  },
): ConversationItem[] {
  // Only compute turn index for picker suppression, NOT for history hiding
  const currentTurnStartIndex =
    options?.compactPlanTranscript && options?.suppressCurrentTurnPrompt
      ? findCurrentTurnStartIndex(items)
      : -1;
  return items.filter((item, itemIndex) => {
    if (!shouldRenderTimelineItem(item)) {
      return false;
    }
    // Picker prompt suppression (unchanged)
    if (
      currentTurnStartIndex >= 0 &&
      itemIndex >= currentTurnStartIndex &&
      (item.type === "user" || item.type === "assistant")
    ) {
      return false;
    }
    // Hide conversation text during active compact plan flow (unchanged)
    if (
      options?.hideConversationText &&
      (item.type === "user" || item.type === "assistant")
    ) {
      return false;
    }
    if (!options?.compactPlanTranscript) {
      return true;
    }
    // During plan mode: hide thinking and stats (noise), SHOW everything else
    if (item.type === "thinking" || item.type === "turn_stats") {
      return false;
    }
    return true;
  });
}

export {
  getPlanFlowActivities,
  getPlanFlowActivitySummary,
  getRecentPlanFlowActivitySummaries,
} from "./conversation/plan-flow.ts";

function estimateTodoRows(
  todoState: TodoState | undefined,
): number {
  if (!todoState || todoState.items.length === 0) return 0;
  return todoState.items.length;
}

function renderItem(
  item: ConversationItem,
  width: number,
  activeThinkingId: string | undefined,
  isToolExpanded: (toolId: string) => boolean,
  isThinkingExpanded: (thinkingId: string) => boolean,
  isDelegateExpanded: (delegateId: string) => boolean,
  isMemoryExpanded: (memoryId: string) => boolean,
): React.ReactElement | null {
  if (!shouldRenderTimelineItem(item)) {
    return null;
  }

  switch (item.type) {
    case "user":
      return (
        <UserMessage
          text={item.text}
          attachments={item.attachments}
          width={width}
        />
      );
    case "assistant":
      return (
        <AssistantMessage
          text={item.text}
          citations={item.citations}
          isPending={item.isPending}
          width={width}
        />
      );
    case "thinking":
      return (
        <ThinkingIndicator
          kind={item.kind}
          summary={item.summary}
          iteration={item.iteration}
          expanded={isThinkingExpanded(item.id)}
          isAnimating={item.id === activeThinkingId}
        />
      );
    case "tool_group":
      return (
        <ToolGroup
          tools={item.tools}
          width={width}
          isToolExpanded={isToolExpanded}
        />
      );
    case "delegate":
      return (
        <DelegateItem
          item={item}
          width={width}
          expanded={isDelegateExpanded(item.id)}
        />
      );
    case "turn_stats":
      return (
        <TurnStats
          toolCount={item.toolCount}
          durationMs={item.durationMs}
          width={width}
          inputTokens={item.inputTokens}
          outputTokens={item.outputTokens}
          modelId={item.modelId}
        />
      );
    case "memory_activity":
      return (
        <MemoryActivityLine
          recalled={item.recalled}
          written={item.written}
          searched={item.searched}
          details={item.details}
          expanded={isMemoryExpanded(item.id)}
        />
      );
    case "hql_eval":
      return <HqlEvalDisplay input={item.input} result={item.result} />;
    case "error":
      return <ErrorMessage text={item.text} />;
    case "info":
      if (isStructuredTeamInfoItem(item)) {
        return <TeamEventItem item={item} width={width} />;
      }
      return <InfoMessage text={item.text} />;
    default:
      return null;
  }
}

// Conversation history is expensive to recompute; skip redraws while the
// composer draft changes but the transcript props stay referentially stable.
export const ConversationPanel = React.memo(function ConversationPanel({
  items,
  width,
  streamingState,
  activePlan,
  planningPhase,
  todoState,
  pendingPlanReview,
  allowToggleHotkeys = true,
  interactionRequest,
  interactionQueueLength = 0,
  onInteractionResponse,
  onQuestionInterrupt,
  extraReservedRows = 0,
}: ConversationPanelProps): React.ReactElement {
  const sc = useSemanticColors();
  const { stdout } = useStdout();
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
  const agentItems = useMemo(
    () =>
      items.filter((item): item is AgentConversationItem =>
        item.type !== "hql_eval"
      ),
    [items],
  );
  const [scrollOffsetFromBottom, setScrollOffsetFromBottom] = useState(0);
  const compactPlanTranscript = useMemo(
    () =>
      shouldCompactPlanTranscript(planningPhase, activePlan, pendingPlanReview),
    [activePlan, pendingPlanReview, planningPhase],
  );
  const pickerInteractionActive = useMemo(
    () => isPickerInteractionRequest(interactionRequest),
    [interactionRequest],
  );
  const hideTranscriptDuringPicker = false;
  const hidePlanChromeDuringReviewPicker = Boolean(
    pendingPlanReview && pickerInteractionActive,
  );
  const hideConversationText = false;
  const displayItems = useMemo(
    () =>
      getConversationDisplayItems(items, {
        compactPlanTranscript,
        suppressCurrentTurnPrompt: compactPlanTranscript &&
          pickerInteractionActive,
        hideConversationText,
      }),
    [
      compactPlanTranscript,
      hideConversationText,
      pickerInteractionActive,
      items,
    ],
  );

  useEffect(() => {
    if (displayItems.length === 0) {
      setExpandedToolIds(new Set());
      setExpandedThinkingIds(new Set());
      setExpandedDelegateIds(new Set());
      setExpandedMemoryIds(new Set());
      setScrollOffsetFromBottom(0);
    }
  }, [displayItems.length]);

  const terminalRows = stdout?.rows ?? 24;
  const interactionRows = estimateInteractionDialogRows(
    interactionRequest,
    width,
  );
  const headerRows = useMemo(() => {
    let total = 0;
    if (!hidePlanChromeDuringReviewPicker) {
      total += estimateTodoRows(todoState);
    }
    return total;
  }, [
    hidePlanChromeDuringReviewPicker,
    todoState,
  ]);
  const visibleCount = useMemo(
    () =>
      getConversationVisibleCount(terminalRows, {
        reservedRows: headerRows + extraReservedRows +
          (interactionRequest ? interactionRows + 2 : 8),
      }),
    [
      extraReservedRows,
      headerRows,
      interactionRows,
      interactionRequest,
      terminalRows,
    ],
  );
  const renderableDisplayItems = hideTranscriptDuringPicker ? [] : displayItems;
  const viewport = useMemo(
    () =>
      computeConversationViewport(
        renderableDisplayItems.length,
        visibleCount,
        scrollOffsetFromBottom,
      ),
    [renderableDisplayItems.length, scrollOffsetFromBottom, visibleCount],
  );
  const visibleItems = useMemo(
    () => renderableDisplayItems.slice(viewport.start, viewport.end),
    [renderableDisplayItems, viewport.end, viewport.start],
  );

  useEffect(() => {
    setScrollOffsetFromBottom((prev: number) => {
      if (prev === 0) return 0; // At bottom (auto-follow) — nothing to clamp
      return clampConversationScrollOffset(
        prev,
        renderableDisplayItems.length,
        visibleCount,
      );
    });
  }, [renderableDisplayItems.length, visibleCount]);

  // Toggle targets operate over the visible conversation so the latest
  // tool/thinking block can always be expanded without duplicating turns.
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
    registerHandler(
      HandlerIds.CONVERSATION_TOGGLE_LATEST,
      () => {
        const target = toggleTargets[toggleTargets.length - 1];
        if (target) {
          toggleTarget(target);
        }
      },
      "ConversationPanel",
    );
    registerHandler(
      HandlerIds.CONVERSATION_OPEN_LATEST_SOURCE,
      async () => {
        const citation = getLatestCitation(items);
        if (citation?.url) {
          await getPlatform().openUrl(citation.url).catch(() => {});
        }
      },
      "ConversationPanel",
    );
    return () => {
      unregisterHandler(HandlerIds.CONVERSATION_TOGGLE_LATEST);
      unregisterHandler(HandlerIds.CONVERSATION_OPEN_LATEST_SOURCE);
    };
  }, [items, toggleTargets]);

  useInput((char, key) => {
    if (pickerInteractionActive) return;
    if (!displayItems.length) return;

    if (key.pageUp) {
      const pageSize = Math.max(1, visibleCount - 1);
      setScrollOffsetFromBottom((prev: number) =>
        clampConversationScrollOffset(
          prev + pageSize,
          displayItems.length,
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
          displayItems.length,
          visibleCount,
        )
      );
      return;
    }

    const conversationBinding = inspectHandlerKeybinding(char, key, {
      categories: CONVERSATION_KEYBINDING_CATEGORIES,
    });
    if (conversationBinding.kind === "handler") {
      if (interactionRequest?.mode === "question") return;
      if (!allowToggleHotkeys) return;
      void executeHandler(conversationBinding.id);
      return;
    }
    if (
      conversationBinding.kind === "disabled-default" ||
      conversationBinding.kind === "shadowed"
    ) {
      return;
    }
  });

  return (
    <Box flexDirection="column" width={width}>
      {displayItems.length === 0 &&
        streamingState != null &&
        streamingState !== ConversationStreamingState.Idle &&
        !todoState?.items.length &&
        !interactionRequest && (
        <Text color={sc.text.muted}>Conversation starting...</Text>
      )}

      {!hideTranscriptDuringPicker && viewport.hiddenAbove > 0 && (
        <Text color={sc.text.muted}>
          ↑ {viewport.hiddenAbove}{" "}
          earlier item{viewport.hiddenAbove === 1 ? "" : "s"}
        </Text>
      )}

      {visibleItems.map((item: ConversationItem) => (
        <Box key={item.id}>
          <RenderErrorBoundary>
            {renderItem(
              item,
              width,
              activeThinkingId,
              isToolExpanded,
              isThinkingExpanded,
              isDelegateExpanded,
              isMemoryExpanded,
            )}
          </RenderErrorBoundary>
        </Box>
      ))}

      {!hideTranscriptDuringPicker && viewport.hiddenBelow > 0 && (
        <Text color={sc.text.muted}>
          ↓ {viewport.hiddenBelow}{" "}
          newer item{viewport.hiddenBelow === 1 ? "" : "s"}
        </Text>
      )}

      {!hidePlanChromeDuringReviewPicker && todoState &&
        todoState.items.length > 0 && (
        <Box marginTop={1}>
          <PlanChecklistPanel
            planningPhase={planningPhase}
            todoState={todoState}
            items={agentItems}
          />
        </Box>
      )}

      {interactionRequest && onInteractionResponse && (
        <Box flexDirection="column" marginTop={1}>
          {interactionQueueLength > 1 && (
            <Text color={sc.status.warning}>
              {interactionQueueLength - 1}{" "}
              more interaction{interactionQueueLength - 1 === 1 ? "" : "s"}{" "}
              queued
            </Text>
          )}
          {interactionRequest.mode === "permission" && (
            <ConfirmationDialog
              requestId={interactionRequest.requestId}
              toolName={interactionRequest.toolName}
              toolArgs={interactionRequest.toolArgs}
              sourceLabel={interactionRequest.sourceLabel}
              sourceTeamName={interactionRequest.sourceTeamName}
              onResolve={onInteractionResponse}
            />
          )}
          {interactionRequest.mode === "question" && (
            <QuestionDialog
              requestId={interactionRequest.requestId}
              question={interactionRequest.question}
              options={interactionRequest.options}
              onResolve={onInteractionResponse}
              onInterrupt={onQuestionInterrupt}
            />
          )}
        </Box>
      )}
    </Box>
  );
});
