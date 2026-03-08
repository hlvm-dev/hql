import type { Message as AgentMessage } from "./context.ts";
import { deriveDefaultSessionKey } from "../runtime/session-key.ts";
import {
  getOrCreateSession,
  getSession,
  insertMessage,
  updateSession,
} from "../store/conversation-store.ts";
import { loadAllMessages } from "../store/message-utils.ts";
import { buildStoredAgentHistoryMessages } from "../cli/repl/handlers/chat-context.ts";

const DEFAULT_TITLE_LENGTH = 60;

export interface PersistedAgentTurn {
  sessionId: string;
  requestId: string;
}

export function getPersistedAgentSessionId(): string {
  return deriveDefaultSessionKey();
}

export async function loadPersistedAgentHistory(options: {
  model: string;
  maxGroups: number;
}): Promise<{ sessionId: string; history: AgentMessage[] }> {
  const sessionId = getPersistedAgentSessionId();
  getOrCreateSession(sessionId);

  const history = await buildStoredAgentHistoryMessages({
    storedMessages: loadAllMessages(sessionId),
    maxGroups: options.maxGroups,
    modelKey: options.model,
  });

  return { sessionId, history };
}

export function startPersistedAgentTurn(
  sessionId: string,
  query: string,
): PersistedAgentTurn {
  const requestId = crypto.randomUUID();
  getOrCreateSession(sessionId);
  ensureDefaultTitle(sessionId, query);
  insertMessage({
    session_id: sessionId,
    role: "user",
    content: query,
    request_id: requestId,
    sender_type: "user",
  });
  return { sessionId, requestId };
}

export function appendPersistedAgentToolResult(
  turn: PersistedAgentTurn,
  toolName: string,
  content: string,
): void {
  insertMessage({
    session_id: turn.sessionId,
    role: "tool",
    content,
    request_id: turn.requestId,
    sender_type: "agent",
    tool_name: toolName,
  });
}

export function completePersistedAgentTurn(
  turn: PersistedAgentTurn,
  model: string,
  content: string,
): void {
  insertMessage({
    session_id: turn.sessionId,
    role: "assistant",
    content,
    request_id: turn.requestId,
    sender_type: "agent",
    sender_detail: model,
  });
}

function ensureDefaultTitle(sessionId: string, query: string): void {
  const session = getSession(sessionId);
  if (!session || session.title.length > 0) return;

  const title = query.slice(0, DEFAULT_TITLE_LENGTH).replace(/\n/g, " ").trim();
  if (!title) return;
  updateSession(sessionId, { title });
}
