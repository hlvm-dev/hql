/**
 * useConversation — Standalone conversation state manager for TUI v2.
 *
 * Manages a list of ConversationItem objects without importing from
 * the old TUI (repl-ink/), avoiding transitive npm:ink@5 dependency.
 *
 * When the agent communication layer is wired, AgentUIEvents will be
 * mapped to items here. For now, provides simple add/clear operations.
 */

import { useCallback, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Standalone types (no imports from old TUI)
// ---------------------------------------------------------------------------

export interface ConversationItem {
  type: string;
  id: string;
  [key: string]: unknown;
}

export type StreamingState = "idle" | "responding" | "waiting_for_confirmation";

interface ConversationState {
  items: ConversationItem[];
  streamingState: StreamingState;
  nextId: number;
}

function createState(): ConversationState {
  return { items: [], streamingState: "idle", nextId: 0 };
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface UseConversationResult {
  items: ConversationItem[];
  streamingState: StreamingState;
  addEvent: (event: unknown) => void;
  addUserMessage: (text: string) => void;
  addAssistantText: (text: string, isPending: boolean) => void;
  addError: (text: string) => void;
  addInfo: (text: string, isTransient?: boolean) => void;
  addHqlEval: (input: string, result: unknown) => void;
  finalize: (status: "completed" | "cancelled" | "failed") => void;
  clear: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useConversation(): UseConversationResult {
  const [state, setState] = useState<ConversationState>(createState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const nextId = useCallback(() => {
    const id = stateRef.current.nextId;
    return `item-${id}`;
  }, []);

  const addItem = useCallback((item: ConversationItem) => {
    setState((prev) => ({
      ...prev,
      items: [...prev.items, item],
      nextId: prev.nextId + 1,
    }));
  }, []);

  const updateLastAssistant = useCallback((text: string, isPending: boolean) => {
    setState((prev) => {
      const items = [...prev.items];
      // Find last assistant item and update it, or create new
      const lastIdx = items.findLastIndex((i) => i.type === "assistant");
      if (lastIdx >= 0 && items[lastIdx].isPending) {
        items[lastIdx] = {
          ...items[lastIdx],
          text: (items[lastIdx].text as string) + text,
          isPending,
        };
      } else {
        items.push({
          type: "assistant",
          id: `item-${prev.nextId}`,
          text,
          isPending,
          ts: Date.now(),
        });
      }
      return {
        ...prev,
        items,
        nextId: lastIdx >= 0 && items[lastIdx].isPending === false ? prev.nextId : prev.nextId + 1,
        streamingState: isPending ? "responding" : "idle",
      };
    });
  }, []);

  // -- Actions ----------------------------------------------------------------

  const addEvent = useCallback(
    // deno-lint-ignore no-explicit-any
    (event: any) => {
      // Map AgentUIEvents to items
      if (!event || !event.type) return;
      switch (event.type) {
        case "thinking":
          addItem({
            type: "thinking",
            id: nextId(),
            kind: event.kind ?? "reasoning",
            summary: event.summary ?? "",
            iteration: event.iteration ?? 0,
          });
          break;
        case "tool_start":
          addItem({
            type: "tool_group",
            id: nextId(),
            tools: [{
              id: event.tool_call_id ?? nextId(),
              name: event.tool_name ?? "unknown",
              displayName: event.display_name,
              argsSummary: event.args_summary ?? "",
              status: "running",
            }],
            ts: Date.now(),
          });
          break;
        case "tool_end": {
          setState((prev) => {
            const items = [...prev.items];
            const lastToolGroup = items.findLastIndex((i) => i.type === "tool_group");
            if (lastToolGroup >= 0) {
              const tools = [...(items[lastToolGroup].tools as Array<Record<string, unknown>>)];
              const lastTool = tools[tools.length - 1];
              if (lastTool) {
                tools[tools.length - 1] = {
                  ...lastTool,
                  status: event.error ? "error" : "success",
                  resultSummaryText: event.result_summary ?? event.error ?? "",
                };
              }
              items[lastToolGroup] = { ...items[lastToolGroup], tools };
            }
            return { ...prev, items };
          });
          break;
        }
        default:
          // Other events logged as info for now
          break;
      }
    },
    [addItem, nextId],
  );

  const addUserMessage = useCallback(
    (text: string) => {
      addItem({
        type: "user",
        id: nextId(),
        text,
        ts: Date.now(),
      });
      setState((prev) => ({ ...prev, streamingState: "responding" }));
    },
    [addItem, nextId],
  );

  const addAssistantText = useCallback(
    (text: string, isPending: boolean) => {
      updateLastAssistant(text, isPending);
    },
    [updateLastAssistant],
  );

  const addError = useCallback(
    (text: string) => {
      addItem({ type: "error", id: nextId(), text });
    },
    [addItem, nextId],
  );

  const addInfo = useCallback(
    (text: string, isTransient?: boolean) => {
      addItem({ type: "info", id: nextId(), text, isTransient: isTransient ?? false });
    },
    [addItem, nextId],
  );

  const addHqlEval = useCallback(
    (input: string, result: unknown) => {
      addItem({
        type: "hql_eval",
        id: nextId(),
        input,
        result,
        ts: Date.now(),
      });
    },
    [addItem, nextId],
  );

  const finalize = useCallback(
    (status: "completed" | "cancelled" | "failed") => {
      setState((prev) => ({ ...prev, streamingState: "idle" }));
      // Optionally add turn stats
      if (status !== "cancelled") {
        addItem({
          type: "turn_stats",
          id: nextId(),
          status,
          toolCount: 0,
          durationMs: 0,
        });
      }
    },
    [addItem, nextId],
  );

  const clear = useCallback(() => {
    setState(createState());
  }, []);

  return {
    items: state.items,
    streamingState: state.streamingState,
    addEvent,
    addUserMessage,
    addAssistantText,
    addError,
    addInfo,
    addHqlEval,
    finalize,
    clear,
  };
}
