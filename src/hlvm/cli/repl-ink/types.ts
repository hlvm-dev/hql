/**
 * HLVM Ink REPL - Type Definitions
 *
 * Re-exports + conversation display types for the REPL agent UI.
 * These types bridge AgentUIEvent (from orchestrator) → renderable UI items.
 */

// Re-export EvalResult from evaluator.ts (used by Output, App, useRepl)
export type { EvalResult } from "../repl/evaluator.ts";
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
  name: string;
  argsSummary: string;
  status: "pending" | "running" | "success" | "error";
  resultSummaryText?: string;
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

/** User message in the conversation */
export interface UserItem {
  type: "user";
  id: string;
  text: string;
  ts: number;
}

/** Assistant (model) response — may be streaming */
export interface AssistantItem {
  type: "assistant";
  id: string;
  text: string;
  citations?: AssistantCitation[];
  isPending: boolean;
  ts: number;
}

/** Thinking/reasoning indicator */
export interface ThinkingItem {
  type: "thinking";
  id: string;
  summary: string;
  iteration: number;
}

/** Group of tool calls executed together */
export interface ToolGroupItem {
  type: "tool_group";
  id: string;
  tools: ToolCallDisplay[];
  ts: number;
}

/** Turn completion statistics */
export interface TurnStatsItem {
  type: "turn_stats";
  id: string;
  toolCount: number;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
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
}

/** Error message */
export interface ErrorItem {
  type: "error";
  id: string;
  text: string;
}

/** Informational message */
export interface InfoItem {
  type: "info";
  id: string;
  text: string;
  isTransient?: boolean;
  ts?: number;
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
  | TeamPlanReviewInfoItem
  | TeamShutdownInfoItem
  | TeamRuntimeSnapshotInfoItem;

/** Discriminated union of all renderable conversation items */
export type ConversationItem =
  | UserItem
  | AssistantItem
  | ThinkingItem
  | ToolGroupItem
  | DelegateItem
  | TurnStatsItem
  | ErrorItem
  | StructuredTeamInfoItem
  | InfoItem;

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
