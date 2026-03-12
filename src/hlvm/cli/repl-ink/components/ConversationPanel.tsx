/**
 * ConversationPanel Component
 *
 * Renders a list of ConversationItems by dispatching to appropriate
 * message components. Used during agent mode in the REPL.
 */

import React, { useEffect, useMemo, useState } from "react";
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
import type { Plan } from "../../../agent/planning.ts";
import type { TodoState } from "../../../agent/todo-state.ts";
import type { AgentCheckpointSummary } from "../../../agent/checkpoints.ts";
import type {
  InteractionRequestEvent,
  InteractionResponse,
} from "../../../agent/registry.ts";
import { getPlatform } from "../../../../platform/platform.ts";
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
  todoState?: TodoState;
  pendingPlanReview?: { plan: Plan };
  latestCheckpoint?: AgentCheckpointSummary;
  /** Whether section toggle hotkeys should be active (avoid conflicts with input editing) */
  allowToggleHotkeys?: boolean;
  /** Pending interaction request (permission or question) */
  interactionRequest?: InteractionRequestEvent;
  /** Number of queued interactions (permission/question) */
  interactionQueueLength?: number;
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

function renderItem(
  item: ConversationItem,
  width: number,
  streamingState: StreamingState | undefined,
  isToolExpanded: (toolId: string) => boolean,
  isThinkingExpanded: (thinkingId: string) => boolean,
  isDelegateExpanded: (delegateId: string) => boolean,
): React.ReactElement | null {
  if (!shouldRenderConversationItem(item)) {
    return null;
  }

  switch (item.type) {
    case "user":
      return <UserMessage text={item.text} width={width} />;
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
          isAnimating={streamingState === ConversationStreamingState.Responding}
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
  todoState,
  pendingPlanReview,
  latestCheckpoint,
  allowToggleHotkeys = true,
  interactionRequest,
  interactionQueueLength = 0,
  onInteractionResponse,
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
  const headerRows = ((): number => {
    let total = 0;
    if (activePlan) {
      total += estimateWrappedRows(
        `Plan ${activePlan.steps.length} step${
          activePlan.steps.length === 1 ? "" : "s"
        } · ${activePlan.goal}`,
        contentWidth,
      ) + 1;
    }
    if (todoState && todoState.items.length > 0) {
      total += estimateWrappedRows(
        `Progress ${
          todoState.items.filter((item) => item.status === "completed").length
        } done · ${
          todoState.items.filter((item) => item.status === "in_progress").length
        } in progress · ${
          todoState.items.filter((item) => item.status === "pending").length
        } pending`,
        contentWidth,
      ) + 1;
    }
    if (pendingPlanReview) {
      total += estimateWrappedRows(
        `Plan review pending · ${pendingPlanReview.plan.steps.length} step${
          pendingPlanReview.plan.steps.length === 1 ? "" : "s"
        } awaiting approval`,
        contentWidth,
      ) + 1;
    }
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
  })();
  const visibleCount = useMemo(
    () =>
      getConversationVisibleCount(terminalRows, {
        reservedRows: (interactionRequest ? 12 : 8) + headerRows,
      }),
    [headerRows, interactionRequest, terminalRows],
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
    setScrollOffsetFromBottom((prev: number) =>
      clampConversationScrollOffset(prev, displayItems.length, visibleCount)
    );
  }, [displayItems.length, visibleCount]);

  // Toggle targets operate over the visible conversation so the latest
  // tool/thinking block can always be expanded without duplicating turns.
  const toggleTargets = useMemo(
    () => getToggleTargets(visibleItems),
    [visibleItems],
  );

  const isToolExpanded = (toolId: string): boolean =>
    expandedToolIds.has(toolId);
  const isThinkingExpanded = (thinkingId: string): boolean =>
    expandedThinkingIds.has(thinkingId);
  const isDelegateExpanded = (delegateId: string): boolean =>
    expandedDelegateIds.has(delegateId);

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

      {activePlan && (
        <Box
          marginBottom={1}
          paddingLeft={1}
          borderLeft
          borderColor={sc.border.active}
        >
          <Text color={sc.text.primary} bold>
            Plan
          </Text>
          <Text color={sc.text.secondary}>
            {" "}
            {activePlan.steps.length}{" "}
            step{activePlan.steps.length === 1 ? "" : "s"} · {activePlan.goal}
          </Text>
        </Box>
      )}

      {todoState && todoState.items.length > 0 && (
        <Box
          marginBottom={1}
          paddingLeft={1}
          borderLeft
          borderColor={sc.status.warning}
        >
          <Text color={sc.status.warning} bold>
            Progress
          </Text>
          <Text color={sc.text.secondary}>
            {" "}
            {todoState.items.filter((item) => item.status === "completed")
              .length} done ·{" "}
            {todoState.items.filter((item) => item.status === "in_progress")
              .length} in progress ·{" "}
            {todoState.items.filter((item) => item.status === "pending").length}
            {" "}
            pending
          </Text>
        </Box>
      )}

      {pendingPlanReview && (
        <Box
          marginBottom={1}
          paddingLeft={1}
          borderLeft
          borderColor={sc.status.warning}
        >
          <Text color={sc.status.warning} bold>
            Plan Review
          </Text>
          <Text color={sc.text.secondary}>
            {" "}
            {pendingPlanReview.plan.steps.length} step
            {pendingPlanReview.plan.steps.length === 1 ? "" : "s"} awaiting{" "}
            approval
          </Text>
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
            streamingState,
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
