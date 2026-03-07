// tests/unit/interpreter/macro-hof-integration.test.ts
// Integration tests for HQL functions with stdlib HOFs in macros
// These tests verify that the interpreter properly wraps HQL functions
// so they can be called from JavaScript stdlib functions like map, filter, reduce

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "../helpers.ts";

// ============================================================================
// Macro with map and HQL function
// ============================================================================

Deno.test("Macro HOF Integration: map with inline fn", async () => {
  const code = `
(macro double-all [items]
  \`[~@(map (fn [x] (* 2 x)) items)])

(double-all [1 2 3])
`;
  const result = await run(code);
  assertEquals(result, [2, 4, 6]);
});

// ============================================================================
// Macro with filter and HQL function
// ============================================================================

Deno.test("Macro HOF Integration: filter with inline fn", async () => {
  const code = `
(macro evens-only [items]
  \`[~@(filter (fn [x] (= 0 (% x 2))) items)])

(evens-only [1 2 3 4 5 6])
`;
  const result = await run(code);
  assertEquals(result, [2, 4, 6]);
});

// ============================================================================
// Macro with reduce and HQL function
// ============================================================================

Deno.test("Macro HOF Integration: reduce sum with inline fn", async () => {
  const code = `
(macro sum-all [items]
  (reduce (fn [acc x] (+ acc x)) 0 items))

(sum-all [1 2 3 4 5])
`;
  const result = await run(code);
  assertEquals(result, 15);
});

// ============================================================================
// Nested HOFs in macros
// ============================================================================

Deno.test("Macro HOF Integration: map then filter", async () => {
  const code = `
(macro double-then-filter-evens [items]
  \`[~@(filter (fn [x] (= 0 (% x 2))) (map (fn [x] (* 2 x)) items))])

(double-then-filter-evens [1 2 3 4 5])
`;
  const result = await run(code);
  // [1 2 3 4 5] -> [2 4 6 8 10] -> [2 4 6 8 10] (all even after doubling)
  assertEquals(result, [2, 4, 6, 8, 10]);
});

Deno.test("Macro HOF Integration: filter then map", async () => {
  const code = `
(macro filter-evens-then-double [items]
  \`[~@(map (fn [x] (* 2 x)) (filter (fn [x] (= 0 (% x 2))) items))])

(filter-evens-then-double [1 2 3 4 5 6])
`;
  const result = await run(code);
  // [1 2 3 4 5 6] -> [2 4 6] -> [4 8 12]
  assertEquals(result, [4, 8, 12]);
});

// ============================================================================
// More complex HOF patterns
// ============================================================================

// ============================================================================
// Compose multiple HOFs
// ============================================================================

Deno.test("Macro HOF Integration: triple then sum", async () => {
  const code = `
(macro triple-and-sum [items]
  (reduce (fn [acc x] (+ acc x)) 0 (map (fn [x] (* 3 x)) items)))

(triple-and-sum [1 2 3 4])
`;
  const result = await run(code);
  // [1 2 3 4] -> [3 6 9 12] -> 30
  assertEquals(result, 30);
});

Deno.test("Macro HOF Integration: reduce to single value in macro", async () => {
  const code = `
(macro const-sum [items]
  (reduce (fn [acc x] (+ acc x)) 0 items))

// The macro computes the sum at compile time
(+ (const-sum [1 2 3 4 5]) 100)
`;
  const result = await run(code);
  // 15 + 100 = 115
  assertEquals(result, 115);
});
