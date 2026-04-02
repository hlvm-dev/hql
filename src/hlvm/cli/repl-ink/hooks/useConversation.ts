/**
 * useConversation — React wrapper over the shared agent transcript reducer.
 */

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AgentUIEvent } from "../../../agent/orchestrator.ts";
import {
  createTranscriptState,
  reduceTranscriptState,
  type TranscriptState,
} from "../../agent-transcript-state.ts";
import type {
  AssistantCitation,
  ConversationAttachmentRef,
  ConversationItem,
  EvalResult,
  ShellHistoryEntry,
  StreamingState,
  TurnCompletionStatus,
} from "../types.ts";

export interface UseConversationResult {
  items: ConversationItem[];
  activeTurnId?: string;
  historyItems: ShellHistoryEntry[];
  liveItems: Exclude<ConversationItem, { type: "hql_eval" }>[];
  streamingState: StreamingState;
  activeTool?: {
    name: string;
    displayName: string;
    progressText?: string;
    progressTone?: "running" | "success" | "warning";
    toolIndex: number;
    toolTotal: number;
  };
  activePlan?: TranscriptState["activePlan"];
  planningPhase?: TranscriptState["planningPhase"];
  todoState?: TranscriptState["todoState"];
  planTodoState?: TranscriptState["planTodoState"];
  pendingPlanReview?: TranscriptState["pendingPlanReview"];
  hydrateState: (state: TranscriptState) => void;
  addEvent: (event: AgentUIEvent) => void;
  addUserMessage: (
    text: string,
    options?: {
      submittedText?: string;
      attachments?: ConversationAttachmentRef[];
      startTurn?: boolean;
    },
  ) => string | undefined;
  addAssistantText: (
    text: string,
    isPending: boolean,
    citations?: AssistantCitation[],
    options?: { turnId?: string },
  ) => void;
  addHqlEval: (input: string, result: EvalResult) => void;
  addError: (text: string, options?: { turnId?: string }) => void;
  addInfo: (
    text: string,
    options?: { isTransient?: boolean; turnId?: string },
  ) => void;
  replaceItems: (items: ConversationItem[]) => void;
  resetStatus: () => void;
  cancelPlanning: () => void;
  finalize: (
    status: TurnCompletionStatus,
    options?: { turnId?: string },
  ) => void;
  clear: () => void;
}

function updateState(
  stateRef: MutableRefObject<TranscriptState>,
  setState: Dispatch<SetStateAction<TranscriptState>>,
  input: Parameters<typeof reduceTranscriptState>[1],
): TranscriptState {
  const nextState = reduceTranscriptState(stateRef.current, input);
  stateRef.current = nextState;
  setState(nextState);
  return nextState;
}

export function useConversation(): UseConversationResult {
  const initialStateRef = useRef<TranscriptState>(createTranscriptState());
  const [state, setState] = useState<TranscriptState>(() => initialStateRef.current);
  const stateRef = useRef<TranscriptState>(state);
  stateRef.current = state;
  const [activeTurnId, setActiveTurnId] = useState<string | undefined>(
    state.currentTurnId,
  );

  const hydrateState = useCallback((nextState: TranscriptState) => {
    stateRef.current = nextState;
    setState(nextState);
    setActiveTurnId(nextState.currentTurnId);
  }, []);

  const addEvent = useCallback((event: AgentUIEvent) => {
    updateState(stateRef, setState, { type: "agent_event", event });
  }, []);

  const addUserMessage = useCallback((
    text: string,
    options?: {
      submittedText?: string;
      attachments?: ConversationAttachmentRef[];
      startTurn?: boolean;
    },
  ) => {
    const nextState = updateState(stateRef, setState, {
      type: "user_message",
      text,
      submittedText: options?.submittedText,
      attachments: options?.attachments,
      startTurn: options?.startTurn,
    });
    const turnId = nextState.currentTurnId;
    if (options?.startTurn !== false) {
      setActiveTurnId(turnId);
    }
    return turnId;
  }, []);

  const addAssistantText = useCallback((
    text: string,
    isPending: boolean,
    citations?: AssistantCitation[],
    options?: { turnId?: string },
  ) => {
    updateState(stateRef, setState, {
      type: "assistant_text",
      text,
      isPending,
      citations,
      turnId: options?.turnId,
    });
  }, []);

  const addHqlEval = useCallback((input: string, result: EvalResult) => {
    updateState(stateRef, setState, { type: "hql_eval", input, result });
  }, []);

  const addError = useCallback((text: string, options?: { turnId?: string }) => {
    updateState(stateRef, setState, {
      type: "error",
      text,
      turnId: options?.turnId,
    });
  }, []);

  const addInfo = useCallback((
    text: string,
    options?: { isTransient?: boolean; turnId?: string },
  ) => {
    updateState(stateRef, setState, {
      type: "info",
      text,
      isTransient: options?.isTransient,
      turnId: options?.turnId,
    });
  }, []);

  const replaceItems = useCallback((items: ConversationItem[]) => {
    const nextState = updateState(stateRef, setState, {
      type: "replace_items",
      items,
    });
    setActiveTurnId(nextState.currentTurnId);
  }, []);

  const resetStatus = useCallback(() => {
    updateState(stateRef, setState, { type: "reset_status" });
  }, []);

  const cancelPlanning = useCallback(() => {
    updateState(stateRef, setState, { type: "cancel_planning" });
  }, []);

  const finalize = useCallback((
    status: TurnCompletionStatus,
    options?: { turnId?: string },
  ) => {
    const nextState = updateState(stateRef, setState, {
      type: "finalize",
      status,
      turnId: options?.turnId,
    });
    if (!options?.turnId || options.turnId === activeTurnId) {
      setActiveTurnId(nextState.currentTurnId);
    }
  }, []);

  const clear = useCallback(() => {
    const nextState = updateState(stateRef, setState, { type: "clear" });
    setActiveTurnId(nextState.currentTurnId);
  }, []);

  // Split into stable actions (never recalculates) + reactive data (recalculates on state changes).
  // All callbacks have [] deps so actionsMemo is referentially stable across all renders.
  const actionsMemo = useMemo(() => ({
    hydrateState,
    addEvent,
    addUserMessage,
    addAssistantText,
    addHqlEval,

    addError,
    addInfo,
    replaceItems,
    resetStatus,
    cancelPlanning,
    finalize,
    clear,
  }), [
    hydrateState,
    addEvent,
    addUserMessage,
    addAssistantText,
    addHqlEval,

    addError,
    addInfo,
    replaceItems,
    resetStatus,
    cancelPlanning,
    finalize,
    clear,
  ]);

  const dataMemo = useMemo(() => ({
    items: state.items,
    activeTurnId,
    historyItems: activeTurnId
      ? state.items.filter((item: ConversationItem) =>
        item.turnId !== activeTurnId || item.type === "hql_eval"
      ) as ShellHistoryEntry[]
      : state.items as ShellHistoryEntry[],
    liveItems: activeTurnId
      ? state.items.filter((item: ConversationItem) =>
        item.turnId === activeTurnId && item.type !== "hql_eval"
      ) as Exclude<ConversationItem, { type: "hql_eval" }>[]
      : [] as Exclude<ConversationItem, { type: "hql_eval" }>[],
    streamingState: state.streamingState,
    activeTool: state.activeTool,
    activePlan: state.activePlan,
    planningPhase: state.planningPhase,
    todoState: state.todoState,
    planTodoState: state.planTodoState,
    pendingPlanReview: state.pendingPlanReview,
  }), [
    activeTurnId,
    state.items,
    state.streamingState,
    state.activeTool,
    state.activePlan,
    state.planningPhase,
    state.todoState,
    state.planTodoState,
    state.pendingPlanReview,
  ]);

  return useMemo(
    () => ({ ...dataMemo, ...actionsMemo }),
    [dataMemo, actionsMemo],
  );
}
