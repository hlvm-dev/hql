/**
 * SSE Handler
 *
 * Server-Sent Events stream for real-time session updates.
 * Supports Last-Event-ID for reconnect replay.
 */

import { getSession } from "../../../store/conversation-store.ts";
import { subscribe, replayAfter, nextSSEEventId } from "../../../store/sse-store.ts";
import { loadAllMessages } from "../../../store/message-utils.ts";
import type { RouteParams } from "../http-router.ts";
import { jsonError, formatSSE, createSSEResponse } from "../http-utils.ts";

/**
 * @openapi
 * /api/sessions/{id}/stream:
 *   get:
 *     tags: [Sessions]
 *     summary: SSE stream for a single session
 *     operationId: streamSession
 *     description: |
 *       Server-Sent Events stream for real-time session updates.
 *       Events: snapshot, message_added, message_updated, message_deleted,
 *       session_updated, session_deleted. Supports Last-Event-ID for replay.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID.
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
 *       '404':
 *         description: Session not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
    const replay = replayAfter(sessionId, lastEventId);

    if (replay.gapDetected) {
      const messages = loadAllMessages(sessionId);
      const freshSession = getSession(sessionId);
      const snapshotVersion = freshSession?.session_version ?? session.session_version;
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

    const unsubscribe = subscribe(sessionId, (event) => {
      emit(formatSSE(event));
    });
    return unsubscribe;
  });
}
