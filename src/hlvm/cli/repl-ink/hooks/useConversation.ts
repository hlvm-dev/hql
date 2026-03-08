/**
 * useConversation — Accumulates AgentUIEvent stream into ConversationItem[].
 *
 * Transforms raw agent events into structured, renderable conversation items.
 *
 * Lifecycle rules (following Gemini CLI pattern):
 * - Thinking items are TRANSIENT — removed when turn ends (turn_stats)
 * - Assistant text updates find ANY pending assistant item (not just last)
 * - turn_stats cleans up thinking items and finalizes pending assistants
 * - addUserMessage cleans up orphaned thinking/pending from incomplete turns
 */

import { useCallback, useRef, useState } from "react";
import type { AgentUIEvent } from "../../../agent/orchestrator.ts";
import type {
  AssistantCitation,
  AssistantItem,
  ConversationItem,
  DelegateItem,
  InfoItem,
  StreamingState,
  ThinkingItem,
  ToolCallDisplay,
  ToolGroupItem,
} from "../types.ts";
import { StreamingState as ConversationStreamingState } from "../types.ts";

// ============================================================
// Helpers
// ============================================================

/** Remove transient status rows and finalize any pending assistant items. */
function findPendingAssistantIndex(items: ConversationItem[]): number {
  return items.findLastIndex((item: ConversationItem) =>
    item.type === "assistant" && item.isPending
  );
}

function insertBeforePendingAssistant(
  items: ConversationItem[],
  nextItem: ConversationItem,
): ConversationItem[] {
  const pendingAssistantIdx = findPendingAssistantIndex(items);
  if (pendingAssistantIdx < 0) {
    return [...items, nextItem];
  }
  const next = [...items];
  next.splice(pendingAssistantIdx, 0, nextItem);
  return next;
}

function removeTransientInfoItems(
  items: ConversationItem[],
): ConversationItem[] {
  return items.filter((item: ConversationItem) =>
    item.type !== "info" || item.isTransient !== true
  );
}

function cleanupTransientItems(items: ConversationItem[]): ConversationItem[] {
  return removeTransientInfoItems(items).flatMap((item: ConversationItem) => {
    if (item.type === "thinking") return [];
    if (item.type === "assistant" && item.isPending) {
      return item.text.trim().length > 0 ? [{ ...item, isPending: false }] : [];
    }
    return [item];
  });
}

function upsertThinkingItem(
  items: ConversationItem[],
  iteration: number,
  summary: string,
  nextId: () => string,
): ConversationItem[] {
  const idx = items.findIndex(
    (item: ConversationItem) =>
      item.type === "thinking" && item.iteration === iteration,
  );
  if (idx < 0) {
    const thinking: ThinkingItem = {
      type: "thinking",
      id: nextId(),
      summary,
      iteration,
    };
    return insertBeforePendingAssistant(items, thinking);
  }
  const next = [...items];
  const current = next[idx];
  if (current.type !== "thinking") return items;
  next[idx] = { ...current, summary };
  return next;
}

function findMatchingRunningToolIndex(
  tools: ToolCallDisplay[],
  name: string,
  argsSummary: string,
): number {
  const exactIdx = tools.findIndex(
    (tool: ToolCallDisplay) =>
      tool.status === "running" &&
      tool.name === name &&
      tool.argsSummary === argsSummary,
  );
  if (exactIdx >= 0) return exactIdx;
  return tools.findIndex(
    (tool: ToolCallDisplay) => tool.name === name && tool.status === "running",
  );
}

function findMatchingRunningDelegateIndex(
  items: ConversationItem[],
  agent: string,
  task: string,
): number {
  const exactIdx = items.findLastIndex((item: ConversationItem) =>
    item.type === "delegate" &&
    item.status === "running" &&
    item.agent === agent &&
    item.task === task
  );
  if (exactIdx >= 0) return exactIdx;
  return items.findLastIndex((item: ConversationItem) =>
    item.type === "delegate" &&
    item.status === "running" &&
    item.agent === agent
  );
}

function appendDelegateItem(
  items: ConversationItem[],
  agent: string,
  task: string,
  nextId: () => string,
): ConversationItem[] {
  return insertBeforePendingAssistant(items, {
    type: "delegate" as const,
    id: nextId(),
    agent,
    task,
    status: "running",
    ts: Date.now(),
  });
}

function findTrailingToolGroupIndex(items: ConversationItem[]): number {
  const pendingAssistantIdx = findPendingAssistantIndex(items);
  for (
    let i = pendingAssistantIdx >= 0
      ? pendingAssistantIdx - 1
      : items.length - 1;
    i >= 0;
    i--
  ) {
    const item = items[i];
    if (item?.type === "thinking") continue;
    return item?.type === "tool_group" ? i : -1;
  }
  return -1;
}

function completeDelegateItem(
  items: ConversationItem[],
  event: Extract<AgentUIEvent, { type: "delegate_end" }>,
): ConversationItem[] {
  const idx = findMatchingRunningDelegateIndex(
    items,
    event.agent,
    event.task,
  );
  if (idx < 0) return items;
  const current = items[idx];
  if (current?.type !== "delegate") return items;
  const next = [...items];
  const updated: DelegateItem = {
    ...current,
    status: event.success ? "success" : "error",
    summary: event.summary,
    error: event.error,
    durationMs: event.durationMs,
    snapshot: event.snapshot,
  };
  next[idx] = updated;
  return next;
}

function upsertAssistantTextItem(
  items: ConversationItem[],
  text: string,
  isPending: boolean,
  citations: AssistantCitation[] | undefined,
  nextId: () => string,
): ConversationItem[] {
  const cleanedItems = removeTransientInfoItems(items);
  let pendingIdx = -1;
  for (let i = cleanedItems.length - 1; i >= 0; i--) {
    const item = cleanedItems[i];
    if (item.type === "assistant") {
      if (item.isPending && pendingIdx < 0) pendingIdx = i;
      if (pendingIdx >= 0) break;
    }
  }

  if (pendingIdx >= 0) {
    const target = cleanedItems[pendingIdx] as AssistantItem;
    const next = [...cleanedItems];
    next[pendingIdx] = { ...target, text, isPending, citations };
    return next;
  }

  const assistant: AssistantItem = {
    type: "assistant",
    id: nextId(),
    text,
    citations,
    isPending,
    ts: Date.now(),
  };
  const trailingTurnStatsIdx = !isPending && cleanedItems.length > 0 &&
      cleanedItems[cleanedItems.length - 1]?.type === "turn_stats"
    ? cleanedItems.length - 1
    : -1;
  if (trailingTurnStatsIdx >= 0) {
    const next = [...cleanedItems];
    next.splice(trailingTurnStatsIdx, 0, assistant);
    return next;
  }
  return [...cleanedItems, assistant];
}

// ============================================================
// Hook
// ============================================================

export interface UseConversationResult {
  /** Accumulated conversation items */
  items: ConversationItem[];
  /** Current streaming state for conversation mode */
  streamingState: StreamingState;
  /** Currently active tool metadata for status display */
  activeTool?: { name: string; toolIndex: number; toolTotal: number };
  /** Process an incoming agent event */
  addEvent: (event: AgentUIEvent) => void;
  /** Add a user message (also cleans up orphaned transient items) */
  addUserMessage: (
    text: string,
    options?: { startTurn?: boolean },
  ) => void;
  /** Add/update assistant text (streaming or final) */
  addAssistantText: (
    text: string,
    isPending: boolean,
    citations?: AssistantCitation[],
  ) => void;
  /** Add an error message */
  addError: (text: string) => void;
  /** Add an info message */
  addInfo: (text: string, options?: { isTransient?: boolean }) => void;
  /** Replace the entire conversation with persisted items */
  replaceItems: (items: ConversationItem[]) => void;
  /** Reset stream state to idle */
  resetStatus: () => void;
  /** Finalize conversation: clean up transient items (thinking) and reset status */
  finalize: () => void;
  /** Clear all items */
  clear: () => void;
}

export function useConversation(): UseConversationResult {
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [streamingState, setStreamingState] = useState<StreamingState>(
    ConversationStreamingState.Idle,
  );
  const [activeTool, setActiveTool] = useState<
    { name: string; toolIndex: number; toolTotal: number } | undefined
  >(undefined);
  // Counter for generating unique IDs (items + tools)
  const idCounter = useRef(0);
  const nextId = () => `ci-${++idCounter.current}`;

  const addEvent = useCallback((event: AgentUIEvent) => {
    switch (event.type) {
      case "thinking":
        setStreamingState(ConversationStreamingState.Responding);
        setActiveTool(undefined);
        setItems((prev: ConversationItem[]) =>
          upsertThinkingItem(
            removeTransientInfoItems(prev),
            event.iteration,
            "",
            nextId,
          )
        );
        break;

      case "thinking_update":
        setStreamingState(ConversationStreamingState.Responding);
        setActiveTool(undefined);
        setItems((prev: ConversationItem[]) =>
          upsertThinkingItem(
            removeTransientInfoItems(prev),
            event.iteration,
            event.summary,
            nextId,
          )
        );
        break;

      case "tool_start": {
        if (event.name === "delegate_agent") {
          break;
        }
        setStreamingState(ConversationStreamingState.Responding);
        setActiveTool({
          name: event.name,
          toolIndex: event.toolIndex,
          toolTotal: event.toolTotal,
        });
        const toolId = nextId();
        const tool: ToolCallDisplay = {
          id: toolId,
          name: event.name,
          argsSummary: event.argsSummary,
          status: "running",
          toolIndex: event.toolIndex,
          toolTotal: event.toolTotal,
        };
        setItems((prev: ConversationItem[]) => {
          const cleaned = removeTransientInfoItems(prev);
          const trailingToolGroupIdx = findTrailingToolGroupIndex(cleaned);
          const trailingToolGroup = trailingToolGroupIdx >= 0
            ? cleaned[trailingToolGroupIdx]
            : undefined;

          if (trailingToolGroup?.type === "tool_group") {
            const next = [...cleaned];
            const group = {
              ...trailingToolGroup,
              tools: [...trailingToolGroup.tools, tool],
            };
            next[trailingToolGroupIdx] = group;
            return next;
          }
          // New tool group
          const group: ToolGroupItem = {
            type: "tool_group",
            id: nextId(),
            tools: [tool],
            ts: Date.now(),
          };
          return insertBeforePendingAssistant(cleaned, group);
        });
        break;
      }

      case "tool_end":
        if (event.name === "delegate_agent") {
          break;
        }
        setItems((prev: ConversationItem[]) => {
          const groupIdx = prev.findLastIndex((item: ConversationItem) =>
            item.type === "tool_group" &&
            findMatchingRunningToolIndex(
                item.tools,
                event.name,
                event.argsSummary,
              ) >= 0
          );
          if (groupIdx < 0) return prev;

          const groupItem = prev[groupIdx];
          if (groupItem.type !== "tool_group") return prev;
          const resolvedIdx = findMatchingRunningToolIndex(
            groupItem.tools,
            event.name,
            event.argsSummary,
          );
          if (resolvedIdx < 0) return prev;

          const next = [...prev];
          const updatedTools = [...groupItem.tools];
          updatedTools[resolvedIdx] = {
            ...updatedTools[resolvedIdx],
            status: event.success ? "success" : "error",
            resultSummaryText: event.summary ?? event.content,
            resultText: event.content,
            resultMeta: event.meta,
            durationMs: event.durationMs,
          };
          next[groupIdx] = { ...groupItem, tools: updatedTools };

          // If all tools are done, the model typically continues summarizing.
          const allDone = updatedTools.every(
            (tool: ToolCallDisplay) =>
              tool.status === "success" || tool.status === "error",
          );
          if (allDone) {
            setStreamingState(ConversationStreamingState.Responding);
            setActiveTool(undefined);
          }
          return next;
        });
        break;

      case "delegate_start":
        setStreamingState(ConversationStreamingState.Responding);
        setActiveTool(undefined);
        setItems((prev: ConversationItem[]) =>
          appendDelegateItem(
            removeTransientInfoItems(prev),
            event.agent,
            event.task,
            nextId,
          )
        );
        break;

      case "delegate_end":
        setStreamingState(ConversationStreamingState.Responding);
        setActiveTool(undefined);
        setItems((prev: ConversationItem[]) =>
          completeDelegateItem(prev, event)
        );
        break;

      case "turn_stats":
        setStreamingState(ConversationStreamingState.Idle);
        setActiveTool(undefined);
        setItems((prev: ConversationItem[]) => {
          // Clean up transient items (thinking indicators, pending assistants)
          const cleaned = cleanupTransientItems(prev);
          return [
            ...cleaned,
            {
              type: "turn_stats" as const,
              id: nextId(),
              toolCount: event.toolCount,
              durationMs: event.durationMs,
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
            },
          ];
        });
        break;

      case "interaction_request":
        setStreamingState(ConversationStreamingState.WaitingForConfirmation);
        // Interaction requests are handled separately by the ConversationPanel
        break;
    }
  }, []);

  const addUserMessage = useCallback((
    text: string,
    options?: { startTurn?: boolean },
  ) => {
    const startTurn = options?.startTurn !== false;
    setItems((prev: ConversationItem[]) => {
      const baseItems = startTurn ? cleanupTransientItems(prev) : prev;
      const userItem: ConversationItem = {
        type: "user" as const,
        id: nextId(),
        text,
        ts: Date.now(),
      };

      if (!startTurn) {
        return insertBeforePendingAssistant(baseItems, userItem);
      }

      const pendingAssistant: AssistantItem = {
        type: "assistant",
        id: nextId(),
        text: "",
        citations: undefined,
        isPending: true,
        ts: Date.now(),
      };

      return [...baseItems, userItem, pendingAssistant];
    });
  }, []);

  const addAssistantText = useCallback((
    text: string,
    isPending: boolean,
    citations?: AssistantCitation[],
  ) => {
    setItems((prev: ConversationItem[]) =>
      upsertAssistantTextItem(prev, text, isPending, citations, nextId)
    );
  }, []);

  const addError = useCallback((text: string) => {
    setItems((
      prev: ConversationItem[],
    ) => [...prev, { type: "error" as const, id: nextId(), text }]);
  }, []);

  const addInfo = useCallback((
    text: string,
    options?: { isTransient?: boolean },
  ) => {
    setItems((prev: ConversationItem[]) => {
      if (options?.isTransient) {
        const infoItem: InfoItem = {
          type: "info",
          id: nextId(),
          text,
          isTransient: true,
        };
        return insertBeforePendingAssistant(
          removeTransientInfoItems(prev),
          infoItem,
        );
      }
      return [...prev, { type: "info" as const, id: nextId(), text }];
    });
  }, []);

  const replaceItems = useCallback((nextItems: ConversationItem[]) => {
    setItems(nextItems);
    setStreamingState(ConversationStreamingState.Idle);
    setActiveTool(undefined);
    idCounter.current = nextItems.length;
  }, []);

  const resetStatus = useCallback(() => {
    setStreamingState(ConversationStreamingState.Idle);
    setActiveTool(undefined);
  }, []);

  const finalize = useCallback(() => {
    setStreamingState(ConversationStreamingState.Idle);
    setActiveTool(undefined);
    setItems((prev: ConversationItem[]) => cleanupTransientItems(prev));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setStreamingState(ConversationStreamingState.Idle);
    setActiveTool(undefined);
    idCounter.current = 0;
  }, []);

  return {
    items,
    streamingState,
    activeTool,
    addEvent,
    addUserMessage,
    addAssistantText,
    addError,
    addInfo,
    replaceItems,
    resetStatus,
    finalize,
    clear,
  };
}

export const __testOnlyUpsertAssistantTextItem = upsertAssistantTextItem;
export const __testOnlyAppendDelegateItem = appendDelegateItem;
export const __testOnlyCompleteDelegateItem = completeDelegateItem;
export const __testOnlyCleanupTransientItems = cleanupTransientItems;
