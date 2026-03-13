/**
 * useConversation — React wrapper over the shared agent transcript reducer.
 */

import type { Dispatch, SetStateAction } from "react";
import { useCallback, useState } from "react";
import type { AgentUIEvent } from "../../../agent/orchestrator.ts";
import {
  createTranscriptState,
  reduceTranscriptState,
  type TranscriptState,
} from "../../agent-transcript-state.ts";
import type {
  AssistantCitation,
  ConversationItem,
  StreamingState,
} from "../types.ts";

export interface UseConversationResult {
  items: ConversationItem[];
  streamingState: StreamingState;
  activeTool?: { name: string; toolIndex: number; toolTotal: number };
  activePlan?: TranscriptState["activePlan"];
  todoState?: TranscriptState["todoState"];
  planTodoState?: TranscriptState["planTodoState"];
  pendingPlanReview?: TranscriptState["pendingPlanReview"];
  latestCheckpoint?: TranscriptState["latestCheckpoint"];
  hydrateState: (state: TranscriptState) => void;
  addEvent: (event: AgentUIEvent) => void;
  addUserMessage: (
    text: string,
    options?: { attachments?: string[]; startTurn?: boolean },
  ) => void;
  addAssistantText: (
    text: string,
    isPending: boolean,
    citations?: AssistantCitation[],
  ) => void;
  addError: (text: string) => void;
  addInfo: (text: string, options?: { isTransient?: boolean }) => void;
  replaceItems: (items: ConversationItem[]) => void;
  resetStatus: () => void;
  finalize: () => void;
  clear: () => void;
}

function updateState(
  setState: Dispatch<SetStateAction<TranscriptState>>,
  input: Parameters<typeof reduceTranscriptState>[1],
): void {
  setState((prev: TranscriptState) => reduceTranscriptState(prev, input));
}

export function useConversation(): UseConversationResult {
  const [state, setState] = useState<TranscriptState>(() =>
    createTranscriptState()
  );

  const hydrateState = useCallback((nextState: TranscriptState) => {
    setState(nextState);
  }, []);

  const addEvent = useCallback((event: AgentUIEvent) => {
    updateState(setState, { type: "agent_event", event });
  }, []);

  const addUserMessage = useCallback((
    text: string,
    options?: { attachments?: string[]; startTurn?: boolean },
  ) => {
    updateState(setState, {
      type: "user_message",
      text,
      attachments: options?.attachments,
      startTurn: options?.startTurn,
    });
  }, []);

  const addAssistantText = useCallback((
    text: string,
    isPending: boolean,
    citations?: AssistantCitation[],
  ) => {
    updateState(setState, {
      type: "assistant_text",
      text,
      isPending,
      citations,
    });
  }, []);

  const addError = useCallback((text: string) => {
    updateState(setState, { type: "error", text });
  }, []);

  const addInfo = useCallback((
    text: string,
    options?: { isTransient?: boolean },
  ) => {
    updateState(setState, {
      type: "info",
      text,
      isTransient: options?.isTransient,
    });
  }, []);

  const replaceItems = useCallback((items: ConversationItem[]) => {
    updateState(setState, { type: "replace_items", items });
  }, []);

  const resetStatus = useCallback(() => {
    updateState(setState, { type: "reset_status" });
  }, []);

  const finalize = useCallback(() => {
    updateState(setState, { type: "finalize" });
  }, []);

  const clear = useCallback(() => {
    updateState(setState, { type: "clear" });
  }, []);

  return {
    items: state.items,
    streamingState: state.streamingState,
    activeTool: state.activeTool,
    activePlan: state.activePlan,
    todoState: state.todoState,
    planTodoState: state.planTodoState,
    pendingPlanReview: state.pendingPlanReview,
    latestCheckpoint: state.latestCheckpoint,
    hydrateState,
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
