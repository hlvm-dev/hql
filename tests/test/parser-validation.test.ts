// test/parser-validation.test.ts
// Comprehensive parser validation tests

import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { parse } from "../../src/transpiler/pipeline/parser.ts";
import { ParseError } from "../../src/common/error.ts";

Deno.test("Parser: balanced parentheses", () => {
  const result = parse("(+ 1 2)");
  assertEquals(result.length, 1);
  assertEquals(result[0].type, "list");
});

Deno.test("Parser: unbalanced parentheses - missing closing", () => {
  assertThrows(
    () => parse("(+ 1 2"),
    ParseError,
    "Unclosed list", // Updated to match actual error message
  );
});

Deno.test("Parser: unbalanced parentheses - extra closing", () => {
  assertThrows(
    () => parse("(+ 1 2))"),
    ParseError,
    "Unexpected ')'",
  );
});

Deno.test("Parser: balanced brackets", () => {
  const result = parse("[1, 2, 3]");
  assertEquals(result.length, 1);
  assertEquals(result[0].type, "list");
});

Deno.test("Parser: unbalanced brackets - missing closing", () => {
  assertThrows(
    () => parse("[1, 2, 3"),
    ParseError,
    "Unclosed vector", // Updated to match actual error message
  );
});

Deno.test("Parser: unbalanced brackets - extra closing", () => {
  assertThrows(
    () => parse("[1, 2, 3]]"),
    ParseError,
    "Unexpected ']'",
  );
});

Deno.test("Parser: balanced braces", () => {
  const result = parse('{"key": "value"}');
  assertEquals(result.length, 1);
  assertEquals(result[0].type, "list");
});

Deno.test("Parser: unbalanced braces - missing closing", () => {
  assertThrows(
    () => parse('{"key": "value"'),
    ParseError,
    "Unclosed map", // Updated to match actual error message
  );
});

Deno.test("Parser: unbalanced braces - extra closing", () => {
  assertThrows(
    () => parse('{"key": "value"}}'),
    ParseError,
    "Unexpected '}'",
  );
});

Deno.test("Parser: nested balanced structures", () => {
  const result = parse('(let x [1, 2, {"a": 3}])');
  assertEquals(result.length, 1);
});

Deno.test("Parser: nested unbalanced - inner missing close", () => {
  assertThrows(
    () => parse('(let x [1, 2, {"a": 3})'),
    ParseError,
  );
});

Deno.test("Parser: mismatched brackets", () => {
  assertThrows(
    () => parse("(let x [1, 2, 3)"),
    Error, // Will fail during parsing
  );
});

Deno.test("Parser: multiple expressions balanced", () => {
  const result = parse("(+ 1 2) (- 3 1) (* 4 5)");
  assertEquals(result.length, 3);
});

Deno.test("Parser: multiple expressions - one unbalanced", () => {
  assertThrows(
    () => parse("(+ 1 2) (- 3 1 (* 4 5)"),
    ParseError,
  );
});

Deno.test("Parser: empty input", () => {
  const result = parse("");
  assertEquals(result.length, 0);
});

Deno.test("Parser: whitespace only", () => {
  const result = parse("   \n  \t  ");
  assertEquals(result.length, 0);
});

Deno.test("Parser: comments only", () => {
  const result = parse(";; This is a comment\n;; Another comment");
  assertEquals(result.length, 0);
});

Deno.test("Parser: code with comments", () => {
  const result = parse(";; Add two numbers\n(+ 1 2)");
  assertEquals(result.length, 1);
});

Deno.test("Parser: string with brackets", () => {
  const result = parse('(print "This has (parens) and [brackets]")');
  assertEquals(result.length, 1);
});

Deno.test("Parser: quote syntax", () => {
  const result = parse("'(1 2 3)");
  assertEquals(result.length, 1);
  assertEquals(result[0].type, "list");
});

Deno.test("Parser: quasiquote syntax", () => {
  const result = parse("`(1 ~x 3)");
  assertEquals(result.length, 1);
});

Deno.test("Parser: complex real-world example", () => {
  const code = `
(fn fibonacci [n]
  (if (<= n 1)
    n
    (+ (fibonacci (- n 1))
       (fibonacci (- n 2)))))
`;
  const result = parse(code);
  assertEquals(result.length, 1);
});

Deno.test("Parser: import statement validation", () => {
  const result = parse('(import [add] from "./math.hql")');
  assertEquals(result.length, 1);
});
