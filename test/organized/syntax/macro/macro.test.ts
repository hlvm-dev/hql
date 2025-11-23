// test/organized/syntax/macro/macro.test.ts
// Comprehensive tests for quote, quasiquote, unquote, and unquote-splicing
// Based on quote.ts implementation and macro usage patterns

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "../../../helpers.ts";

// ============================================================================
// SECTION 1: QUOTE - PREVENTING EVALUATION
// ============================================================================

Deno.test("Quote: quote symbol returns string", async () => {
  const code = `(quote x)`;
  const result = await run(code);
  assertEquals(result, "x");
});

Deno.test("Quote: quote number returns number", async () => {
  const code = `(quote 42)`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Quote: quote string returns string", async () => {
  const code = `(quote "hello")`;
  const result = await run(code);
  assertEquals(result, "hello");
});

Deno.test("Quote: quote boolean returns boolean", async () => {
  const code = `(quote true)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Quote: quote null literal", async () => {
  const code = `(quote null)`;
  const result = await run(code);
  // null is treated as a symbol and returns string "null"
  assertEquals(result, "null");
});

Deno.test("Quote: quote empty list returns empty array", async () => {
  const code = `(quote ())`;
  const result = await run(code);
  assertEquals(result, []);
});

Deno.test("Quote: quote list of symbols returns array of strings", async () => {
  const code = `(quote (a b c))`;
  const result = await run(code);
  assertEquals(result, ["a", "b", "c"]);
});

Deno.test("Quote: quote nested list", async () => {
  const code = `(quote (a (b c) d))`;
  const result = await run(code);
  assertEquals(result, ["a", ["b", "c"], "d"]);
});

// ============================================================================
// SECTION 2: QUASIQUOTE - TEMPLATE WITH INTERPOLATION
// ============================================================================

Deno.test("Quasiquote: quasiquote without unquote acts like quote", async () => {
  const code = `(quasiquote (a b c))`;
  const result = await run(code);
  assertEquals(result, ["a", "b", "c"]);
});

Deno.test("Quasiquote: quasiquote with unquote evaluates expression", async () => {
  const code = `
(var x 10)
(quasiquote (a (unquote x) c))
`;
  const result = await run(code);
  assertEquals(result, ["a", 10, "c"]);
});

Deno.test("Quasiquote: quasiquote with multiple unquotes", async () => {
  const code = `
(var x 5)
(var y 10)
(quasiquote ((unquote x) (unquote y) (unquote (+ x y))))
`;
  const result = await run(code);
  assertEquals(result, [5, 10, 15]);
});

Deno.test("Quasiquote: quasiquote with unquote-splicing", async () => {
  const code = `
(var nums [1, 2, 3])
(quasiquote (a (unquote-splicing nums) b))
`;
  const result = await run(code);
  assertEquals(result, ["a", 1, 2, 3, "b"]);
});

Deno.test("Quasiquote: quasiquote with multiple unquote-splicings", async () => {
  const code = `
(var first [1, 2])
(var second [3, 4])
(quasiquote ((unquote-splicing first) (unquote-splicing second)))
`;
  const result = await run(code);
  assertEquals(result, [1, 2, 3, 4]);
});

// ============================================================================
// SECTION 3: BACKTICK SYNTAX (SHORTHAND FOR QUASIQUOTE)
// ============================================================================

Deno.test("Backtick: backtick without tilde acts like quote", async () => {
  const code = "`" + "(a b c)";
  const result = await run(code);
  assertEquals(result, ["a", "b", "c"]);
});

Deno.test("Backtick: backtick with tilde (~) for unquote", async () => {
  const code = "(var x 42)\n" + "`" + "(result is ~x)";
  const result = await run(code);
  assertEquals(result, ["result", "is", 42]);
});

Deno.test("Backtick: backtick with ~@ for unquote-splicing", async () => {
  const code = '(var items ["apple", "banana", "cherry"])\n' + "`" +
    "(fruits: ~@items)";
  const result = await run(code);
  assertEquals(result, ["fruits:", "apple", "banana", "cherry"]);
});

// ============================================================================
// SECTION 4: QUOTE IN MACRO CONTEXTS
// ============================================================================

Deno.test("Quote: macro using quasiquote and unquote", async () => {
  const code = "(macro when (condition body)\n  " + "`" +
    '(if ~condition ~body null))\n(var x 10)\n(when (> x 5) "x is greater than 5")';
  const result = await run(code);
  assertEquals(result, "x is greater than 5");
});

Deno.test("Quote: macro with unquote-splicing for variadic arguments", async () => {
  const code = "(macro log-all (items)\n  " + "`" +
    "(do ~@items))\n(log-all ((var a 1) (var b 2) (+ a b)))";
  const result = await run(code);
  assertEquals(result, 3);
});

// ============================================================================
// SECTION 5: NESTED QUASIQUOTES
// ============================================================================

Deno.test("Quote: nested quasiquote with unquote", async () => {
  const code = `
(var x 100)
(quasiquote (outer (unquote x)))
`;
  const result = await run(code);
  assertEquals(result, ["outer", 100]);
});

Deno.test("Quote: quasiquote with complex expression in unquote", async () => {
  const code = "(var a 5)\n(var b 10)\n" + "`" + "(sum is ~(+ a b))";
  const result = await run(code);
  assertEquals(result, ["sum", "is", 15]);
});
