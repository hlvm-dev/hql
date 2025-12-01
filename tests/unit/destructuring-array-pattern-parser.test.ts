// Tests for Phase 1.3: Array Pattern Parser
// Tests the parseArrayPattern() function that converts S-expressions to ArrayPattern AST nodes

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  type ArrayPattern,
  createList,
  createLiteral,
  createSymbol,
  type IdentifierPattern,
  type RestPattern,
  type SkipPattern,
} from "../../src/s-exp/types.ts";
import {
  parseArrayPattern,
  parseIdentifierPattern,
  parsePattern,
} from "../../src/s-exp/pattern-parser.ts";

// ============================================================================
// POSITIVE CASES - Valid Array Patterns
// ============================================================================

Deno.test("Array Pattern Parser: Empty array pattern []", () => {
  const pattern = parseArrayPattern(createList());

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals(pattern.elements.length, 0);
});

Deno.test("Array Pattern Parser: Single identifier [x]", () => {
  const pattern = parseArrayPattern(createList(createSymbol("x")));

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals(pattern.elements.length, 1);
  assertEquals(
    (pattern.elements[0] as IdentifierPattern).type,
    "IdentifierPattern",
  );
  assertEquals((pattern.elements[0] as IdentifierPattern).name, "x");
});

Deno.test("Array Pattern Parser: Multiple identifiers [x y z]", () => {
  const pattern = parseArrayPattern(
    createList(
      createSymbol("x"),
      createSymbol("y"),
      createSymbol("z"),
    ),
  );

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals(pattern.elements.length, 3);
  assertEquals((pattern.elements[0] as IdentifierPattern).name, "x");
  assertEquals((pattern.elements[1] as IdentifierPattern).name, "y");
  assertEquals((pattern.elements[2] as IdentifierPattern).name, "z");
});

Deno.test("Array Pattern Parser: Skip pattern [_]", () => {
  const pattern = parseArrayPattern(createList(createSymbol("_")));

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals(pattern.elements.length, 1);
  assertEquals((pattern.elements[0] as SkipPattern).type, "SkipPattern");
});

Deno.test("Array Pattern Parser: Skip in middle [x _ z]", () => {
  const pattern = parseArrayPattern(
    createList(
      createSymbol("x"),
      createSymbol("_"),
      createSymbol("z"),
    ),
  );

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals(pattern.elements.length, 3);
  assertEquals((pattern.elements[0] as IdentifierPattern).name, "x");
  assertEquals((pattern.elements[1] as SkipPattern).type, "SkipPattern");
  assertEquals((pattern.elements[2] as IdentifierPattern).name, "z");
});

Deno.test("Array Pattern Parser: Multiple skips [_ _ x]", () => {
  const pattern = parseArrayPattern(
    createList(
      createSymbol("_"),
      createSymbol("_"),
      createSymbol("x"),
    ),
  );

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals(pattern.elements.length, 3);
  assertEquals((pattern.elements[0] as SkipPattern).type, "SkipPattern");
  assertEquals((pattern.elements[1] as SkipPattern).type, "SkipPattern");
  assertEquals((pattern.elements[2] as IdentifierPattern).name, "x");
});

Deno.test("Array Pattern Parser: Rest pattern [x & rest]", () => {
  const pattern = parseArrayPattern(
    createList(
      createSymbol("x"),
      createSymbol("&"),
      createSymbol("rest"),
    ),
  );

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals(pattern.elements.length, 2);
  assertEquals((pattern.elements[0] as IdentifierPattern).name, "x");
  assertEquals((pattern.elements[1] as RestPattern).type, "RestPattern");
  assertEquals(
    ((pattern.elements[1] as RestPattern).argument as IdentifierPattern).name,
    "rest",
  );
});

Deno.test("Array Pattern Parser: Rest at beginning [& all]", () => {
  const pattern = parseArrayPattern(
    createList(
      createSymbol("&"),
      createSymbol("all"),
    ),
  );

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals(pattern.elements.length, 1);
  assertEquals((pattern.elements[0] as RestPattern).type, "RestPattern");
  assertEquals(
    ((pattern.elements[0] as RestPattern).argument as IdentifierPattern).name,
    "all",
  );
});

Deno.test("Array Pattern Parser: Rest with multiple preceding [x y & rest]", () => {
  const pattern = parseArrayPattern(
    createList(
      createSymbol("x"),
      createSymbol("y"),
      createSymbol("&"),
      createSymbol("rest"),
    ),
  );

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals(pattern.elements.length, 3);
  assertEquals((pattern.elements[0] as IdentifierPattern).name, "x");
  assertEquals((pattern.elements[1] as IdentifierPattern).name, "y");
  assertEquals((pattern.elements[2] as RestPattern).type, "RestPattern");
  assertEquals(
    ((pattern.elements[2] as RestPattern).argument as IdentifierPattern).name,
    "rest",
  );
});

Deno.test("Array Pattern Parser: Rest with underscore [x & _]", () => {
  const pattern = parseArrayPattern(
    createList(
      createSymbol("x"),
      createSymbol("&"),
      createSymbol("_"),
    ),
  );

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals(pattern.elements.length, 2);
  assertEquals((pattern.elements[0] as IdentifierPattern).name, "x");
  assertEquals((pattern.elements[1] as RestPattern).type, "RestPattern");
  assertEquals(
    ((pattern.elements[1] as RestPattern).argument as IdentifierPattern).name,
    "_",
  );
});

Deno.test("Array Pattern Parser: Mixed skip and identifiers [_ x _ y]", () => {
  const pattern = parseArrayPattern(
    createList(
      createSymbol("_"),
      createSymbol("x"),
      createSymbol("_"),
      createSymbol("y"),
    ),
  );

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals(pattern.elements.length, 4);
  assertEquals((pattern.elements[0] as SkipPattern).type, "SkipPattern");
  assertEquals((pattern.elements[1] as IdentifierPattern).name, "x");
  assertEquals((pattern.elements[2] as SkipPattern).type, "SkipPattern");
  assertEquals((pattern.elements[3] as IdentifierPattern).name, "y");
});

// ============================================================================
// NESTED PATTERNS
// ============================================================================

Deno.test("Array Pattern Parser: Nested simple [[x y]]", () => {
  const pattern = parseArrayPattern(
    createList(
      createList(createSymbol("x"), createSymbol("y")),
    ),
  );

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals(pattern.elements.length, 1);

  const nested = pattern.elements[0] as ArrayPattern;
  assertEquals(nested.type, "ArrayPattern");
  assertEquals(nested.elements.length, 2);
  assertEquals((nested.elements[0] as IdentifierPattern).name, "x");
  assertEquals((nested.elements[1] as IdentifierPattern).name, "y");
});

Deno.test("Array Pattern Parser: Multiple nested [[a b] [c d]]", () => {
  const pattern = parseArrayPattern(
    createList(
      createList(createSymbol("a"), createSymbol("b")),
      createList(createSymbol("c"), createSymbol("d")),
    ),
  );

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals(pattern.elements.length, 2);

  const first = pattern.elements[0] as ArrayPattern;
  assertEquals(first.type, "ArrayPattern");
  assertEquals((first.elements[0] as IdentifierPattern).name, "a");
  assertEquals((first.elements[1] as IdentifierPattern).name, "b");

  const second = pattern.elements[1] as ArrayPattern;
  assertEquals(second.type, "ArrayPattern");
  assertEquals((second.elements[0] as IdentifierPattern).name, "c");
  assertEquals((second.elements[1] as IdentifierPattern).name, "d");
});

Deno.test("Array Pattern Parser: Mixed flat and nested [x [y z]]", () => {
  const pattern = parseArrayPattern(
    createList(
      createSymbol("x"),
      createList(createSymbol("y"), createSymbol("z")),
    ),
  );

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals(pattern.elements.length, 2);
  assertEquals((pattern.elements[0] as IdentifierPattern).name, "x");

  const nested = pattern.elements[1] as ArrayPattern;
  assertEquals(nested.type, "ArrayPattern");
  assertEquals((nested.elements[0] as IdentifierPattern).name, "y");
  assertEquals((nested.elements[1] as IdentifierPattern).name, "z");
});

Deno.test("Array Pattern Parser: Deep nesting [x [y [z]]]", () => {
  const pattern = parseArrayPattern(
    createList(
      createSymbol("x"),
      createList(
        createSymbol("y"),
        createList(createSymbol("z")),
      ),
    ),
  );

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals(pattern.elements.length, 2);
  assertEquals((pattern.elements[0] as IdentifierPattern).name, "x");

  const nested1 = pattern.elements[1] as ArrayPattern;
  assertEquals(nested1.type, "ArrayPattern");
  assertEquals((nested1.elements[0] as IdentifierPattern).name, "y");

  const nested2 = nested1.elements[1] as ArrayPattern;
  assertEquals(nested2.type, "ArrayPattern");
  assertEquals((nested2.elements[0] as IdentifierPattern).name, "z");
});

Deno.test("Array Pattern Parser: Nested with skip [[_ x] [y _]]", () => {
  const pattern = parseArrayPattern(
    createList(
      createList(createSymbol("_"), createSymbol("x")),
      createList(createSymbol("y"), createSymbol("_")),
    ),
  );

  assertEquals(pattern.type, "ArrayPattern");
  const first = pattern.elements[0] as ArrayPattern;
  assertEquals((first.elements[0] as SkipPattern).type, "SkipPattern");
  assertEquals((first.elements[1] as IdentifierPattern).name, "x");

  const second = pattern.elements[1] as ArrayPattern;
  assertEquals((second.elements[0] as IdentifierPattern).name, "y");
  assertEquals((second.elements[1] as SkipPattern).type, "SkipPattern");
});

// ============================================================================
// ERROR CASES - Invalid Patterns
// ============================================================================

Deno.test("Array Pattern Parser: ERROR - Rest not at end [& rest x]", () => {
  assertThrows(
    () => {
      parseArrayPattern(
        createList(
          createSymbol("&"),
          createSymbol("rest"),
          createSymbol("x"),
        ),
      );
    },
    Error,
    "Rest pattern (&) must be second-to-last element",
  );
});

Deno.test("Array Pattern Parser: ERROR - Rest in middle [x & rest y]", () => {
  assertThrows(
    () => {
      parseArrayPattern(
        createList(
          createSymbol("x"),
          createSymbol("&"),
          createSymbol("rest"),
          createSymbol("y"),
        ),
      );
    },
    Error,
    "Rest pattern (&) must be second-to-last element",
  );
});

Deno.test("Array Pattern Parser: ERROR - Rest without identifier [x &]", () => {
  assertThrows(
    () => {
      parseArrayPattern(
        createList(
          createSymbol("x"),
          createSymbol("&"),
        ),
      );
    },
    Error,
    "Rest pattern (&) must be followed by identifier",
  );
});

Deno.test("Array Pattern Parser: ERROR - Literal in pattern [1 2 3]", () => {
  assertThrows(
    () => {
      parseArrayPattern(
        createList(
          createLiteral(1),
          createLiteral(2),
          createLiteral(3),
        ),
      );
    },
    Error,
    "Array pattern cannot contain literal values",
  );
});

Deno.test("Array Pattern Parser: ERROR - Mixed literal and symbol [x 2 y]", () => {
  assertThrows(
    () => {
      parseArrayPattern(
        createList(
          createSymbol("x"),
          createLiteral(2),
          createSymbol("y"),
        ),
      );
    },
    Error,
    "Array pattern cannot contain literal values",
  );
});

Deno.test("Array Pattern Parser: ERROR - Function call in pattern [x (+ 1 2)]", () => {
  assertThrows(
    () => {
      parseArrayPattern(
        createList(
          createSymbol("x"),
          createList(createSymbol("+"), createLiteral(1), createLiteral(2)),
        ),
      );
    },
    Error,
    "Invalid element in array pattern",
  );
});

// ============================================================================
// HELPER FUNCTION TESTS
// ============================================================================

Deno.test("Identifier Pattern Parser: Simple identifier", () => {
  const pattern = parseIdentifierPattern(createSymbol("foo"));

  assertEquals(pattern.type, "IdentifierPattern");
  assertEquals(pattern.name, "foo");
});

Deno.test("Identifier Pattern Parser: Underscore identifier", () => {
  const pattern = parseIdentifierPattern(createSymbol("_"));

  assertEquals(pattern.type, "IdentifierPattern");
  assertEquals(pattern.name, "_");
});

Deno.test("Generic parsePattern: Identifier", () => {
  const pattern = parsePattern(createSymbol("x"));

  assertEquals(pattern.type, "IdentifierPattern");
  assertEquals((pattern as IdentifierPattern).name, "x");
});

Deno.test("Generic parsePattern: Array", () => {
  const pattern = parsePattern(
    createList(createSymbol("x"), createSymbol("y")),
  );

  assertEquals(pattern.type, "ArrayPattern");
  assertEquals((pattern as ArrayPattern).elements.length, 2);
});

console.log("\nArray Pattern Parser Tests Complete!");
console.log("All tests validate parseArrayPattern() functionality");
console.log("✅ Simple patterns (identifiers, skip, rest)");
console.log("✅ Nested patterns (arrays within arrays)");
console.log("✅ Error cases (invalid rest, literals, etc.)");
