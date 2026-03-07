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
