/**
 * Companion Agent — Observation Debouncer
 *
 * Async generator that batches observations by time window.
 */

import type { Observation } from "./types.ts";
import { TRIAGE_PRIORITY_KINDS } from "./types.ts";

function triageBatch(batch: Observation[], maxSize: number): Observation[] {
  if (batch.length <= maxSize) return batch;
  const high = batch.filter((o) => TRIAGE_PRIORITY_KINDS.has(o.kind));
  const low = batch.filter((o) => !TRIAGE_PRIORITY_KINDS.has(o.kind));
  // Keep all high-signal, fill remaining with newest low-signal
  const remaining = maxSize - high.length;
  return remaining > 0
    ? [...high, ...low.slice(-remaining)]
    : high.slice(-maxSize);
}

/** Sentinel value to distinguish timeout from source exhaustion. */
const TIMEOUT = Symbol("timeout");

export async function* debounceObservations(
  source: AsyncIterable<Observation>,
  windowMs: number,
  maxBatchSize = 100,
): AsyncGenerator<Observation[]> {
  const iter = source[Symbol.asyncIterator]();
  let batch: Observation[] = [];
  // Track pending iter.next() to avoid orphaned promises
  let pendingNext: Promise<IteratorResult<Observation>> | null = null;

  while (true) {
    // Wait for the first observation (blocking)
    const nextPromise = pendingNext ?? iter.next();
    pendingNext = null;

    const first = await nextPromise;
    if (first.done) {
      if (batch.length > 0) yield triageBatch(batch, maxBatchSize);
      return;
    }
    batch.push(first.value);

    // Collect within the debounce window
    const deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      const iterPromise = iter.next();
      const result = await Promise.race([
        iterPromise,
        new Promise<typeof TIMEOUT>((resolve) =>
          setTimeout(() => resolve(TIMEOUT), remaining)
        ),
      ]);

      if (result === TIMEOUT) {
        // Timeout — window expired. Save the pending iter promise for next round.
        pendingNext = iterPromise;
        break;
      }
      if (result.done) {
        // Source exhausted
        if (batch.length > 0) yield triageBatch(batch, maxBatchSize);
        return;
      }
      batch.push(result.value);
    }

    yield triageBatch(batch, maxBatchSize);
    batch = [];
  }
}
