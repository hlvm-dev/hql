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
import { StreamingState as ConversationStreamingState } from "../types.ts";
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

interface ConversationPanelProps {
  items: ConversationItem[];
  width: number;
  streamingState?: StreamingState;
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

  useEffect(() => {
    if (items.length === 0) {
      setExpandedToolIds(new Set());
      setExpandedThinkingIds(new Set());
      setExpandedDelegateIds(new Set());
      setScrollOffsetFromBottom(0);
    }
  }, [items.length]);

  const terminalRows = stdout?.rows ?? 24;
  const visibleCount = useMemo(
    () =>
      getConversationVisibleCount(terminalRows, {
        reservedRows: interactionRequest ? 12 : 8,
      }),
    [interactionRequest, terminalRows],
  );
  const viewport = useMemo(
    () =>
      computeConversationViewport(
        items.length,
        visibleCount,
        scrollOffsetFromBottom,
      ),
    [items.length, scrollOffsetFromBottom, visibleCount],
  );
  const visibleItems = useMemo(
    () => items.slice(viewport.start, viewport.end),
    [items, viewport.end, viewport.start],
  );

  useEffect(() => {
    setScrollOffsetFromBottom((prev: number) =>
      clampConversationScrollOffset(prev, items.length, visibleCount)
    );
  }, [items.length, visibleCount]);

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

  useInput((char, key) => {
    const ctrlCode = char?.charCodeAt(0) ?? 0;
    const isCtrlO = (key.ctrl && char?.toLowerCase() === "o") ||
      ctrlCode === 15;
    const isCtrlY = (key.ctrl && char?.toLowerCase() === "y") ||
      ctrlCode === 25;
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

    if (isCtrlO) {
      if (interactionRequest?.mode === "question") return;
      if (!allowToggleHotkeys) return;
      const target = toggleTargets[toggleTargets.length - 1];
      if (target) {
        toggleTarget(target);
      }
      return;
    }
    if (isCtrlY) {
      if (interactionRequest?.mode === "question") return;
      if (!allowToggleHotkeys) return;
      const citation = getLatestCitation(items);
      if (!citation?.url) {
        return;
      }
      void getPlatform().openUrl(citation.url).catch(() => {});
      return;
    }
  });

  return (
    <Box flexDirection="column" width={width}>
      {items.length === 0 && streamingState && (
        <Text color={sc.text.muted}>Conversation starting...</Text>
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
