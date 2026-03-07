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

import { useState, useCallback, useRef } from "react";
import type { AgentUIEvent } from "../../../agent/orchestrator.ts";
import type {
  AssistantCitation,
  AssistantItem,
  ConversationItem,
  StreamingState,
  ThinkingItem,
  ToolCallDisplay,
  ToolGroupItem,
} from "../types.ts";
import { StreamingState as ConversationStreamingState } from "../types.ts";

// ============================================================
// Helpers
// ============================================================

/** Remove all thinking items and finalize any pending assistant items */
function cleanupTransientItems(items: ConversationItem[]): ConversationItem[] {
  return items.flatMap((item: ConversationItem) => {
    if (item.type === "thinking") return [];
    if (item.type === "assistant" && item.isPending) {
      return [{ ...item, isPending: false }];
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
    (item: ConversationItem) => item.type === "thinking" && item.iteration === iteration,
  );
  if (idx < 0) {
    const thinking: ThinkingItem = {
      type: "thinking",
      id: nextId(),
      summary,
      iteration,
    };
    return [...items, thinking];
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

function upsertAssistantTextItem(
  items: ConversationItem[],
  text: string,
  isPending: boolean,
  citations: AssistantCitation[] | undefined,
  nextId: () => string,
): ConversationItem[] {
  let pendingIdx = -1;
  let lastAssistantIdx = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type === "assistant") {
      if (item.isPending && pendingIdx < 0) pendingIdx = i;
      if (lastAssistantIdx < 0) lastAssistantIdx = i;
      if (pendingIdx >= 0 && lastAssistantIdx >= 0) break;
    }
  }

  const targetIdx = pendingIdx >= 0 ? pendingIdx : lastAssistantIdx;
  if (targetIdx >= 0) {
    const target = items[targetIdx] as AssistantItem;
    const next = [...items];
    next[targetIdx] = { ...target, text, isPending, citations };
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
  const trailingTurnStatsIdx = !isPending && items.length > 0 && items[items.length - 1]?.type === "turn_stats"
    ? items.length - 1
    : -1;
  if (trailingTurnStatsIdx >= 0) {
    const next = [...items];
    next.splice(trailingTurnStatsIdx, 0, assistant);
    return next;
  }
  return [...items, assistant];
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
  addUserMessage: (text: string) => void;
  /** Add/update assistant text (streaming or final) */
  addAssistantText: (text: string, isPending: boolean, citations?: AssistantCitation[]) => void;
  /** Add an error message */
  addError: (text: string) => void;
  /** Add an info message */
  addInfo: (text: string) => void;
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
          upsertThinkingItem(prev, event.iteration, "", nextId)
        );
        break;

      case "thinking_update":
        setStreamingState(ConversationStreamingState.Responding);
        setActiveTool(undefined);
        setItems((prev: ConversationItem[]) =>
          upsertThinkingItem(prev, event.iteration, event.summary, nextId)
        );
        break;

      case "tool_start": {
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
          const lastNonThinkingIdx = prev.findLastIndex(
            (item: ConversationItem) => item.type !== "thinking",
          );
          const lastNonThinking = lastNonThinkingIdx >= 0
            ? prev[lastNonThinkingIdx]
            : undefined;

          if (lastNonThinking?.type === "tool_group") {
            const next = [...prev];
            const group = { ...lastNonThinking, tools: [...lastNonThinking.tools, tool] };
            next[lastNonThinkingIdx] = group;
            return next;
          }
          // New tool group
          const group: ToolGroupItem = {
            type: "tool_group",
            id: nextId(),
            tools: [tool],
            ts: Date.now(),
          };
          return [...prev, group];
        });
        break;
      }

      case "tool_end":
        setItems((prev: ConversationItem[]) => {
          const groupIdx = prev.findLastIndex((item: ConversationItem) =>
            item.type === "tool_group" &&
            findMatchingRunningToolIndex(item.tools, event.name, event.argsSummary) >= 0
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
            (tool: ToolCallDisplay) => tool.status === "success" || tool.status === "error",
          );
          if (allDone) {
            setStreamingState(ConversationStreamingState.Responding);
            setActiveTool(undefined);
          }
          return next;
        });
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

  const addUserMessage = useCallback((text: string) => {
    setItems((prev: ConversationItem[]) => {
      // Clean up orphaned transient items from any incomplete previous turn
      const cleaned = cleanupTransientItems(prev);
      return [...cleaned, { type: "user" as const, id: nextId(), text, ts: Date.now() }];
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
    setItems((prev: ConversationItem[]) => [...prev, { type: "error" as const, id: nextId(), text }]);
  }, []);

  const addInfo = useCallback((text: string) => {
    setItems((prev: ConversationItem[]) => [...prev, { type: "info" as const, id: nextId(), text }]);
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
    resetStatus,
    finalize,
    clear,
  };
}

export const __testOnlyUpsertAssistantTextItem = upsertAssistantTextItem;
