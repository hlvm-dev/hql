/**
 * Companion Agent — Observation Bus
 *
 * Async iterable ring buffer for observation ingestion.
 */

import type { Observation } from "./types.ts";

export class ObservationBus {
  private queue: Observation[] = [];
  private maxSize: number;
  private closed = false;
  private waiters: Array<() => void> = [];

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  append(obs: Observation): boolean {
    if (this.closed) return false;
    this.queue.push(obs);
    // Cap backpressure: drop oldest unconsumed when over limit
    if (this.queue.length > this.maxSize) {
      this.queue.shift();
    }
    // Wake up any waiting async iterators
    const pending = this.waiters.splice(0);
    for (const resolve of pending) resolve();
    return true;
  }

  close(): void {
    this.closed = true;
    const pending = this.waiters.splice(0);
    for (const resolve of pending) resolve();
  }

  get size(): number {
    return this.queue.length;
  }

  /** Drain pattern: shift items as they're yielded — immune to overflow reindex bugs. */
  async *[Symbol.asyncIterator](): AsyncGenerator<Observation> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.closed) {
        return;
      } else {
        await new Promise<void>((resolve) => {
          this.waiters.push(resolve);
        });
      }
    }
  }
}
