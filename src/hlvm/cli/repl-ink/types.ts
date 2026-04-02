/**
 * HLVM Ink REPL - Type Definitions
 *
 * Re-exports + conversation display types for the REPL agent UI.
 * These types bridge AgentUIEvent (from orchestrator) → renderable UI items.
 */

// Re-export EvalResult from evaluator.ts (used by Output, App, useRepl)
export type { EvalResult } from "../repl/evaluator.ts";
import type { EvalResult } from "../repl/evaluator.ts";
import type { Citation } from "../../agent/tools/web/search-provider.ts";
import type { ToolEventMeta } from "../../agent/orchestrator.ts";
import type { DelegateTranscriptSnapshot } from "../../agent/delegate-transcript.ts";
import type {
  TeamApprovalStatus,
  TeamRuntimeSnapshot,
  TeamShutdownStatus,
} from "../../agent/team-runtime.ts";

// ============================================================
// Tool Call Display
// ============================================================

/** Display state for a single tool call within a tool group */
export interface ToolCallDisplay {
  id: string;
  toolCallId?: string;
  name: string;
  displayName?: string;
  argsSummary: string;
  status: "pending" | "running" | "success" | "error";
  queuedText?: string;
  progressText?: string;
  progressTone?: "running" | "success" | "warning";
  resultSummaryText?: string;
  resultDetailText?: string;
  resultText?: string;
  resultMeta?: ToolEventMeta;
  durationMs?: number;
  toolIndex: number;
  toolTotal: number;
}

export type AssistantCitation = Citation;

// ============================================================
// Conversation Items
// ============================================================

export interface ConversationAttachmentRef {
  attachmentId?: string;
  label: string;
}

export function createConversationAttachmentRef(
  label: string,
  attachmentId?: string,
): ConversationAttachmentRef {
  const trimmedId = attachmentId?.trim();
  return trimmedId ? { attachmentId: trimmedId, label } : { label };
}

export function createConversationAttachmentRefs(
  labels: readonly string[],
): ConversationAttachmentRef[] {
  return labels.map((label) => createConversationAttachmentRef(label));
}

/** User message in the conversation */
export interface UserItem {
  type: "user";
  id: string;
  text: string;
  submittedText?: string;
  attachments?: ConversationAttachmentRef[];
  ts: number;
  turnId?: string;
}

/** Assistant (model) response — may be streaming */
export interface AssistantItem {
  type: "assistant";
  id: string;
  text: string;
  citations?: AssistantCitation[];
  isPending: boolean;
  ts: number;
  turnId?: string;
}

/** Thinking/reasoning indicator */
export interface ThinkingItem {
  type: "thinking";
  id: string;
  kind: "reasoning" | "planning";
  summary: string;
  iteration: number;
  turnId?: string;
}

/** Group of tool calls executed together */
export interface ToolGroupItem {
  type: "tool_group";
  id: string;
  tools: ToolCallDisplay[];
  ts: number;
  turnId?: string;
}

export type TurnCompletionStatus = "completed" | "cancelled" | "failed";

/** Turn completion statistics */
export interface TurnStatsItem {
  type: "turn_stats";
  id: string;
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
  status: TurnCompletionStatus;
  summary?: string;
  activityTrail?: string[];
  turnId?: string;
}

/** Delegated sub-agent activity */
export interface DelegateItem {
  type: "delegate";
  id: string;
  agent: string;
  task: string;
  childSessionId?: string;
  status: "queued" | "running" | "success" | "error" | "cancelled";
  summary?: string;
  error?: string;
  durationMs?: number;
  snapshot?: DelegateTranscriptSnapshot;
  threadId?: string;
  nickname?: string;
  ts: number;
  turnId?: string;
}

/** Single entry within a parallel delegate group */
export interface DelegateGroupEntry {
  id: string;
  agent: string;
  task: string;
  childSessionId?: string;
  status: "queued" | "running" | "success" | "error" | "cancelled";
  summary?: string;
  error?: string;
  durationMs?: number;
  snapshot?: DelegateTranscriptSnapshot;
  threadId?: string;
  nickname?: string;
}

/** Grouped parallel delegate agents (batch_delegate) */
export interface DelegateGroupItem {
  type: "delegate_group";
  id: string;
  batchId: string;
  entries: DelegateGroupEntry[];
  ts: number;
  turnId?: string;
}

/** Error message */
export interface ErrorItem {
  type: "error";
  id: string;
  text: string;
  turnId?: string;
}

/** Informational message */
export interface InfoItem {
  type: "info";
  id: string;
  text: string;
  isTransient?: boolean;
  ts?: number;
  turnId?: string;
}

export interface TeamTaskInfoItem extends InfoItem {
  teamEventType: "team_task_updated";
  taskId: string;
  goal: string;
  status: string;
  assigneeMemberId?: string;
  artifacts?: Record<string, unknown>;
}

export interface TeamMessageInfoItem extends InfoItem {
  teamEventType: "team_message";
  kind: string;
  fromMemberId: string;
  toMemberId?: string;
  relatedTaskId?: string;
  contentPreview: string;
}

export interface TeamMemberActivityInfoItem extends InfoItem {
  teamEventType: "team_member_activity";
  memberId: string;
  memberLabel: string;
  threadId?: string;
  activityKind:
    | "reasoning"
    | "planning"
    | "plan_created"
    | "plan_step"
    | "tool_start"
    | "tool_progress"
    | "tool_end"
      | "turn_stats";
  status: "active" | "success" | "error";
  summary: string;
  durationMs?: number;
  toolCount?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface TeamPlanReviewInfoItem extends InfoItem {
  teamEventType: "team_plan_review";
  approvalId: string;
  taskId: string;
  submittedByMemberId: string;
  status: TeamApprovalStatus;
  reviewedByMemberId?: string;
}

export interface TeamShutdownInfoItem extends InfoItem {
  teamEventType: "team_shutdown";
  requestId: string;
  memberId: string;
  requestedByMemberId: string;
  status: TeamShutdownStatus;
  reason?: string;
}

export interface TeamRuntimeSnapshotInfoItem extends InfoItem {
  teamEventType: "team_runtime_snapshot";
  snapshot: TeamRuntimeSnapshot;
}

export type StructuredTeamInfoItem =
  | TeamTaskInfoItem
  | TeamMessageInfoItem
  | TeamMemberActivityInfoItem
  | TeamPlanReviewInfoItem
  | TeamShutdownInfoItem
  | TeamRuntimeSnapshotInfoItem;

export interface MemoryActivityDetail {
  action: "recalled" | "wrote" | "searched";
  text: string;
  score?: number;
  factId?: number;
}

export interface MemoryActivityItem {
  type: "memory_activity";
  id: string;
  recalled: number;
  written: number;
  searched?: { query: string; count: number };
  details: MemoryActivityDetail[];
  ts: number;
  turnId?: string;
}

/** HQL evaluation result displayed in the unified timeline */
export interface HqlEvalItem {
  type: "hql_eval";
  id: string;
  input: string;
  result: EvalResult;
  ts: number;
  turnId?: string;
}

/** Discriminated union of all renderable conversation items */
export type ConversationItem =
  | UserItem
  | AssistantItem
  | ThinkingItem
  | ToolGroupItem
  | DelegateItem
  | DelegateGroupItem
  | TurnStatsItem
  | ErrorItem
  | StructuredTeamInfoItem
  | InfoItem
  | MemoryActivityItem
  | HqlEvalItem;

export type AgentConversationItem = Exclude<ConversationItem, HqlEvalItem>;

export type ShellHistoryEntry = AgentConversationItem | HqlEvalItem;

export type DialogState =
  | { mode: "none" }
  | {
    mode: "permission";
    requestId: string;
    toolName?: string;
    toolArgs?: string;
  }
  | {
    mode: "question";
    requestId: string;
    question?: string;
  };

export function isStructuredTeamInfoItem(
  item: ConversationItem,
): item is StructuredTeamInfoItem {
  return item.type === "info" && "teamEventType" in item;
}

// ============================================================
// Conversation Streaming State
// ============================================================

/**
 * Streaming lifecycle state for conversation mode.
 * Single runtime source for spinner/footer/input/dialog behavior.
 */
export enum StreamingState {
  Idle = "idle",
  Responding = "responding",
  WaitingForConfirmation = "waiting_for_confirmation",
}
