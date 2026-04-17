import type { AgentExecutionMode } from "../agent/execution-mode.ts";
import type { FinalResponseMeta, TraceEvent } from "../agent/orchestrator.ts";
import type { Plan, PlanningPhase } from "../agent/planning.ts";
import type { InteractionOption } from "../agent/registry.ts";
import type { TodoState } from "../agent/todo-state.ts";

export const CLAUDE_CODE_AGENT_MODE = "claude-code-agent" as const;

export type ChatMode =
  | "chat"
  | "eval"
  | "agent"
  | typeof CLAUDE_CODE_AGENT_MODE;

export interface ChatRequestMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  display_content?: string;
  attachment_ids?: string[];
  client_turn_id?: string;
}

export interface ChatRequestCapturedContext {
  source: string;
  name: string;
  detail?: string;
  metadata?: Record<string, string>;
}

export interface ChatRequest {
  mode?: ChatMode;
  query_source?: string;
  stateless?: boolean;
  messages: ChatRequestMessage[];
  model?: string;
  fixture_path?: string;
  temperature?: number;
  max_tokens?: number;
  client_turn_id?: string;
  assistant_client_turn_id?: string;
  captured_contexts?: ChatRequestCapturedContext[];
  expected_version?: number;
  context_window?: number;
  permission_mode?: AgentExecutionMode;
  skip_session_history?: boolean;
  disable_persistent_memory?: boolean;
  tool_allowlist?: string[];
  tool_denylist?: string[];
  max_iterations?: number;
  response_schema?: Record<string, unknown>;
  computer_use?: boolean;
  trace?: boolean;
}

export interface CancelRequest {
  request_id: string;
}

export interface InteractionResponseRequest {
  request_id: string;
  approved?: boolean;
  remember_choice?: boolean;
  user_input?: string;
}

export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: "provider" | "estimated";
}

export interface ChatResultStats {
  messageCount: number;
  estimatedTokens: number;
  toolMessages: number;
  usage?: UsageSnapshot;
}

export interface HostHealthResponse {
  status: "ok";
  initialized: boolean;
  definitions: number;
  aiReady: boolean;
  aiReadyReason?: string | null;
  aiReadyRetryable?: boolean;
  version: string;
  buildId: string;
  authToken: string | null;
  /** Actual port the server is listening on (may differ from default on port-0 fallback) */
  port?: number | null;
}

export type ChatStreamEvent =
  | { event: "start"; request_id: string }
  | { event: "duplicate"; request_id: string; message: unknown }
  | { event: "token"; text: string }
  | { event: "thinking"; iteration: number }
  | { event: "reasoning_update"; iteration: number; summary: string }
  | { event: "planning_update"; iteration: number; summary: string }
  | {
    event: "structured_result";
    result: unknown;
  }
  | {
    event: "tool_start";
    name: string;
    tool_call_id?: string;
    args_summary: string;
    tool_index: number;
    tool_total: number;
  }
  | {
    event: "tool_progress";
    name: string;
    tool_call_id?: string;
    args_summary: string;
    message: string;
    tone: "running" | "success" | "warning";
    phase?: string;
  }
  | {
    event: "tool_end";
    name: string;
    tool_call_id?: string;
    success: boolean;
    content?: string;
    summary?: string;
    duration_ms?: number;
    args_summary: string;
    meta?: Record<string, unknown>;
    request_id?: string;
  }
  | {
    event: "agent_spawn";
    agent_id: string;
    agent_type: string;
    description: string;
    is_async: boolean;
  }
  | {
    event: "agent_progress";
    agent_id: string;
    agent_type: string;
    tool_use_count: number;
    duration_ms: number;
  }
  | {
    event: "agent_complete";
    agent_id: string;
    agent_type: string;
    success: boolean;
    duration_ms: number;
    tool_use_count: number;
    total_tokens?: number;
    result_preview?: string;
    transcript?: string;
  }
  | {
    event: "todo_updated";
    todo_state: TodoState;
    source: "tool" | "plan";
  }
  | { event: "plan_phase_changed"; phase: PlanningPhase }
  | { event: "plan_created"; plan: Plan }
  | { event: "plan_step"; step_id: string; index: number; completed: boolean }
  | { event: "plan_review_required"; plan: Plan }
  | {
    event: "plan_review_resolved";
    plan: Plan;
    approved: boolean;
    decision?: "approved" | "revise" | "cancelled";
  }
  | {
    event: "interaction_request";
    request_id: string;
    mode: "permission" | "question";
    tool_name?: string;
    tool_args?: string;
    question?: string;
    options?: InteractionOption[];
    source_label?: string;
    source_thread_id?: string;
  }
  | {
    event: "turn_stats";
    iteration: number;
    tool_count: number;
    duration_ms?: number;
    input_tokens?: number;
    output_tokens?: number;
    model_id?: string;
    cost_usd?: number;
    cost_estimated?: boolean;
    continued_this_turn?: boolean;
    continuation_count?: number;
    compaction_reason?: "proactive_pressure" | "overflow_retry";
  }
  | { event: "trace"; trace: TraceEvent }
  | { event: "final_response_meta"; meta: FinalResponseMeta }
  | { event: "result_stats"; stats: ChatResultStats }
  | { event: "complete"; request_id: string; session_version: number }
  | {
    event: "error";
    message: string;
    errorClass?: string;
    retryable?: boolean;
  }
  | { event: "cancelled"; request_id: string; partial_text: string }
  | { event: "heartbeat" };
