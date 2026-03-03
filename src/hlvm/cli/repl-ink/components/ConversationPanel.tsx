/**
 * ConversationPanel Component
 *
 * Renders a list of ConversationItems by dispatching to appropriate
 * message components. Used during agent mode in the REPL.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Box, Static, Text, useInput } from "ink";
import type { ConversationItem, StreamingState } from "../types.ts";
import { StreamingState as ConversationStreamingState } from "../types.ts";
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
  streamingState: StreamingState | undefined,
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
    case "turn_stats":
      return <TurnStats toolCount={item.toolCount} durationMs={item.durationMs} inputTokens={item.inputTokens} outputTokens={item.outputTokens} />;
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
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Set<string>>(
    () => new Set(),
  );

  const pendingStart = useMemo(
    () => getPendingStartIndex(items),
    [items],
  );
  const staticItems = useMemo(() => items.slice(0, pendingStart), [items, pendingStart]);
  const pendingItems = useMemo(() => items.slice(pendingStart), [items, pendingStart]);

  useEffect(() => {
    if (items.length === 0) {
      setExpandedToolIds(new Set());
      setExpandedThinkingIds(new Set());
    }
  }, [items.length]);

  // Toggle targets only apply to current pending section to avoid re-rendering committed history.
  const toggleTargets = useMemo(
    () => getToggleTargets(pendingItems),
    [pendingItems],
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
  });

  const renderStaticItem = (item: ConversationItem): React.ReactElement => (
    <Box key={item.id}>
      {renderItem(item, width, streamingState, isToolExpanded, isThinkingExpanded)}
    </Box>
  );
  const staticProps = { items: staticItems, children: renderStaticItem };

  return (
    <Box flexDirection="column" width={width}>
      {items.length === 0 && streamingState && (
        <Text color={sc.text.muted}>Conversation starting...</Text>
      )}

      {/* Committed history is rendered once and never reflowed, eliminating jumpy updates. */}
      {staticItems.length > 0 && (
        <Static<ConversationItem> {...staticProps} />
      )}

      {pendingItems.map((item: ConversationItem) => (
        <Box key={item.id}>
          {renderItem(item, width, streamingState, isToolExpanded, isThinkingExpanded)}
        </Box>
      ))}

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
