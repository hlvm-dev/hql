import {
  assertEquals,
  assertMatch,
  assertNotEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { macroexpand } from "../../mod.ts";
import { transpileToJavascript } from "../../src/hql/transpiler/hql-transpiler.ts";
import { resetGensymCounter } from "../../src/hql/gensym.ts";

function resetCounter() {
  resetGensymCounter();
}

// =============================================================================
// EDGE CASES: Position within quasiquote
// =============================================================================

Deno.test("auto-gensym: symbol in function position", async () => {
  resetCounter();
  const source = `(do
    (macro call-with-temp [f]
      \`(let (tmp# 42)
         (tmp# tmp#)))
    (call-with-temp identity))`;

  const [expanded] = await macroexpand(source);
  // tmp# should be same in all 3 positions (let binding, fn position, arg position)
  const matches = expanded.match(/tmp_\d+/g);
  assertEquals(matches?.length, 3);
  assertEquals(matches?.[0], matches?.[1]);
  assertEquals(matches?.[1], matches?.[2]);
});

Deno.test("auto-gensym: deeply nested in lists", async () => {
  resetCounter();
  const source = `(do
    (macro deep-nest []
      \`(if true
         (let (x# 1)
           (do
             (print x#)
             (+ x# x#)))))
    (deep-nest))`;

  const [expanded] = await macroexpand(source);
  const matches = expanded.match(/x_\d+/g);
  // x# appears 4 times: let binding, print arg, + arg1, + arg2
  assertEquals(matches?.length, 4);
  // All should be same symbol
  const unique = new Set(matches);
  assertEquals(unique.size, 1);
});

Deno.test("auto-gensym: in vector literal", async () => {
  resetCounter();
  const source = `(do
    (macro vec-test []
      \`[a# b# a#])
    (vec-test))`;

  const [expanded] = await macroexpand(source);
  const aMatches = expanded.match(/a_\d+/g);
  const bMatches = expanded.match(/b_\d+/g);
  // a# appears twice, b# once
  assertEquals(aMatches?.length, 2);
  assertEquals(bMatches?.length, 1);
  // Both a# should be same
  assertEquals(aMatches?.[0], aMatches?.[1]);
  // a# and b# should be different
  assertNotEquals(aMatches?.[0], bMatches?.[0]);
});

// =============================================================================
// EDGE CASES: Interaction with unquote
// =============================================================================

Deno.test("auto-gensym: not transformed inside unquote", async () => {
  resetCounter();
  // x# inside ~(...) should NOT be auto-gensymed because unquote evaluates
  const source = `(do
    (macro test-unquote [x#]
      \`(+ tmp# ~x#))
    (test-unquote 5))`;

  const [expanded] = await macroexpand(source);
  // tmp# should be transformed
  assertMatch(expanded, /tmp_\d+/);
  // The ~x# evaluates x# as macro parameter, not as auto-gensym
  // Since x# is a parameter name, it should evaluate to the argument (5)
  assertMatch(expanded, /5/);
});

Deno.test("auto-gensym: works alongside manual gensym", async () => {
  resetCounter();
  const source = `(do
    (macro hybrid [val]
      (var manual (gensym "manual"))
      \`(let (~manual ~val auto# 2)
         (+ ~manual auto#)))
    (hybrid 10))`;

  const [expanded] = await macroexpand(source);
  // Should have both manual_N and auto_N
  assertMatch(expanded, /manual_\d+/);
  assertMatch(expanded, /auto_\d+/);
});

// =============================================================================
// REAL-WORLD: Match macro pattern
// =============================================================================

Deno.test("auto-gensym: match macro pattern (real world)", async () => {
  resetCounter();
  // This mimics the actual match macro pattern
  const source = `(do
    (macro my-match [value & clauses]
      \`(let (val# ~value)
         (if (=== val# 1) "one"
             (if (=== val# 2) "two"
                 "other"))))
    (my-match (+ 1 1)))`;

  const [expanded] = await macroexpand(source);
  // val# should appear multiple times, all same symbol
  const matches = expanded.match(/val_\d+/g);
  assertEquals(matches?.length, 3); // let binding + 2 comparisons
  const unique = new Set(matches);
  assertEquals(unique.size, 1);
});

// =============================================================================
// CORRECTNESS: Actually compiles and runs
// =============================================================================

Deno.test("auto-gensym: compiles to valid JavaScript", async () => {
  resetCounter();
  // Note: tmp# in body ~@body is USER code, not macro template code
  // So it won't be transformed (correct Clojure semantics)
  // The macro must explicitly provide a way to reference the binding
  const source = `(do
    (macro with-temp [val]
      \`(let (tmp# ~val)
         (+ tmp# 1)))

    (with-temp 42))`;

  // Should compile without error
  const result = await transpileToJavascript(source, {});

  // Should have a variable declaration with generated name
  assertMatch(result.code, /let\s+tmp_\d+\s*=/);
  // Should use that variable in the addition
  assertMatch(result.code, /tmp_\d+\s*\+\s*1/);
});

Deno.test("auto-gensym: swap macro compiles and would work", async () => {
  resetCounter();
  const source = `
    (macro my-swap [a b]
      \`(let (temp# ~a)
         (= ~a ~b)
         (= ~b temp#)))

    (fn []
      (var x 1)
      (var y 2)
      (my-swap x y)
      [x y])`;

  const result = await transpileToJavascript(source, {});

  // Verify the generated code structure
  assertMatch(result.code, /let\s+temp_\d+\s*=\s*x/);
  assertMatch(result.code, /x\s*=\s*y/);
  assertMatch(result.code, /y\s*=\s*temp_\d+/);
});

// =============================================================================
// ISOLATION: Each macro call gets fresh symbols
// =============================================================================

Deno.test("auto-gensym: multiple calls are isolated", async () => {
  resetCounter();
  const source = `(do
    (macro make-binding []
      \`(let (x# 1) x#))

    (do
      (make-binding)
      (make-binding)
      (make-binding)))`;

  const [expanded] = await macroexpand(source);
  const matches = expanded.match(/x_\d+/g);
  // 6 total: 2 per call (binding + usage) × 3 calls
  assertEquals(matches?.length, 6);

  // Extract unique numbers
  const numbers = matches?.map(m => m.match(/\d+/)?.[0]);
  const uniqueNumbers = new Set(numbers);
  // Should have 3 different numbers (one per macro call)
  assertEquals(uniqueNumbers.size, 3);
});

// =============================================================================
// EDGE: Special characters and names
// =============================================================================

Deno.test("auto-gensym: works with various prefix names", async () => {
  resetCounter();
  const source = `(do
    (macro test-names []
      \`(do
         a#
         abc#
         a-b-c#
         ABC#
         _private#))
    (test-names))`;

  const [expanded] = await macroexpand(source);
  assertMatch(expanded, /a_\d+/);
  assertMatch(expanded, /abc_\d+/);
  assertMatch(expanded, /a-b-c_\d+/);
  assertMatch(expanded, /ABC_\d+/);
  assertMatch(expanded, /_private_\d+/);
});

Deno.test("auto-gensym: single character prefix works", async () => {
  resetCounter();
  const source = `(do
    (macro single-char []
      \`(let (x# 1 y# 2) (+ x# y#)))
    (single-char))`;

  const [expanded] = await macroexpand(source);
  assertMatch(expanded, /x_\d+/);
  assertMatch(expanded, /y_\d+/);
});
