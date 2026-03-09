import type { AgentUIEvent } from "../agent/orchestrator.ts";
import type { Plan } from "../agent/planning.ts";
import type { AgentCheckpointSummary } from "../agent/checkpoints.ts";
import {
  cloneTodoState,
  createTodoStateFromPlan,
  summarizeTodoState,
  type TodoState,
} from "../agent/todo-state.ts";
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
} from "./repl-ink/types.ts";
import { StreamingState as ConversationStreamingState } from "./repl-ink/types.ts";

export interface TranscriptState {
  items: ConversationItem[];
  streamingState: StreamingState;
  activeTool?: { name: string; toolIndex: number; toolTotal: number };
  nextId: number;
  activePlan?: Plan;
  completedPlanStepIds: string[];
  todoState?: TodoState;
  planTodoState?: TodoState;
  pendingPlanReview?: { plan: Plan };
  latestCheckpoint?: AgentCheckpointSummary;
}

export type TranscriptInput =
  | { type: "agent_event"; event: AgentUIEvent }
  | { type: "user_message"; text: string; startTurn?: boolean }
  | {
    type: "assistant_text";
    text: string;
    isPending: boolean;
    citations?: AssistantCitation[];
  }
  | { type: "error"; text: string }
  | { type: "info"; text: string; isTransient?: boolean }
  | { type: "replace_items"; items: ConversationItem[] }
  | { type: "reset_status" }
  | { type: "finalize" }
  | { type: "clear" };

export function createTranscriptState(): TranscriptState {
  return {
    items: [],
    streamingState: ConversationStreamingState.Idle,
    nextId: 0,
    completedPlanStepIds: [],
  };
}

export function getVisibleTodoState(state: TranscriptState): TodoState | undefined {
  return state.todoState ?? state.planTodoState;
}

export function getVisibleTodoSummary(state: TranscriptState): string | undefined {
  const visible = getVisibleTodoState(state);
  return visible ? summarizeTodoState(visible) : undefined;
}

function nextItemId(state: TranscriptState): [TranscriptState, string] {
  const nextId = state.nextId + 1;
  return [{ ...state, nextId }, `ci-${nextId}`];
}

function findPendingAssistantIndex(items: ConversationItem[]): number {
  return items.findLastIndex((item) =>
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

function removeTransientInfoItems(items: ConversationItem[]): ConversationItem[] {
  return items.filter((item) =>
    item.type !== "info" || item.isTransient !== true
  );
}

function cleanupTransientItems(items: ConversationItem[]): ConversationItem[] {
  return removeTransientInfoItems(items).flatMap((item) => {
    if (item.type === "thinking") return [];
    if (item.type === "assistant" && item.isPending) {
      return item.text.trim().length > 0 ? [{ ...item, isPending: false }] : [];
    }
    return [item];
  });
}

function appendInfoItem(
  state: TranscriptState,
  text: string,
): TranscriptState {
  const [nextState, id] = nextItemId(state);
  const item: InfoItem = {
    type: "info",
    id,
    text,
  };
  return {
    ...nextState,
    items: insertBeforePendingAssistant(nextState.items, item),
  };
}

function upsertThinkingItem(
  state: TranscriptState,
  iteration: number,
  summary: string,
): TranscriptState {
  const idx = state.items.findIndex((item) =>
    item.type === "thinking" && item.iteration === iteration
  );
  if (idx < 0) {
    const [nextState, id] = nextItemId(state);
    const thinking: ThinkingItem = {
      type: "thinking",
      id,
      summary,
      iteration,
    };
    return {
      ...nextState,
      items: insertBeforePendingAssistant(nextState.items, thinking),
    };
  }
  const nextItems = [...state.items];
  const current = nextItems[idx];
  if (current?.type !== "thinking") return state;
  nextItems[idx] = { ...current, summary };
  return { ...state, items: nextItems };
}

function findMatchingRunningToolIndex(
  tools: ToolCallDisplay[],
  name: string,
  argsSummary: string,
): number {
  const exactIdx = tools.findIndex((tool) =>
    tool.status === "running" &&
    tool.name === name &&
    tool.argsSummary === argsSummary
  );
  if (exactIdx >= 0) return exactIdx;
  return tools.findIndex((tool) =>
    tool.name === name && tool.status === "running"
  );
}

function findMatchingRunningDelegateIndex(
  items: ConversationItem[],
  agent: string,
  task: string,
  threadId?: string,
): number {
  // Match by threadId first (most precise for concurrent delegates)
  if (threadId) {
    const byThread = items.findLastIndex((item) =>
      item.type === "delegate" &&
      (item.status === "running" || item.status === "queued") &&
      item.threadId === threadId
    );
    if (byThread >= 0) return byThread;
  }
  const exactIdx = items.findLastIndex((item) =>
    item.type === "delegate" &&
    (item.status === "running" || item.status === "queued") &&
    item.agent === agent &&
    item.task === task
  );
  if (exactIdx >= 0) return exactIdx;
  return items.findLastIndex((item) =>
    item.type === "delegate" &&
    (item.status === "running" || item.status === "queued") &&
    item.agent === agent
  );
}

function appendDelegateItem(
  state: TranscriptState,
  agent: string,
  task: string,
  childSessionId?: string,
  threadId?: string,
  nickname?: string,
): TranscriptState {
  const [nextState, id] = nextItemId(state);
  const item: DelegateItem = {
    type: "delegate",
    id,
    agent,
    task,
    childSessionId,
    status: "running",
    threadId,
    nickname,
    ts: Date.now(),
  };
  return {
    ...nextState,
    items: insertBeforePendingAssistant(nextState.items, item),
  };
}

function completeDelegateItem(
  state: TranscriptState,
  event: Extract<AgentUIEvent, { type: "delegate_end" }>,
): TranscriptState {
  const idx = findMatchingRunningDelegateIndex(
    state.items,
    event.agent,
    event.task,
    event.threadId,
  );
  if (idx < 0) return state;
  const current = state.items[idx];
  if (current?.type !== "delegate") return state;
  const nextItems = [...state.items];
  // Determine final status: cancelled if error contains "abort" signal
  const isCancelled = !event.success &&
    event.error?.toLowerCase().includes("abort");
  nextItems[idx] = {
    ...current,
    status: isCancelled ? "cancelled" : event.success ? "success" : "error",
    summary: event.summary,
    error: event.error,
    durationMs: event.durationMs,
    snapshot: event.snapshot,
    childSessionId: event.childSessionId ?? current.childSessionId,
  };
  return { ...state, items: nextItems };
}

function findTrailingToolGroupIndex(items: ConversationItem[]): number {
  const pendingAssistantIdx = findPendingAssistantIndex(items);
  for (
    let i = pendingAssistantIdx >= 0 ? pendingAssistantIdx - 1 : items.length - 1;
    i >= 0;
    i--
  ) {
    const item = items[i];
    if (item?.type === "thinking") continue;
    return item?.type === "tool_group" ? i : -1;
  }
  return -1;
}

function upsertAssistantTextItem(
  state: TranscriptState,
  text: string,
  isPending: boolean,
  citations?: AssistantCitation[],
): TranscriptState {
  const cleanedItems = removeTransientInfoItems(state.items);
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
    const nextItems = [...cleanedItems];
    nextItems[pendingIdx] = { ...target, text, isPending, citations };
    return { ...state, items: nextItems };
  }

  const [nextState, id] = nextItemId({
    ...state,
    items: cleanedItems,
  });
  const assistant: AssistantItem = {
    type: "assistant",
    id,
    text,
    citations,
    isPending,
    ts: Date.now(),
  };
  const trailingTurnStatsIdx = !isPending &&
      cleanedItems.length > 0 &&
      cleanedItems[cleanedItems.length - 1]?.type === "turn_stats"
    ? cleanedItems.length - 1
    : -1;
  if (trailingTurnStatsIdx >= 0) {
    const nextItems = [...cleanedItems];
    nextItems.splice(trailingTurnStatsIdx, 0, assistant);
    return { ...nextState, items: nextItems };
  }
  return { ...nextState, items: [...cleanedItems, assistant] };
}

function derivePlanTodoState(
  plan: Plan | undefined,
  completedPlanStepIds: string[],
): TodoState | undefined {
  if (!plan) return undefined;
  const currentIndex = completedPlanStepIds.length < plan.steps.length
    ? completedPlanStepIds.length
    : undefined;
  return createTodoStateFromPlan(
    plan.steps,
    completedPlanStepIds,
    currentIndex,
  );
}

export function reduceTranscriptState(
  state: TranscriptState,
  input: TranscriptInput,
): TranscriptState {
  switch (input.type) {
    case "agent_event": {
      const event = input.event;
      switch (event.type) {
        case "thinking":
          return {
            ...upsertThinkingItem(
              {
                ...state,
                streamingState: ConversationStreamingState.Responding,
                activeTool: undefined,
                items: removeTransientInfoItems(state.items),
              },
              event.iteration,
              "",
            ),
          };
        case "thinking_update":
          return {
            ...upsertThinkingItem(
              {
                ...state,
                streamingState: ConversationStreamingState.Responding,
                activeTool: undefined,
                items: removeTransientInfoItems(state.items),
              },
              event.iteration,
              event.summary,
            ),
          };
        case "tool_start": {
          if (event.name === "delegate_agent") return state;
          const tool: ToolCallDisplay = {
            id: `ci-${state.nextId + 1}`,
            name: event.name,
            argsSummary: event.argsSummary,
            status: "running",
            toolIndex: event.toolIndex,
            toolTotal: event.toolTotal,
          };
          let nextState: TranscriptState = {
            ...state,
            streamingState: ConversationStreamingState.Responding,
            activeTool: {
              name: event.name,
              toolIndex: event.toolIndex,
              toolTotal: event.toolTotal,
            },
            items: removeTransientInfoItems(state.items),
          };
          const [stateWithToolId, toolId] = nextItemId(nextState);
          const nextTool = { ...tool, id: toolId };
          nextState = stateWithToolId;

          const trailingToolGroupIdx = findTrailingToolGroupIndex(nextState.items);
          const trailingToolGroup = trailingToolGroupIdx >= 0
            ? nextState.items[trailingToolGroupIdx]
            : undefined;

          if (trailingToolGroup?.type === "tool_group") {
            const nextItems = [...nextState.items];
            nextItems[trailingToolGroupIdx] = {
              ...trailingToolGroup,
              tools: [...trailingToolGroup.tools, nextTool],
            };
            return { ...nextState, items: nextItems };
          }

          const [stateWithGroupId, groupId] = nextItemId(nextState);
          const group: ToolGroupItem = {
            type: "tool_group",
            id: groupId,
            tools: [nextTool],
            ts: Date.now(),
          };
          return {
            ...stateWithGroupId,
            items: insertBeforePendingAssistant(stateWithGroupId.items, group),
          };
        }
        case "tool_end": {
          if (event.name === "delegate_agent") return state;
          const groupIdx = state.items.findLastIndex((item) =>
            item.type === "tool_group" &&
            findMatchingRunningToolIndex(
                item.tools,
                event.name,
                event.argsSummary,
              ) >= 0
          );
          if (groupIdx < 0) return state;
          const groupItem = state.items[groupIdx];
          if (groupItem.type !== "tool_group") return state;
          const resolvedIdx = findMatchingRunningToolIndex(
            groupItem.tools,
            event.name,
            event.argsSummary,
          );
          if (resolvedIdx < 0) return state;

          const nextTools = [...groupItem.tools];
          nextTools[resolvedIdx] = {
            ...nextTools[resolvedIdx],
            status: event.success ? "success" : "error",
            resultSummaryText: event.summary ?? event.content,
            resultText: event.content,
            resultMeta: event.meta,
            durationMs: event.durationMs,
          };
          const nextItems = [...state.items];
          nextItems[groupIdx] = { ...groupItem, tools: nextTools };
          const allDone = nextTools.every((tool) =>
            tool.status === "success" || tool.status === "error"
          );
          return {
            ...state,
            items: nextItems,
            streamingState: allDone
              ? ConversationStreamingState.Responding
              : state.streamingState,
            activeTool: allDone ? undefined : state.activeTool,
          };
        }
        case "delegate_running":
          return state; // TaskManager handles state transition; transcript unchanged
        case "delegate_start":
          return appendDelegateItem(
            {
              ...state,
              streamingState: ConversationStreamingState.Responding,
              activeTool: undefined,
              items: removeTransientInfoItems(state.items),
            },
            event.agent,
            event.task,
            event.childSessionId,
            event.threadId,
            event.nickname,
          );
        case "delegate_end":
          return {
            ...completeDelegateItem(
              {
                ...state,
                streamingState: ConversationStreamingState.Responding,
                activeTool: undefined,
              },
              event,
            ),
          };
        case "todo_updated":
          return {
            ...state,
            todoState: cloneTodoState(event.todoState),
          };
        case "team_task_updated":
          return appendInfoItem(
            {
              ...state,
              items: removeTransientInfoItems(state.items),
            },
            event.assigneeMemberId
              ? `Team task ${event.status}: ${event.goal} (${event.assigneeMemberId})`
              : `Team task ${event.status}: ${event.goal}`,
          );
        case "team_message":
          return appendInfoItem(
            {
              ...state,
              items: removeTransientInfoItems(state.items),
            },
            event.toMemberId
              ? `Team ${event.kind}: ${event.fromMemberId} -> ${event.toMemberId}: ${event.contentPreview}`
              : `Team ${event.kind}: ${event.fromMemberId}: ${event.contentPreview}`,
          );
        case "team_plan_review_required":
          return appendInfoItem(
            {
              ...state,
              items: removeTransientInfoItems(state.items),
            },
            `Team plan review requested for task ${event.taskId}`,
          );
        case "team_plan_review_resolved":
          return appendInfoItem(
            {
              ...state,
              items: removeTransientInfoItems(state.items),
            },
            `Team plan review ${event.approved ? "approved" : "rejected"} for task ${event.taskId}`,
          );
        case "team_shutdown_requested":
          return appendInfoItem(
            {
              ...state,
              items: removeTransientInfoItems(state.items),
            },
            event.reason
              ? `Shutdown requested for ${event.memberId}: ${event.reason}`
              : `Shutdown requested for ${event.memberId}`,
          );
        case "team_shutdown_resolved":
          return appendInfoItem(
            {
              ...state,
              items: removeTransientInfoItems(state.items),
            },
            `Shutdown ${event.status} for ${event.memberId}`,
          );
        case "batch_progress_updated":
          return appendInfoItem(
            {
              ...state,
              items: removeTransientInfoItems(state.items),
            },
            `Batch ${event.snapshot.batchId}: ${event.snapshot.running} running · ${event.snapshot.completed} completed · ${event.snapshot.errored} errored`,
          );
        case "plan_created":
          return {
            ...state,
            activePlan: event.plan,
            completedPlanStepIds: [],
            planTodoState: derivePlanTodoState(event.plan, []),
          };
        case "plan_step": {
          const completedPlanStepIds = state.completedPlanStepIds.includes(event.stepId)
            ? state.completedPlanStepIds
            : [...state.completedPlanStepIds, event.stepId];
          return {
            ...state,
            completedPlanStepIds,
            planTodoState: derivePlanTodoState(state.activePlan, completedPlanStepIds),
          };
        }
        case "plan_review_required":
          return {
            ...state,
            pendingPlanReview: { plan: event.plan },
            streamingState: ConversationStreamingState.WaitingForConfirmation,
          };
        case "plan_review_resolved":
          return {
            ...state,
            pendingPlanReview: undefined,
            streamingState: ConversationStreamingState.Responding,
          };
        case "checkpoint_created":
          return {
            ...state,
            latestCheckpoint: { ...event.checkpoint },
          };
        case "checkpoint_restored":
          return {
            ...state,
            latestCheckpoint: { ...event.checkpoint },
          };
        case "turn_stats": {
          const cleaned = cleanupTransientItems(state.items);
          const [nextState, id] = nextItemId({
            ...state,
            streamingState: ConversationStreamingState.Idle,
            activeTool: undefined,
            items: cleaned,
          });
          return {
            ...nextState,
            items: [
              ...cleaned,
              {
                type: "turn_stats",
                id,
                toolCount: event.toolCount,
                durationMs: event.durationMs,
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
              },
            ],
          };
        }
        case "interaction_request":
          return {
            ...state,
            streamingState: ConversationStreamingState.WaitingForConfirmation,
          };
      }
      return state;
    }
    case "user_message": {
      const startTurn = input.startTurn !== false;
      let nextState = {
        ...state,
        items: startTurn ? cleanupTransientItems(state.items) : state.items,
      };
      let id: string;
      [nextState, id] = nextItemId(nextState);
      const userItem: ConversationItem = {
        type: "user",
        id,
        text: input.text,
        ts: Date.now(),
      };

      if (!startTurn) {
        return {
          ...nextState,
          items: insertBeforePendingAssistant(nextState.items, userItem),
        };
      }

      let assistantId: string;
      [nextState, assistantId] = nextItemId({
        ...nextState,
        items: [...nextState.items, userItem],
      });
      const pendingAssistant: AssistantItem = {
        type: "assistant",
        id: assistantId,
        text: "",
        citations: undefined,
        isPending: true,
        ts: Date.now(),
      };
      return {
        ...nextState,
        items: [...nextState.items, pendingAssistant],
      };
    }
    case "assistant_text":
      return upsertAssistantTextItem(
        state,
        input.text,
        input.isPending,
        input.citations,
      );
    case "error": {
      const [nextState, id] = nextItemId(state);
      return {
        ...nextState,
        items: [...nextState.items, { type: "error", id, text: input.text }],
      };
    }
    case "info": {
      if (input.isTransient) {
        const [nextState, id] = nextItemId({
          ...state,
          items: removeTransientInfoItems(state.items),
        });
        const item: InfoItem = {
          type: "info",
          id,
          text: input.text,
          isTransient: true,
        };
        return {
          ...nextState,
          items: insertBeforePendingAssistant(nextState.items, item),
        };
      }
      const [nextState, id] = nextItemId(state);
      return {
        ...nextState,
        items: [...nextState.items, { type: "info", id, text: input.text }],
      };
    }
    case "replace_items":
      return {
        ...state,
        items: input.items,
        streamingState: ConversationStreamingState.Idle,
        activeTool: undefined,
        activePlan: undefined,
        completedPlanStepIds: [],
        todoState: undefined,
        planTodoState: undefined,
        pendingPlanReview: undefined,
        latestCheckpoint: undefined,
        nextId: input.items.length,
      };
    case "reset_status":
      return {
        ...state,
        streamingState: ConversationStreamingState.Idle,
        activeTool: undefined,
      };
    case "finalize":
      return {
        ...state,
        streamingState: ConversationStreamingState.Idle,
        activeTool: undefined,
        items: cleanupTransientItems(state.items),
      };
    case "clear":
      return createTranscriptState();
  }
}
