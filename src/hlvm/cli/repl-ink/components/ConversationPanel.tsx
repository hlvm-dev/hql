/**
 * ConversationPanel Component
 *
 * Renders a list of ConversationItems by dispatching to appropriate
 * message components. Used during agent mode in the REPL.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { ConversationItem } from "../types.ts";
import type { InteractionRequestEvent, InteractionResponse } from "../../../agent/registry.ts";
import {
  AssistantMessage,
  ConfirmationDialog,
  ErrorMessage,
  InfoMessage,
  QuestionDialog,
  ThinkingIndicator,
  ToolGroup,
  TurnStats,
  UserMessage,
} from "./conversation/index.ts";
import {
  clampConversationScrollOffset,
  computeConversationViewport,
  getConversationVisibleCount,
} from "../utils/conversation-viewport.ts";
import { useSemanticColors } from "../../theme/index.ts";

interface ConversationPanelProps {
  items: ConversationItem[];
  width: number;
  /** Whether section toggle hotkeys should be active (avoid conflicts with input editing) */
  allowToggleHotkeys?: boolean;
  /** Pending interaction request (permission or question) */
  interactionRequest?: InteractionRequestEvent;
  /** Number of queued interactions (permission/question) */
  interactionQueueLength?: number;
  /** Callback to respond to interaction request */
  onInteractionResponse?: (requestId: string, response: InteractionResponse) => void;
}

type ToggleTarget =
  | { kind: "tool"; id: string }
  | { kind: "thinking"; id: string };

function isPendingItem(item: ConversationItem): boolean {
  if (item.type === "thinking") return true;
  if (item.type === "assistant" && item.isPending) return true;
  if (item.type === "tool_group") {
    return item.tools.some((t) => t.status === "running" || t.status === "pending");
  }
  return false;
}

function getPendingStartIndex(items: ConversationItem[]): number {
  for (let i = 0; i < items.length; i++) {
    if (isPendingItem(items[i])) return i;
  }
  return items.length;
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
  }
  return targets;
}

function renderItem(
  item: ConversationItem,
  width: number,
  isToolExpanded: (toolId: string) => boolean,
  isThinkingExpanded: (thinkingId: string) => boolean,
): React.ReactElement | null {
  switch (item.type) {
    case "user":
      return <UserMessage text={item.text} width={width} />;
    case "assistant":
      return <AssistantMessage text={item.text} isPending={item.isPending} width={width} />;
    case "thinking":
      return (
        <ThinkingIndicator
          summary={item.summary}
          iteration={item.iteration}
          expanded={isThinkingExpanded(item.id)}
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
    case "turn_stats":
      return <TurnStats toolCount={item.toolCount} durationMs={item.durationMs} />;
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
  allowToggleHotkeys = true,
  interactionRequest,
  interactionQueueLength = 0,
  onInteractionResponse,
}: ConversationPanelProps): React.ReactElement {
  const sc = useSemanticColors();
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;
  const reservedRows = interactionRequest ? 14 : 10;
  const visibleCount = getConversationVisibleCount(terminalRows, { reservedRows });
  const [scrollOffset, setScrollOffset] = useState(0);
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Set<string>>(
    () => new Set(),
  );

  const pendingStart = useMemo(() => getPendingStartIndex(items), [items]);
  const staticItems = useMemo(() => items.slice(0, pendingStart), [items, pendingStart]);
  const pendingItems = useMemo(() => items.slice(pendingStart), [items, pendingStart]);
  const maxPendingVisible = Math.max(2, Math.floor(visibleCount * 0.5));
  const hiddenPendingCount = Math.max(0, pendingItems.length - maxPendingVisible);
  const visiblePendingItems = useMemo(
    () => hiddenPendingCount > 0 ? pendingItems.slice(-maxPendingVisible) : pendingItems,
    [pendingItems, hiddenPendingCount, maxPendingVisible],
  );
  // Reserve viewport budget for pending items so static history window does not overflow.
  const effectiveStaticVisibleCount = Math.max(0, visibleCount - visiblePendingItems.length);
  const pageStep = Math.max(1, Math.floor(Math.max(1, effectiveStaticVisibleCount) * 0.8));

  const viewport = useMemo(
    () => computeConversationViewport(staticItems.length, effectiveStaticVisibleCount, scrollOffset),
    [staticItems.length, effectiveStaticVisibleCount, scrollOffset],
  );

  useEffect(() => {
    setScrollOffset((prev: number) =>
      clampConversationScrollOffset(prev, staticItems.length, effectiveStaticVisibleCount)
    );
  }, [staticItems.length, effectiveStaticVisibleCount]);

  useEffect(() => {
    if (items.length === 0) {
      setExpandedToolIds(new Set());
      setExpandedThinkingIds(new Set());
    }
  }, [items.length]);

  const visibleStaticItems = staticItems.slice(viewport.start, viewport.end);
  const toggleTargets = useMemo(
    () => getToggleTargets([...visibleStaticItems, ...visiblePendingItems]),
    [visibleStaticItems, visiblePendingItems],
  );

  const isToolExpanded = (toolId: string): boolean => expandedToolIds.has(toolId);
  const isThinkingExpanded = (thinkingId: string): boolean =>
    expandedThinkingIds.has(thinkingId);

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
    setExpandedThinkingIds((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(target.id)) next.delete(target.id);
      else next.add(target.id);
      return next;
    });
  };

  useInput((char, key) => {
    const ctrlCode = char?.charCodeAt(0) ?? 0;
    const isCtrlO = (key.ctrl && char?.toLowerCase() === "o") || ctrlCode === 15;
    if (!items.length) return;
    if (interactionRequest?.mode !== "question" && isCtrlO) {
      if (!allowToggleHotkeys) return;
      const target = toggleTargets[toggleTargets.length - 1];
      if (target) {
        toggleTarget(target);
      }
      return;
    }
    if (key.pageUp) {
      setScrollOffset((prev: number) =>
        clampConversationScrollOffset(
          prev + pageStep,
          staticItems.length,
          effectiveStaticVisibleCount,
        )
      );
      return;
    }
    if (key.pageDown) {
      setScrollOffset((prev: number) =>
        clampConversationScrollOffset(
          prev - pageStep,
          staticItems.length,
          effectiveStaticVisibleCount,
        )
      );
      return;
    }
    if (key.ctrl && key.downArrow) {
      setScrollOffset(0);
      return;
    }
    if (key.ctrl && key.upArrow) {
      setScrollOffset(viewport.maxOffset);
    }
  });

  return (
    <Box flexDirection="column" width={width}>
      {scrollOffset > 0 && (
        <Text color={sc.status.warning}>
          Scrolled up · Ctrl+↓ to jump to latest
        </Text>
      )}

      {viewport.hiddenAbove > 0 && (
        <Text color={sc.text.muted}>
          … {viewport.hiddenAbove} earlier item{viewport.hiddenAbove === 1 ? "" : "s"} hidden (PgUp)
        </Text>
      )}

      {visibleStaticItems.map((item: ConversationItem) => (
        <Box key={item.id}>
          {renderItem(item, width, isToolExpanded, isThinkingExpanded)}
        </Box>
      ))}

      {hiddenPendingCount > 0 && (
        <Text color={sc.text.muted}>
          … {hiddenPendingCount} earlier pending item{hiddenPendingCount === 1 ? "" : "s"} hidden
        </Text>
      )}

      {visiblePendingItems.map((item: ConversationItem) => (
        <Box key={item.id}>
          {renderItem(item, width, isToolExpanded, isThinkingExpanded)}
        </Box>
      ))}

      {viewport.hiddenBelow > 0 && (
        <Text color={sc.text.muted}>
          … {viewport.hiddenBelow} newer item{viewport.hiddenBelow === 1 ? "" : "s"} hidden (PgDn)
        </Text>
      )}

      {interactionRequest && onInteractionResponse && (
        <Box flexDirection="column" marginTop={1}>
          {interactionQueueLength > 1 && (
            <Text color={sc.status.warning}>
              {interactionQueueLength - 1} more interaction{interactionQueueLength - 1 === 1 ? "" : "s"} queued
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
