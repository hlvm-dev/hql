import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  type ArrayPattern,
  createList,
  createLiteral,
  createSymbol,
  type IdentifierPattern,
  type RestPattern,
  type SkipPattern,
} from "../../src/hql/s-exp/types.ts";
import { parsePattern } from "../../src/hql/s-exp/pattern-parser.ts";

function parseArrayPattern(exp: ReturnType<typeof createList>): ArrayPattern {
  return parsePattern(exp) as ArrayPattern;
}

Deno.test("array pattern parser: empty and flat identifier patterns parse correctly", () => {
  const empty = parseArrayPattern(createList());
  const flat = parseArrayPattern(
    createList(createSymbol("x"), createSymbol("y"), createSymbol("z")),
  );

  assertEquals(empty.type, "ArrayPattern");
  assertEquals(empty.elements.length, 0);
  assertEquals(flat.elements.length, 3);
  assertEquals((flat.elements[0] as IdentifierPattern).name, "x");
  assertEquals((flat.elements[1] as IdentifierPattern).name, "y");
  assertEquals((flat.elements[2] as IdentifierPattern).name, "z");
});

Deno.test("array pattern parser: skip patterns are preserved in mixed arrays", () => {
  const pattern = parseArrayPattern(
    createList(
      createSymbol("_"),
      createSymbol("x"),
      createSymbol("_"),
      createSymbol("y"),
    ),
  );

  assertEquals(pattern.elements.length, 4);
  assertEquals((pattern.elements[0] as SkipPattern).type, "SkipPattern");
  assertEquals((pattern.elements[1] as IdentifierPattern).name, "x");
  assertEquals((pattern.elements[2] as SkipPattern).type, "SkipPattern");
  assertEquals((pattern.elements[3] as IdentifierPattern).name, "y");
});

Deno.test("array pattern parser: rest patterns work at the beginning and end", () => {
  const trailing = parseArrayPattern(
    createList(createSymbol("x"), createSymbol("&"), createSymbol("rest")),
  );
  const leading = parseArrayPattern(
    createList(createSymbol("&"), createSymbol("all")),
  );

  assertEquals(trailing.elements.length, 2);
  assertEquals((trailing.elements[0] as IdentifierPattern).name, "x");
  assertEquals((trailing.elements[1] as RestPattern).type, "RestPattern");
  assertEquals(
    ((trailing.elements[1] as RestPattern).argument as IdentifierPattern).name,
    "rest",
  );
  assertEquals((leading.elements[0] as RestPattern).type, "RestPattern");
  assertEquals(
    ((leading.elements[0] as RestPattern).argument as IdentifierPattern).name,
    "all",
  );
});

Deno.test("array pattern parser: nested array patterns support depth, skips, and rest", () => {
  const pattern = parseArrayPattern(
    createList(
      createSymbol("x"),
      createList(
        createSymbol("_"),
        createSymbol("y"),
        createList(createSymbol("z")),
      ),
      createList(createSymbol("head"), createSymbol("&"), createSymbol("tail")),
    ),
  );

  assertEquals((pattern.elements[0] as IdentifierPattern).name, "x");
  const nested = pattern.elements[1] as ArrayPattern;
  assertEquals((nested.elements[0] as SkipPattern).type, "SkipPattern");
  assertEquals((nested.elements[1] as IdentifierPattern).name, "y");
  const deep = nested.elements[2] as ArrayPattern;
  assertEquals((deep.elements[0] as IdentifierPattern).name, "z");
  const restNest = pattern.elements[2] as ArrayPattern;
  assertEquals((restNest.elements[0] as IdentifierPattern).name, "head");
  assertEquals((restNest.elements[1] as RestPattern).type, "RestPattern");
});

Deno.test("array pattern parser: invalid rest placement is rejected", () => {
  for (const exp of [
    createList(createSymbol("&"), createSymbol("rest"), createSymbol("x")),
    createList(createSymbol("x"), createSymbol("&"), createSymbol("rest"), createSymbol("y")),
    createList(createSymbol("x"), createSymbol("&")),
  ]) {
    assertThrows(() => parseArrayPattern(exp), Error);
  }
});

Deno.test("array pattern parser: literals and call forms are rejected", () => {
  for (const exp of [
    createList(createLiteral(1), createLiteral(2), createLiteral(3)),
    createList(createSymbol("x"), createLiteral(2), createSymbol("y")),
    createList(
      createSymbol("x"),
      createList(createSymbol("+"), createLiteral(1), createLiteral(2)),
    ),
  ]) {
    assertThrows(() => parseArrayPattern(exp), Error);
  }
});

Deno.test("array pattern parser: parsePattern returns identifiers and arrays through one SSOT", () => {
  const identifier = parsePattern(createSymbol("foo")) as IdentifierPattern;
  const array = parsePattern(createList(createSymbol("x"), createSymbol("y"))) as ArrayPattern;

  assertEquals(identifier.type, "IdentifierPattern");
  assertEquals(identifier.name, "foo");
  assertEquals(array.type, "ArrayPattern");
  assertEquals(array.elements.length, 2);
});
