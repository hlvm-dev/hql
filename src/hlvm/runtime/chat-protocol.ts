import type { AgentExecutionMode } from "../agent/execution-mode.ts";
import type {
  CapabilityRoutingDecision,
  ExecutionFallbackState,
  ExecutionSurfaceLocalModelSummary,
  ExecutionSurfaceMcpServerSummary,
  ExecutionSurfaceProviderSummary,
} from "../agent/execution-surface.ts";
import type { FinalResponseMeta, TraceEvent } from "../agent/orchestrator.ts";
import type { Plan, PlanningPhase } from "../agent/planning.ts";
import type { RoutingConstraintSet } from "../agent/routing-constraints.ts";
import type { InteractionOption } from "../agent/registry.ts";
import type { RuntimeMode } from "../agent/runtime-mode.ts";
import type { DelegateTranscriptSnapshot } from "../agent/delegate-transcript.ts";
import type { DelegateBatchSnapshot } from "../agent/delegate-batches.ts";
import type { TodoState } from "../agent/todo-state.ts";
import type { ExecutionResponseShapeContext } from "../agent/response-shape-context.ts";
import type { ExecutionTaskCapabilityContext } from "../agent/task-capability-context.ts";
import type { ExecutionTurnContext } from "../agent/turn-context.ts";

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

export interface ChatRequest {
  mode: ChatMode;
  session_id?: string;
  stateless?: boolean;
  messages: ChatRequestMessage[];
  model?: string;
  fixture_path?: string;
  temperature?: number;
  max_tokens?: number;
  client_turn_id?: string;
  assistant_client_turn_id?: string;
  expected_version?: number;
  context_window?: number;
  permission_mode?: AgentExecutionMode;
  runtime_mode?: RuntimeMode;
  skip_session_history?: boolean;
  disable_persistent_memory?: boolean;
  tool_allowlist?: string[];
  tool_denylist?: string[];
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
  version: string;
  buildId: string;
  authToken: string | null;
  /** Actual port the server is listening on (may differ from default on port-0 fallback) */
  port?: number | null;
}

export interface RuntimeExecutionSurfaceResponse {
  session_id: string;
  runtime_mode: RuntimeMode;
  active_model_id?: string;
  pinned_provider_name: string;
  strategy: string;
  signature: string;
  constraints: RoutingConstraintSet;
  task_capability_context: ExecutionTaskCapabilityContext;
  response_shape_context: ExecutionResponseShapeContext;
  turn_context: ExecutionTurnContext;
  fallback_state: ExecutionFallbackState;
  providers: ExecutionSurfaceProviderSummary[];
  local_model_summary: ExecutionSurfaceLocalModelSummary;
  mcp_servers: ExecutionSurfaceMcpServerSummary[];
  capabilities: Record<string, CapabilityRoutingDecision>;
}

export type ChatStreamEvent =
  | { event: "start"; request_id: string }
  | { event: "duplicate"; request_id: string; message: unknown }
  | { event: "token"; text: string }
  | { event: "thinking"; iteration: number }
  | { event: "reasoning_update"; iteration: number; summary: string }
  | { event: "planning_update"; iteration: number; summary: string }
  | {
    event: "capability_routed";
    route_phase: "turn-start" | "tool-start" | "fallback";
    runtime_mode: RuntimeMode;
    family_id: string;
    capability_id: string;
    strategy: string;
    selected_backend_kind?: string;
    selected_tool_name?: string;
    selected_server_name?: string;
    provider_name: string;
    fallback_reason?: string;
    route_changed_by_failure?: boolean;
    failed_backend_kind?: string;
    failed_tool_name?: string;
    failed_server_name?: string;
    failure_reason?: string;
    summary: string;
    candidates: Array<{
      family_id: string;
      capability_id: string;
      backend_kind: string;
      label: string;
      tool_name?: string;
      provider_name?: string;
      server_name?: string;
      reachable: boolean;
      allowed: boolean;
      selected: boolean;
      reason?: string;
      blocked_reasons?: string[];
    }>;
  }
  | {
    event: "reasoning_routed";
    selected_model_id: string;
    selected_provider_name: string;
    reason: string;
    switched_from_pinned: boolean;
  }
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
    event: "delegate_start";
    agent: string;
    task: string;
    thread_id?: string;
    nickname?: string;
    child_session_id?: string;
    batch_id?: string;
  }
  | {
    event: "delegate_running";
    thread_id: string;
  }
  | {
    event: "delegate_end";
    agent: string;
    task: string;
    success: boolean;
    summary?: string;
    duration_ms?: number;
    error?: string;
    snapshot?: DelegateTranscriptSnapshot;
    child_session_id?: string;
    thread_id?: string;
    batch_id?: string;
  }
  | {
    event: "todo_updated";
    todo_state: TodoState;
    source: "tool" | "plan" | "team";
  }
  | {
    event: "team_task_updated";
    task_id: string;
    goal: string;
    status: string;
    assignee_member_id?: string;
  }
  | {
    event: "team_message";
    kind: string;
    from_member_id: string;
    to_member_id?: string;
    related_task_id?: string;
    content_preview: string;
  }
  | {
    event: "team_member_activity";
    member_id: string;
    member_label: string;
    thread_id?: string;
    activity_kind:
      | "reasoning"
      | "planning"
      | "plan_created"
      | "plan_step"
      | "tool_start"
      | "tool_progress"
      | "tool_end"
      | "turn_stats";
    summary: string;
    status: "active" | "success" | "error";
  }
  | {
    event: "team_plan_review_required";
    approval_id: string;
    task_id: string;
    submitted_by_member_id: string;
  }
  | {
    event: "team_plan_review_resolved";
    approval_id: string;
    task_id: string;
    submitted_by_member_id: string;
    approved: boolean;
    reviewed_by_member_id?: string;
  }
  | {
    event: "team_shutdown_requested";
    request_id: string;
    member_id: string;
    requested_by_member_id: string;
    reason?: string;
  }
  | {
    event: "team_shutdown_resolved";
    request_id: string;
    member_id: string;
    requested_by_member_id: string;
    status: "acknowledged" | "forced";
  }
  | {
    event: "batch_progress_updated";
    snapshot: DelegateBatchSnapshot;
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
    source_member_id?: string;
    source_thread_id?: string;
    source_team_name?: string;
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
