/**
 * SSE Handler
 *
 * Server-Sent Events stream for the macOS GUI live transcript.
 * Supports Last-Event-ID for reconnect replay.
 */

import {
  nextSSEEventId,
  replayAfter,
  subscribe,
} from "../../../store/sse-store.ts";
import { GUI_LIVE_TRANSCRIPT_SESSION_ID } from "../../../store/gui-live-transcript.ts";
import { createSSEResponse, formatSSE } from "../http-utils.ts";

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
export function handleActiveConversationStream(req: Request): Response {
  return createSSEResponse(req, (emit) => {
    let isReady = false;
    let closed = false;
    let pendingEvents: string[] = [];
    const lastEventId = req.headers.get("Last-Event-ID");
    const sessionId = GUI_LIVE_TRANSCRIPT_SESSION_ID;
    const unsubscribe = subscribe(sessionId, (event) => {
      if (closed) return;
      const formatted = formatSSE(event);
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
          data: { messages: [], session_version: 0 },
        }));
      } else {
        for (const event of replay.events) emit(formatSSE(event));
      }

      isReady = true;
      for (const event of pendingEvents) emit(event);
      pendingEvents = [];
    })();

    return () => {
      closed = true;
      pendingEvents = [];
      unsubscribe();
    };
  });
}
