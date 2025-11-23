// Tests for Phase 1.2: Pattern Recognition
// Tests the couldBePattern() function that distinguishes patterns from literals

import { assertEquals } from "jsr:@std/assert@1";
import {
  couldBePattern,
  createList,
  createLiteral,
  createSymbol,
} from "../core/src/s-exp/types.ts";

Deno.test("Pattern Recognition: Simple symbols are patterns", () => {
  const symbol = createSymbol("x");
  assertEquals(
    couldBePattern(symbol),
    true,
    "Symbol 'x' should be recognized as potential pattern",
  );
});

Deno.test("Pattern Recognition: Literals are NOT patterns", () => {
  assertEquals(
    couldBePattern(createLiteral(42)),
    false,
    "Number literal should NOT be pattern",
  );
  assertEquals(
    couldBePattern(createLiteral("hello")),
    false,
    "String literal should NOT be pattern",
  );
  assertEquals(
    couldBePattern(createLiteral(true)),
    false,
    "Boolean literal should NOT be pattern",
  );
  assertEquals(
    couldBePattern(createLiteral(null)),
    false,
    "Null literal should NOT be pattern",
  );
});

Deno.test("Pattern Recognition: Empty list is valid pattern", () => {
  const emptyList = createList();
  assertEquals(
    couldBePattern(emptyList),
    true,
    "Empty list [] should be valid pattern",
  );
});

Deno.test("Pattern Recognition: List of symbols is pattern", () => {
  // [x y z]
  const pattern = createList(
    createSymbol("x"),
    createSymbol("y"),
    createSymbol("z"),
  );
  assertEquals(
    couldBePattern(pattern),
    true,
    "[x y z] should be recognized as pattern",
  );
});

Deno.test("Pattern Recognition: List with underscore (skip) is pattern", () => {
  // [x _ z]
  const pattern = createList(
    createSymbol("x"),
    createSymbol("_"),
    createSymbol("z"),
  );
  assertEquals(
    couldBePattern(pattern),
    true,
    "[x _ z] should be recognized as pattern",
  );
});

Deno.test("Pattern Recognition: List with rest is pattern", () => {
  // [x & rest]
  const pattern = createList(
    createSymbol("x"),
    createSymbol("&"),
    createSymbol("rest"),
  );
  assertEquals(
    couldBePattern(pattern),
    true,
    "[x & rest] should be recognized as pattern",
  );
});

Deno.test("Pattern Recognition: List with default value is pattern", () => {
  // [x (= 10)]
  const pattern = createList(
    createSymbol("x"),
    createList(createSymbol("="), createLiteral(10)),
  );
  assertEquals(
    couldBePattern(pattern),
    true,
    "[x (= 10)] should be recognized as pattern",
  );
});

Deno.test("Pattern Recognition: Nested list of symbols is pattern", () => {
  // [[x y] [a b]]
  const pattern = createList(
    createList(createSymbol("x"), createSymbol("y")),
    createList(createSymbol("a"), createSymbol("b")),
  );
  assertEquals(
    couldBePattern(pattern),
    true,
    "[[x y] [a b]] should be recognized as pattern",
  );
});

Deno.test("Pattern Recognition: List with literals is NOT pattern (array literal)", () => {
  // [1 2 3]
  const arrayLiteral = createList(
    createLiteral(1),
    createLiteral(2),
    createLiteral(3),
  );
  assertEquals(
    couldBePattern(arrayLiteral),
    false,
    "[1 2 3] should be array literal, NOT pattern",
  );
});

Deno.test("Pattern Recognition: Mixed symbols and literals is NOT pattern", () => {
  // [x 2 y]
  const mixed = createList(
    createSymbol("x"),
    createLiteral(2),
    createSymbol("y"),
  );
  assertEquals(
    couldBePattern(mixed),
    false,
    "[x 2 y] should NOT be pattern (contains literal)",
  );
});

Deno.test("Pattern Recognition: List with function call is NOT pattern", () => {
  // [x (+ 1 2)]
  const withFunctionCall = createList(
    createSymbol("x"),
    createList(createSymbol("+"), createLiteral(1), createLiteral(2)),
  );
  assertEquals(
    couldBePattern(withFunctionCall),
    false,
    "[x (+ 1 2)] should NOT be pattern (contains function call)",
  );
});

Deno.test("Pattern Recognition: Rest must be second-to-last (invalid)", () => {
  // [& rest x] - rest not at end
  const invalidRest = createList(
    createSymbol("&"),
    createSymbol("rest"),
    createSymbol("x"),
  );
  assertEquals(
    couldBePattern(invalidRest),
    false,
    "[& rest x] should be invalid (rest not at end)",
  );
});

Deno.test("Pattern Recognition: Rest must be followed by identifier", () => {
  // [x &] - no identifier after &
  const invalidRest = createList(
    createSymbol("x"),
    createSymbol("&"),
  );
  assertEquals(
    couldBePattern(invalidRest),
    false,
    "[x &] should be invalid (no identifier after &)",
  );
});

Deno.test("Pattern Recognition: Complex valid pattern with defaults and rest", () => {
  // [x (= 10) y & rest]
  const pattern = createList(
    createSymbol("x"),
    createList(createSymbol("="), createLiteral(10)),
    createSymbol("y"),
    createSymbol("&"),
    createSymbol("rest"),
  );
  assertEquals(
    couldBePattern(pattern),
    true,
    "[x (= 10) y & rest] should be valid pattern",
  );
});

Deno.test("Pattern Recognition: Complex invalid pattern (literal after symbol)", () => {
  // [x y 3]
  const invalid = createList(
    createSymbol("x"),
    createSymbol("y"),
    createLiteral(3),
  );
  assertEquals(
    couldBePattern(invalid),
    false,
    "[x y 3] should be invalid pattern (ends with literal)",
  );
});

Deno.test("Pattern Recognition: Nested pattern with defaults", () => {
  // [[x (= 1)] [y (= 2)]]
  const pattern = createList(
    createList(
      createSymbol("x"),
      createList(createSymbol("="), createLiteral(1)),
    ),
    createList(
      createSymbol("y"),
      createList(createSymbol("="), createLiteral(2)),
    ),
  );
  assertEquals(
    couldBePattern(pattern),
    true,
    "[[x (= 1)] [y (= 2)]] should be valid nested pattern",
  );
});

Deno.test("Pattern Recognition: Pattern with only underscore", () => {
  // [_]
  const pattern = createList(createSymbol("_"));
  assertEquals(
    couldBePattern(pattern),
    true,
    "[_] should be valid pattern (skip one element)",
  );
});

Deno.test("Pattern Recognition: Pattern with multiple underscores", () => {
  // [_ _ x]
  const pattern = createList(
    createSymbol("_"),
    createSymbol("_"),
    createSymbol("x"),
  );
  assertEquals(
    couldBePattern(pattern),
    true,
    "[_ _ x] should be valid pattern",
  );
});

Deno.test("Pattern Recognition: Rest with underscore as identifier", () => {
  // [x & _] - using _ as rest identifier
  const pattern = createList(
    createSymbol("x"),
    createSymbol("&"),
    createSymbol("_"),
  );
  assertEquals(
    couldBePattern(pattern),
    true,
    "[x & _] should be valid (underscore can be rest identifier)",
  );
});

console.log("\nPattern Recognition Tests Complete!");
console.log("All tests validate the couldBePattern() function");
console.log("This ensures we can distinguish patterns from array literals");
