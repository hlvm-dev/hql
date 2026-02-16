/**
 * SSE Store
 *
 * In-memory ring buffer + pub/sub for Server-Sent Events.
 * Each session maintains a capped event buffer for replay on reconnect.
 */

import type { SSEEvent } from "./types.ts";

type SSECallback = (event: SSEEvent) => void;

const MAX_BUFFER_SIZE = 1024;

/** Well-known SSE channel for session-level events (created/updated/deleted) */
export const SESSIONS_CHANNEL = "__sessions__";

// MARK: - Stored Properties

const buffers = new Map<string, SSEEvent[]>();
const sequences = new Map<string, number>();
const subscribers = new Map<string, Set<SSECallback>>();

// MARK: - Public Methods

export function pushSSEEvent(
  sessionId: string,
  eventType: string,
  data: unknown,
): SSEEvent {
  const seq = (sequences.get(sessionId) ?? 0) + 1;
  sequences.set(sessionId, seq);

  const event: SSEEvent = {
    id: String(seq),
    session_id: sessionId,
    event_type: eventType,
    data,
    created_at: new Date().toISOString(),
  };

  let buffer = buffers.get(sessionId);
  if (!buffer) {
    buffer = [];
    buffers.set(sessionId, buffer);
  }
  buffer.push(event);
  if (buffer.length > MAX_BUFFER_SIZE) {
    buffer = buffer.slice(-MAX_BUFFER_SIZE);
    buffers.set(sessionId, buffer);
  }

  const subs = subscribers.get(sessionId);
  if (subs) {
    for (const cb of subs) {
      try {
        cb(event);
      } catch {
        subs.delete(cb);
      }
    }
  }

  return event;
}

export function subscribe(
  sessionId: string,
  callback: SSECallback,
): () => void {
  let subs = subscribers.get(sessionId);
  if (!subs) {
    subs = new Set();
    subscribers.set(sessionId, subs);
  }
  subs.add(callback);

  return () => {
    subs!.delete(callback);
    if (subs!.size === 0) {
      subscribers.delete(sessionId);
    }
  };
}

export interface ReplayResult {
  events: SSEEvent[];
  gapDetected: boolean;
}

export function replayAfter(
  sessionId: string,
  lastEventId: string | null,
): ReplayResult {
  const buffer = buffers.get(sessionId);
  if (!buffer || buffer.length === 0) {
    return { events: [], gapDetected: false };
  }

  if (!lastEventId) {
    return { events: [...buffer], gapDetected: false };
  }

  const lastSeq = parseInt(lastEventId, 10);
  if (isNaN(lastSeq)) {
    return { events: [...buffer], gapDetected: false };
  }

  const firstInBuffer = parseInt(buffer[0].id, 10);
  if (lastSeq < firstInBuffer - 1) {
    return { events: [], gapDetected: true };
  }

  const events = buffer.filter((e) => parseInt(e.id, 10) > lastSeq);
  return { events, gapDetected: false };
}

export function clearSessionBuffer(sessionId: string): void {
  buffers.delete(sessionId);
  sequences.delete(sessionId);
}

export function clearAllBuffers(): void {
  buffers.clear();
  sequences.clear();
}
