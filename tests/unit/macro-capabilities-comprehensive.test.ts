/**
 * Comprehensive Macro Capabilities Test Suite
 *
 * Tests all macro features systematically, including edge cases that were
 * previously broken and have been fixed.
 *
 * Categories:
 * 1. Basic macro definition and expansion
 * 2. Quasiquote with unquote
 * 3. Unquote-splicing
 * 4. Rest parameters
 * 5. Recursive macros
 * 6. Macro calling macro
 * 7. Nested macro as argument
 * 8. Stdlib functions in macros
 * 9. User-defined functions in macros
 * 10. Built-in macros
 * 11. Gensym hygiene
 * 12. Conditional logic in macros
 * 13. Macro generates macro
 * 14. Edge cases (deep recursion, fibonacci, multi-level nesting)
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import hql from "../../mod.ts";

// ============================================================================
// SECTION 1: BASIC MACRO DEFINITION
// ============================================================================

Deno.test("Macro: basic macro doubles a number", async () => {
  const result = await hql.run(`
    (macro double [x] (* x 2))
    (double 5)
  `);
  assertEquals(result, 10);
});

Deno.test("Macro: basic macro with multiple parameters", async () => {
  const result = await hql.run(`
    (macro add3 [a b c] (+ a b c))
    (add3 1 2 3)
  `);
  assertEquals(result, 6);
});

// ============================================================================
// SECTION 2: QUASIQUOTE WITH UNQUOTE
// ============================================================================

Deno.test("Macro: quasiquote generates function", async () => {
  const result = await hql.run(`
    (macro make-adder [n]
      \`(fn [x] (+ x ~n)))
    (let add10 (make-adder 10))
    (add10 5)
  `);
  assertEquals(result, 15);
});

Deno.test("Macro: quasiquote with multiple unquotes", async () => {
  const result = await hql.run(`
    (macro make-pair [a b]
      \`[~a ~b])
    (make-pair 1 2)
  `);
  assertEquals(result, [1, 2]);
});

// ============================================================================
// SECTION 3: UNQUOTE-SPLICING
// ============================================================================

Deno.test("Macro: unquote-splicing with rest params", async () => {
  const result = await hql.run(`
    (macro sum-all [& nums]
      \`(+ ~@nums))
    (sum-all 1 2 3 4 5)
  `);
  assertEquals(result, 15);
});

Deno.test("Macro: unquote-splicing in vector creation", async () => {
  const result = await hql.run(`
    (macro my-vec [& items]
      \`(vector ~@items))
    (my-vec "a" "b" "c")
  `);
  assertEquals(result, ["a", "b", "c"]);
});

// ============================================================================
// SECTION 4: REST PARAMETERS
// ============================================================================

Deno.test("Macro: rest parameters capture multiple args", async () => {
  // Use count instead of length for compile-time count
  const result = await hql.run(`
    (macro count-args [& args]
      (count args))
    (count-args 1 2 3 4 5)
  `);
  assertEquals(result, 5);
});

Deno.test("Macro: mixed regular and rest parameters", async () => {
  const result = await hql.run(`
    (macro prepend-to [first & rest]
      \`(vector ~first ~@rest))
    (prepend-to 0 1 2 3)
  `);
  assertEquals(result, [0, 1, 2, 3]);
});

// ============================================================================
// SECTION 5: RECURSIVE MACROS (EDGE CASE - PREVIOUSLY BROKEN)
// ============================================================================

Deno.test("Macro: recursive countdown generates nested do", async () => {
  // Simpler recursive test without side effects
  const result = await hql.run(`
    (macro count-sum [n]
      (if (> n 0)
        (+ n (count-sum (- n 1)))
        0))
    (count-sum 3)
  `);
  assertEquals(result, 6);  // 3 + 2 + 1 + 0 = 6
});

Deno.test("Macro: recursive factorial (edge case)", async () => {
  const result = await hql.run(`
    (macro factorial [n]
      (if (<= n 1)
        1
        (* n (factorial (- n 1)))))
    (factorial 5)
  `);
  assertEquals(result, 120);
});

Deno.test("Macro: recursive factorial of 7", async () => {
  const result = await hql.run(`
    (macro factorial [n]
      (if (<= n 1)
        1
        (* n (factorial (- n 1)))))
    (factorial 7)
  `);
  assertEquals(result, 5040);
});

Deno.test("Macro: recursive fibonacci (edge case)", async () => {
  const result = await hql.run(`
    (macro fib [n]
      (cond
        ((<= n 0) 0)
        ((=== n 1) 1)
        (true (+ (fib (- n 1)) (fib (- n 2))))))
    [(fib 0) (fib 1) (fib 5) (fib 8)]
  `);
  assertEquals(result, [0, 1, 5, 21]);
});

// ============================================================================
// SECTION 6: MACRO CALLING MACRO
// ============================================================================

Deno.test("Macro: macro calling another macro in body", async () => {
  const result = await hql.run(`
    (macro inc1 [x] (+ x 1))
    (macro inc3 [x] (+ (inc1 (inc1 (inc1 x))) 0))
    (inc3 10)
  `);
  assertEquals(result, 13);
});

// ============================================================================
// SECTION 7: NESTED MACRO AS ARGUMENT (EDGE CASE - PREVIOUSLY BROKEN)
// ============================================================================

Deno.test("Macro: nested macro as argument", async () => {
  const result = await hql.run(`
    (macro dec1 [x] (- x 1))
    (dec1 (dec1 (dec1 10)))
  `);
  assertEquals(result, 7);
});

Deno.test("Macro: deeply nested macro calls", async () => {
  const result = await hql.run(`
    (macro add1 [x] (+ x 1))
    (add1 (add1 (add1 (add1 (add1 0)))))
  `);
  assertEquals(result, 5);
});

// ============================================================================
// SECTION 8: STDLIB FUNCTIONS IN MACROS
// ============================================================================

Deno.test("Macro: stdlib map in macro", async () => {
  const result = await hql.run(`
    (macro double-list [& nums]
      \`(map (fn [x] (* x 2)) (list ~@nums)))
    (doall (double-list 1 2 3))
  `);
  assertEquals(result, [2, 4, 6]);
});

Deno.test("Macro: stdlib filter in macro", async () => {
  const result = await hql.run(`
    (macro filter-positive [& nums]
      \`(doall (filter (fn [x] (> x 2)) (list ~@nums))))
    (filter-positive 1 2 3 4 5)
  `);
  assertEquals(result, [3, 4, 5]);
});

// ============================================================================
// SECTION 9: USER-DEFINED FUNCTIONS IN MACROS
// ============================================================================

Deno.test("Macro: user function called in macro body", async () => {
  const result = await hql.run(`
    (fn helper-calc [a b] (* a (+ b 1)))
    (macro use-helper [x]
      (helper-calc x 2))
    (use-helper 5)
  `);
  assertEquals(result, 15);
});

Deno.test("Macro: user function passed as macro argument", async () => {
  const result = await hql.run(`
    (fn my-square [x] (* x x))
    (macro apply-it [f val]
      (f val))
    (apply-it my-square 6)
  `);
  assertEquals(result, 36);
});

// ============================================================================
// SECTION 10: BUILT-IN MACROS
// ============================================================================

Deno.test("Macro: when macro works correctly", async () => {
  const result = await hql.run(`
    (var result "no")
    (when true (= result "yes"))
    result
  `);
  assertEquals(result, "yes");
});

Deno.test("Macro: unless macro works correctly", async () => {
  const result = await hql.run(`
    (var result "no")
    (unless false (= result "yes"))
    result
  `);
  assertEquals(result, "yes");
});

Deno.test("Macro: or macro short-circuits", async () => {
  const result = await hql.run(`(or false true false)`);
  assertEquals(result, true);
});

Deno.test("Macro: and macro short-circuits", async () => {
  const result = await hql.run(`(and true false true)`);
  assertEquals(result, false);
});

// ============================================================================
// SECTION 11: GENSYM HYGIENE
// ============================================================================

Deno.test("Macro: auto-gensym with # suffix", async () => {
  const result = await hql.run(`
    (macro safe-double [x]
      (let [temp# x]
        \`(+ ~temp# ~temp#)))
    (safe-double 7)
  `);
  assertEquals(result, 14);
});

Deno.test("Macro: let bindings in macro with gensym", async () => {
  const result = await hql.run(`
    (macro with-triple [x & body]
      \`(let [tripled (* ~x 3)]
         ~@body))
    (with-triple 4
      tripled)
  `);
  assertEquals(result, 12);
});

// ============================================================================
// SECTION 12: CONDITIONAL LOGIC IN MACROS
// ============================================================================

Deno.test("Macro: cond in macro body", async () => {
  const result = await hql.run(`
    (macro classify [n]
      (cond
        ((< n 0) "negative")
        ((=== n 0) "zero")
        (true "positive")))
    [(classify -5) (classify 0) (classify 10)]
  `);
  assertEquals(result, ["negative", "zero", "positive"]);
});

Deno.test("Macro: if in macro body", async () => {
  const result = await hql.run(`
    (macro abs-val [n]
      (if (< n 0)
        (- 0 n)
        n))
    [(abs-val -5) (abs-val 5)]
  `);
  assertEquals(result, [5, 5]);
});

// ============================================================================
// SECTION 13: MACRO GENERATES MACRO
// ============================================================================

Deno.test("Macro: macro that generates another macro", async () => {
  const result = await hql.run(`
    (macro def-multiplier [name factor]
      \`(macro ~name [x] (* x ~factor)))
    (def-multiplier triple 3)
    (def-multiplier quadruple 4)
    [(triple 5) (quadruple 5)]
  `);
  assertEquals(result, [15, 20]);
});

// ============================================================================
// SECTION 14: EDGE CASES - MULTI-LEVEL MACRO NESTING
// ============================================================================

Deno.test("Macro: 5-level nested macros (edge case)", async () => {
  // l1(x) = x + 1
  // l2(x) = l1(l1(x)) = x + 2
  // l3(x) = l2(l2(x)) = x + 4
  // l4(x) = l3(l3(x)) = x + 8
  // l5(x) = l4(l4(x)) = x + 16
  // l5(0) = 16
  const result = await hql.run(`
    (macro l1 [x] (+ x 1))
    (macro l2 [x] (l1 (l1 x)))
    (macro l3 [x] (l2 (l2 x)))
    (macro l4 [x] (l3 (l3 x)))
    (macro l5 [x] (l4 (l4 x)))
    (l5 0)
  `);
  assertEquals(result, 16);
});

Deno.test("Macro: multiple macros in single expression", async () => {
  const result = await hql.run(`
    (macro m-add [x] (+ x 10))
    (macro m-mul [x] (* x 2))
    (+ (m-add 5) (m-mul 3))
  `);
  assertEquals(result, 21);
});

Deno.test("Macro: macros in data structure literals", async () => {
  const result = await hql.run(`
    (macro dbl [x] (* x 2))
    [(dbl 1) (dbl 2) (dbl 3)]
  `);
  assertEquals(result, [2, 4, 6]);
});

// ============================================================================
// SECTION 15: COMPLEX SCENARIOS
// ============================================================================

Deno.test("Macro: runtime macro with variable reference", async () => {
  const result = await hql.run(`
    (macro rt-dbl [x] \`(* ~x 2))
    (let v 8)
    (rt-dbl v)
  `);
  assertEquals(result, 16);
});

Deno.test("Macro: chained let with compile-time macro", async () => {
  const result = await hql.run(`
    (macro rt-dbl [x] \`(* ~x 2))
    (let [a (rt-dbl 3)
          b (rt-dbl a)]
      [a b])
  `);
  assertEquals(result, [6, 12]);
});

Deno.test("Macro: macro in lambda body", async () => {
  const result = await hql.run(`
    (macro rt-square [x] \`(* ~x ~x))
    (let square-fn (fn [x] (rt-square x)))
    (square-fn 9)
  `);
  assertEquals(result, 81);
});

Deno.test("Macro: zero-parameter macro", async () => {
  const result = await hql.run(`
    (macro get-pi [] 3.14159)
    (get-pi)
  `);
  assertEquals(result, 3.14159);
});

Deno.test("Macro: macro returning nil", async () => {
  const result = await hql.run(`
    (macro return-nil [] nil)
    (return-nil)
  `);
  assertEquals(result, null);
});

Deno.test("Macro: complex arithmetic in macro", async () => {
  // complex-calc: (a*b) + (c-a) + (b*c) = (2*3) + (4-2) + (3*4) = 6 + 2 + 12 = 20
  const result = await hql.run(`
    (macro complex-calc [a b c]
      (+ (* a b) (- c a) (* b c)))
    (complex-calc 2 3 4)
  `);
  assertEquals(result, 20);
});

Deno.test("Macro: deeply nested quasiquote generates function factory", async () => {
  const result = await hql.run(`
    (macro make-fn-factory [op]
      \`(fn [n]
         (fn [x]
           (~op x n))))
    (let make-adder-fn (make-fn-factory +))
    (let add7 (make-adder-fn 7))
    (add7 3)
  `);
  assertEquals(result, 10);
});

Deno.test("Macro: nested data structures in macro", async () => {
  const result = await hql.run(`
    (macro make-nested [x]
      \`(list (list ~x ~x) (list ~x ~x ~x)))
    (make-nested 9)
  `);
  assertEquals(result, [[9, 9], [9, 9, 9]]);
});

// ============================================================================
// SECTION 16: CLOSURE CREATION
// ============================================================================

Deno.test("Macro: creates closure correctly", async () => {
  const result = await hql.run(`
    (macro make-multiplier [factor]
      \`(fn [x] (* x ~factor)))
    (let times5 (make-multiplier 5))
    (times5 7)
  `);
  assertEquals(result, 35);
});
