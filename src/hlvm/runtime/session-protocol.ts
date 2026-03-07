import type { MessageRow, PagedMessages } from "../store/types.ts";

export interface RuntimeSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  session_version: number;
  metadata?: string | null;
}

export interface RuntimeSessionsResponse {
  sessions: RuntimeSession[];
}

export type RuntimeSessionMessage = MessageRow;
export type RuntimeSessionMessagesResponse = PagedMessages;

export interface RuntimeSessionMessageInput {
  role: MessageRow["role"];
  content: string;
  client_turn_id?: string;
  sender_type?: string;
  image_paths?: string[];
}
