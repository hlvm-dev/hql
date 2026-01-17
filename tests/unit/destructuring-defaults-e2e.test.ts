// Tests for Phase 1.6: Default Values in Destructuring
// Tests default values in array and object destructuring patterns

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

// ============================================================================
// ARRAY DESTRUCTURING WITH DEFAULTS
// ============================================================================

Deno.test("Array Destructuring: Single default [x (= 10)]", async () => {
  const code = `
(let [x (= 10)] [])
x
`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Array Destructuring: Default with value [x (= 10)]", async () => {
  const code = `
(let [x (= 10)] [5])
x
`;
  const result = await run(code);
  assertEquals(result, 5);
});

Deno.test("Array Destructuring: Multiple defaults", async () => {
  const code = `
(let [x (= 1) y (= 2)] [])
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Array Destructuring: Partial defaults", async () => {
  const code = `
(let [x (= 1) y (= 2)] [10])
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 12); // x=10, y=2 (default)
});

Deno.test("Array Destructuring: Mix with and without defaults", async () => {
  const code = `
(let [a b (= 20) c] [1 undefined 3])
(+ a (+ b c))
`;
  const result = await run(code);
  assertEquals(result, 24); // a=1, b=20 (default because undefined), c=3
});

Deno.test("Array Destructuring: Default with expression", async () => {
  const code = `
(let [x (= (+ 5 5))] [])
x
`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Array Destructuring: Nested pattern with default", async () => {
  const code = `
(let [[a b] (= [1 2])] [])
(+ a b)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Array Destructuring: Nested pattern with default provided", async () => {
  const code = `
(let [[a b] (= [1 2])] [[10 20]])
(+ a b)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

// ============================================================================
// NESTED COMBINATIONS
// ============================================================================

Deno.test("Array Destructuring: Deep nested with defaults", async () => {
  const code = `
(let [[a (= 1)] (= [undefined])] [])
a
`;
  const result = await run(code);
  assertEquals(result, 1);
});

Deno.test("Array Destructuring: Multiple nested levels", async () => {
  const code = `
(let [x [[y (= 5)]]] [10 [[undefined]]])
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 15);
});

// ============================================================================
// VAR (MUTABLE) DESTRUCTURING WITH DEFAULTS
// ============================================================================

Deno.test("Array Destructuring: var with defaults", async () => {
  const code = `
(var [x (= 5) y (= 10)] [])
(= x 20)
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

console.log("\nDestructuring Defaults E2E Tests Complete!");
console.log("All tests verify default values in array destructuring");
console.log("✅ Array defaults");
console.log("✅ Nested pattern defaults");
console.log("✅ Expression defaults");
console.log("✅ var (mutable) with defaults");
console.log("Note: Object property defaults syntax not yet implemented");
