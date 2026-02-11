/**
 * Rate Limiter Tests
 */

import { assertEquals } from "jsr:@std/assert";
import { SlidingWindowRateLimiter } from "../../../src/common/rate-limiter.ts";

Deno.test({
  name: "RateLimiter: allows up to maxCalls within window",
  fn() {
    const now = 0;
    const limiter = new SlidingWindowRateLimiter(
      { maxCalls: 2, windowMs: 1000 },
      () => now,
    );

    const first = limiter.consume();
    assertEquals(first.allowed, true);
    assertEquals(first.used, 1);

    const second = limiter.consume();
    assertEquals(second.allowed, true);
    assertEquals(second.used, 2);

    const third = limiter.consume();
    assertEquals(third.allowed, false);
    assertEquals(third.used, 2);
  },
});

Deno.test({
  name: "RateLimiter: resets after window passes",
  fn() {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(
      { maxCalls: 1, windowMs: 1000 },
      () => now,
    );

    const first = limiter.consume();
    assertEquals(first.allowed, true);

    const blocked = limiter.consume();
    assertEquals(blocked.allowed, false);

    now = 1500;
    const afterWindow = limiter.consume();
    assertEquals(afterWindow.allowed, true);
  },
});

Deno.test({
  name: "RateLimiter: disabled when maxCalls <= 0",
  fn() {
    const limiter = new SlidingWindowRateLimiter(
      { maxCalls: 0, windowMs: 1000 },
      () => 0,
    );
    const result = limiter.consume();
    assertEquals(result.allowed, true);
  },
});
