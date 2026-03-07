import type { PermissionMode } from "../../common/config/types.ts";
import type { FinalResponseMeta, TraceEvent } from "../agent/orchestrator.ts";

export const CLAUDE_CODE_AGENT_MODE = "claude-code-agent" as const;

export type ChatMode = "chat" | "agent" | typeof CLAUDE_CODE_AGENT_MODE;

export interface ChatRequestMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  image_paths?: string[];
  client_turn_id?: string;
}

export interface ChatRequest {
  mode: ChatMode;
  session_id: string;
  messages: ChatRequestMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  client_turn_id?: string;
  assistant_client_turn_id?: string;
  expected_version?: number;
  workspace?: string;
  context_window?: number;
  permission_mode?: PermissionMode;
  skip_session_history?: boolean;
  tool_denylist?: string[];
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
  authToken: string | null;
}

export type ChatStreamEvent =
  | { event: "start"; request_id: string }
  | { event: "duplicate"; request_id: string; message: unknown }
  | { event: "token"; text: string }
  | { event: "thinking"; iteration: number }
  | { event: "thinking_update"; iteration: number; summary: string }
  | {
    event: "tool_start";
    name: string;
    args_summary: string;
    tool_index: number;
    tool_total: number;
  }
  | {
    event: "tool_end";
    name: string;
    success: boolean;
    content?: string;
    summary?: string;
    duration_ms?: number;
    args_summary: string;
    meta?: Record<string, unknown>;
    request_id?: string;
  }
  | {
    event: "interaction_request";
    request_id: string;
    mode: "permission" | "question";
    tool_name?: string;
    tool_args?: string;
    question?: string;
  }
  | { event: "turn_stats"; iteration: number; tool_count: number; duration_ms?: number }
  | { event: "trace"; trace: TraceEvent }
  | { event: "final_response_meta"; meta: FinalResponseMeta }
  | { event: "result_stats"; stats: ChatResultStats }
  | { event: "complete"; request_id: string; session_version: number }
  | { event: "error"; message: string; errorClass?: string; retryable?: boolean }
  | { event: "cancelled"; request_id: string; partial_text: string };
