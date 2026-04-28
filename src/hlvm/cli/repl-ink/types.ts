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
import type { TracePresentationTone } from "../../agent/trace-presentation.ts";

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

export interface SkillActivityInput {
  name: string;
  source?: string;
  filePath?: string;
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
  continuedThisTurn?: boolean;
  continuationCount?: number;
  compactionReason?: "proactive_pressure" | "overflow_retry";
  status: TurnCompletionStatus;
  summary?: string;
  activityTrail?: string[];
  turnId?: string;
}

/** Error message */
export interface ErrorItem {
  type: "error";
  id: string;
  text: string;
  turnId?: string;
  errorClass?: string;
  hint?: string | null;
  retryable?: boolean;
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

export interface DebugTraceItem {
  type: "debug_trace";
  id: string;
  text: string;
  depth: number;
  tone: TracePresentationTone;
  ts: number;
  turnId?: string;
}

export interface MemoryUpdatedItem {
  type: "memory_updated";
  id: string;
  /** Absolute path of the memory file that was just written/edited. */
  path: string;
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
  | TurnStatsItem
  | ErrorItem
  | InfoItem
  | DebugTraceItem
  | MemoryUpdatedItem
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
