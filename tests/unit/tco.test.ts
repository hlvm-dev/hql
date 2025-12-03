/**
 * Tests for Tail Call Optimization (TCO)
 *
 * TCO transforms tail-recursive functions into while loops automatically,
 * preventing stack overflow for deep recursion.
 *
 * Unlike Clojure (which requires explicit `recur`), HQL detects tail calls
 * at transpile time and transforms them automatically.
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { transpileToJavascript } from "../../src/transpiler/hql-transpiler.ts";

async function transpile(code: string): Promise<string> {
  const result = await transpileToJavascript(code);
  return result.code.trim();
}

async function evalHql(code: string): Promise<unknown> {
  const js = await transpile(code);
  return eval(js);
}

// ==========================================
// Basic Tail Recursion Detection
// ==========================================

Deno.test("TCO: factorial with accumulator (classic tail recursion)", async () => {
  const result = await evalHql(`
    (fn factorial [n acc]
      (if (<= n 1)
        acc
        (factorial (- n 1) (* n acc))))
    (factorial 5 1)
  `);
  assertEquals(result, 120);
});

Deno.test("TCO: factorial computes correctly for various inputs", async () => {
  const result = await evalHql(`
    (fn factorial [n acc]
      (if (<= n 1)
        acc
        (factorial (- n 1) (* n acc))))
    [(factorial 0 1)
     (factorial 1 1)
     (factorial 5 1)
     (factorial 10 1)]
  `);
  assertEquals(result, [1, 1, 120, 3628800]);
});

Deno.test("TCO: sum with accumulator", async () => {
  const result = await evalHql(`
    (fn sum [n acc]
      (if (<= n 0)
        acc
        (sum (- n 1) (+ acc n))))
    (sum 100 0)
  `);
  assertEquals(result, 5050);
});

Deno.test("TCO: countdown returns final value", async () => {
  const result = await evalHql(`
    (fn countdown [n]
      (if (<= n 0)
        "done"
        (countdown (- n 1))))
    (countdown 10)
  `);
  assertEquals(result, "done");
});

// ==========================================
// Fibonacci (Tail-Recursive Version)
// ==========================================

Deno.test("TCO: fibonacci with accumulators", async () => {
  const result = await evalHql(`
    (fn fib [n a b]
      (if (=== n 0)
        a
        (fib (- n 1) b (+ a b))))
    [(fib 0 0 1)
     (fib 1 0 1)
     (fib 10 0 1)
     (fib 20 0 1)]
  `);
  assertEquals(result, [0, 1, 55, 6765]);
});

// ==========================================
// GCD Algorithm (Euclidean)
// ==========================================

Deno.test("TCO: GCD algorithm", async () => {
  const result = await evalHql(`
    (fn gcd [a b]
      (if (=== b 0)
        a
        (gcd b (% a b))))
    [(gcd 48 18)
     (gcd 100 25)
     (gcd 17 13)]
  `);
  assertEquals(result, [6, 25, 1]);
});

// ==========================================
// Deep Recursion (Stack Overflow Prevention)
// ==========================================

Deno.test("TCO: deep recursion does not stack overflow", async () => {
  const result = await evalHql(`
    (fn countdown [n]
      (if (<= n 0)
        0
        (countdown (- n 1))))
    (countdown 50000)
  `);
  assertEquals(result, 0);
});

Deno.test("TCO: deep sum with 10000 iterations", async () => {
  const result = await evalHql(`
    (fn sum [n acc]
      (if (<= n 0)
        acc
        (sum (- n 1) (+ acc n))))
    (sum 10000 0)
  `);
  assertEquals(result, 50005000);
});

// ==========================================
// Non-Tail Recursion (Should NOT Optimize)
// ==========================================

Deno.test("TCO: non-tail recursive function still works", async () => {
  // This is NOT tail recursive - (* n ...) wraps the recursive call
  const result = await evalHql(`
    (fn factorial-naive [n]
      (if (<= n 1)
        1
        (* n (factorial-naive (- n 1)))))
    (factorial-naive 5)
  `);
  assertEquals(result, 120);
});

Deno.test("TCO: non-tail recursive should not have while loop", async () => {
  const js = await transpile(`
    (fn factorial-naive [n]
      (if (<= n 1)
        1
        (* n (factorial-naive (- n 1)))))
  `);
  // Should NOT be transformed (recursive call is not in tail position)
  assertEquals(js.includes("while (true)"), false);
});

// ==========================================
// Non-Recursive Functions (Should NOT Optimize)
// ==========================================

Deno.test("TCO: non-recursive function unchanged", async () => {
  const js = await transpile(`
    (fn add [a b]
      (+ a b))
  `);
  assertEquals(js.includes("while"), false);
});

Deno.test("TCO: non-recursive function with if still works", async () => {
  const result = await evalHql(`
    (fn max [a b]
      (if (> a b) a b))
    [(max 5 3) (max 2 7)]
  `);
  assertEquals(result, [5, 7]);
});

// ==========================================
// Generated Code Verification
// ==========================================

Deno.test("TCO: generates while loop for tail recursion", async () => {
  const js = await transpile(`
    (fn factorial [n acc]
      (if (<= n 1)
        acc
        (factorial (- n 1) (* n acc))))
  `);
  assertStringIncludes(js, "while (true)");
});

Deno.test("TCO: generates destructuring assignment for params", async () => {
  const js = await transpile(`
    (fn factorial [n acc]
      (if (<= n 1)
        acc
        (factorial (- n 1) (* n acc))))
  `);
  // Should have [n, acc] = [...] style assignment
  assertStringIncludes(js, "[n, acc]");
});

Deno.test("TCO: generates proper return for base case", async () => {
  const js = await transpile(`
    (fn countdown [n]
      (if (<= n 0)
        "done"
        (countdown (- n 1))))
  `);
  assertStringIncludes(js, "return");
  assertStringIncludes(js, "done");
});

// ==========================================
// Edge Cases
// ==========================================

Deno.test("TCO: single parameter function", async () => {
  const result = await evalHql(`
    (fn count-to-zero [n]
      (if (<= n 0)
        0
        (count-to-zero (- n 1))))
    (count-to-zero 100)
  `);
  assertEquals(result, 0);
});

Deno.test("TCO: three parameters", async () => {
  const result = await evalHql(`
    (fn triple-acc [n a b c]
      (if (<= n 0)
        [a b c]
        (triple-acc (- n 1) (+ a 1) (+ b 2) (+ c 3))))
    (triple-acc 5 0 0 0)
  `);
  assertEquals(result, [5, 10, 15]);
});

Deno.test("TCO: function with string return", async () => {
  const result = await evalHql(`
    (fn repeat-char [n char acc]
      (if (<= n 0)
        acc
        (repeat-char (- n 1) char (+ acc char))))
    (repeat-char 5 "x" "")
  `);
  assertEquals(result, "xxxxx");
});

Deno.test("TCO: nested conditionals in tail position", async () => {
  const result = await evalHql(`
    (fn classify [n]
      (if (< n 0)
        "negative"
        (if (=== n 0)
          "zero"
          (classify (- n 1)))))
    [(classify 5) (classify 0) (classify -3)]
  `);
  assertEquals(result, ["zero", "zero", "negative"]);
});

// ==========================================
// Multiple Tail Calls in Branches
// ==========================================

Deno.test("TCO: tail calls in both if branches", async () => {
  const result = await evalHql(`
    (fn collatz-length [n steps]
      (if (=== n 1)
        steps
        (if (=== (% n 2) 0)
          (collatz-length (/ n 2) (+ steps 1))
          (collatz-length (+ (* n 3) 1) (+ steps 1)))))
    [(collatz-length 1 0)
     (collatz-length 2 0)
     (collatz-length 6 0)]
  `);
  assertEquals(result, [0, 1, 8]);
});

// ==========================================
// Verify Clojure Semantics Comparison
// ==========================================

Deno.test("TCO: no special syntax needed (unlike Clojure recur)", async () => {
  // In Clojure you'd write: (recur (dec n) (* n acc))
  // In HQL, just write normal recursive call - it's auto-optimized
  const result = await evalHql(`
    (fn factorial [n acc]
      (if (<= n 1)
        acc
        (factorial (- n 1) (* n acc))))
    (factorial 10 1)
  `);
  assertEquals(result, 3628800);
});

// ==========================================
// Integration with Other Features
// ==========================================

Deno.test("TCO: works with let bindings in body", async () => {
  const result = await evalHql(`
    (fn sum-with-let [n acc]
      (let [done (<= n 0)]
        (if done
          acc
          (sum-with-let (- n 1) (+ acc n)))))
    (sum-with-let 10 0)
  `);
  assertEquals(result, 55);
});

Deno.test("TCO: function returning computed value", async () => {
  const result = await evalHql(`
    (fn power [base exp acc]
      (if (<= exp 0)
        acc
        (power base (- exp 1) (* acc base))))
    [(power 2 0 1)
     (power 2 5 1)
     (power 3 4 1)]
  `);
  assertEquals(result, [1, 32, 81]);
});
