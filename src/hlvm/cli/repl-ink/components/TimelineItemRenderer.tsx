import React from "react";
import { Box } from "ink";
import type {
  AgentConversationItem,
  AssistantCitation,
  HqlEvalItem,
  ShellHistoryEntry,
  StreamingState,
} from "../types.ts";
import {
  isStructuredTeamInfoItem,
  StreamingState as ConversationStreamingState,
} from "../types.ts";
import {
  AssistantMessage,
  DelegateGroup,
  DelegateItem,
  ErrorMessage,
  HqlEvalDisplay,
  InfoMessage,
  MemoryActivityLine,
  TeamEventItem,
  ThinkingIndicator,
  ToolGroup,
  TurnStats,
  UserMessage,
} from "./conversation/index.ts";
import { TranscriptDivider } from "./conversation/TranscriptDivider.tsx";

export type ToggleTarget =
  | { kind: "tool"; id: string }
  | { kind: "thinking"; id: string }
  | { kind: "delegate"; id: string }
  | { kind: "delegate_group"; id: string }
  | { kind: "memory"; id: string };

interface TimelineItemRendererProps {
  item: ShellHistoryEntry;
  width: number;
  activeThinkingId?: string;
  compactSpacing?: boolean;
  showDividerBefore?: boolean;
  isToolExpanded?: (toolId: string) => boolean;
  isThinkingExpanded?: (thinkingId: string) => boolean;
  isDelegateExpanded?: (delegateId: string) => boolean;
  isDelegateGroupExpanded?: (groupId: string) => boolean;
  isMemoryExpanded?: (memoryId: string) => boolean;
}

export function getToggleTargets(
  items: readonly ShellHistoryEntry[],
): ToggleTarget[] {
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
        if (tool.resultDetailText || tool.resultText) {
          targets.push({ kind: "tool", id: tool.id });
        }
      }
      continue;
    }
    if (item.type === "delegate" && item.snapshot?.events.length) {
      targets.push({ kind: "delegate", id: item.id });
      continue;
    }
    if (item.type === "delegate_group" && item.entries.length > 0) {
      targets.push({ kind: "delegate_group", id: item.id });
      continue;
    }
    if (item.type === "memory_activity" && item.details.length > 0) {
      targets.push({ kind: "memory", id: item.id });
    }
  }
  return targets;
}

export function getLatestCitation(
  items: readonly ShellHistoryEntry[],
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

export function filterDuplicateWaitingIndicators<T extends ShellHistoryEntry>(
  items: readonly T[],
): T[] {
  const thinkingTurnIds = new Set(
    items.flatMap((item) =>
      item.type === "thinking" && typeof item.turnId === "string"
        ? [item.turnId]
        : []
    ),
  );
  if (thinkingTurnIds.size === 0) {
    return [...items];
  }
  return items.filter((item) =>
    !(
      item.type === "assistant" &&
      item.isPending &&
      item.text.trim().length === 0 &&
      typeof item.turnId === "string" &&
      thinkingTurnIds.has(item.turnId)
    )
  );
}

export function getActiveThinkingId(
  items: readonly AgentConversationItem[],
  streamingState: StreamingState | undefined,
): string | undefined {
  if (streamingState !== ConversationStreamingState.Responding) {
    return undefined;
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type === "thinking") {
      return item.id;
    }
  }
  return undefined;
}

export function TimelineItemRenderer(
  {
    item,
    width,
    activeThinkingId,
    compactSpacing = false,
    showDividerBefore = false,
    isToolExpanded,
    isThinkingExpanded,
    isDelegateExpanded,
    isDelegateGroupExpanded,
    isMemoryExpanded,
  }: TimelineItemRendererProps,
): React.ReactElement {
  if (item.type === "user") {
    return (
      <UserMessage
        text={item.text}
        attachments={item.attachments}
        width={width}
        compactSpacing={compactSpacing}
        showDividerBefore={showDividerBefore}
      />
    );
  }
  if (item.type === "assistant") {
    return (
      <AssistantMessage
        text={item.text}
        citations={item.citations}
        isPending={item.isPending}
        width={width}
        compactSpacing={compactSpacing}
      />
    );
  }
  if (item.type === "thinking") {
    return (
      <ThinkingIndicator
        kind={item.kind}
        summary={item.summary}
        iteration={item.iteration}
        expanded={Boolean(isThinkingExpanded?.(item.id))}
        isAnimating={item.id === activeThinkingId}
      />
    );
  }
  if (item.type === "tool_group") {
    return (
      <ToolGroup
        tools={item.tools}
        width={width}
        isToolExpanded={isToolExpanded}
      />
    );
  }
  if (item.type === "delegate") {
    return (
      <DelegateItem
        item={item}
        width={width}
        expanded={Boolean(isDelegateExpanded?.(item.id))}
      />
    );
  }
  if (item.type === "delegate_group") {
    return (
      <DelegateGroup
        item={item}
        width={width}
        expanded={Boolean(isDelegateGroupExpanded?.(item.id))}
      />
    );
  }
  if (item.type === "turn_stats") {
    return (
      <TurnStats
        toolCount={item.toolCount}
        durationMs={item.durationMs}
        inputTokens={item.inputTokens}
        outputTokens={item.outputTokens}
        modelId={item.modelId}
        costUsd={item.costUsd}
        costEstimated={item.costEstimated}
        continuedThisTurn={item.continuedThisTurn}
        continuationCount={item.continuationCount}
        compactionReason={item.compactionReason}
        status={item.status}
        summary={item.summary}
        activityTrail={item.activityTrail}
        width={width}
      />
    );
  }
  if (item.type === "memory_activity") {
    return (
      <MemoryActivityLine
        recalled={item.recalled}
        written={item.written}
        searched={item.searched}
        details={item.details}
        expanded={Boolean(isMemoryExpanded?.(item.id))}
      />
    );
  }
  if (item.type === "error") {
    return <ErrorMessage text={item.text} />;
  }
  if (item.type === "info" && isStructuredTeamInfoItem(item)) {
    return <TeamEventItem item={item} width={width} />;
  }
  if (item.type === "info") {
    return <InfoMessage text={item.text} />;
  }
  if ((item as HqlEvalItem).type === "hql_eval") {
    const evalItem = item as HqlEvalItem;
    return (
      <Box flexDirection="column" width={width}>
        {showDividerBefore && <TranscriptDivider width={width} />}
        <HqlEvalDisplay input={evalItem.input} result={evalItem.result} />
      </Box>
    );
  }
  return <Box />;
}
