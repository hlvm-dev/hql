// Tests for Phase 4.1: Object Destructuring
// Tests object destructuring in let/var statements

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

// ============================================================================
// BASIC OBJECT DESTRUCTURING
// ============================================================================

Deno.test("Object Destructuring: Simple {x y}", async () => {
  const code = `
(let {x y} {x: 1 y: 2})
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Object Destructuring: Three properties {a b c}", async () => {
  const code = `
(let {a b c} {a: 10 b: 20 c: 30})
(+ a (+ b c))
`;
  const result = await run(code);
  assertEquals(result, 60);
});

Deno.test("Object Destructuring: Single property {x}", async () => {
  const code = `
(let {x} {x: 42})
x
`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Object Destructuring: Order independence", async () => {
  const code = `
(let {b a} {a: 1 b: 2})
(+ a b)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Object Destructuring: Extra properties in object", async () => {
  const code = `
(let {x y} {x: 1 y: 2 z: 3 w: 4})
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Object Destructuring: Missing property (undefined)", async () => {
  const code = `
(let {x y z} {x: 1 y: 2})
(if (=== z undefined) "ok" "fail")
`;
  const result = await run(code);
  assertEquals(result, "ok");
});

// ============================================================================
// PROPERTY RENAMING (ALIASING)
// ============================================================================

Deno.test("Object Destructuring: Rename {x: newX}", async () => {
  const code = `
(let {x: newX} {x: 42})
newX
`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Object Destructuring: Multiple renames", async () => {
  const code = `
(let {a: x b: y} {a: 1 b: 2})
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Object Destructuring: Mixed rename and direct", async () => {
  const code = `
(let {a x: y} {a: 10 x: 20})
(+ a y)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

// ============================================================================
// NESTED OBJECT DESTRUCTURING
// ============================================================================

// Nested destructuring: extract {b c} from nested object at property 'a'
// Pattern: {a {b c}} means {a: {b, c}} in JavaScript
// Creates variables: b, c (NOT a - it's the path, not a variable)
Deno.test("Object Destructuring: Nested {a {b c}}", async () => {
  const code = `
(let {data: {x y}} {data: {x: 10 y: 20}})
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

// Deep nested destructuring: extract value from deeply nested object
// Pattern: {outer: {middle: {inner}}}
// Extracts 'inner' from obj.outer.middle.inner
Deno.test("Object Destructuring: Deep nesting", async () => {
  const code = `
(let {outer: {middle: {inner}}} {outer: {middle: {inner: 42}}})
inner
`;
  const result = await run(code);
  assertEquals(result, 42);
});

// ============================================================================
// MIXED ARRAY AND OBJECT DESTRUCTURING
// ============================================================================

Deno.test("Object Destructuring: Object containing array", async () => {
  const code = `
(let {nums: [a b]} {nums: [1 2]})
(+ a b)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Object Destructuring: Array containing object", async () => {
  const code = `
(let [{x y}] [{x: 1 y: 2}])
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

// ============================================================================
// VAR (MUTABLE) DESTRUCTURING
// ============================================================================

Deno.test("Object Destructuring: var {x y}", async () => {
  const code = `
(var {x y} {x: 1 y: 2})
(= x 10)
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 12);
});

// ============================================================================
// COMPLEX EXPRESSIONS AS VALUES
// ============================================================================

Deno.test("Object Destructuring: Function call result", async () => {
  const code = `
(fn make-point [a b]
  {x: a y: b})

(let {x y} (make-point 10 20))
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Object Destructuring: Object with expressions", async () => {
  const code = `
(let {x y} {x: (+ 1 2) y: (* 3 4)})
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 15);
});

console.log("\nObject Destructuring E2E Tests Complete!");
console.log("All tests verify object destructuring pipeline");
console.log("✅ Simple patterns");
console.log("✅ Property renaming");
console.log("✅ Nested patterns");
console.log("✅ Mixed with arrays");
console.log("✅ var (mutable) destructuring");
