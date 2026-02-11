/**
 * SSE Handler
 *
 * Server-Sent Events stream for real-time session updates.
 * Supports Last-Event-ID for reconnect replay.
 */

import { getSession } from "../../../store/conversation-store.ts";
import { subscribe, replayAfter } from "../../../store/sse-store.ts";
import { loadAllMessages } from "../../../store/message-utils.ts";
import type { SSEEvent } from "../../../store/types.ts";
import type { RouteParams } from "../http-router.ts";
import { jsonError } from "../http-utils.ts";

function formatSSE(event: SSEEvent): string {
  return `id: ${event.id}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export function handleSSEStream(
  req: Request,
  params: RouteParams,
): Response {
  const sessionId = params.id;
  const session = getSession(sessionId);
  if (!session) return jsonError("Session not found", 404);

  const lastEventId = req.headers.get("Last-Event-ID");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("retry: 3000\n\n"));

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
        controller.enqueue(encoder.encode(
          `id: ${snapshotId}\nevent: snapshot\ndata: ${snapshotData}\n\n`
        ));
      } else {
        for (const event of replay.events) {
          controller.enqueue(encoder.encode(formatSSE(event)));
        }
      }

      const unsubscribe = subscribe(sessionId, (event) => {
        try {
          controller.enqueue(encoder.encode(formatSSE(event)));
        } catch {
          // Stream closed
        }
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      req.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
