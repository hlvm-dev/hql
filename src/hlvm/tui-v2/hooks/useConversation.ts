/**
 * useConversation — React hook wrapping the existing transcript reducer.
 *
 * Delegates all state transitions to `reduceTranscriptState` from
 * `agent-transcript-state.ts` so the TUI v2 shares the exact same
 * conversation logic as the v1 Ink REPL.
 */

import { useCallback, useRef, useState } from "react";
import {
  createTranscriptState,
  reduceTranscriptState,
  type TranscriptInput,
  type TranscriptState,
} from "../../cli/agent-transcript-state.ts";
import type { ConversationItem, StreamingState } from "../../cli/repl-ink/types.ts";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface UseConversationResult {
  /** Rendered conversation items (user, assistant, tool groups, etc.) */
  items: ConversationItem[];
  /** Current streaming lifecycle state (idle / responding / waiting) */
  streamingState: StreamingState;
  /** Full transcript state for advanced consumers */
  transcript: TranscriptState;

  // -- Actions --------------------------------------------------------------
  /** Dispatch a raw AgentUIEvent through the reducer */
  addEvent: (event: unknown) => void;
  /** Append a user message and start a new turn */
  addUserMessage: (text: string) => void;
  /** Append or update assistant text (isPending=true while streaming) */
  addAssistantText: (text: string, isPending: boolean) => void;
  /** Append an error item */
  addError: (text: string) => void;
  /** Append an informational item (optionally transient) */
  addInfo: (text: string, isTransient?: boolean) => void;
  /** Append an HQL eval result */
  addHqlEval: (input: string, result: unknown) => void;
  /** Finalize the current turn with a completion status */
  finalize: (status: "completed" | "cancelled" | "failed") => void;
  /** Reset conversation to initial empty state */
  clear: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useConversation(): UseConversationResult {
  const [state, setState] = useState<TranscriptState>(createTranscriptState);

  // Keep a ref to the latest state so callbacks are always stable
  // (no need to re-create them when state changes).
  const stateRef = useRef(state);
  stateRef.current = state;

  const dispatch = useCallback((input: TranscriptInput) => {
    setState((prev: TranscriptState) => reduceTranscriptState(prev, input));
  }, []);

  // -- Stable action helpers ------------------------------------------------

  const addEvent = useCallback(
    // deno-lint-ignore no-explicit-any
    (event: any) => {
      dispatch({ type: "agent_event", event });
    },
    [dispatch],
  );

  const addUserMessage = useCallback(
    (text: string) => {
      dispatch({ type: "user_message", text, startTurn: true });
    },
    [dispatch],
  );

  const addAssistantText = useCallback(
    (text: string, isPending: boolean) => {
      dispatch({ type: "assistant_text", text, isPending });
    },
    [dispatch],
  );

  const addError = useCallback(
    (text: string) => {
      dispatch({ type: "error", text });
    },
    [dispatch],
  );

  const addInfo = useCallback(
    (text: string, isTransient?: boolean) => {
      dispatch({ type: "info", text, isTransient });
    },
    [dispatch],
  );

  const addHqlEval = useCallback(
    // deno-lint-ignore no-explicit-any
    (input: string, result: any) => {
      dispatch({ type: "hql_eval", input, result });
    },
    [dispatch],
  );

  const finalize = useCallback(
    (status: "completed" | "cancelled" | "failed") => {
      dispatch({ type: "finalize", status });
    },
    [dispatch],
  );

  const clear = useCallback(() => {
    dispatch({ type: "clear" });
  }, [dispatch]);

  return {
    items: state.items,
    streamingState: state.streamingState,
    transcript: state,
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
