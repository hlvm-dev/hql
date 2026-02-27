/**
 * Companion Agent — HTTP Handlers
 *
 * POST /api/companion/observe — ingest observations
 * GET  /api/companion/stream  — SSE stream of companion events
 * POST /api/companion/respond — respond to action requests
 * GET  /api/companion/status  — current state
 * POST /api/companion/config  — enable/disable companion
 */

import { parseJsonBody, jsonError, createSSEResponse, formatSSE } from "../http-utils.ts";
import { subscribe, replayAfter } from "../../../store/sse-store.ts";
import {
  getCompanionBus,
  isCompanionRunning,
  getCompanionState,
  getCompanionConfig,
  startCompanion,
  stopCompanion,
  COMPANION_CHANNEL,
  resolveCompanionResponse,
} from "../../../companion/mod.ts";
import type { CompanionEvent } from "../../../companion/types.ts";
import type { Observation, CompanionResponse, CompanionConfig } from "../../../companion/mod.ts";

/** POST /api/companion/observe */
export async function handleCompanionObserve(req: Request): Promise<Response> {
  const bus = getCompanionBus();
  if (!bus) return jsonError("Companion not running", 503);

  const parsed = await parseJsonBody<Observation | Observation[]>(req);
  if (!parsed.ok) return parsed.response;

  const observations = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
  let queued = 0;
  for (const obs of observations) {
    if (bus.append(obs)) queued++;
  }

  return new Response(JSON.stringify({ queued }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}

/** GET /api/companion/stream */
export function handleCompanionStream(req: Request): Response {
  const lastEventId = req.headers.get("Last-Event-ID");
  const parsedLastEventId = lastEventId ? Number.parseInt(lastEventId, 10) : NaN;
  const initialSSEId = Number.isNaN(parsedLastEventId) ? "0" : String(parsedLastEventId);

  return createSSEResponse(req, (emit) => {
    // Initial state sync — lets clients know the backend is reachable
    // and what the current companion state is. This is the event that
    // breaks the startup chicken-and-egg: Swift defers setEnabled() until
    // it receives proof the backend is up, and this event provides it.
    const initialEvent: CompanionEvent = {
      type: "status_change",
      content: getCompanionState(),
      id: `comp-init-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    emit(formatSSE({
      id: initialSSEId,
      event_type: "companion_event",
      data: initialEvent,
    }));

    // Replay missed events
    const replay = replayAfter(COMPANION_CHANNEL, lastEventId);
    if (replay.gapDetected) {
      const gapSSEId = Number.isNaN(parsedLastEventId)
        ? String(Date.now())
        : String(parsedLastEventId + 1);
      emit(formatSSE({
        id: gapSSEId,
        event_type: "companion_event",
        data: {
          type: "status_change",
          content: "replay_gap_detected",
          timestamp: new Date().toISOString(),
          id: `comp-gap-${Date.now()}`,
        },
      }));
    }
    for (const event of replay.events) {
      emit(formatSSE(event));
    }

    // Subscribe to live events
    const unsubscribe = subscribe(COMPANION_CHANNEL, (event) => {
      emit(formatSSE(event));
    });
    return unsubscribe;
  });
}

/** POST /api/companion/respond */
export async function handleCompanionRespond(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<CompanionResponse>(req);
  if (!parsed.ok) return parsed.response;

  if (!parsed.value.eventId) {
    return jsonError("Missing eventId", 400);
  }

  const resolved = resolveCompanionResponse(parsed.value);
  return new Response(JSON.stringify({ resolved }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** GET /api/companion/status */
export function handleCompanionStatus(): Response {
  return new Response(
    JSON.stringify({
      state: getCompanionState(),
      running: isCompanionRunning(),
      config: getCompanionConfig(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** POST /api/companion/config */
export async function handleCompanionConfig(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<Partial<CompanionConfig>>(req);
  if (!parsed.ok) return parsed.response;

  const update = parsed.value;

  if (update.enabled === true && !isCompanionRunning()) {
    startCompanion(update);
    return new Response(
      JSON.stringify({ status: "started", config: getCompanionConfig() }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (update.enabled === false && isCompanionRunning()) {
    stopCompanion();
    return new Response(
      JSON.stringify({ status: "stopped", config: getCompanionConfig() }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ status: "unchanged", config: getCompanionConfig() }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
