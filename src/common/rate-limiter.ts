/**
 * Sliding Window Rate Limiter (local-only, in-memory)
 *
 * Enforces a maximum number of events per time window.
 * No external dependencies, deterministic for tests.
 */

// ============================================================
// Types
// ============================================================

export interface RateLimitConfig {
  maxCalls: number;
  windowMs: number;
}

interface RateLimitStatus {
  allowed: boolean;
  maxCalls: number;
  windowMs: number;
  used: number;
  remaining: number;
  resetMs: number;
}

export class RateLimitError extends Error {
  readonly maxCalls: number;
  readonly windowMs: number;

  constructor(message: string, maxCalls: number, windowMs: number) {
    super(message);
    this.name = "RateLimitError";
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
  }
}

// ============================================================
// Sliding Window Limiter
// ============================================================

export class SlidingWindowRateLimiter {
  private readonly maxCalls: number;
  private readonly windowMs: number;
  private readonly nowFn: () => number;
  private timestamps: number[] = [];

  constructor(config: RateLimitConfig, nowFn: () => number = Date.now) {
    this.maxCalls = config.maxCalls;
    this.windowMs = config.windowMs;
    this.nowFn = nowFn;
  }

  isDisabled(): boolean {
    return this.maxCalls <= 0 || this.windowMs <= 0;
  }

  consume(count = 1): RateLimitStatus {
    if (this.isDisabled()) {
      return {
        allowed: true,
        maxCalls: this.maxCalls,
        windowMs: this.windowMs,
        used: 0,
        remaining: Number.POSITIVE_INFINITY,
        resetMs: 0,
      };
    }

    const now = this.nowFn();
    this.prune(now);

    const used = this.timestamps.length;
    const projected = used + count;

    const oldest = this.timestamps[0];
    const resetMs = oldest ? Math.max(0, this.windowMs - (now - oldest)) : 0;

    if (projected > this.maxCalls) {
      return {
        allowed: false,
        maxCalls: this.maxCalls,
        windowMs: this.windowMs,
        used,
        remaining: Math.max(0, this.maxCalls - used),
        resetMs,
      };
    }

    for (let i = 0; i < count; i++) {
      this.timestamps.push(now);
    }

    return {
      allowed: true,
      maxCalls: this.maxCalls,
      windowMs: this.windowMs,
      used: used + count,
      remaining: Math.max(0, this.maxCalls - (used + count)),
      resetMs,
    };
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    if (this.timestamps.length === 0) return;

    // Find first timestamp within the window
    let idx = 0;
    while (idx < this.timestamps.length && this.timestamps[idx] <= cutoff) {
      idx++;
    }
    if (idx > 0) {
      this.timestamps.splice(0, idx);
    }
  }
}
