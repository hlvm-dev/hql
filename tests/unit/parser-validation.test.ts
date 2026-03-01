// test/parser-validation.test.ts
// Comprehensive parser validation tests

import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { parse } from "../../src/hql/transpiler/pipeline/parser.ts";
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
  const result = parse("// This is a comment\n// Another comment");
  assertEquals(result.length, 0);
});

Deno.test("Parser: code with comments", () => {
  const result = parse("// Add two numbers\n(+ 1 2)");
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

Deno.test("Parser: template interpolation must contain one expression", () => {
  assertThrows(
    () => parse("`value=${a b}`"),
    ParseError,
    "must contain exactly one expression",
  );
});

Deno.test("Parser: template interpolation cannot be empty", () => {
  assertThrows(
    () => parse("`value=${}`"),
    ParseError,
    "Empty expression in template literal interpolation",
  );
});

Deno.test("Parser: template interpolation rejects unclosed expression", () => {
  assertThrows(
    () => parse("`value=${{a}`"),
    ParseError,
    "Unclosed template interpolation",
  );
});

Deno.test("Parser: template interpolation with single expression is valid", () => {
  const result = parse("`value=${(+ 1 2)}`");
  assertEquals(result.length, 1);
});

Deno.test("Parser: nested template interpolation respects max parsing depth", () => {
  // PARSER_LIMITS.MAX_PARSING_DEPTH is 128.
  // Outer form depth is below the limit, interpolation expression depth is also below
  // the limit, but combined depth should exceed the global limit when propagated.
  const outerDepth = 100;
  const interpolationDepth = 40;
  let interpolationExpr = "x";

  for (let i = 0; i < interpolationDepth; i++) {
    interpolationExpr = `(+ 1 ${interpolationExpr})`;
  }
  const template = "`value=${" + interpolationExpr + "}`";
  const source = "(".repeat(outerDepth) + template + ")".repeat(outerDepth);

  assertThrows(
    () => parse(source),
    ParseError,
    "Maximum nesting depth exceeded",
  );
});
