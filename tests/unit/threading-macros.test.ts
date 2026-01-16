/**
 * Tests for Clojure-compatible threading macros: ->, ->>, as->
 */

import { assertEquals } from "jsr:@std/assert";
import { transpileToJavascript } from "../../src/hql/transpiler/hql-transpiler.ts";

async function transpile(code: string): Promise<string> {
  const result = await transpileToJavascript(code);
  return result.code.trim();
}

async function evalHql(code: string): Promise<unknown> {
  const js = await transpile(code);
  return eval(js);
}

// ==========================================
// Thread-First Macro (->)
// ==========================================

Deno.test("-> with single form (no threading)", async () => {
  const result = await evalHql(`(-> 5)`);
  assertEquals(result, 5);
});

Deno.test("-> with symbol forms", async () => {
  // (-> 5 inc inc) => (inc (inc 5)) => 7
  const result = await evalHql(`
    (fn inc [x] (+ x 1))
    (-> 5 inc inc)
  `);
  assertEquals(result, 7);
});

Deno.test("-> with list forms inserts as first arg", async () => {
  // (-> 10 (- 3) (- 1)) => (- (- 10 3) 1) => (- 7 1) => 6
  const result = await evalHql(`(-> 10 (- 3) (- 1))`);
  assertEquals(result, 6);
});

Deno.test("-> with mixed forms", async () => {
  // (-> 5 inc (- 2)) => (- (inc 5) 2) => (- 6 2) => 4
  const result = await evalHql(`
    (fn inc [x] (+ x 1))
    (-> 5 inc (- 2))
  `);
  assertEquals(result, 4);
});

Deno.test("-> with function chaining", async () => {
  // Test threading through multiple function calls
  const result = await evalHql(`
    (fn double [x] (* x 2))
    (fn add-ten [x] (+ x 10))
    (-> 5 double add-ten double)
  `);
  // 5 -> double -> 10 -> add-ten -> 20 -> double -> 40
  assertEquals(result, 40);
});

// ==========================================
// Thread-Last Macro (->>)
// ==========================================

Deno.test("->> with single form (no threading)", async () => {
  const result = await evalHql(`(->> 5)`);
  assertEquals(result, 5);
});

Deno.test("->> with symbol forms", async () => {
  // (->> 5 inc inc) => (inc (inc 5)) => 7
  const result = await evalHql(`
    (fn inc [x] (+ x 1))
    (->> 5 inc inc)
  `);
  assertEquals(result, 7);
});

Deno.test("->> inserts as last arg", async () => {
  // (->> 2 (- 10)) => (- 10 2) => 8
  const result = await evalHql(`(->> 2 (- 10))`);
  assertEquals(result, 8);
});

Deno.test("->> with multiple list forms", async () => {
  // (->> 1 (+ 2) (* 3)) => (* (+ 2 1) 3) => (* 3 3) => 9
  const result = await evalHql(`(->> 1 (+ 2) (* 3))`);
  assertEquals(result, 9);
});

// ==========================================
// Thread-As Macro (as->)
// ==========================================

Deno.test("as-> with single form (no threading)", async () => {
  const result = await evalHql(`(as-> 5 $)`);
  assertEquals(result, 5);
});

Deno.test("as-> allows arbitrary placement", async () => {
  // (as-> 5 $ (- 10 $)) => (- 10 5) => 5
  const result = await evalHql(`(as-> 5 $ (- 10 $))`);
  assertEquals(result, 5);
});

Deno.test("as-> with multiple forms", async () => {
  // (as-> 2 x (+ x 1) (* x 3)) => (* (+ 2 1) 3) => (* 3 3) => 9
  const result = await evalHql(`(as-> 2 x (+ x 1) (* x 3))`);
  assertEquals(result, 9);
});

Deno.test("as-> with mixed placement", async () => {
  // (as-> 5 x (+ x 1) (- 10 x) (* x 2))
  // x=5 -> (+ 5 1)=6 -> (- 10 6)=4 -> (* 4 2)=8
  const result = await evalHql(`(as-> 5 x (+ x 1) (- 10 x) (* x 2))`);
  assertEquals(result, 8);
});

// ==========================================
// Comparison: Thread-First vs Thread-Last
// ==========================================

Deno.test("-> vs ->> difference with subtraction", async () => {
  // -> inserts as first: (-> 10 (- 3)) => (- 10 3) => 7
  const threadFirst = await evalHql(`(-> 10 (- 3))`);
  assertEquals(threadFirst, 7);

  // ->> inserts as last: (->> 10 (- 3)) => (- 3 10) => -7
  const threadLast = await evalHql(`(->> 10 (- 3))`);
  assertEquals(threadLast, -7);
});

// ==========================================
// Generated Code Quality
// ==========================================

Deno.test("-> generates direct nested calls (no runtime overhead)", async () => {
  const js = await transpile(`(-> x (f a) (g b))`);
  // Should NOT contain any threading macro artifacts
  // Should be direct nested call: g(f(x, a), b)
  assertEquals(js.includes("->"), false, "Should not contain -> in output");
});

Deno.test("->> generates direct nested calls (no runtime overhead)", async () => {
  const js = await transpile(`(->> x (f a) (g b))`);
  // Should NOT contain any threading macro artifacts
  assertEquals(js.includes("->>"), false, "Should not contain ->> in output");
});

// ==========================================
// Generated Code Verification (Exact Output)
// ==========================================

Deno.test("-> generates correct nested structure", async () => {
  const js = await transpile(`(-> 1 (+ 2) (* 3))`);
  // (-> 1 (+ 2) (* 3)) => (* (+ 1 2) 3)
  // Should generate: (1 + 2) * 3
  assertEquals(js.includes("(1 + 2) * 3"), true, `Expected nested structure, got: ${js}`);
});

Deno.test("->> generates correct nested structure", async () => {
  const js = await transpile(`(->> 1 (+ 2) (* 3))`);
  // (->> 1 (+ 2) (* 3)) => (* 3 (+ 2 1))
  // Should generate: 3 * (2 + 1)
  assertEquals(js.includes("3 * (2 + 1)"), true, `Expected nested structure, got: ${js}`);
});

// ==========================================
// Edge Cases
// ==========================================

Deno.test("-> with deeply nested forms", async () => {
  const result = await evalHql(`(-> 1 (+ 1) (+ 1) (+ 1) (+ 1) (+ 1))`);
  // 1 + 1 + 1 + 1 + 1 + 1 = 6
  assertEquals(result, 6);
});

Deno.test("->> with deeply nested forms", async () => {
  const result = await evalHql(`(->> 1 (+ 1) (+ 1) (+ 1) (+ 1) (+ 1))`);
  // All additions are commutative so same result
  assertEquals(result, 6);
});

Deno.test("-> nested inside ->>", async () => {
  // (->> 5 (+ (-> 2 (* 3))))
  // Inner: (-> 2 (* 3)) => (* 2 3) = 6
  // Outer: (->> 5 (+ 6)) => (+ 6 5) = 11
  const result = await evalHql(`(->> 5 (+ (-> 2 (* 3))))`);
  assertEquals(result, 11);
});

Deno.test("->> nested inside ->", async () => {
  // (-> 5 (+ (->> 2 (* 3))))
  // Inner: (->> 2 (* 3)) => (* 3 2) = 6
  // Outer: (-> 5 (+ 6)) => (+ 5 6) = 11
  const result = await evalHql(`(-> 5 (+ (->> 2 (* 3))))`);
  assertEquals(result, 11);
});

Deno.test("as-> with symbol that shadows outer binding", async () => {
  // Ensure the binding is properly scoped
  const result = await evalHql(`
    (let [x 100]
      (as-> 5 x (+ x 1) (* x 2)))
  `);
  // as-> creates its own binding, so x=5 -> 6 -> 12
  assertEquals(result, 12);
});

// ==========================================
// Verify Clojure Semantics
// ==========================================

Deno.test("-> Clojure semantics: division order matters", async () => {
  // (-> 100 (/ 10) (/ 2)) => (/ (/ 100 10) 2) => (/ 10 2) => 5
  const result = await evalHql(`(-> 100 (/ 10) (/ 2))`);
  assertEquals(result, 5);
});

Deno.test("->> Clojure semantics: division order matters", async () => {
  // (->> 100 (/ 10) (/ 2)) => (/ 2 (/ 10 100)) => (/ 2 0.1) => 20
  const result = await evalHql(`(->> 100 (/ 10) (/ 2))`);
  assertEquals(result, 20);
});
