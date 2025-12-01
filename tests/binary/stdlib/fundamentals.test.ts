/**
 * Binary tests for stdlib fundamental functions
 * Tests: first, rest, cons, nth, count, second, last, isEmpty
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { runExpression, USE_BINARY } from "../_shared/binary-helpers.ts";

console.log(`Testing stdlib fundamentals in ${USE_BINARY ? "BINARY" : "DENO RUN"} mode`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIRST
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: first - returns first element of array",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(first [1 2 3])");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
  },
});

Deno.test({
  name: "stdlib binary: first - returns first element of vector",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(first [42])");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "42");
  },
});

Deno.test({
  name: "stdlib binary: first - returns nil for empty array",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(print (first []))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "undefined");
  },
});

Deno.test({
  name: "stdlib binary: first - works with strings",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(first "hello")');
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "h");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REST
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: rest - returns all but first element",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (rest [1 2 3]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "3");
  },
});

Deno.test({
  name: "stdlib binary: rest - returns empty for single element",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (rest [1]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "[]");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: cons - prepends element to array",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (cons 0 [1 2 3]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "0");
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "3");
  },
});

Deno.test({
  name: "stdlib binary: cons - prepends to empty array",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (cons 1 []))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NTH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: nth - returns element at index",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(nth [10 20 30] 1)");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "20");
  },
});

Deno.test({
  name: "stdlib binary: nth - returns first element at index 0",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(nth [10 20 30] 0)");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "10");
  },
});

Deno.test({
  name: "stdlib binary: nth - returns last element",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(nth [10 20 30] 2)");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "30");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COUNT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: count - returns length of array",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(count [1 2 3 4 5])");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "5");
  },
});

Deno.test({
  name: "stdlib binary: count - returns 0 for empty array",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(count [])");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "0");
  },
});

Deno.test({
  name: "stdlib binary: count - works with strings",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(count "hello")');
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "5");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECOND
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: second - returns second element",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(second [10 20 30])");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "20");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LAST
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: last - returns last element",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(last [10 20 30])");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "30");
  },
});

Deno.test({
  name: "stdlib binary: last - returns only element for single-element array",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(last [42])");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "42");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ISEMPTY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: isEmpty - returns true for empty array",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(isEmpty [])");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "true");
  },
});

Deno.test({
  name: "stdlib binary: isEmpty - returns false for non-empty array",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(isEmpty [1 2 3])");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "false");
  },
});
