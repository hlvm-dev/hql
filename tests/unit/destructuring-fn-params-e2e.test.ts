// Tests for Phase 3.1: Function Parameter Destructuring
// Tests destructuring in function parameter lists

import { assertEquals } from "jsr:@std/assert@1";
import hql from "../../mod.ts";

async function run(code: string): Promise<any> {
  return await hql.run(code);
}

// ============================================================================
// BASIC FUNCTION PARAMETER DESTRUCTURING
// ============================================================================

Deno.test("Fn Param Destructuring: Simple [a b]", async () => {
  const code = `
(fn add [[a b]]
  (+ a b))

(add [1 2])
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Fn Param Destructuring: Three elements [x y z]", async () => {
  const code = `
(fn sum3 [[x y z]]
  (+ x (+ y z)))

(sum3 [10 20 30])
`;
  const result = await run(code);
  assertEquals(result, 60);
});

Deno.test("Fn Param Destructuring: Single element [x]", async () => {
  const code = `
(fn identity [[x]]
  x)

(identity [42])
`;
  const result = await run(code);
  assertEquals(result, 42);
});

// ============================================================================
// SKIP PATTERNS IN PARAMETERS
// ============================================================================

Deno.test("Fn Param Destructuring: Skip first [_ y]", async () => {
  const code = `
(fn second [[_ y]]
  y)

(second [1 2])
`;
  const result = await run(code);
  assertEquals(result, 2);
});

Deno.test("Fn Param Destructuring: Skip middle [x _ z]", async () => {
  const code = `
(fn skip-middle [[x _ z]]
  (+ x z))

(skip-middle [1 2 3])
`;
  const result = await run(code);
  assertEquals(result, 4);
});

// ============================================================================
// REST PATTERNS IN PARAMETERS
// ============================================================================

Deno.test("Fn Param Destructuring: Rest pattern [x & rest]", async () => {
  const code = `
(fn first-and-rest [[x & rest]]
  rest)

(first-and-rest [1 2 3 4])
`;
  const result = await run(code);
  assertEquals(result, [2, 3, 4]);
});

Deno.test("Fn Param Destructuring: Rest at beginning [& all]", async () => {
  const code = `
(fn all-elements [[& all]]
  all)

(all-elements [1 2 3])
`;
  const result = await run(code);
  assertEquals(result, [1, 2, 3]);
});

// ============================================================================
// NESTED PATTERNS IN PARAMETERS
// ============================================================================

Deno.test("Fn Param Destructuring: Nested [[a b]]", async () => {
  const code = `
(fn add-nested [[[a b]]]
  (+ a b))

(add-nested [[1 2]])
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Fn Param Destructuring: Deep nesting [[a [b c]]]", async () => {
  const code = `
(fn deep [[[a [b c]]]]
  (+ a (+ b c)))

(deep [[1 [2 3]]])
`;
  const result = await run(code);
  assertEquals(result, 6);
});

// ============================================================================
// MIXED NORMAL AND DESTRUCTURED PARAMETERS
// ============================================================================

Deno.test("Fn Param Destructuring: Mixed (x [y z])", async () => {
  const code = `
(fn mixed [x [y z]]
  (+ x (+ y z)))

(mixed 1 [2 3])
`;
  const result = await run(code);
  assertEquals(result, 6);
});

Deno.test("Fn Param Destructuring: Mixed ([a b] c)", async () => {
  const code = `
(fn mixed2 [[a b] c]
  (+ a (+ b c)))

(mixed2 [1 2] 3)
`;
  const result = await run(code);
  assertEquals(result, 6);
});

Deno.test("Fn Param Destructuring: Three params (x [y z] w)", async () => {
  const code = `
(fn mixed3 [x [y z] w]
  (+ x (+ y (+ z w))))

(mixed3 1 [2 3] 4)
`;
  const result = await run(code);
  assertEquals(result, 10);
});

// ============================================================================
// MULTIPLE DESTRUCTURED PARAMETERS
// ============================================================================

Deno.test("Fn Param Destructuring: Two arrays ([a b] [c d])", async () => {
  const code = `
(fn two-arrays [[a b] [c d]]
  (+ a (+ b (+ c d))))

(two-arrays [1 2] [3 4])
`;
  const result = await run(code);
  assertEquals(result, 10);
});

// ============================================================================
// ANONYMOUS FUNCTIONS WITH DESTRUCTURING
// ============================================================================

Deno.test("Fn Param Destructuring: Anonymous fn", async () => {
  const code = `
(let f (fn [[x y]] (+ x y)))
(f [5 10])
`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Fn Param Destructuring: Inline anonymous", async () => {
  const code = `
((fn [[a b]] (* a b)) [3 4])
`;
  const result = await run(code);
  assertEquals(result, 12);
});
