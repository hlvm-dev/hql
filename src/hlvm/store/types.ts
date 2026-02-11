/**
 * Shared Store Types
 *
 * Type definitions for the SQLite conversation store.
 * Used by conversation-store, sse-store, and HTTP handlers.
 */

export interface SessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  session_version: number;
  metadata: string | null;
}

export interface MessageRow {
  id: number;
  session_id: string;
  order: number;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  client_turn_id: string | null;
  request_id: string | null;
  sender_type: string;
  sender_detail: string | null;
  image_paths: string | null;
  tool_calls: string | null;
  tool_name: string | null;
  tool_call_id: string | null;
  cancelled: number;
  created_at: string;
}

export interface InsertMessageOpts {
  session_id: string;
  role: MessageRow["role"];
  content: string;
  client_turn_id?: string;
  request_id?: string;
  sender_type?: string;
  sender_detail?: string;
  image_paths?: string[];
  tool_calls?: unknown[];
  tool_name?: string;
  tool_call_id?: string;
  created_at?: string;
}

export interface PageOpts {
  limit?: number;
  offset?: number;
  sort?: "asc" | "desc";
  after_order?: number;
}

export interface PagedMessages {
  messages: MessageRow[];
  total: number;
  has_more: boolean;
  session_version: number;
  cursor?: number;
}

export interface SSEEvent {
  id: string;
  session_id: string;
  event_type: string;
  data: unknown;
  created_at: string;
}
