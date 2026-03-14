/**
 * ConversationPanel Component
 *
 * Renders a list of ConversationItems by dispatching to appropriate
 * message components. Used during agent mode in the REPL.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type {
  AssistantCitation,
  ConversationItem,
  StreamingState,
} from "../types.ts";
import {
  isStructuredTeamInfoItem,
  StreamingState as ConversationStreamingState,
} from "../types.ts";
import type { Plan, PlanningPhase } from "../../../agent/planning.ts";
import type { TodoState } from "../../../agent/todo-state.ts";
import type { AgentCheckpointSummary } from "../../../agent/checkpoints.ts";
import type {
  InteractionRequestEvent,
  InteractionResponse,
} from "../../../agent/registry.ts";
import { findCurrentTurnStartIndex } from "../../agent-transcript-state.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { estimateInteractionDialogRows } from "./conversation/interaction-dialog-layout.ts";
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
  AssistantMessage,
  ConfirmationDialog,
  DelegateItem,
  ErrorMessage,
  InfoMessage,
  QuestionDialog,
  ThinkingIndicator,
  ToolGroup,
  TurnStats,
  UserMessage,
} from "./conversation/index.ts";
import { useSemanticColors } from "../../theme/index.ts";

const CONVERSATION_KEYBINDING_CATEGORIES = ["Conversation"] as const;

interface ConversationPanelProps {
  items: ConversationItem[];
  width: number;
  streamingState?: StreamingState;
  activePlan?: Plan;
  planningPhase?: PlanningPhase;
  todoState?: TodoState;
  pendingPlanReview?: { plan: Plan };
  latestCheckpoint?: AgentCheckpointSummary;
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
}

type ToggleTarget =
  | { kind: "tool"; id: string }
  | { kind: "thinking"; id: string }
  | { kind: "delegate"; id: string };

function estimateWrappedRows(text: string, width: number): number {
  if (text.length === 0) return 0;
  const usableWidth = Math.max(1, width);
  return text.split("\n").reduce((rows: number, line: string) => {
    return rows + Math.max(1, Math.ceil(Array.from(line).length / usableWidth));
  }, 0);
}

function shouldRenderConversationItem(item: ConversationItem): boolean {
  return !(
    isStructuredTeamInfoItem(item) &&
    item.teamEventType === "team_runtime_snapshot"
  );
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

function getPlanningPhaseTitle(
  phase: PlanningPhase | undefined,
  hasPendingPlanReview: boolean,
): string | undefined {
  switch (phase) {
    case "researching":
      return "Plan Mode · Researching";
    case "drafting":
      return "Plan Mode · Drafting";
    case "reviewing":
      return hasPendingPlanReview
        ? "Ready To Execute"
        : "Plan Mode · Reviewing";
    case "executing":
      return "Executing Approved Plan";
    case "done":
      return "Plan Complete";
    default:
      return undefined;
  }
}

function getPlanningPhaseSummary(
  phase: PlanningPhase | undefined,
  plan: Plan | undefined,
  hasPendingPlanReview: boolean,
): string | undefined {
  if (plan) {
    const planSummary = `${plan.steps.length} step${
      plan.steps.length === 1 ? "" : "s"
    } · ${plan.goal}`;
    if (hasPendingPlanReview) {
      return `${planSummary} · awaiting approval`;
    }
    return planSummary;
  }
  switch (phase) {
    case "researching":
      return "Read-only planning is active";
    case "drafting":
      return "Shaping the execution plan";
    case "reviewing":
      return "Review the plan before execution";
    default:
      return undefined;
  }
}

function estimateTodoRows(
  todoState: TodoState | undefined,
  width: number,
): number {
  if (!todoState || todoState.items.length === 0) return 0;
  const contentWidth = Math.max(12, width);
  const summary = `${
    todoState.items.filter((item) => item.status === "completed").length
  } done · ${
    todoState.items.filter((item) => item.status === "in_progress").length
  } in progress · ${
    todoState.items.filter((item) => item.status === "pending").length
  } pending`;
  return 2 +
    estimateWrappedRows(summary, contentWidth) +
    todoState.items.reduce(
      (total: number, item: TodoState["items"][number]) =>
        total + estimateWrappedRows(`• ${item.content}`, contentWidth),
      0,
    );
}

function renderItem(
  item: ConversationItem,
  width: number,
  activeThinkingId: string | undefined,
  isToolExpanded: (toolId: string) => boolean,
  isThinkingExpanded: (thinkingId: string) => boolean,
  isDelegateExpanded: (delegateId: string) => boolean,
): React.ReactElement | null {
  if (!shouldRenderConversationItem(item)) {
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
          inputTokens={item.inputTokens}
          outputTokens={item.outputTokens}
          modelId={item.modelId}
        />
      );
    case "error":
      return <ErrorMessage text={item.text} />;
    case "info":
      return <InfoMessage text={item.text} />;
    default:
      return null;
  }
}

export function ConversationPanel({
  items,
  width,
  streamingState,
  activePlan,
  planningPhase,
  todoState,
  pendingPlanReview,
  latestCheckpoint,
  allowToggleHotkeys = true,
  interactionRequest,
  interactionQueueLength = 0,
  onInteractionResponse,
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
  const activeThinkingId = useMemo(
    () => getActiveThinkingId(items, streamingState),
    [items, streamingState],
  );
  const [scrollOffsetFromBottom, setScrollOffsetFromBottom] = useState(0);
  const displayItems = useMemo(
    () => items.filter(shouldRenderConversationItem),
    [items],
  );

  useEffect(() => {
    if (displayItems.length === 0) {
      setExpandedToolIds(new Set());
      setExpandedThinkingIds(new Set());
      setExpandedDelegateIds(new Set());
      setScrollOffsetFromBottom(0);
    }
  }, [displayItems.length]);

  const terminalRows = stdout?.rows ?? 24;
  const contentWidth = Math.max(10, width - 6);
  // Derive plan checklist display state from active/pending plan and current planning phase
  // Plan checklist: shows pending-review plan if present, otherwise the active plan
  const planSummary = pendingPlanReview?.plan ?? activePlan;
  const phaseTitle = getPlanningPhaseTitle(
    planningPhase,
    Boolean(pendingPlanReview),
  );
  const phaseSummary = getPlanningPhaseSummary(
    planningPhase,
    planSummary,
    Boolean(pendingPlanReview),
  );
  const interactionRows = estimateInteractionDialogRows(
    interactionRequest,
    width,
  );
  const headerRows = useMemo(() => {
    let total = 0;
    if (phaseTitle || phaseSummary) {
      total += estimateWrappedRows(phaseTitle ?? "Plan Mode", contentWidth);
      if (phaseSummary) {
        total += estimateWrappedRows(phaseSummary, contentWidth);
      }
      total += 1;
    }
    total += estimateTodoRows(todoState, contentWidth);
    if (latestCheckpoint) {
      total += estimateWrappedRows(
        latestCheckpoint.restoredAt
          ? `Checkpoint restored · ${latestCheckpoint.fileCount} file${
            latestCheckpoint.fileCount === 1 ? "" : "s"
          }`
          : `Checkpoint ready · ${latestCheckpoint.fileCount} file${
            latestCheckpoint.fileCount === 1 ? "" : "s"
          } protected · /undo available`,
        contentWidth,
      ) + 1;
    }
    return total;
  }, [phaseTitle, phaseSummary, todoState, latestCheckpoint, contentWidth]);
  const visibleCount = useMemo(
    () =>
      getConversationVisibleCount(terminalRows, {
        reservedRows: headerRows + extraReservedRows +
          (interactionRequest ? interactionRows + 2 : 8),
      }),
    [extraReservedRows, headerRows, interactionRows, interactionRequest, terminalRows],
  );
  const viewport = useMemo(
    () =>
      computeConversationViewport(
        displayItems.length,
        visibleCount,
        scrollOffsetFromBottom,
      ),
    [displayItems.length, scrollOffsetFromBottom, visibleCount],
  );
  const visibleItems = useMemo(
    () => displayItems.slice(viewport.start, viewport.end),
    [displayItems, viewport.end, viewport.start],
  );

  useEffect(() => {
    setScrollOffsetFromBottom((prev: number) => {
      if (prev === 0) return 0; // At bottom (auto-follow) — nothing to clamp
      return clampConversationScrollOffset(prev, displayItems.length, visibleCount);
    });
  }, [displayItems.length, visibleCount]);

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

  const toggleTarget = (target: ToggleTarget): void => {
    if (target.kind === "tool") {
      setExpandedToolIds((prev: Set<string>) => {
        const next = new Set(prev);
        if (next.has(target.id)) next.delete(target.id);
        else next.add(target.id);
        return next;
      });
      return;
    }
    if (target.kind === "delegate") {
      setExpandedDelegateIds((prev: Set<string>) => {
        const next = new Set(prev);
        if (next.has(target.id)) next.delete(target.id);
        else next.add(target.id);
        return next;
      });
      return;
    }
    setExpandedThinkingIds((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(target.id)) next.delete(target.id);
      else next.add(target.id);
      return next;
    });
  };

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
      {displayItems.length === 0 && streamingState && (
        <Text color={sc.text.muted}>Conversation starting...</Text>
      )}

      {(phaseTitle || phaseSummary) && (
        <Box
          marginBottom={1}
          paddingLeft={1}
          borderLeft
          borderColor={planningPhase === "done"
            ? sc.status.success
            : planningPhase === "reviewing"
            ? sc.status.warning
            : planningPhase === "executing"
            ? sc.border.active
            : sc.border.active}
          flexDirection="column"
        >
          <Text
            color={planningPhase === "done"
              ? sc.status.success
              : planningPhase === "reviewing"
              ? sc.status.warning
              : sc.text.primary}
            bold
          >
            {phaseTitle ?? "Plan Mode"}
          </Text>
          {phaseSummary && (
            <Text color={sc.text.secondary}>
              {phaseSummary}
            </Text>
          )}
        </Box>
      )}

      {todoState && todoState.items.length > 0 && (
        <Box
          marginBottom={1}
          paddingLeft={1}
          borderLeft
          borderColor={sc.status.warning}
          flexDirection="column"
        >
          <Text color={sc.status.warning} bold>
            Checklist
          </Text>
          <Text color={sc.text.secondary}>
            {todoState.items.filter((item) => item.status === "completed")
              .length} done ·{" "}
            {todoState.items.filter((item) => item.status === "in_progress")
              .length} in progress ·{" "}
            {todoState.items.filter((item) => item.status === "pending").length}
            {" "}
            pending
          </Text>
          <Box paddingLeft={1} flexDirection="column">
            {todoState.items.map((item) => {
              const marker = item.status === "completed"
                ? "✓"
                : item.status === "in_progress"
                ? "~"
                : "•";
              const markerColor = item.status === "completed"
                ? sc.status.success
                : item.status === "in_progress"
                ? sc.status.warning
                : sc.text.muted;
              const textColor = item.status === "pending"
                ? sc.text.muted
                : sc.text.primary;
              return (
                <Box key={item.id}>
                  <Text color={markerColor}>{marker}</Text>
                  <Text color={textColor}>{item.content}</Text>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {latestCheckpoint && (
        <Box
          marginBottom={1}
          paddingLeft={1}
          borderLeft
          borderColor={latestCheckpoint.restoredAt
            ? sc.status.success
            : sc.border.active}
        >
          <Text
            color={latestCheckpoint.restoredAt
              ? sc.status.success
              : sc.border.active}
            bold
          >
            {latestCheckpoint.restoredAt ? "Checkpoint Restored" : "Checkpoint"}
          </Text>
          <Text color={sc.text.secondary}>
            {" "}
            {latestCheckpoint.fileCount} file
            {latestCheckpoint.fileCount === 1 ? "" : "s"}
            {latestCheckpoint.restoredAt
              ? " reverted"
              : " protected · /undo available"}
          </Text>
        </Box>
      )}

      {viewport.hiddenAbove > 0 && (
        <Text color={sc.text.muted}>
          ↑ {viewport.hiddenAbove}{" "}
          earlier item{viewport.hiddenAbove === 1 ? "" : "s"}
        </Text>
      )}

      {visibleItems.map((item: ConversationItem) => (
        <Box key={item.id}>
          {renderItem(
            item,
            width,
            activeThinkingId,
            isToolExpanded,
            isThinkingExpanded,
            isDelegateExpanded,
          )}
        </Box>
      ))}

      {viewport.hiddenBelow > 0 && (
        <Text color={sc.text.muted}>
          ↓ {viewport.hiddenBelow}{" "}
          newer item{viewport.hiddenBelow === 1 ? "" : "s"}
        </Text>
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
              toolName={interactionRequest.toolName}
              toolArgs={interactionRequest.toolArgs}
            />
          )}
          {interactionRequest.mode === "question" && (
            <QuestionDialog question={interactionRequest.question} />
          )}
        </Box>
      )}
    </Box>
  );
}
