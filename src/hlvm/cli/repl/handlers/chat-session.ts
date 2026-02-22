/**
 * Chat session management: request tracking, interaction handling, cancellation.
 * Extracted from chat.ts for modularity.
 */

import {
  pushSSEEvent,
  SESSIONS_CHANNEL,
} from "../../../store/sse-store.ts";
import {
  updateMessage,
} from "../../../store/conversation-store.ts";
import type { InteractionResponse } from "../../../agent/orchestrator.ts";
import { jsonError, parseJsonBody } from "../http-utils.ts";

export const CHAT_CONTEXT_HISTORY_LIMIT = 80;
export const TITLE_SEARCH_HISTORY_LIMIT = 40;
export const AGENT_CONTEXT_HISTORY_LIMIT = 20;
const INTERACTION_TIMEOUT_MS = 300_000;
const MAX_PENDING_INTERACTIONS = 50;

/** Mode string for Claude Code full agent passthrough */
export const CLAUDE_CODE_AGENT_MODE = "claude-code-agent" as const;

export type ChatMode = "chat" | "agent" | typeof CLAUDE_CODE_AGENT_MODE;

export interface ChatRequest {
  mode: ChatMode;
  session_id: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    image_paths?: string[];
    client_turn_id?: string;
  }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  client_turn_id?: string;
  assistant_client_turn_id?: string;
  expected_version?: number;
}

export interface CancelRequest {
  request_id: string;
}

// MARK: - Stored Properties

export const activeRequests = new Map<string, {
  controller: AbortController;
  sessionId: string;
  cancel?: () => void;
}>();
let agentReadyPromise: Promise<void> | null = null;

export function isAgentReady(): boolean {
  return agentReadyPromise !== null;
}

export function markAgentReady(): void {
  if (!agentReadyPromise) {
    agentReadyPromise = Promise.resolve();
  }
}

export function getAgentReadyPromise(): Promise<void> | null {
  return agentReadyPromise;
}

export function setAgentReadyPromise(p: Promise<void> | null): void {
  agentReadyPromise = p;
}

export function pushSessionUpdatedEvent(sessionId: string): void {
  pushSSEEvent(SESSIONS_CHANNEL, "session_updated", { session_id: sessionId });
}

export function getLastUserMessage(
  messages: ChatRequest["messages"],
): ChatRequest["messages"][number] | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return undefined;
}

export function cancelSessionRequests(sessionId: string): number {
  let count = 0;
  for (const [requestId, entry] of activeRequests) {
    if (entry.sessionId !== sessionId) continue;

    if (entry.cancel) {
      entry.cancel();
    } else {
      entry.controller.abort();
    }

    activeRequests.delete(requestId);
    count++;
  }
  return count;
}

export function handleSessionCancel(sessionId: string): Response {
  const count = cancelSessionRequests(sessionId);
  return Response.json({
    cancelled: count > 0,
    session_id: sessionId,
    cancelled_count: count,
  });
}

export function emitCancellation(
  assistantMessageId: number,
  partialText: string,
  sessionId: string,
  requestId: string,
  emit: (obj: unknown) => void,
): void {
  updateMessage(assistantMessageId, { cancelled: true, content: partialText });
  pushSSEEvent(sessionId, "message_updated", {
    id: assistantMessageId,
    content: partialText,
    cancelled: true,
  });
  pushSessionUpdatedEvent(sessionId);
  emit({
    event: "cancelled",
    request_id: requestId,
    partial_text: partialText,
  });
}

// MARK: - Pending Interactions (GUI permission/question flow)

const pendingInteractions = new Map<string, {
  resolve: (response: InteractionResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

/** POST /api/chat/interaction — Resolve a pending interaction request from the GUI */
export async function handleChatInteraction(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<{
    request_id?: string;
    approved?: boolean;
    remember_choice?: boolean;
    user_input?: string;
  }>(req);
  if (!parsed.ok) return parsed.response;

  const { request_id, approved, remember_choice, user_input } = parsed.value;
  if (!request_id) return jsonError("Missing request_id", 400);

  const pending = pendingInteractions.get(request_id);
  if (!pending) return jsonError("No pending interaction with that ID", 404);

  clearTimeout(pending.timer);
  pendingInteractions.delete(request_id);
  pending.resolve({
    approved: approved === true,
    rememberChoice: remember_choice,
    userInput: user_input,
  });

  return Response.json({ ok: true });
}

export function awaitInteractionResponse(
  event: {
    requestId: string;
    mode: "permission" | "question";
    toolName?: string;
    toolArgs?: string;
    question?: string;
  },
  signal: AbortSignal,
  emit: (obj: unknown) => void,
): Promise<InteractionResponse> {
  emit({
    event: "interaction_request",
    request_id: event.requestId,
    mode: event.mode,
    tool_name: event.toolName,
    tool_args: event.toolArgs,
    question: event.question,
  });

  return new Promise<InteractionResponse>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finalize = (response: InteractionResponse) => {
      if (done) return;
      done = true;
      pendingInteractions.delete(event.requestId);
      if (timer) {
        clearTimeout(timer);
      }
      signal.removeEventListener("abort", onAbort);
      resolve(response);
    };

    const onAbort = () => {
      finalize({ approved: false });
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    if (pendingInteractions.size >= MAX_PENDING_INTERACTIONS) {
      finalize({ approved: false });
      return;
    }

    timer = setTimeout(() => {
      finalize({ approved: false });
    }, INTERACTION_TIMEOUT_MS);

    pendingInteractions.set(event.requestId, {
      resolve: (response) => finalize(response),
      timer,
    });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
