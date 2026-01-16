import {
  assertEquals,
  assertMatch,
  assertNotEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { macroexpand } from "../../mod.ts";
import { resetGensymCounter } from "../../src/hql/gensym.ts";

// Reset gensym counter before each test for predictable results
function resetCounter() {
  resetGensymCounter();
}

Deno.test("auto-gensym: basic foo# syntax generates unique symbol", async () => {
  resetCounter();
  const source = `(do
    (macro test-auto []
      \`(let (tmp# 42) tmp#))
    (test-auto))`;

  const [expanded] = await macroexpand(source);
  // Should contain a generated symbol like tmp_0
  assertMatch(expanded, /tmp_\d+/);
  // Should have the same symbol in both places (let binding and usage)
  const matches = expanded.match(/tmp_\d+/g);
  assertEquals(matches?.length, 2);
  assertEquals(matches?.[0], matches?.[1]);
});

Deno.test("auto-gensym: multiple foo# in same template use same symbol", async () => {
  resetCounter();
  const source = `(do
    (macro swap [a b]
      \`(let (tmp# ~a)
         (= ~a ~b)
         (= ~b tmp#)))
    (swap x y))`;

  const [expanded] = await macroexpand(source);
  // All tmp# should become the same generated symbol
  const matches = expanded.match(/tmp_\d+/g);
  assertEquals(matches?.length, 2);
  assertEquals(matches?.[0], matches?.[1]);
});

Deno.test("auto-gensym: different foo# names generate different symbols", async () => {
  resetCounter();
  const source = `(do
    (macro test-multi []
      \`(let (a# 1 b# 2)
         (+ a# b#)))
    (test-multi))`;

  const [expanded] = await macroexpand(source);
  // Should have a_N and b_N symbols
  assertMatch(expanded, /a_\d+/);
  assertMatch(expanded, /b_\d+/);
  // They should be different
  const aMatches = expanded.match(/a_\d+/g);
  const bMatches = expanded.match(/b_\d+/g);
  assertNotEquals(aMatches?.[0], bMatches?.[0]);
});

Deno.test("auto-gensym: separate macro calls generate different symbols", async () => {
  resetCounter();
  const source = `(do
    (macro make-temp []
      \`(let (tmp# 1) tmp#))
    (do (make-temp) (make-temp)))`;

  const [expanded] = await macroexpand(source);
  // Should have two different tmp_ symbols from two macro calls
  const matches = expanded.match(/tmp_\d+/g);
  // 4 occurrences: 2 per macro call (binding + usage)
  assertEquals(matches?.length, 4);
  // First two should be same (first call), last two should be same (second call)
  assertEquals(matches?.[0], matches?.[1]);
  assertEquals(matches?.[2], matches?.[3]);
  // But different between calls
  assertNotEquals(matches?.[0], matches?.[2]);
});

Deno.test("auto-gensym: works with unquote", async () => {
  resetCounter();
  const source = `(do
    (macro with-temp [value & body]
      \`(let (tmp# ~value)
         ~@body))
    (with-temp 42 (print tmp#)))`;

  const [expanded] = await macroexpand(source);
  // The tmp# in body is unquoted, so it won't be auto-gensymed
  // Only the tmp# in the let binding should be transformed
  assertMatch(expanded, /tmp_\d+/);
});

Deno.test("auto-gensym: real-world swap macro", async () => {
  resetCounter();
  const source = `(do
    (macro my-swap [a b]
      \`(let (temp# ~a)
         (= ~a ~b)
         (= ~b temp#)))
    (my-swap foo bar))`;

  const [expanded] = await macroexpand(source);
  // Verify expansion is correct
  assertMatch(expanded, /\(let \(temp_\d+ foo\)/);
  assertMatch(expanded, /\(= foo bar\)/);
  assertMatch(expanded, /\(= bar temp_\d+\)/);
});

Deno.test("auto-gensym: single # is not treated as auto-gensym", async () => {
  resetCounter();
  // A symbol that is just "#" should not be transformed
  const source = `(do
    (macro test-hash []
      \`(list #))
    (test-hash))`;

  const [expanded] = await macroexpand(source);
  // Should keep # as-is (not transform it)
  assertMatch(expanded, /#/);
});

Deno.test("auto-gensym: preserves non-gensym symbols", async () => {
  resetCounter();
  const source = `(do
    (macro test-mixed [x]
      \`(let (tmp# ~x regular 10)
         (+ tmp# regular)))
    (test-mixed 5))`;

  const [expanded] = await macroexpand(source);
  // tmp# should be transformed, regular should stay
  assertMatch(expanded, /tmp_\d+/);
  assertMatch(expanded, /regular/);
});
