/**
 * Binary tests for stdlib lazy sequence operations
 * Tests: repeat (macro), repeatedly, cycle, iterate, seq, conj, into, mapIndexed, keep, mapcat
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { runExpression, USE_BINARY } from "../_shared/binary-helpers.ts";

console.log(`Testing stdlib lazy sequences in ${USE_BINARY ? "BINARY" : "DENO RUN"} mode`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REPEAT MACRO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: repeat macro - executes body n times",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // HQL repeat is a MACRO that executes body n times (like a loop)
    const result = await runExpression(`
      (var count 0)
      (repeat 5 (= count (+ count 1)))
      (print count)
    `);
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "5");
  },
});

Deno.test({
  name: "stdlib binary: repeat macro - accumulates values",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Use repeat macro to build up a result
    const result = await runExpression(`
      (var sum 0)
      (repeat 3 (= sum (+ sum 10)))
      (print sum)
    `);
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "30");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REPEATEDLY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: repeatedly - creates lazy sequence from function",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // repeatedly creates infinite lazy sequence by calling function
    const result = await runExpression("(print (vec (take 5 (repeatedly (fn [] 42)))))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "42");
    // Should have 5 elements
    assertStringIncludes(result.stdout, "[ 42, 42, 42, 42, 42 ]");
  },
});

Deno.test({
  name: "stdlib binary: repeatedly - with stateful function",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // repeatedly can use closures for stateful generation
    const result = await runExpression(`
      (var counter 0)
      (let nextVal (fn [] (= counter (+ counter 1)) counter))
      (print (vec (take 5 (repeatedly nextVal))))
    `);
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "5");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CYCLE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: cycle - cycles through collection",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (take 6 (cycle [1 2 3])))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "3");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ITERATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: iterate - generates sequence with function",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (take 5 (iterate inc 0)))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "0");
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "4");
  },
});

Deno.test({
  name: "stdlib binary: iterate - powers of 2",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (take 5 (iterate (fn [x] (* x 2)) 1)))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "4");
    assertStringIncludes(result.stdout, "8");
    assertStringIncludes(result.stdout, "16");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEQ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: seq - converts array to sequence",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(first (seq [1 2 3]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONJ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: conj - adds to vector",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(print (conj [1 2] 3))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "3");
  },
});

Deno.test({
  name: "stdlib binary: conj - adds multiple elements",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(print (conj [1] 2 3 4))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "3");
    assertStringIncludes(result.stdout, "4");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INTO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: into - adds sequence to collection",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(print (into [1 2] [3 4]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "3");
    assertStringIncludes(result.stdout, "4");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAPINDEXED
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: mapIndexed - maps with index",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(vec (mapIndexed (fn [i x] (+ i x)) [10 20 30]))');
    assertEquals(result.success, true, result.stderr);
    // [0+10, 1+20, 2+30] = [10, 21, 32]
    assertStringIncludes(result.stdout, "10");
    assertStringIncludes(result.stdout, "21");
    assertStringIncludes(result.stdout, "32");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// KEEP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: keep - keeps non-nil results",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (keep (fn [x] (if (> x 2) x null)) [1 2 3 4 5]))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "3");
    assertStringIncludes(result.stdout, "4");
    assertStringIncludes(result.stdout, "5");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAPCAT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: mapcat - maps and concatenates",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (mapcat (fn [x] [x x]) [1 2 3]))");
    assertEquals(result.success, true, result.stderr);
    // [1,1,2,2,3,3]
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "3");
  },
});
