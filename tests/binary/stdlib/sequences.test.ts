/**
 * Binary tests for stdlib sequence operations
 * Tests: map, filter, reduce, take, drop, concat, flatten, distinct
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { runExpression, USE_BINARY } from "../_shared/binary-helpers.ts";

console.log(`Testing stdlib sequences in ${USE_BINARY ? "BINARY" : "DENO RUN"} mode`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: map - doubles each element",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (map (fn [x] (* x 2)) [1 2 3]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "4");
    assertStringIncludes(result.stdout, "6");
  },
});

Deno.test({
  name: "stdlib binary: map - increments each element",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (map inc [1 2 3]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "3");
    assertStringIncludes(result.stdout, "4");
  },
});

Deno.test({
  name: "stdlib binary: map - empty input returns empty",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (map inc []))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "[]");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILTER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: filter - keeps elements greater than 2",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (filter (fn [x] (> x 2)) [1 2 3 4 5]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "3");
    assertStringIncludes(result.stdout, "4");
    assertStringIncludes(result.stdout, "5");
  },
});

Deno.test({
  name: "stdlib binary: filter - keeps even numbers",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (filter (fn [x] (eq 0 (mod x 2))) [1 2 3 4 5 6]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "4");
    assertStringIncludes(result.stdout, "6");
  },
});

Deno.test({
  name: "stdlib binary: filter - returns empty when no matches",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (filter (fn [x] (> x 100)) [1 2 3]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "[]");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REDUCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: reduce - sums numbers",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(reduce add 0 [1 2 3 4 5])");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "15");
  },
});

Deno.test({
  name: "stdlib binary: reduce - with custom function",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(reduce (fn [acc x] (+ acc x)) 0 [1 2 3])");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "6");
  },
});

Deno.test({
  name: "stdlib binary: reduce - multiply",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(reduce mul 1 [1 2 3 4])");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "24");
  },
});

Deno.test({
  name: "stdlib binary: reduce - returns initial for empty",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(reduce add 100 [])");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "100");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAKE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: take - takes first n elements",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (take 3 [1 2 3 4 5]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "3");
  },
});

Deno.test({
  name: "stdlib binary: take - takes from range",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (take 5 (range 100)))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "0");
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "4");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DROP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: drop - drops first n elements",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (drop 2 [1 2 3 4 5]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "3");
    assertStringIncludes(result.stdout, "4");
    assertStringIncludes(result.stdout, "5");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONCAT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: concat - joins two arrays",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (concat [1 2] [3 4]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "3");
    assertStringIncludes(result.stdout, "4");
  },
});

Deno.test({
  name: "stdlib binary: concat - joins three arrays",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (concat [1] [2] [3]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "3");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FLATTEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: flatten - flattens nested array",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (flatten [[1 2] [3 4]]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "3");
    assertStringIncludes(result.stdout, "4");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DISTINCT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: distinct - removes duplicates",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (distinct [1 2 2 3 3 3]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "3");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RANGE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: range - generates sequence",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (range 5))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "0");
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "4");
  },
});

Deno.test({
  name: "stdlib binary: range - with start and end",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (range 1 5))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "4");
  },
});
