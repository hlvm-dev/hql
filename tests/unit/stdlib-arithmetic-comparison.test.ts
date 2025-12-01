/**
 * Tests for first-class arithmetic and comparison functions
 * These functions enable HOF usage like (reduce add 0 [1 2 3])
 */

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIRST-CLASS ARITHMETIC OPERATORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("Stdlib arithmetic: add with reduce", async () => {
  const code = `(reduce add 0 [1 2 3 4 5])`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Stdlib arithmetic: add variadic", async () => {
  const code = `(add 1 2 3 4 5)`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Stdlib arithmetic: add with no args returns 0", async () => {
  const code = `(add)`;
  const result = await run(code);
  assertEquals(result, 0);
});

Deno.test("Stdlib arithmetic: add single arg", async () => {
  const code = `(add 42)`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Stdlib arithmetic: sub with reduce", async () => {
  const code = `(reduce sub 100 [10 20 30])`;
  const result = await run(code);
  assertEquals(result, 40); // 100 - 10 - 20 - 30
});

Deno.test("Stdlib arithmetic: sub variadic", async () => {
  const code = `(sub 100 10 20 30)`;
  const result = await run(code);
  assertEquals(result, 40);
});

Deno.test("Stdlib arithmetic: sub single arg (negation)", async () => {
  const code = `(sub 5)`;
  const result = await run(code);
  assertEquals(result, -5);
});

Deno.test("Stdlib arithmetic: mul with reduce", async () => {
  const code = `(reduce mul 1 [1 2 3 4 5])`;
  const result = await run(code);
  assertEquals(result, 120);
});

Deno.test("Stdlib arithmetic: mul variadic", async () => {
  const code = `(mul 2 3 4)`;
  const result = await run(code);
  assertEquals(result, 24);
});

Deno.test("Stdlib arithmetic: mul with no args returns 1", async () => {
  const code = `(mul)`;
  const result = await run(code);
  assertEquals(result, 1);
});

Deno.test("Stdlib arithmetic: div with reduce", async () => {
  const code = `(reduce div 1000 [10 10])`;
  const result = await run(code);
  assertEquals(result, 10); // 1000 / 10 / 10
});

Deno.test("Stdlib arithmetic: div variadic", async () => {
  const code = `(div 100 2 5)`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Stdlib arithmetic: div single arg (reciprocal)", async () => {
  const code = `(div 4)`;
  const result = await run(code);
  assertEquals(result, 0.25);
});

Deno.test("Stdlib arithmetic: mod basic", async () => {
  const code = `(mod 10 3)`;
  const result = await run(code);
  assertEquals(result, 1);
});

Deno.test("Stdlib arithmetic: mod with zero dividend", async () => {
  const code = `(mod 0 5)`;
  const result = await run(code);
  assertEquals(result, 0);
});

Deno.test("Stdlib arithmetic: inc", async () => {
  const code = `(inc 5)`;
  const result = await run(code);
  assertEquals(result, 6);
});

Deno.test("Stdlib arithmetic: dec", async () => {
  const code = `(dec 5)`;
  const result = await run(code);
  assertEquals(result, 4);
});

Deno.test("Stdlib arithmetic: inc with map", async () => {
  const code = `(doall (map inc [1 2 3 4 5]))`;
  const result = await run(code);
  assertEquals(result, [2, 3, 4, 5, 6]);
});

Deno.test("Stdlib arithmetic: dec with map", async () => {
  const code = `(doall (map dec [1 2 3 4 5]))`;
  const result = await run(code);
  assertEquals(result, [0, 1, 2, 3, 4]);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPARISON FUNCTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("Stdlib comparison: eq with equal values", async () => {
  const code = `(eq 1 1)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Stdlib comparison: eq with unequal values", async () => {
  const code = `(eq 1 2)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Stdlib comparison: eq variadic (all equal)", async () => {
  const code = `(eq 5 5 5 5)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Stdlib comparison: eq variadic (one different)", async () => {
  const code = `(eq 5 5 5 6)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Stdlib comparison: eq with strings", async () => {
  const code = `(eq "hello" "hello")`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Stdlib comparison: neq basic", async () => {
  const code = `(neq 1 2)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Stdlib comparison: neq with equal values", async () => {
  const code = `(neq 1 1)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Stdlib comparison: lt basic", async () => {
  const code = `(lt 1 2)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Stdlib comparison: lt variadic (ascending)", async () => {
  const code = `(lt 1 2 3 4 5)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Stdlib comparison: lt variadic (not ascending)", async () => {
  const code = `(lt 1 2 3 3)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Stdlib comparison: gt basic", async () => {
  const code = `(gt 2 1)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Stdlib comparison: gt variadic (descending)", async () => {
  const code = `(gt 5 4 3 2 1)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Stdlib comparison: lte basic", async () => {
  const code = `(lte 1 2)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Stdlib comparison: lte with equal", async () => {
  const code = `(lte 2 2)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Stdlib comparison: lte variadic", async () => {
  const code = `(lte 1 2 2 3)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Stdlib comparison: gte basic", async () => {
  const code = `(gte 2 1)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Stdlib comparison: gte with equal", async () => {
  const code = `(gte 2 2)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Stdlib comparison: gte variadic", async () => {
  const code = `(gte 5 5 3 2)`;
  const result = await run(code);
  assertEquals(result, true);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PREDICATES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("Stdlib predicate: isNil with null", async () => {
  const code = `(isNil null)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Stdlib predicate: isNil with value", async () => {
  const code = `(isNil 42)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Stdlib predicate: isNil with empty array", async () => {
  const code = `(isNil [])`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Stdlib predicate: isNil with false", async () => {
  const code = `(isNil false)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Stdlib predicate: isNil with zero", async () => {
  const code = `(isNil 0)`;
  const result = await run(code);
  assertEquals(result, false);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NEXT FUNCTION (like rest but returns null for empty)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("Stdlib sequence: next with array", async () => {
  const code = `(doall (next [1 2 3 4]))`;
  const result = await run(code);
  assertEquals(result, [2, 3, 4]);
});

Deno.test("Stdlib sequence: next with single element returns null", async () => {
  const code = `(next [1])`;
  const result = await run(code);
  assertEquals(result, null);
});

Deno.test("Stdlib sequence: next with empty returns null", async () => {
  const code = `(next [])`;
  const result = await run(code);
  assertEquals(result, null);
});

Deno.test("Stdlib sequence: next with null returns null", async () => {
  const code = `(next null)`;
  const result = await run(code);
  assertEquals(result, null);
});

Deno.test("Stdlib sequence: next vs rest - key difference", async () => {
  // rest returns empty seq, next returns null
  const code1 = `(isEmpty (rest [1]))`;
  const result1 = await run(code1);
  assertEquals(result1, true); // rest returns empty seq

  const code2 = `(next [1])`;
  const result2 = await run(code2);
  assertEquals(result2, null); // next returns null
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INTEGRATION: HOF USAGE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("Integration: filter with comparison function", async () => {
  const code = `(doall (filter (fn [x] (gt x 5)) [1 3 6 8 2 9]))`;
  const result = await run(code);
  assertEquals(result, [6, 8, 9]);
});

Deno.test("Integration: arithmetic with lazy sequences", async () => {
  const code = `(reduce add 0 (take 10 (range 0 100)))`;
  const result = await run(code);
  assertEquals(result, 45); // 0+1+2+3+4+5+6+7+8+9
});

Deno.test("Integration: chaining arithmetic and comparison", async () => {
  // Sum of even numbers from 0-9
  const code = `(reduce add 0 (filter (fn [x] (eq (mod x 2) 0)) (take 10 (range 0 100))))`;
  const result = await run(code);
  assertEquals(result, 20); // 0+2+4+6+8
});

Deno.test("Integration: factorial with reduce and mul", async () => {
  const code = `(reduce mul 1 [1 2 3 4 5])`;
  const result = await run(code);
  assertEquals(result, 120);
});

Deno.test("Integration: product of range with mul", async () => {
  const code = `(reduce mul 1 (take 5 (map inc (range 0 100))))`;
  const result = await run(code);
  assertEquals(result, 120); // 1*2*3*4*5
});
