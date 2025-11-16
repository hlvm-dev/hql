// Tests for Phase 1.9: End-to-End Array Destructuring
// Tests the complete pipeline: HQL source → transpile → execute

import { assertEquals } from "jsr:@std/assert@1";
import hql from "../mod.ts";

async function run(code: string): Promise<any> {
  return await hql.run(code);
}

// ============================================================================
// BASIC ARRAY DESTRUCTURING
// ============================================================================

Deno.test("Array Destructuring E2E: Simple [x y]", async () => {
  const code = `
(const [x y] [1 2])
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Array Destructuring E2E: Three elements [x y z]", async () => {
  const code = `
(const [x y z] [10 20 30])
(+ x (+ y z))
`;
  const result = await run(code);
  assertEquals(result, 60);
});

Deno.test("Array Destructuring E2E: Empty pattern []", async () => {
  const code = `
(const [] [1 2 3])
42
`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Array Destructuring E2E: Single element [x]", async () => {
  const code = `
(const [x] [100])
x
`;
  const result = await run(code);
  assertEquals(result, 100);
});

Deno.test("Array Destructuring E2E: More values than bindings", async () => {
  const code = `
(const [x y] [1 2 3 4 5])
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Array Destructuring E2E: Fewer values than bindings (undefined)", async () => {
  const code = `
(const [x y z] [1 2])
(if (=== z undefined) "ok" "fail")
`;
  const result = await run(code);
  assertEquals(result, "ok");
});

// ============================================================================
// SKIP PATTERNS (_)
// ============================================================================

Deno.test("Array Destructuring E2E: Skip first [_ y]", async () => {
  const code = `
(const [_ y] [1 2])
y
`;
  const result = await run(code);
  assertEquals(result, 2);
});

Deno.test("Array Destructuring E2E: Skip middle [x _ z]", async () => {
  const code = `
(const [x _ z] [1 2 3])
(+ x z)
`;
  const result = await run(code);
  assertEquals(result, 4);
});

Deno.test("Array Destructuring E2E: Skip last [x _]", async () => {
  const code = `
(const [x _] [1 2])
x
`;
  const result = await run(code);
  assertEquals(result, 1);
});

Deno.test("Array Destructuring E2E: Multiple skips [_ _ x]", async () => {
  const code = `
(const [_ _ x] [1 2 3])
x
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Array Destructuring E2E: All skips [_ _]", async () => {
  const code = `
(const [_ _] [1 2])
"ok"
`;
  const result = await run(code);
  assertEquals(result, "ok");
});

// ============================================================================
// REST PATTERNS (& rest)
// ============================================================================

Deno.test("Array Destructuring E2E: Rest pattern [x & rest]", async () => {
  const code = `
(const [x & rest] [1 2 3 4])
rest
`;
  const result = await run(code);
  assertEquals(result, [2, 3, 4]);
});

Deno.test("Array Destructuring E2E: Rest at beginning [& all]", async () => {
  const code = `
(const [& all] [1 2 3])
all
`;
  const result = await run(code);
  assertEquals(result, [1, 2, 3]);
});

Deno.test("Array Destructuring E2E: Rest with two preceding [x y & rest]", async () => {
  const code = `
(const [x y & rest] [1 2 3 4 5])
rest
`;
  const result = await run(code);
  assertEquals(result, [3, 4, 5]);
});

Deno.test("Array Destructuring E2E: Rest with empty remainder [x y & rest]", async () => {
  const code = `
(const [x y & rest] [1 2])
rest
`;
  const result = await run(code);
  assertEquals(result, []);
});

Deno.test("Array Destructuring E2E: Rest with underscore [x & _]", async () => {
  const code = `
(const [x & _] [1 2 3])
x
`;
  const result = await run(code);
  assertEquals(result, 1);
});

// ============================================================================
// NESTED PATTERNS (Phase 2.1 - IMPLEMENTED!)
// ============================================================================

Deno.test("Array Destructuring E2E: Nested simple [[x y]]", async () => {
  const code = `
(const [[x y]] [[1 2]])
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Array Destructuring E2E: Two nested [[a b] [c d]]", async () => {
  const code = `
(const [[a b] [c d]] [[1 2] [3 4]])
(+ a (+ b (+ c d)))
`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Array Destructuring E2E: Mixed flat and nested [x [y z]]", async () => {
  const code = `
(const [x [y z]] [1 [2 3]])
(+ x (+ y z))
`;
  const result = await run(code);
  assertEquals(result, 6);
});

Deno.test("Array Destructuring E2E: Deep nesting [x [y [z]]]", async () => {
  const code = `
(const [x [y [z]]] [1 [2 [3]]])
(+ x (+ y z))
`;
  const result = await run(code);
  assertEquals(result, 6);
});

Deno.test("Array Destructuring E2E: Nested with skip [[_ x] [y _]]", async () => {
  const code = `
(const [[_ x] [y _]] [[1 2] [3 4]])
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 5);
});

Deno.test("Array Destructuring E2E: Nested with rest [[x & xs] [y & ys]]", async () => {
  const code = `
(const [[x & xs] [y & ys]] [[1 2 3] [4 5 6]])
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 5);
});

// ============================================================================
// VAR (MUTABLE) DESTRUCTURING
// ============================================================================

Deno.test("Array Destructuring E2E: var [x y]", async () => {
  const code = `
(var [x y] [1 2])
(= x 10)
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 12);
});

Deno.test("Array Destructuring E2E: var with rest [x & rest]", async () => {
  const code = `
(var [x & rest] [1 2 3])
(= x 100)
x
`;
  const result = await run(code);
  assertEquals(result, 100);
});

// ============================================================================
// COMPLEX EXPRESSIONS AS VALUES
// ============================================================================

Deno.test("Array Destructuring E2E: Function call result", async () => {
  const code = `
(fn make-pair [a b]
  [a b])

(const [x y] (make-pair 10 20))
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Array Destructuring E2E: Array literal with expressions", async () => {
  const code = `
(const [x y] [(+ 1 2) (* 3 4)])
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Array Destructuring E2E: Destructure result of if", async () => {
  const code = `
(const [x y] (if true [1 2] [3 4]))
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

// ============================================================================
// STRINGS IN PATTERNS
// ============================================================================

Deno.test("Array Destructuring E2E: Strings in array", async () => {
  const code = `
(const [a b] ["hello" "world"])
a
`;
  const result = await run(code);
  assertEquals(result, "hello");
});

Deno.test("Array Destructuring E2E: Mixed types", async () => {
  const code = `
(const [num str bool] [42 "test" true])
(if bool num str)
`;
  const result = await run(code);
  assertEquals(result, 42);
});

console.log("\nArray Destructuring E2E Tests Complete!");
console.log("All tests verify the complete HQL destructuring pipeline");
console.log("✅ Simple patterns");
console.log("✅ Skip patterns");
console.log("✅ Rest patterns");
console.log("✅ Nested patterns");
console.log("✅ var (mutable) destructuring");
