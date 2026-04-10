import type { AgentUIEvent } from "../agent/orchestrator.ts";
import type { Plan, PlanningPhase } from "../agent/planning.ts";
import {
  cloneTodoState,
  createTodoStateFromPlan,
  summarizeTodoState,
  type TodoState,
} from "../agent/todo-state.ts";
import type { EvalResult } from "./repl/evaluator.ts";
import {
  type AssistantCitation,
  type AssistantItem,
  type ConversationAttachmentRef,
  type ConversationItem,
  type DelegateGroupEntry,
  type DelegateGroupItem,
  type DelegateItem,
  type HqlEvalItem,
  type ErrorItem,
  type InfoItem,
  type MemoryActivityDetail,
  type MemoryActivityItem,
  type StreamingState,
  StreamingState as ConversationStreamingState,
  type StructuredTeamInfoItem,
  type TeamMemberActivityInfoItem,
  type TeamMessageInfoItem,
  type TeamPlanReviewInfoItem,
  type TeamShutdownInfoItem,
  type TeamTaskInfoItem,
  type ThinkingItem,
  type ToolCallDisplay,
  type ToolGroupItem,
  type TurnCompletionStatus,
  type TurnStatsItem,
} from "./repl-ink/types.ts";
import {
  getRecentTurnActivityTrail,
  summarizeTurnCompletion,
} from "./repl-ink/components/conversation/turn-activity.ts";
import {
  resolveToolTranscriptDisplayName,
  resolveToolTranscriptProgress,
  resolveToolTranscriptResult,
} from "./repl-ink/components/conversation/tool-transcript.ts";

interface PendingTurnStats {
  toolCount: number;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  modelId?: string;
  costUsd?: number;
  costEstimated?: boolean;
  continuedThisTurn?: boolean;
  continuationCount?: number;
  compactionReason?: "proactive_pressure" | "overflow_retry";
}

export interface TranscriptState {
  items: ConversationItem[];
  streamingState: StreamingState;
  activeTool?: {
    name: string;
    displayName: string;
    progressText?: string;
    progressTone?: "running" | "success" | "warning";
    toolIndex: number;
    toolTotal: number;
  };
  nextId: number;
  activePlan?: Plan;
  planningPhase?: PlanningPhase;
  completedPlanStepIds: string[];
  todoState?: TodoState;
  planTodoState?: TodoState;
  pendingPlanReview?: { plan: Plan };
  currentTurnId?: string;
  currentTurnStartedAt?: number;
  pendingTurnStats?: PendingTurnStats;
  turnCounter: number;
}

export type TranscriptInput =
  | { type: "agent_event"; event: AgentUIEvent }
  | {
    type: "user_message";
    text: string;
    submittedText?: string;
    attachments?: ConversationAttachmentRef[];
    startTurn?: boolean;
  }
  | {
    type: "assistant_text";
    text: string;
    isPending: boolean;
    citations?: AssistantCitation[];
    turnId?: string;
  }
  | { type: "error"; text: string; turnId?: string }
  | { type: "info"; text: string; isTransient?: boolean; turnId?: string }
  | { type: "replace_items"; items: ConversationItem[] }
  | { type: "hql_eval"; input: string; result: EvalResult }
  | { type: "reset_status" }
  | { type: "cancel_planning" }
  | { type: "finalize"; status: TurnCompletionStatus; turnId?: string }
  | { type: "clear" };

export function createTranscriptState(): TranscriptState {
  return {
    items: [],
    streamingState: ConversationStreamingState.Idle,
    nextId: 0,
    completedPlanStepIds: [],
    turnCounter: 0,
  };
}

function getVisibleTodoState(
  state: TranscriptState,
): TodoState | undefined {
  return state.planTodoState ?? state.todoState;
}

export function getVisibleTodoSummary(
  state: TranscriptState,
): string | undefined {
  const visible = getVisibleTodoState(state);
  return visible ? summarizeTodoState(visible) : undefined;
}

function nextItemId(state: TranscriptState): [TranscriptState, string] {
  const nextId = state.nextId + 1;
  return [{ ...state, nextId }, `ci-${nextId}`];
}

function nextTurnId(state: TranscriptState): [TranscriptState, string] {
  const counter = state.turnCounter + 1;
  return [{ ...state, turnCounter: counter }, `turn-${counter}`];
}

function findPendingAssistantIndex(
  items: ConversationItem[],
  turnId?: string,
): number {
  return items.findLastIndex((item) =>
    item.type === "assistant" && item.isPending &&
    (turnId === undefined || item.turnId === turnId)
  );
}

export function findCurrentTurnStartIndex(items: ConversationItem[]): number {
  return items.findLastIndex((item) => item.type === "user");
}


function removeCurrentTurnTurnStats(
  items: ConversationItem[],
): ConversationItem[] {
  const turnStartIdx = findCurrentTurnStartIndex(items);
  return items.filter((item, index) =>
    !(index > turnStartIdx && item.type === "turn_stats")
  );
}

function removeTurnTurnStats(
  items: ConversationItem[],
  turnId?: string,
): ConversationItem[] {
  if (!turnId) {
    return removeCurrentTurnTurnStats(items);
  }
  return items.filter((item) =>
    !(item.type === "turn_stats" && item.turnId === turnId)
  );
}

function keepOnlyCurrentTurnPrompt(
  items: ConversationItem[],
): ConversationItem[] {
  const turnStartIdx = findCurrentTurnStartIndex(items);
  if (turnStartIdx < 0) {
    return cleanupTransientItems(items);
  }
  return cleanupTransientItems(items.slice(0, turnStartIdx + 1));
}

function insertBeforePendingAssistant(
  items: ConversationItem[],
  nextItem: ConversationItem,
  turnId?: string,
): ConversationItem[] {
  const pendingAssistantIdx = findPendingAssistantIndex(items, turnId);
  if (pendingAssistantIdx < 0) {
    if (!turnId) {
      return [...items, nextItem];
    }
    const lastTurnIndex = items.findLastIndex((item) => item.turnId === turnId);
    if (lastTurnIndex < 0) {
      return [...items, nextItem];
    }
    const next = [...items];
    next.splice(lastTurnIndex + 1, 0, nextItem);
    return next;
  }
  const next = [...items];
  next.splice(pendingAssistantIdx, 0, nextItem);
  return next;
}

function removeTransientInfoItems(
  items: ConversationItem[],
): ConversationItem[] {
  return items.filter((item) =>
    item.type !== "info" || item.isTransient !== true
  );
}

/** Strip transient info items from state, returning a new state. */
function withoutTransientItems(state: TranscriptState): TranscriptState {
  return { ...state, items: removeTransientInfoItems(state.items) };
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

function cleanupTransientItemsForTurn(
  items: ConversationItem[],
  turnId?: string,
): ConversationItem[] {
  if (!turnId) {
    return cleanupTransientItems(items);
  }
  return removeTransientInfoItems(items).flatMap((item) => {
    if (item.turnId !== turnId) {
      return [item];
    }
    if (item.type === "thinking") return [];
    if (item.type === "assistant" && item.isPending) {
      return item.text.trim().length > 0 ? [{ ...item, isPending: false }] : [];
    }
    return [item];
  });
}

function getTurnItems(
  items: readonly ConversationItem[],
  turnId: string | undefined,
): ConversationItem[] {
  return turnId ? items.filter((item) => item.turnId === turnId) : [];
}

function countTurnTools(items: readonly ConversationItem[]): number {
  let count = 0;
  for (const item of items) {
    if (item.type === "tool_group") {
      count += item.tools.length;
    }
  }
  return count;
}

function resolveFinalTurnDurationMs(state: TranscriptState): number {
  const wallClockDuration = typeof state.currentTurnStartedAt === "number"
    ? Math.max(0, Date.now() - state.currentTurnStartedAt)
    : 0;
  const reportedDuration = typeof state.pendingTurnStats?.durationMs === "number"
    ? Math.max(0, state.pendingTurnStats.durationMs)
    : 0;
  return Math.max(reportedDuration, wallClockDuration);
}

function appendCommittedTurnStats(
  state: TranscriptState,
  cleanedItems: ConversationItem[],
  status: TurnCompletionStatus,
  turnId?: string,
): TranscriptState {
  const targetTurnId = turnId ?? state.currentTurnId;
  if (!targetTurnId) {
    return { ...state, items: cleanedItems };
  }

  const turnItems = getTurnItems(cleanedItems, targetTurnId);
  const [nextState, id] = nextItemId({ ...state, items: cleanedItems });
  const statsItem: TurnStatsItem = {
    type: "turn_stats",
    id,
    toolCount: state.pendingTurnStats?.toolCount ?? countTurnTools(turnItems),
    durationMs: resolveFinalTurnDurationMs(state),
    inputTokens: state.pendingTurnStats?.inputTokens,
    outputTokens: state.pendingTurnStats?.outputTokens,
    modelId: state.pendingTurnStats?.modelId,
    costUsd: state.pendingTurnStats?.costUsd,
    costEstimated: state.pendingTurnStats?.costEstimated,
    continuedThisTurn: state.pendingTurnStats?.continuedThisTurn,
    continuationCount: state.pendingTurnStats?.continuationCount,
    compactionReason: state.pendingTurnStats?.compactionReason,
    status,
    summary: summarizeTurnCompletion(turnItems),
    activityTrail: getRecentTurnActivityTrail(turnItems, 2),
    turnId: targetTurnId,
  };

  return {
    ...nextState,
    items: insertBeforePendingAssistant(cleanedItems, statsItem, targetTurnId),
  };
}

function appendInfoItem(
  state: TranscriptState,
  text: string,
  turnId?: string,
): TranscriptState {
  const [nextState, id] = nextItemId(state);
  const item: InfoItem = {
    type: "info",
    id,
    text,
    turnId: turnId ?? state.currentTurnId,
  };
  return {
    ...nextState,
    items: insertBeforePendingAssistant(
      nextState.items,
      item,
      turnId ?? state.currentTurnId,
    ),
  };
}

type StructuredTeamInfoInput =
  | Omit<TeamTaskInfoItem, "id" | "type" | "text" | "ts">
  | Omit<TeamMessageInfoItem, "id" | "type" | "text" | "ts">
  | Omit<TeamMemberActivityInfoItem, "id" | "type" | "text" | "ts">
  | Omit<TeamPlanReviewInfoItem, "id" | "type" | "text" | "ts">
  | Omit<TeamShutdownInfoItem, "id" | "type" | "text" | "ts">;

function appendStructuredTeamInfoItem(
  state: TranscriptState,
  item: StructuredTeamInfoInput,
  text: string,
): TranscriptState {
  const [nextState, id] = nextItemId(state);
  const nextItem: StructuredTeamInfoItem = {
    type: "info",
    ...item,
    id,
    text,
    ts: Date.now(),
    turnId: state.currentTurnId,
  };
  return {
    ...nextState,
    items: insertBeforePendingAssistant(
      nextState.items,
      nextItem,
      state.currentTurnId,
    ),
  };
}

function describeTeamTaskUpdate(
  event: Extract<AgentUIEvent, { type: "team_task_updated" }>,
): string {
  return event.assigneeMemberId
    ? `Team task ${event.status}: ${event.goal} (${event.assigneeMemberId})`
    : `Team task ${event.status}: ${event.goal}`;
}

function describeTeamMessage(
  event: Extract<AgentUIEvent, { type: "team_message" }>,
): string {
  return event.toMemberId
    ? `Team ${event.kind}: ${event.fromMemberId} -> ${event.toMemberId}: ${event.contentPreview}`
    : `Team ${event.kind}: ${event.fromMemberId}: ${event.contentPreview}`;
}

function describeTeamMemberActivity(
  event: Extract<AgentUIEvent, { type: "team_member_activity" }>,
): string {
  return `Team worker ${event.memberLabel}: ${event.summary}`;
}

function describeTeamPlanReview(
  event: Extract<
    AgentUIEvent,
    { type: "team_plan_review_required" | "team_plan_review_resolved" }
  >,
): string {
  if (event.type === "team_plan_review_required") {
    return `Team plan review requested for task ${event.taskId}`;
  }
  return `Team plan review ${
    event.approved ? "approved" : "rejected"
  } for task ${event.taskId}`;
}

function describeTeamShutdown(
  event: Extract<
    AgentUIEvent,
    { type: "team_shutdown_requested" | "team_shutdown_resolved" }
  >,
): string {
  if (event.type === "team_shutdown_requested") {
    return event.reason
      ? `Shutdown requested for ${event.memberId}: ${event.reason}`
      : `Shutdown requested for ${event.memberId}`;
  }
  return `Shutdown ${event.status} for ${event.memberId}`;
}

function upsertThinkingItem(
  state: TranscriptState,
  iteration: number,
  kind: ThinkingItem["kind"],
  summary: string,
): TranscriptState {
  const turnStartIdx = findCurrentTurnStartIndex(state.items);
  const idx = state.items.findLastIndex((item, itemIndex) =>
    itemIndex > turnStartIdx &&
    item.type === "thinking" &&
    item.kind === kind
  );
  if (idx < 0) {
    const [nextState, id] = nextItemId(state);
    const thinking: ThinkingItem = {
      type: "thinking",
      id,
      kind,
      summary,
      iteration,
      turnId: state.currentTurnId,
    };
    return {
      ...nextState,
      items: insertBeforePendingAssistant(nextState.items, thinking),
    };
  }
  const nextItems = [...state.items];
  const current = nextItems[idx];
  if (current?.type !== "thinking") return state;
  nextItems[idx] = { ...current, kind, summary, iteration };
  return { ...state, items: nextItems };
}

function findMatchingRunningToolIndex(
  tools: ToolCallDisplay[],
  toolCallId: string | undefined,
  name: string,
  argsSummary: string,
): number {
  if (toolCallId) {
    const byToolCallId = tools.findIndex((tool) =>
      tool.status === "running" && tool.toolCallId === toolCallId
    );
    if (byToolCallId >= 0) return byToolCallId;
  }
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

/** Resolve a tool event to its group and tool index, or null if not found. */
function resolveToolInGroup(
  items: ConversationItem[],
  event: { toolCallId?: string; name: string; argsSummary: string },
): { groupIdx: number; groupItem: ToolGroupItem; resolvedIdx: number } | null {
  const groupIdx = items.findLastIndex((item) =>
    item.type === "tool_group" &&
    findMatchingRunningToolIndex(
      item.tools,
      event.toolCallId,
      event.name,
      event.argsSummary,
    ) >= 0
  );
  if (groupIdx < 0) return null;
  const groupItem = items[groupIdx];
  if (groupItem.type !== "tool_group") return null;
  const resolvedIdx = findMatchingRunningToolIndex(
    groupItem.tools,
    event.toolCallId,
    event.name,
    event.argsSummary,
  );
  if (resolvedIdx < 0) return null;
  return { groupIdx, groupItem, resolvedIdx };
}

function buildActiveToolDisplay(
  tool: Pick<
    ToolCallDisplay,
    "name" | "displayName" | "progressText" | "progressTone" | "toolIndex" |
      "toolTotal"
  >,
): NonNullable<TranscriptState["activeTool"]> {
  return {
    name: tool.name,
    displayName: tool.displayName ?? resolveToolTranscriptDisplayName(tool.name),
    progressText: tool.progressText,
    progressTone: tool.progressTone,
    toolIndex: tool.toolIndex,
    toolTotal: tool.toolTotal,
  };
}

function findLatestRunningTool(
  items: readonly ConversationItem[],
): ToolCallDisplay | undefined {
  for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex--) {
    const item = items[itemIndex];
    if (item?.type !== "tool_group") continue;
    for (let toolIndex = item.tools.length - 1; toolIndex >= 0; toolIndex--) {
      const tool = item.tools[toolIndex];
      if (tool.status === "running") return tool;
    }
  }
  return undefined;
}

// ── Delegate Group Helpers ─────────────────────────────────────

/** Reverse-search for existing DelegateGroupItem with matching batchId */
function findTrailingDelegateGroupIndex(
  items: ConversationItem[],
  batchId: string,
): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type === "delegate_group" && item.batchId === batchId) return i;
  }
  return -1;
}

/** Find group containing a running/queued entry matching the given criteria */
function findDelegateGroupEntryIndex(
  items: ConversationItem[],
  agent: string,
  task: string,
  threadId?: string,
): { groupIdx: number; entryIdx: number } | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type !== "delegate_group") continue;
    for (let j = item.entries.length - 1; j >= 0; j--) {
      const entry = item.entries[j];
      if (entry.status !== "running" && entry.status !== "queued") continue;
      if (threadId && entry.threadId === threadId) {
        return { groupIdx: i, entryIdx: j };
      }
      if (entry.agent === agent && entry.task === task) {
        return { groupIdx: i, entryIdx: j };
      }
    }
  }
  return null;
}

function findMatchingRunningDelegateIndex(
  items: ConversationItem[],
  agent: string,
  task: string,
  threadId?: string,
): number {
  // Single reverse pass: track best match at 3 precision levels
  let byExact = -1;
  let byAgent = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (
      item.type !== "delegate" ||
      (item.status !== "running" && item.status !== "queued")
    ) continue;
    // Most precise: threadId match (return immediately — findLast semantics)
    if (threadId && item.threadId === threadId) return i;
    // Exact agent+task match
    if (byExact < 0 && item.agent === agent && item.task === task) byExact = i;
    // Loose agent-only match
    if (byAgent < 0 && item.agent === agent) byAgent = i;
    // Early exit: all levels found
    if (byExact >= 0 && byAgent >= 0) break;
  }
  return byExact >= 0 ? byExact : byAgent;
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
    turnId: state.currentTurnId,
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

/**
 * Append an item to the list, inserting it before a trailing turn_stats
 * item when the item is finalized (not pending).
 */
function appendBeforeTrailingTurnStats(
  items: ConversationItem[],
  item: ConversationItem,
  isPending: boolean,
): ConversationItem[] {
  const nextItems = [...items];
  if (
    !isPending &&
    nextItems.length > 0 &&
    nextItems[nextItems.length - 1]?.type === "turn_stats"
  ) {
    nextItems.splice(nextItems.length - 1, 0, item);
  } else {
    nextItems.push(item);
  }
  return nextItems;
}

function insertAssistantIntoTurn(
  items: ConversationItem[],
  item: AssistantItem,
  isPending: boolean,
  turnId?: string,
): ConversationItem[] {
  if (!turnId) {
    return appendBeforeTrailingTurnStats(items, item, isPending);
  }
  const trailingTurnStatsIdx = items.findLastIndex((existing) =>
    existing.type === "turn_stats" && existing.turnId === turnId
  );
  if (trailingTurnStatsIdx >= 0) {
    const next = [...items];
    next.splice(trailingTurnStatsIdx, 0, item);
    return next;
  }
  const lastTurnIndex = items.findLastIndex((existing) =>
    existing.turnId === turnId
  );
  if (lastTurnIndex < 0) {
    return appendBeforeTrailingTurnStats(items, item, isPending);
  }
  const next = [...items];
  next.splice(lastTurnIndex + 1, 0, item);
  return next;
}

function upsertAssistantTextItem(
  state: TranscriptState,
  text: string,
  isPending: boolean,
  citations?: AssistantCitation[],
  turnId?: string,
): TranscriptState {
  const targetTurnId = turnId ?? state.currentTurnId;
  // When a pending assistant item is created or updated, ensure streamingState
  // is Responding so the footer shows "Working · esc to interrupt" immediately.
  const baseState = isPending
    ? { ...state, streamingState: ConversationStreamingState.Responding }
    : state;

  // Fast path: streaming update to pending assistant (last item).
  // During streaming, the last item is always the pending assistant and there
  // are no transient info items or turn stats to clean — skip O(n) filters.
  if (isPending && baseState.items.length > 0) {
    const lastIdx = baseState.items.length - 1;
    const last = baseState.items[lastIdx];
    if (
      last.type === "assistant" && last.isPending &&
      (targetTurnId === undefined || last.turnId === targetTurnId)
    ) {
      const nextItems = baseState.items.slice();
      nextItems[lastIdx] = { ...last, text, citations };
      return { ...baseState, items: nextItems };
    }
  }

  const cleanedItems = removeTurnTurnStats(
    removeTransientInfoItems(baseState.items),
    targetTurnId,
  );
  let pendingIdx = -1;
  for (let i = cleanedItems.length - 1; i >= 0; i--) {
    const item = cleanedItems[i];
    if (item.type === "assistant") {
      if (
        item.isPending &&
        (targetTurnId === undefined || item.turnId === targetTurnId) &&
        pendingIdx < 0
      ) pendingIdx = i;
      if (pendingIdx >= 0) break;
    }
  }

  if (pendingIdx >= 0) {
    const target = cleanedItems[pendingIdx] as AssistantItem;
    const nextItems = [...cleanedItems];
    nextItems[pendingIdx] = { ...target, text, isPending, citations };
    return { ...baseState, items: nextItems };
  }

  // Each finalized text block between tool calls stays as its own item
  // (matches Claude Code rendering). No consolidation — previous blocks
  // were already flushed and finalized by tool_start events.

  const [nextState, id] = nextItemId({
    ...baseState,
    items: cleanedItems,
  });
  const assistant: AssistantItem = {
    type: "assistant",
    id,
    text,
    citations,
    isPending,
    ts: Date.now(),
    turnId: targetTurnId,
  };
  return {
    ...nextState,
    items: insertAssistantIntoTurn(
      cleanedItems,
      assistant,
      isPending,
      targetTurnId,
    ),
  };
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
        case "plan_phase_changed":
          // Only update the phase — never remove items (thinking, transient
          // info, etc.) to avoid visible screen flush during transitions.
          return {
            ...state,
            planningPhase: event.phase,
          };
        case "thinking":
          return {
            ...state,
            streamingState: ConversationStreamingState.Responding,
            activeTool: undefined,
            items: removeTransientInfoItems(state.items),
          };
        case "reasoning_update":
        case "planning_update": {
          if (
            state.planningPhase === "executing" ||
            state.planningPhase === "done"
          ) {
            return state;
          }
          const inExplicitPlanFlow = Boolean(
            state.planningPhase || state.activePlan || state.pendingPlanReview,
          );
          const thinkingKind: ThinkingItem["kind"] =
            event.type === "reasoning_update" || !inExplicitPlanFlow
              ? "reasoning"
              : "planning";
          return upsertThinkingItem(
            {
              ...state,
              streamingState: ConversationStreamingState.Responding,
              activeTool: undefined,
              items: removeTransientInfoItems(state.items),
            },
            event.iteration,
            thinkingKind,
            event.summary,
          );
        }
        case "tool_start": {
          if (event.name === "delegate_agent") return state;
          if (event.name.startsWith("memory_")) return state;
          const displayName = resolveToolTranscriptDisplayName(event.name);
          const initialProgress = resolveToolTranscriptProgress(event.name, {
            toolCallId: event.toolCallId,
            name: event.name,
            argsSummary: event.argsSummary,
            message: "",
            tone: "running",
            phase: "start",
          });
          const tool: ToolCallDisplay = {
            id: `ci-${state.nextId + 1}`,
            toolCallId: event.toolCallId,
            name: event.name,
            displayName,
            argsSummary: event.argsSummary,
            status: "running",
            progressText: initialProgress?.message,
            progressTone: initialProgress?.tone,
            toolIndex: event.toolIndex,
            toolTotal: event.toolTotal,
          };
          let nextState: TranscriptState = {
            ...state,
            streamingState: ConversationStreamingState.Responding,
            activeTool: buildActiveToolDisplay(tool),
            items: removeTransientInfoItems(state.items),
          };
          const [stateWithToolId, toolId] = nextItemId(nextState);
          const nextTool = { ...tool, id: toolId };
          nextState = stateWithToolId;

          const trailingToolGroupIdx = findTrailingToolGroupIndex(
            nextState.items,
          );
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
            turnId: nextState.currentTurnId,
          };
          return {
            ...stateWithGroupId,
            items: insertBeforePendingAssistant(stateWithGroupId.items, group),
          };
        }
        case "tool_progress": {
          if (event.name === "delegate_agent") return state;
          if (event.name.startsWith("memory_")) return state;
          const match = resolveToolInGroup(state.items, event);
          if (!match) return state;
          const { groupIdx, groupItem, resolvedIdx } = match;

          const formattedProgress = resolveToolTranscriptProgress(
            event.name,
            event,
          );
          if (!formattedProgress) return state;

          const nextTools = [...groupItem.tools];
          nextTools[resolvedIdx] = {
            ...nextTools[resolvedIdx],
            progressText: formattedProgress.message,
            progressTone: formattedProgress.tone,
          };
          const nextItems = [...state.items];
          nextItems[groupIdx] = { ...groupItem, tools: nextTools };
          const runningTool = nextTools[resolvedIdx];
          return {
            ...state,
            items: nextItems,
            activeTool: buildActiveToolDisplay(runningTool),
          };
        }
        case "tool_end": {
          if (event.name === "delegate_agent") return state;
          if (event.name.startsWith("memory_")) return state;
          const match = resolveToolInGroup(state.items, event);
          if (!match) return state;
          const { groupIdx, groupItem, resolvedIdx } = match;

          const nextTools = [...groupItem.tools];
          const transcriptResult = resolveToolTranscriptResult(event.name, {
            toolCallId: event.toolCallId,
            name: event.name,
            success: event.success,
            summary: event.summary,
            content: event.content,
            durationMs: event.durationMs,
            argsSummary: event.argsSummary,
            meta: event.meta,
          });
          nextTools[resolvedIdx] = {
            ...nextTools[resolvedIdx],
            status: event.success ? "success" : "error",
            progressText: undefined,
            progressTone: undefined,
            resultSummaryText: transcriptResult.summaryText,
            resultDetailText: transcriptResult.detailText,
            resultText: transcriptResult.detailText,
            resultMeta: event.meta,
            durationMs: event.durationMs,
          };
          const nextItems = [...state.items];
          nextItems[groupIdx] = { ...groupItem, tools: nextTools };
          const allDone = nextTools.every((tool) =>
            tool.status === "success" || tool.status === "error"
          );
          const latestRunningTool = findLatestRunningTool(nextItems);
          return {
            ...state,
            items: nextItems,
            streamingState: allDone
              ? ConversationStreamingState.Responding
              : state.streamingState,
            activeTool: latestRunningTool
              ? buildActiveToolDisplay(latestRunningTool)
              : undefined,
          };
        }
        case "delegate_running": {
          for (let i = state.items.length - 1; i >= 0; i--) {
            const item = state.items[i];
            if (item.type !== "delegate_group") continue;
            const entryIdx = item.entries.findIndex(
              (e) => e.threadId === event.threadId && e.status === "queued",
            );
            if (entryIdx >= 0) {
              const nextEntries = [...item.entries];
              nextEntries[entryIdx] = {
                ...nextEntries[entryIdx],
                status: "running",
              };
              const nextItems = [...state.items];
              nextItems[i] = { ...item, entries: nextEntries };
              return { ...state, items: nextItems };
            }
          }
          return state; // no match = individual delegate, unchanged
        }
        case "delegate_start": {
          const baseState = {
            ...state,
            streamingState: ConversationStreamingState.Responding,
            activeTool: undefined,
            items: removeTransientInfoItems(state.items),
          };
          // Batched delegate → group into DelegateGroupItem
          if (event.batchId) {
            const groupIdx = findTrailingDelegateGroupIndex(
              baseState.items,
              event.batchId,
            );
            const [idState, entryId] = nextItemId(baseState);
            const newEntry: DelegateGroupEntry = {
              id: entryId,
              agent: event.agent,
              task: event.task,
              childSessionId: event.childSessionId,
              status: "queued",
              threadId: event.threadId,
              nickname: event.nickname,
            };
            if (groupIdx >= 0) {
              // Append to existing group
              const group = idState.items[groupIdx] as DelegateGroupItem;
              const nextItems = [...idState.items];
              nextItems[groupIdx] = {
                ...group,
                entries: [...group.entries, newEntry],
              };
              return { ...idState, items: nextItems };
            }
            // Create new group
            const [groupIdState, groupId] = nextItemId(idState);
            const groupItem: DelegateGroupItem = {
              type: "delegate_group",
              id: groupId,
              batchId: event.batchId,
              entries: [newEntry],
              ts: Date.now(),
              turnId: groupIdState.currentTurnId,
            };
            return {
              ...groupIdState,
              items: insertBeforePendingAssistant(
                groupIdState.items,
                groupItem,
              ),
            };
          }
          // Non-batched → individual DelegateItem (unchanged)
          return appendDelegateItem(
            baseState,
            event.agent,
            event.task,
            event.childSessionId,
            event.threadId,
            event.nickname,
          );
        }
        case "delegate_end": {
          const endBaseState = {
            ...state,
            streamingState: ConversationStreamingState.Responding,
            activeTool: undefined,
          };
          // Batched → update entry within group
          if (event.batchId) {
            const match = findDelegateGroupEntryIndex(
              endBaseState.items,
              event.agent,
              event.task,
              event.threadId,
            );
            if (match) {
              const group = endBaseState
                .items[match.groupIdx] as DelegateGroupItem;
              const isCancelled = !event.success &&
                event.error?.toLowerCase().includes("abort");
              const nextEntries = [...group.entries];
              nextEntries[match.entryIdx] = {
                ...nextEntries[match.entryIdx],
                status: isCancelled
                  ? "cancelled"
                  : event.success
                  ? "success"
                  : "error",
                summary: event.summary,
                error: event.error,
                durationMs: event.durationMs,
                snapshot: event.snapshot,
                childSessionId: event.childSessionId ??
                  nextEntries[match.entryIdx].childSessionId,
              };
              const nextItems = [...endBaseState.items];
              nextItems[match.groupIdx] = {
                ...group,
                entries: nextEntries,
              };
              return { ...endBaseState, items: nextItems };
            }
          }
          // Non-batched or no match → existing behavior
          return { ...completeDelegateItem(endBaseState, event) };
        }
        case "todo_updated":
          return {
            ...state,
            todoState: cloneTodoState(event.todoState),
          };
        case "team_task_updated":
          return appendStructuredTeamInfoItem(
            withoutTransientItems(state),
            {
              teamEventType: "team_task_updated",
              taskId: event.taskId,
              goal: event.goal,
              status: event.status,
              assigneeMemberId: event.assigneeMemberId,
              artifacts: event.artifacts,
            },
            describeTeamTaskUpdate(event),
          );
        case "team_message":
          return appendStructuredTeamInfoItem(
            withoutTransientItems(state),
            {
              teamEventType: "team_message",
              kind: event.kind,
              fromMemberId: event.fromMemberId,
              toMemberId: event.toMemberId,
              relatedTaskId: event.relatedTaskId,
              contentPreview: event.contentPreview,
            },
            describeTeamMessage(event),
          );
        case "team_member_activity":
          return appendStructuredTeamInfoItem(
            withoutTransientItems(state),
            {
              teamEventType: "team_member_activity",
              memberId: event.memberId,
              memberLabel: event.memberLabel,
              threadId: event.threadId,
              activityKind: event.activityKind,
              status: event.status,
              summary: event.summary,
              durationMs: event.durationMs,
              toolCount: event.toolCount,
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
            },
            describeTeamMemberActivity(event),
          );
        case "team_plan_review_required":
          return appendStructuredTeamInfoItem(
            withoutTransientItems(state),
            {
              teamEventType: "team_plan_review",
              approvalId: event.approvalId,
              taskId: event.taskId,
              submittedByMemberId: event.submittedByMemberId,
              status: "pending",
            },
            describeTeamPlanReview(event),
          );
        case "team_plan_review_resolved":
          return appendStructuredTeamInfoItem(
            withoutTransientItems(state),
            {
              teamEventType: "team_plan_review",
              approvalId: event.approvalId,
              taskId: event.taskId,
              submittedByMemberId: event.submittedByMemberId,
              status: event.approved ? "approved" : "rejected",
              reviewedByMemberId: event.reviewedByMemberId,
            },
            describeTeamPlanReview(event),
          );
        case "team_shutdown_requested":
          return appendStructuredTeamInfoItem(
            withoutTransientItems(state),
            {
              teamEventType: "team_shutdown",
              requestId: event.requestId,
              memberId: event.memberId,
              requestedByMemberId: event.requestedByMemberId,
              status: "requested",
              reason: event.reason,
            },
            describeTeamShutdown(event),
          );
        case "team_shutdown_resolved":
          return appendStructuredTeamInfoItem(
            withoutTransientItems(state),
            {
              teamEventType: "team_shutdown",
              requestId: event.requestId,
              memberId: event.memberId,
              requestedByMemberId: event.requestedByMemberId,
              status: event.status,
            },
            describeTeamShutdown(event),
          );
        case "batch_progress_updated": {
          // Suppress redundant info item when a DelegateGroupItem already shows richer data
          const hasGroup = findTrailingDelegateGroupIndex(
            state.items,
            event.snapshot.batchId,
          ) >= 0;
          if (hasGroup) return state;
          return appendInfoItem(
            withoutTransientItems(state),
            `Batch ${event.snapshot.batchId}: ${event.snapshot.running} running · ${event.snapshot.completed} completed · ${event.snapshot.errored} errored`,
          );
        }
        case "memory_activity": {
          const details: MemoryActivityDetail[] = [];
          for (const r of event.recalled) {
            details.push({
              action: "recalled",
              text: r.text,
              score: r.score,
              factId: r.factId,
            });
          }
          for (const w of event.written) {
            details.push({ action: "wrote", text: w.text, factId: w.factId });
          }
          if (event.searched) {
            details.push({
              action: "searched",
              text:
                `"${event.searched.query}" → ${event.searched.count} results`,
            });
          }
          const recalled = event.recalled.length;
          const written = event.written.length;
          const searched = event.searched;

          // Merge into trailing MemoryActivityItem in current turn if present
          const turnStart = findCurrentTurnStartIndex(state.items);
          const trailingMemIdx = state.items.findLastIndex((item, idx) =>
            idx > turnStart && item.type === "memory_activity"
          );
          if (trailingMemIdx >= 0) {
            const existing = state.items[trailingMemIdx] as MemoryActivityItem;
            const nextItems = [...state.items];
            nextItems[trailingMemIdx] = {
              ...existing,
              recalled: existing.recalled + recalled,
              written: existing.written + written,
              searched: searched ?? existing.searched,
              details: [...existing.details, ...details],
            };
            return { ...state, items: nextItems };
          }

          const [nextState, id] = nextItemId(state);
          const memItem: MemoryActivityItem = {
            type: "memory_activity",
            id,
            recalled,
            written,
            searched,
            details,
            ts: Date.now(),
            turnId: state.currentTurnId,
          };
          return {
            ...nextState,
            items: insertBeforePendingAssistant(nextState.items, memItem),
          };
        }
        case "plan_created":
          return {
            ...state,
            activePlan: event.plan,
            planningPhase: state.planningPhase === "reviewing"
              ? state.planningPhase
              : "reviewing",
            completedPlanStepIds: [],
            planTodoState: derivePlanTodoState(event.plan, []),
          };
        case "plan_step": {
          const completedPlanStepIds =
            state.completedPlanStepIds.includes(event.stepId)
              ? state.completedPlanStepIds
              : [...state.completedPlanStepIds, event.stepId];
          return {
            ...state,
            completedPlanStepIds,
            planningPhase: completedPlanStepIds.length >=
                (state.activePlan?.steps.length ?? Number.POSITIVE_INFINITY)
              ? "done"
              : state.planningPhase,
            planTodoState: derivePlanTodoState(
              state.activePlan,
              completedPlanStepIds,
            ),
          };
        }
        case "plan_review_required":
          return {
            ...state,
            pendingPlanReview: { plan: event.plan },
            planningPhase: "reviewing",
            streamingState: ConversationStreamingState.WaitingForConfirmation,
          };
        case "plan_review_resolved":
          if (event.decision === "cancelled") {
            return {
              ...state,
              pendingPlanReview: undefined,
              activePlan: undefined,
              planningPhase: undefined,
              completedPlanStepIds: [],
              planTodoState: undefined,
              streamingState: ConversationStreamingState.Responding,
            };
          }
          return {
            ...state,
            pendingPlanReview: undefined,
            planningPhase: event.approved
              ? "executing"
              : event.decision === "revise"
              ? "researching"
              : state.planningPhase,
            streamingState: ConversationStreamingState.Responding,
          };
        case "turn_stats": {
          return {
            ...state,
            pendingTurnStats: {
              toolCount: event.toolCount,
              durationMs: event.durationMs,
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              modelId: event.modelId,
              costUsd: event.costUsd,
              costEstimated: event.costEstimated,
              continuedThisTurn: event.continuedThisTurn,
              continuationCount: event.continuationCount,
              compactionReason: event.compactionReason,
            },
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
      const clearFinishedPlanState = startTurn &&
        state.planningPhase === "done";
      let nextState: TranscriptState = {
        ...state,
        items: startTurn ? cleanupTransientItems(state.items) : state.items,
        activePlan: clearFinishedPlanState ? undefined : state.activePlan,
        planningPhase: clearFinishedPlanState ? undefined : state.planningPhase,
        completedPlanStepIds: clearFinishedPlanState
          ? []
          : state.completedPlanStepIds,
        todoState: clearFinishedPlanState ? undefined : state.todoState,
        planTodoState: clearFinishedPlanState ? undefined : state.planTodoState,
        pendingPlanReview: clearFinishedPlanState
          ? undefined
          : state.pendingPlanReview,
        pendingTurnStats: startTurn ? undefined : state.pendingTurnStats,
        currentTurnStartedAt: startTurn
          ? Date.now()
          : state.currentTurnStartedAt,
      };

      // Generate a new turnId when starting a new turn
      let turnId = nextState.currentTurnId;
      if (startTurn) {
        [nextState, turnId] = nextTurnId(nextState);
        nextState = { ...nextState, currentTurnId: turnId };
      }

      let id: string;
      [nextState, id] = nextItemId(nextState);
      const userItem: ConversationItem = {
        type: "user",
        id,
        text: input.text,
        submittedText: input.submittedText,
        attachments: input.attachments,
        ts: Date.now(),
        turnId,
      };

      if (!startTurn) {
        return {
          ...nextState,
          items: insertBeforePendingAssistant(nextState.items, userItem),
        };
      }

      let assistantId: string;
      [nextState, assistantId] = nextItemId(
        {
          ...nextState,
          items: [...nextState.items, userItem],
        } satisfies TranscriptState,
      );
      const pendingAssistant: AssistantItem = {
        type: "assistant",
        id: assistantId,
        text: "",
        citations: undefined,
        isPending: true,
        ts: Date.now(),
        turnId,
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
        input.turnId ?? state.currentTurnId,
      );
    case "error": {
      const [nextState, id] = nextItemId(state);
      const item: ErrorItem = {
        type: "error",
        id,
        text: input.text,
        turnId: input.turnId ?? state.currentTurnId,
      };
      return {
        ...nextState,
        items: insertBeforePendingAssistant(
          nextState.items,
          item,
          input.turnId ?? state.currentTurnId,
        ),
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
          turnId: input.turnId ?? state.currentTurnId,
        };
        return {
          ...nextState,
          items: insertBeforePendingAssistant(
            nextState.items,
            item,
            input.turnId ?? state.currentTurnId,
          ),
        };
      }
      return appendInfoItem(state, input.text, input.turnId);
    }
    case "hql_eval": {
      let nextState = state;
      let turnId = state.currentTurnId;
      if (!turnId) {
        [nextState, turnId] = nextTurnId(nextState);
      }
      let id: string;
      [nextState, id] = nextItemId(nextState);
      const evalItem: HqlEvalItem = {
        type: "hql_eval",
        id,
        input: input.input.trim(),
        result: input.result,
        ts: Date.now(),
        turnId,
      };
      return {
        ...nextState,
        items: [...nextState.items, evalItem],
      };
    }
    case "replace_items":
      return {
        ...state,
        items: input.items,
        streamingState: ConversationStreamingState.Idle,
        activeTool: undefined,
        activePlan: undefined,
        planningPhase: undefined,
        completedPlanStepIds: [],
        todoState: undefined,
        planTodoState: undefined,
        pendingPlanReview: undefined,
        currentTurnId: undefined,
        currentTurnStartedAt: undefined,
        pendingTurnStats: undefined,
        nextId: input.items.length,
      };
    case "reset_status":
      return {
        ...state,
        streamingState: ConversationStreamingState.Idle,
        activeTool: undefined,
      };
    case "cancel_planning":
      return {
        ...state,
        streamingState: ConversationStreamingState.Idle,
        activeTool: undefined,
        items: keepOnlyCurrentTurnPrompt(state.items),
        activePlan: undefined,
        planningPhase: undefined,
        completedPlanStepIds: [],
        todoState: undefined,
        planTodoState: undefined,
        pendingPlanReview: undefined,
      };
    case "finalize": {
      const targetTurnId = input.turnId ?? state.currentTurnId;
      const cleanedItems = cleanupTransientItemsForTurn(
        state.items,
        targetTurnId,
      );
      const finalizedState = appendCommittedTurnStats(
        state,
        cleanedItems,
        input.status,
        targetTurnId,
      );
      const finalizesCurrentTurn = !targetTurnId ||
        targetTurnId === state.currentTurnId;
      const hasPlanContext = Boolean(
        state.activePlan || state.pendingPlanReview,
      );
      const shouldResetActivePlan = Boolean(
        finalizesCurrentTurn &&
          state.planningPhase &&
          state.planningPhase !== "done",
      );
      return {
        ...finalizedState,
        streamingState: ConversationStreamingState.Idle,
        activeTool: undefined,
        currentTurnId: finalizesCurrentTurn ? undefined : state.currentTurnId,
        currentTurnStartedAt: finalizesCurrentTurn
          ? undefined
          : state.currentTurnStartedAt,
        pendingTurnStats: finalizesCurrentTurn
          ? undefined
          : state.pendingTurnStats,
        ...(shouldResetActivePlan
          ? {
            activePlan: undefined,
            planningPhase: undefined,
            completedPlanStepIds: [],
            todoState: undefined,
            planTodoState: undefined,
            pendingPlanReview: undefined,
          }
          : hasPlanContext && finalizesCurrentTurn
          ? {}
          : {
            planningPhase: undefined,
            completedPlanStepIds: [],
            planTodoState: undefined,
          }),
      };
    }
    case "clear":
      return createTranscriptState();
  }
}
