/**
 * Concurrency limiter and nickname pool for background delegate agents.
 *
 * Translated from Codex CLI guards.rs CAS loop → simple JS
 * (single-threaded, no atomics needed).
 */

import { createAbortError } from "../../common/timeout-utils.ts";

// ============================================================
// Nickname Pool
// ============================================================

const NICKNAMES = [
  "Alpha", "Bravo", "Charlie", "Delta", "Echo",
  "Foxtrot", "Golf", "Hotel", "India", "Juliet",
  "Kilo", "Lima", "Mike", "November", "Oscar",
  "Papa", "Quebec", "Romeo", "Sierra", "Tango",
];

/** Allocate the first unused nickname from the pool. */
export function allocateNickname(activeNicknames: Set<string>): string {
  for (const name of NICKNAMES) {
    if (!activeNicknames.has(name)) return name;
  }
  // Fallback: generate sequential nickname
  return `Agent-${activeNicknames.size + 1}`;
}

// ============================================================
// Concurrency Limiter
// ============================================================

interface QueueEntry {
  threadId: string;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

export class ConcurrencyLimiter {
  private active = new Set<string>();
  private queue: QueueEntry[] = [];

  constructor(private max = 2) {}

  /** Acquire a slot, waiting if at capacity. Returns a release function. */
  acquire(threadId: string, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal.reason));
    }
    if (this.active.size < this.max) {
      this.active.add(threadId);
      return Promise.resolve(this.createRelease(threadId));
    }
    return new Promise<() => void>((resolve, reject) => {
      const abortHandler = () => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) {
          this.queue.splice(index, 1);
        }
        entry.reject(createAbortError(signal?.reason));
      };
      const cleanup = () => {
        if (signal) {
          signal.removeEventListener("abort", abortHandler);
        }
      };
      const entry: QueueEntry = {
        threadId,
        resolve: (release) => {
          cleanup();
          resolve(release);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
        cleanup,
      };
      if (signal) {
        signal.addEventListener("abort", abortHandler, { once: true });
      }
      this.queue.push(entry);
    });
  }

  /** Try to acquire without waiting. Returns release fn or null if at capacity. */
  tryAcquire(threadId: string): (() => void) | null {
    if (this.active.size < this.max) {
      this.active.add(threadId);
      return this.createRelease(threadId);
    }
    return null;
  }

  getActive(): number {
    return this.active.size;
  }

  getQueued(): number {
    return this.queue.length;
  }

  private createRelease(threadId: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active.delete(threadId);
      // Wake next queued entry — add it to active and give proper release
      const next = this.queue.shift();
      if (next) {
        next.cleanup();
        this.active.add(next.threadId);
        next.resolve(this.createRelease(next.threadId));
      }
    };
  }
}

// ============================================================
// Singleton
// ============================================================

let _limiter: ConcurrencyLimiter | null = null;
let _limiterMax = 4; // default, overridden by config

export function getDelegateLimiter(): ConcurrencyLimiter {
  if (!_limiter) _limiter = new ConcurrencyLimiter(_limiterMax);
  return _limiter;
}

/** Set the max concurrency for the delegate limiter. Recreates if changed. */
export function setDelegateLimiterMax(max: number): void {
  if (max === _limiterMax && _limiter) return;
  _limiterMax = max;
  // Only recreate if no active or queued work (safe to replace idle limiter)
  if (_limiter && _limiter.getActive() === 0 && _limiter.getQueued() === 0) {
    _limiter = new ConcurrencyLimiter(max);
  } else if (!_limiter) {
    // Will be created on next getDelegateLimiter() with new max
  }
  // If there's active work, the new max takes effect on next singleton creation
}

/** Reset singleton (for testing). */
export function resetDelegateLimiter(): void {
  _limiter = null;
  _limiterMax = 4;
}
