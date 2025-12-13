/**
 * Macro Edge Cases Test Suite
 *
 * Tests for edge cases that were previously broken and have been fixed.
 * These tests verify the fixes for:
 * 1. Nested macro as argument (dec1 (dec1 5)) producing NaN
 * 2. Recursive macros only executing once
 * 3. Deeply nested macro chains (5+ levels)
 * 4. Chained let bindings with compile-time macros
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import hql from "../../mod.ts";

// ============================================================================
// EDGE CASE 1: NESTED MACRO AS ARGUMENT
// Previously: (dec1 (dec1 5)) produced NaN
// Root cause: expandMacroExpression didn't pre-expand macro calls in arguments
// ============================================================================

Deno.test("Edge Case: nested macro as argument - double nesting", async () => {
  const result = await hql.run(`
    (macro dec1 [x] (- x 1))
    (dec1 (dec1 10))
  `);
  assertEquals(result, 8, "dec1(dec1(10)) should equal 8");
});

Deno.test("Edge Case: nested macro as argument - triple nesting", async () => {
  const result = await hql.run(`
    (macro dec1 [x] (- x 1))
    (dec1 (dec1 (dec1 10)))
  `);
  assertEquals(result, 7, "dec1(dec1(dec1(10))) should equal 7");
});

Deno.test("Edge Case: nested macro as argument - with addition", async () => {
  const result = await hql.run(`
    (macro add5 [x] (+ x 5))
    (add5 (add5 0))
  `);
  assertEquals(result, 10, "add5(add5(0)) should equal 10");
});

Deno.test("Edge Case: mixed nested macros", async () => {
  const result = await hql.run(`
    (macro inc [x] (+ x 1))
    (macro dec [x] (- x 1))
    (inc (dec (inc (dec 10))))
  `);
  assertEquals(result, 10, "inc(dec(inc(dec(10)))) should equal 10");
});

// ============================================================================
// EDGE CASE 2: RECURSIVE MACROS
// Previously: Recursive macros only executed once
// Root cause: evaluateMacroCall didn't fully evaluate args like (- n 1)
// ============================================================================

Deno.test("Edge Case: recursive factorial macro", async () => {
  const result = await hql.run(`
    (macro factorial [n]
      (if (<= n 1)
        1
        (* n (factorial (- n 1)))))
    (factorial 5)
  `);
  assertEquals(result, 120, "factorial(5) should equal 120");
});

Deno.test("Edge Case: recursive factorial of 7", async () => {
  const result = await hql.run(`
    (macro factorial [n]
      (if (<= n 1)
        1
        (* n (factorial (- n 1)))))
    (factorial 7)
  `);
  assertEquals(result, 5040, "factorial(7) should equal 5040");
});

Deno.test("Edge Case: recursive fibonacci macro", async () => {
  const result = await hql.run(`
    (macro fib [n]
      (cond
        ((<= n 0) 0)
        ((=== n 1) 1)
        (true (+ (fib (- n 1)) (fib (- n 2))))))
    (fib 8)
  `);
  assertEquals(result, 21, "fib(8) should equal 21");
});

Deno.test("Edge Case: recursive sum macro", async () => {
  const result = await hql.run(`
    (macro sum-to [n]
      (if (<= n 0)
        0
        (+ n (sum-to (- n 1)))))
    (sum-to 10)
  `);
  assertEquals(result, 55, "sum-to(10) should equal 55 (1+2+...+10)");
});

// ============================================================================
// EDGE CASE 3: DEEPLY NESTED MACRO CHAINS
// Tests macro composition at multiple levels
// ============================================================================

Deno.test("Edge Case: 3-level macro nesting", async () => {
  // l1(x) = x + 1
  // l2(x) = l1(l1(x)) = x + 2
  // l3(x) = l2(l2(x)) = x + 4
  // l3(0) = 4
  const result = await hql.run(`
    (macro l1 [x] (+ x 1))
    (macro l2 [x] (l1 (l1 x)))
    (macro l3 [x] (l2 (l2 x)))
    (l3 0)
  `);
  assertEquals(result, 4, "l3(0) should equal 4");
});

Deno.test("Edge Case: 4-level macro nesting", async () => {
  // l4(0) = 8
  const result = await hql.run(`
    (macro l1 [x] (+ x 1))
    (macro l2 [x] (l1 (l1 x)))
    (macro l3 [x] (l2 (l2 x)))
    (macro l4 [x] (l3 (l3 x)))
    (l4 0)
  `);
  assertEquals(result, 8, "l4(0) should equal 8");
});

Deno.test("Edge Case: 5-level macro nesting", async () => {
  // l5(0) = 16
  const result = await hql.run(`
    (macro l1 [x] (+ x 1))
    (macro l2 [x] (l1 (l1 x)))
    (macro l3 [x] (l2 (l2 x)))
    (macro l4 [x] (l3 (l3 x)))
    (macro l5 [x] (l4 (l4 x)))
    (l5 0)
  `);
  assertEquals(result, 16, "l5(0) should equal 16");
});

Deno.test("Edge Case: multiplicative macro chain", async () => {
  // m1(x) = x * 2
  // m2(x) = m1(m1(x)) = x * 4
  // m3(x) = m2(m2(x)) = x * 16
  const result = await hql.run(`
    (macro m1 [x] (* x 2))
    (macro m2 [x] (m1 (m1 x)))
    (macro m3 [x] (m2 (m2 x)))
    (m3 1)
  `);
  assertEquals(result, 16, "m3(1) should equal 16");
});

// ============================================================================
// EDGE CASE 4: CHAINED LET WITH COMPILE-TIME MACROS
// Tests that macros work correctly inside let bindings
// ============================================================================

Deno.test("Edge Case: macro in let binding value", async () => {
  const result = await hql.run(`
    (macro dbl [x] (* x 2))
    (let [a (dbl 5)]
      a)
  `);
  assertEquals(result, 10, "let with macro should work");
});

Deno.test("Edge Case: chained let bindings with macros", async () => {
  const result = await hql.run(`
    (macro dbl [x] \`(* ~x 2))
    (let [a (dbl 3)
          b (dbl a)]
      [a b])
  `);
  assertEquals(result, [6, 12], "chained let with macros should work");
});

Deno.test("Edge Case: multiple macros in let bindings", async () => {
  const result = await hql.run(`
    (macro inc [x] (+ x 1))
    (macro dec [x] (- x 1))
    (let [a (inc 5)
          b (dec a)
          c (inc (inc b))]
      [a b c])
  `);
  assertEquals(result, [6, 5, 7], "multiple macros in let should work");
});

// ============================================================================
// EDGE CASE 5: MACRO CALLING MACRO IN BODY
// Tests that macros can call other macros from within their body
// ============================================================================

Deno.test("Edge Case: macro uses another macro in body", async () => {
  const result = await hql.run(`
    (macro add1 [x] (+ x 1))
    (macro add3 [x] (add1 (add1 (add1 x))))
    (add3 10)
  `);
  assertEquals(result, 13, "add3(10) should equal 13");
});

Deno.test("Edge Case: deeply nested macro in body", async () => {
  const result = await hql.run(`
    (macro square [x] (* x x))
    (macro quad [x] (square (square x)))
    (quad 2)
  `);
  assertEquals(result, 16, "quad(2) = square(square(2)) = square(4) = 16");
});

// ============================================================================
// EDGE CASE 6: COMPLEX ARITHMETIC EXPRESSIONS IN MACROS
// Tests that complex arithmetic is properly evaluated at macro time
// ============================================================================

Deno.test("Edge Case: complex arithmetic in recursive macro", async () => {
  const result = await hql.run(`
    (macro power-of-2 [n]
      (if (<= n 0)
        1
        (* 2 (power-of-2 (- n 1)))))
    (power-of-2 4)
  `);
  assertEquals(result, 16, "power-of-2(4) should equal 16");
});

Deno.test("Edge Case: nested arithmetic operations", async () => {
  const result = await hql.run(`
    (macro calc [a b c]
      (+ (* a b) (- c a) (/ b 2)))
    (calc 4 6 10)
  `);
  // (4*6) + (10-4) + (6/2) = 24 + 6 + 3 = 33
  assertEquals(result, 33, "calc(4,6,10) should equal 33");
});

// ============================================================================
// EDGE CASE 7: MACRO WITH CONDITIONAL RETURNING DIFFERENT TYPES
// ============================================================================

Deno.test("Edge Case: macro returns different types based on condition", async () => {
  const result = await hql.run(`
    (macro type-test [val]
      (cond
        ((< val 0) "negative")
        ((=== val 0) 0)
        ((> val 10) true)
        (true val)))
    [(type-test -5) (type-test 0) (type-test 100) (type-test 5)]
  `);
  assertEquals(result, ["negative", 0, true, 5], "macro should return different types");
});
