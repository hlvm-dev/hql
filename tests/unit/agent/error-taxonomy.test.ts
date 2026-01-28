/**
 * Error taxonomy tests
 */

import { assertEquals } from "jsr:@std/assert";
import { classifyError } from "../../../src/hlvm/agent/error-taxonomy.ts";
import { TimeoutError } from "../../../src/common/timeout-utils.ts";

Deno.test("Error taxonomy: abort error is non-retryable", () => {
  const err = new Error("aborted");
  err.name = "AbortError";
  const result = classifyError(err);
  assertEquals(result.class, "abort");
  assertEquals(result.retryable, false);
});

Deno.test("Error taxonomy: timeout error is retryable", () => {
  const err = new TimeoutError("LLM call", 1000);
  const result = classifyError(err);
  assertEquals(result.class, "timeout");
  assertEquals(result.retryable, true);
});

Deno.test("Error taxonomy: rate limit is retryable", () => {
  const err = new Error("Rate limit exceeded (429)");
  const result = classifyError(err);
  assertEquals(result.class, "rate_limit");
  assertEquals(result.retryable, true);
});

Deno.test("Error taxonomy: permanent errors are non-retryable", () => {
  const err = new Error("Invalid request payload");
  const result = classifyError(err);
  assertEquals(result.class, "permanent");
  assertEquals(result.retryable, false);
});
