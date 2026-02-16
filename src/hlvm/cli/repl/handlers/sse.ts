/**
 * SSE Handler
 *
 * Server-Sent Events stream for real-time session updates.
 * Supports Last-Event-ID for reconnect replay.
 */

import { getSession } from "../../../store/conversation-store.ts";
import { subscribe, replayAfter } from "../../../store/sse-store.ts";
import { loadAllMessages } from "../../../store/message-utils.ts";
import type { RouteParams } from "../http-router.ts";
import { jsonError, formatSSE, createSSEResponse } from "../http-utils.ts";

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
      const snapshotData = JSON.stringify({
        messages,
        session_version: snapshotVersion,
      });
      const snapshotId = String(snapshotVersion);
      emit(`id: ${snapshotId}\nevent: snapshot\ndata: ${snapshotData}\n\n`);
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
