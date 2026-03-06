import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { ParseError } from "../../src/common/error.ts";
import { parse } from "../../src/hql/transpiler/pipeline/parser.ts";

Deno.test("parser validation: accepts balanced core delimiters and nested structures", () => {
  const samples = [
    "(+ 1 2)",
    "[1, 2, 3]",
    '{"key": "value"}',
    '(let x [1, 2, {"a": 3}])',
    "(+ 1 2) (- 3 1) (* 4 5)",
    "'(1 2 3)",
    "`(1 ~x 3)",
    '(import [add] from "./math.hql")',
  ];

  for (const source of samples) {
    assert(parse(source).length > 0, source);
  }

  assertEquals(parse("(+ 1 2) (- 3 1) (* 4 5)").length, 3);
});

Deno.test("parser validation: rejects unbalanced and mismatched delimiters", () => {
  assertThrows(() => parse("(+ 1 2"), ParseError, "Unclosed list");
  assertThrows(() => parse("(+ 1 2))"), ParseError, "Unexpected ')'"
  );
  assertThrows(() => parse("[1, 2, 3"), ParseError, "Unclosed vector");
  assertThrows(() => parse("[1, 2, 3]]"), ParseError, "Unexpected ']'"
  );
  assertThrows(() => parse('{"key": "value"'), ParseError, "Unclosed map");
  assertThrows(() => parse('{"key": "value"}}'), ParseError, "Unexpected '}'"
  );
  assertThrows(() => parse("(let x [1, 2, 3)"), Error);
  assertThrows(() => parse("(+ 1 2) (- 3 1 (* 4 5)"), ParseError);
});

Deno.test("parser validation: ignores empty input and comments", () => {
  assertEquals(parse("").length, 0);
  assertEquals(parse("   \n  \t  ").length, 0);
  assertEquals(parse("// This is a comment\n// Another comment").length, 0);
  assertEquals(parse("// Add two numbers\n(+ 1 2)").length, 1);
});

Deno.test("parser validation: treats delimiters inside strings as plain text", () => {
  const result = parse('(print "This has (parens) and [brackets]")');
  assertEquals(result.length, 1);
});

Deno.test("parser validation: parses realistic nested code", () => {
  const result = parse(`
(fn fibonacci [n]
  (if (<= n 1)
    n
    (+ (fibonacci (- n 1))
       (fibonacci (- n 2)))))
`);
  assertEquals(result.length, 1);
});

Deno.test("parser validation: template interpolation accepts exactly one expression", () => {
  assertEquals(parse("`value=${(+ 1 2)}`").length, 1);
  assertThrows(
    () => parse("`value=${a b}`"),
    ParseError,
    "must contain exactly one expression",
  );
  assertThrows(
    () => parse("`value=${}`"),
    ParseError,
    "Empty expression in template literal interpolation",
  );
  assertThrows(
    () => parse("`value=${{a}`"),
    ParseError,
    "Unclosed template interpolation",
  );
});

Deno.test("parser validation: nesting depth limit applies across template interpolation", () => {
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
