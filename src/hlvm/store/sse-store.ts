/**
 * SSE Store
 *
 * In-memory ring buffer + pub/sub for Server-Sent Events.
 * Each session maintains a capped event buffer for replay on reconnect.
 */

import type { SSEEvent } from "./types.ts";

type SSECallback = (event: SSEEvent) => void;

const MAX_BUFFER_SIZE = 1024;

// MARK: - Stored Properties

const buffers = new Map<string, SSEEvent[]>();
const sequences = new Map<string, number>();
const subscribers = new Map<string, Set<SSECallback>>();

// MARK: - Public Methods

function nextSequence(sessionId: string): number {
  const seq = (sequences.get(sessionId) ?? 0) + 1;
  sequences.set(sessionId, seq);
  return seq;
}

export function nextSSEEventId(sessionId: string): string {
  return String(nextSequence(sessionId));
}

export function pushSSEEvent(
  sessionId: string,
  eventType: string,
  data: unknown,
): SSEEvent {
  const event: SSEEvent = {
    id: nextSSEEventId(sessionId),
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
  // Amortized O(1): only compact when 2x over limit, halving allocations
  if (buffer.length > MAX_BUFFER_SIZE * 2) {
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

interface ReplayResult {
  events: SSEEvent[];
  gapDetected: boolean;
}

export function replayAfter(
  sessionId: string,
  lastEventId: string | null,
): ReplayResult {
  const buffer = buffers.get(sessionId);
  const currentSeq = sequences.get(sessionId) ?? 0;

  if (!lastEventId) {
    return { events: buffer ? [...buffer] : [], gapDetected: false };
  }

  const lastSeq = parseInt(lastEventId, 10);
  if (isNaN(lastSeq)) {
    return { events: buffer ? [...buffer] : [], gapDetected: currentSeq > 0 };
  }

  if (!buffer || buffer.length === 0) {
    return { events: [], gapDetected: lastSeq !== currentSeq };
  }

  const firstInBuffer = parseInt(buffer[0].id, 10);
  if (lastSeq < firstInBuffer - 1) {
    return { events: [], gapDetected: true };
  }

  if (lastSeq > currentSeq) {
    return { events: [], gapDetected: true };
  }

  // IDs are contiguous integers from nextSequence(), so compute the slice offset directly (O(1)).
  const startIndex = lastSeq - firstInBuffer + 1;
  if (startIndex >= buffer.length) {
    return { events: [], gapDetected: lastSeq < currentSeq };
  }
  return { events: buffer.slice(startIndex), gapDetected: false };
}

export function clearSessionBuffer(sessionId: string): void {
  buffers.delete(sessionId);
  sequences.delete(sessionId);
  subscribers.delete(sessionId);
}
