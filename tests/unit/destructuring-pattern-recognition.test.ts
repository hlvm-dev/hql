import { assertEquals } from "jsr:@std/assert";
import {
  couldBePattern,
  createList,
  createLiteral,
  createSymbol,
} from "../../src/hql/s-exp/types.ts";

Deno.test("pattern recognition: symbols, underscores, and empty lists are valid patterns", () => {
  assertEquals(couldBePattern(createSymbol("x")), true);
  assertEquals(couldBePattern(createList(createSymbol("_"))), true);
  assertEquals(couldBePattern(createList()), true);
});

Deno.test("pattern recognition: literals are never treated as patterns", () => {
  assertEquals(couldBePattern(createLiteral(42)), false);
  assertEquals(couldBePattern(createLiteral("hello")), false);
  assertEquals(couldBePattern(createLiteral(true)), false);
  assertEquals(couldBePattern(createLiteral(null)), false);
});

Deno.test("pattern recognition: lists of symbols, nested bindings, defaults, and rest markers are valid patterns", () => {
  assertEquals(
    couldBePattern(createList(createSymbol("x"), createSymbol("y"), createSymbol("z"))),
    true,
  );
  assertEquals(
    couldBePattern(
      createList(
        createList(createSymbol("x"), createSymbol("y")),
        createList(createSymbol("a"), createSymbol("b")),
      ),
    ),
    true,
  );
  assertEquals(
    couldBePattern(
      createList(
        createSymbol("x"),
        createList(createSymbol("="), createLiteral(10)),
        createSymbol("y"),
        createSymbol("&"),
        createSymbol("rest"),
      ),
    ),
    true,
  );
});

Deno.test("pattern recognition: literals or executable forms inside lists make them data, not patterns", () => {
  assertEquals(
    couldBePattern(createList(createLiteral(1), createLiteral(2), createLiteral(3))),
    false,
  );
  assertEquals(
    couldBePattern(createList(createSymbol("x"), createLiteral(2), createSymbol("y"))),
    false,
  );
  assertEquals(
    couldBePattern(
      createList(
        createSymbol("x"),
        createList(createSymbol("+"), createLiteral(1), createLiteral(2)),
      ),
    ),
    false,
  );
});

Deno.test("pattern recognition: rest markers must be final and followed by an identifier", () => {
  assertEquals(
    couldBePattern(createList(createSymbol("&"), createSymbol("rest"), createSymbol("x"))),
    false,
  );
  assertEquals(
    couldBePattern(createList(createSymbol("x"), createSymbol("&"))),
    false,
  );
});
