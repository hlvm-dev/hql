/**
 * Error taxonomy tests
 */

import { assertEquals } from "jsr:@std/assert";
import { classifyError, getRecoveryHint } from "../../../src/hlvm/agent/error-taxonomy.ts";
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

// ============================================================
// Recovery hint tests
// ============================================================

Deno.test("Recovery hint: file not found suggests list_files", () => {
  const hint = getRecoveryHint("ENOENT: No such file or directory: /tmp/missing.txt");
  assertEquals(typeof hint, "string");
  assertEquals(hint!.includes("list_files"), true);
});

Deno.test("Recovery hint: permission denied is actionable", () => {
  const hint = getRecoveryHint("Permission denied: /etc/shadow");
  assertEquals(typeof hint, "string");
  assertEquals(hint!.includes("denied"), true);
});

Deno.test("Recovery hint: timeout suggests smaller steps", () => {
  const hint = getRecoveryHint("Operation timed out after 30000ms");
  assertEquals(typeof hint, "string");
  assertEquals(hint!.includes("smaller"), true);
});

Deno.test("Recovery hint: command not found is actionable", () => {
  const hint = getRecoveryHint("bash: foo: command not found");
  assertEquals(typeof hint, "string");
  assertEquals(hint!.includes("alternative"), true);
});

Deno.test("Recovery hint: user denial suggests alternative", () => {
  const hint = getRecoveryHint("Action denied by user");
  assertEquals(typeof hint, "string");
  assertEquals(hint!.includes("alternative"), true);
});

Deno.test("Recovery hint: unknown errors return null", () => {
  const hint = getRecoveryHint("Some completely novel error");
  assertEquals(hint, null);
});

// ============================================================
// HTTP status code classification tests
// ============================================================

Deno.test("Error taxonomy: HTTP status codes classified correctly", () => {
  // Auth errors (permanent)
  for (const code of [401, 403]) {
    const r = classifyError(new Error(`Provider HTTP ${code}: test`));
    assertEquals(r.class, "permanent", `HTTP ${code} should be permanent`);
    assertEquals(r.retryable, false, `HTTP ${code} should not be retryable`);
  }
  // Server errors (transient)
  for (const code of [500, 502, 503]) {
    const r = classifyError(new Error(`Provider HTTP ${code}: test`));
    assertEquals(r.class, "transient", `HTTP ${code} should be transient`);
    assertEquals(r.retryable, true, `HTTP ${code} should be retryable`);
  }
  // Not Implemented (permanent)
  const r501 = classifyError(new Error("Provider HTTP 501: Not Implemented"));
  assertEquals(r501.class, "permanent");
  assertEquals(r501.retryable, false);
});

Deno.test("Recovery hint: auth and schema errors have actionable hints", () => {
  const authHint = getRecoveryHint("Provider HTTP 401: Unauthorized");
  assertEquals(authHint!.includes("API key"), true);

  const schemaHint = getRecoveryHint("Invalid tool schema for search_code");
  assertEquals(schemaHint!.includes("tool"), true);
});
