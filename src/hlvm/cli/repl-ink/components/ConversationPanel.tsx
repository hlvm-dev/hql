/**
 * ConversationPanel Component
 *
 * Renders a list of ConversationItems by dispatching to appropriate
 * message components. Used during agent mode in the REPL.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AssistantCitation, ConversationItem, StreamingState } from "../types.ts";
import { StreamingState as ConversationStreamingState } from "../types.ts";
import type { InteractionRequestEvent, InteractionResponse } from "../../../agent/registry.ts";
import { getPlatform } from "../../../../platform/platform.ts";
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
  onInteractionResponse?: (requestId: string, response: InteractionResponse) => void;
}

type ToggleTarget =
  | { kind: "tool"; id: string }
  | { kind: "thinking"; id: string };

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

function getLatestCitation(items: ConversationItem[]): AssistantCitation | undefined {
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
      return <DelegateItem item={item} width={width} />;
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

  useEffect(() => {
    if (items.length === 0) {
      setExpandedToolIds(new Set());
      setExpandedThinkingIds(new Set());
    }
  }, [items.length]);

  // Toggle targets operate over the visible conversation so the latest
  // tool/thinking block can always be expanded without duplicating turns.
  const toggleTargets = useMemo(
    () => getToggleTargets(items),
    [items],
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
    const isCtrlY = (key.ctrl && char?.toLowerCase() === "y") || ctrlCode === 25;
    if (!items.length) return;
    if (interactionRequest?.mode === "question") return;
    if (!allowToggleHotkeys) return;

    if (isCtrlO) {
      const target = toggleTargets[toggleTargets.length - 1];
      if (target) {
        toggleTarget(target);
      }
      return;
    }
    if (isCtrlY) {
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

      {items.map((item: ConversationItem) => (
        <Box key={item.id}>
          {renderItem(
            item,
            width,
            streamingState,
            isToolExpanded,
            isThinkingExpanded,
          )}
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
