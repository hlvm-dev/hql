/**
 * Companion Agent — Observation Bus
 *
 * Async iterable ring buffer for observation ingestion.
 */

import type { Observation } from "./types.ts";

export class ObservationBus {
  private buffer: Observation[] = [];
  private maxSize: number;
  private closed = false;
  private waiters: Array<() => void> = [];

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  append(obs: Observation): boolean {
    if (this.closed) return false;
    this.buffer.push(obs);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
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
    return this.buffer.length;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Observation> {
    let index = 0;
    while (true) {
      if (index < this.buffer.length) {
        yield this.buffer[index++];
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
