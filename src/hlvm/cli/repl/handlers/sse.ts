/**
 * SSE Handler
 *
 * Server-Sent Events streams for durable sessions and the live GUI transcript.
 * Supports Last-Event-ID for reconnect replay.
 */

import { getSession } from "../../../store/conversation-store.ts";
import {
  nextSSEEventId,
  replayAfter,
  subscribe,
} from "../../../store/sse-store.ts";
import { GUI_LIVE_TRANSCRIPT_SESSION_ID } from "../../../store/gui-live-transcript.ts";
import { loadAllMessages } from "../../../store/message-utils.ts";
import { toRuntimeSessionMessage } from "../../../runtime/session-protocol.ts";
import type { RouteParams } from "../http-router.ts";
import { createSSEResponse, formatSSE, jsonError } from "../http-utils.ts";

/**
 * @openapi
 * /api/chat/stream:
 *   get:
 *     tags: [Chat]
 *     summary: SSE stream for the live GUI transcript
 *     operationId: streamActiveConversation
 *     description: |
 *       Server-Sent Events stream for the macOS GUI live transcript.
 *       The initial snapshot is intentionally empty so app launch does not
 *       render durable history.
 *       Events: snapshot, message_added, message_updated, message_deleted,
 *       conversation_updated. Supports Last-Event-ID for replay.
 *     parameters:
 *       - in: header
 *         name: Last-Event-ID
 *         schema:
 *           type: string
 *         description: Resume from this event ID on reconnect.
 *     responses:
 *       '200':
 *         description: SSE event stream.
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *         x-response-type: stream
 */
export function handleSSEStream(
  req: Request,
  params: RouteParams,
): Response {
  const sessionId = params.id;
  const session = getSession(sessionId);
  if (!session) return jsonError("Session not found", 404);

  const lastEventId = req.headers.get("Last-Event-ID");

  return createSSEResponse(req, (emit) => {
    let isReady = false;
    let closed = false;
    let pendingEvents: string[] = [];
    const unsubscribe = subscribe(sessionId, (event) => {
      const formatted = formatSSE(event);
      if (closed) {
        return;
      }
      if (isReady) {
        emit(formatted);
      } else {
        pendingEvents.push(formatted);
      }
    });

    void (async () => {
      const replay = replayAfter(sessionId, lastEventId);

      if (!lastEventId || replay.gapDetected) {
        const messages = await Promise.all(
          loadAllMessages(sessionId).map((message) =>
            toRuntimeSessionMessage(message)
          ),
        );
        const freshSession = getSession(sessionId);
        const snapshotVersion = freshSession?.session_version ??
          session.session_version;
        emit(formatSSE({
          id: nextSSEEventId(sessionId),
          event_type: "snapshot",
          data: {
            messages,
            session_version: snapshotVersion,
          },
        }));
      } else {
        for (const event of replay.events) {
          emit(formatSSE(event));
        }
      }

      isReady = true;
      for (const event of pendingEvents) {
        emit(event);
      }
      pendingEvents = [];
    })();

    return () => {
      closed = true;
      pendingEvents = [];
      unsubscribe();
    };
  });
}

export function handleActiveConversationStream(req: Request): Response {
  return createSSEResponse(req, (emit) => {
    let isReady = false;
    let closed = false;
    let pendingEvents: string[] = [];
    const lastEventId = req.headers.get("Last-Event-ID");
    const sessionId = GUI_LIVE_TRANSCRIPT_SESSION_ID;
    const unsubscribe = subscribe(sessionId, (event) => {
      const formatted = formatSSE(event);
      if (closed) return;
      if (isReady) {
        emit(formatted);
      } else {
        pendingEvents.push(formatted);
      }
    });

    void (async () => {
      const replay = replayAfter(sessionId, lastEventId);

      if (!lastEventId || replay.gapDetected) {
        emit(formatSSE({
          id: nextSSEEventId(sessionId),
          event_type: "snapshot",
          data: {
            messages: [],
            session_version: 0,
          },
        }));
      } else {
        for (const event of replay.events) {
          emit(formatSSE(event));
        }
      }

      isReady = true;
      for (const event of pendingEvents) {
        emit(event);
      }
      pendingEvents = [];
    })();

    return () => {
      closed = true;
      pendingEvents = [];
      unsubscribe();
    };
  });
}
