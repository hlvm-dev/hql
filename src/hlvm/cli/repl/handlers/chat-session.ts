/**
 * Chat session management: request tracking, interaction handling, cancellation.
 * Extracted from chat.ts for modularity.
 */

import { LRUCache } from "../../../../common/lru-cache.ts";
import { pushSSEEvent } from "../../../store/sse-store.ts";
import { pushGuiLiveTranscriptEvent } from "../../../store/gui-live-transcript.ts";
import {
  cancelRequestMessages,
  getMessage,
  updateMessage,
} from "../../../store/conversation-store.ts";
import type { InteractionResponse } from "../../../agent/orchestrator.ts";
import type { InteractionOption } from "../../../agent/registry.ts";
import { toRuntimeSessionMessage } from "../../../runtime/session-protocol.ts";
import { jsonError, parseJsonBody } from "../http-utils.ts";
export {
  type CancelRequest,
  type ChatMode,
  type ChatRequest,
  CLAUDE_CODE_AGENT_MODE,
} from "../../../runtime/chat-protocol.ts";
import { type ChatRequest } from "../../../runtime/chat-protocol.ts";

export const TITLE_SEARCH_HISTORY_LIMIT = 40;
export const AGENT_CONTEXT_HISTORY_LIMIT = 20;
const INTERACTION_TIMEOUT_MS = 300_000;
const MAX_PENDING_INTERACTIONS = 50;
const MAX_READY_MODELS = 64;

// MARK: - Stored Properties

export const activeRequests = new Map<string, {
  controller: AbortController;
  sessionId: string;
  cancel?: () => void;
}>();
const DEFAULT_AGENT_READY_KEY = "__default__";
const agentReadyPromises = new LRUCache<string, Promise<void>>(
  MAX_READY_MODELS,
);

function getAgentReadyKey(model?: string): string {
  const trimmed = model?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_AGENT_READY_KEY;
}

export function isAgentReady(model?: string): boolean {
  if (typeof model === "string") {
    return agentReadyPromises.has(getAgentReadyKey(model));
  }
  return agentReadyPromises.size > 0;
}

export function markAgentReady(model?: string): void {
  agentReadyPromises.set(getAgentReadyKey(model), Promise.resolve());
}

export function getAgentReadyPromise(model?: string): Promise<void> | null {
  return agentReadyPromises.get(getAgentReadyKey(model)) ?? null;
}

export function setAgentReadyPromise(
  model: string | undefined,
  p: Promise<void> | null,
): void {
  const key = getAgentReadyKey(model);
  if (p) {
    agentReadyPromises.set(key, p);
  } else {
    agentReadyPromises.delete(key);
  }
}

export function __testOnlyResetAgentReadyState(): void {
  agentReadyPromises.clear();
}

export function pushConversationUpdatedEvent(
  sessionId: string,
  data: Record<string, unknown> = {},
): void {
  pushSSEEvent(sessionId, "conversation_updated", {
    session_id: sessionId,
    ...data,
  });
}

export function getLastUserMessage(
  messages: ChatRequest["messages"],
): ChatRequest["messages"][number] | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return undefined;
}

export async function emitCancellation(
  assistantMessageId: number,
  partialText: string,
  sessionId: string,
  requestId: string,
  emit: (obj: unknown) => void,
  mirrorToGuiLiveTranscript = false,
): Promise<void> {
  const cancelled = cancelRequestMessages(sessionId, requestId, {
    assistantMessageId,
    assistantContent: partialText,
  });
  if (cancelled === 0) {
    updateMessage(assistantMessageId, {
      cancelled: true,
      content: partialText,
    });
  }
  const updatedAssistant = getMessage(assistantMessageId);
  const runtimeMessage = updatedAssistant
    ? await toRuntimeSessionMessage(updatedAssistant)
    : {
      id: assistantMessageId,
      content: partialText,
      cancelled: true,
    };
  pushSSEEvent(sessionId, "message_updated", {
    message: runtimeMessage,
  });
  if (mirrorToGuiLiveTranscript) {
    pushGuiLiveTranscriptEvent("message_updated", {
      message: runtimeMessage,
    });
  }
  pushConversationUpdatedEvent(sessionId);
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
    toolInput?: unknown;
    question?: string;
    options?: InteractionOption[];
    sourceLabel?: string;
    sourceThreadId?: string;
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
    tool_input: event.toolInput,
    question: event.question,
    options: event.options,
    source_label: event.sourceLabel,
    source_thread_id: event.sourceThreadId,
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
