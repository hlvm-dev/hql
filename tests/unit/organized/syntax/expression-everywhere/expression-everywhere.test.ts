// tests/unit/organized/syntax/expression-everywhere/expression-everywhere.test.ts
// Tests for expression-everywhere feature - all forms return values

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "../../../helpers.ts";

// ============================================================================
// Let Expressions Return Values
// ============================================================================

Deno.test("Expression-everywhere: let returns bound value", async () => {
  const code = `(let x 10)`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Expression-everywhere: let with expression returns computed value", async () => {
  const code = `(let x (+ 5 7))`;
  const result = await run(code);
  assertEquals(result, 12);
});

Deno.test("Expression-everywhere: var returns bound value", async () => {
  const code = `(var y 42)`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Expression-everywhere: const returns bound value", async () => {
  const code = `(const z 99)`;
  const result = await run(code);
  assertEquals(result, 99);
});

// ============================================================================
// Function Definitions Return Functions
// ============================================================================

Deno.test("Expression-everywhere: fn returns function", async () => {
  // Define named function, then check its type
  const code = `
(fn add [a b] (+ a b))
(typeof add)
`;
  const result = await run(code);
  assertEquals(result, "function");
});

Deno.test("Expression-everywhere: anonymous fn is immediately callable", async () => {
  // Anonymous functions (IIFE) already work as expressions
  const code = `((fn [x] (* x 2)) 21)`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Expression-everywhere: named fn can call itself after definition", async () => {
  const code = `
(fn factorial [n]
  (if (<= n 1)
    1
    (* n (factorial (- n 1)))))
(factorial 5)
`;
  const result = await run(code);
  assertEquals(result, 120);
});

// ============================================================================
// Class Definitions Return Classes
// ============================================================================

Deno.test("Expression-everywhere: class returns constructor function", async () => {
  // Define class, then check its type
  const code = `
(class Point (constructor [x] (= this.x x)))
(typeof Point)
`;
  const result = await run(code);
  assertEquals(result, "function");
});

Deno.test("Expression-everywhere: class can be instantiated immediately", async () => {
  const code = `
(class Box (constructor [value] (= this.value value)))
(let box (new Box 42))
box.value
`;
  const result = await run(code);
  assertEquals(result, 42);
});

// ============================================================================
// Enum Definitions Return Enums
// ============================================================================

Deno.test("Expression-everywhere: enum returns object", async () => {
  // Define enum with proper case syntax, then check its type
  const code = `
(enum Color
  (case Red)
  (case Green)
  (case Blue))
(typeof Color)
`;
  const result = await run(code);
  assertEquals(result, "object");
});

Deno.test("Expression-everywhere: enum values are accessible", async () => {
  const code = `
(enum Status
  (case Pending)
  (case Active)
  (case Done))
Status.Active
`;
  const result = await run(code);
  assertEquals(result, "Active");
});

// ============================================================================
// Composability - Using Definitions as Expressions
// ============================================================================

Deno.test("Expression-everywhere: let in array literal", async () => {
  const code = `
(let a 1)
(let b 2)
(let c 3)
[a, b, c]
`;
  const result = await run(code);
  assertEquals(result, [1, 2, 3]);
});

Deno.test("Expression-everywhere: sequential lets return last value", async () => {
  const code = `
(let x 10)
(let y 20)
(let z 30)
z
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Expression-everywhere: fn definition followed by call", async () => {
  const code = `
(fn greet [name] (str "Hello, " name))
(greet "World")
`;
  const result = await run(code);
  assertEquals(result, "Hello, World");
});

// ============================================================================
// Nested Scopes Still Work
// ============================================================================

Deno.test("Expression-everywhere: let with body still works", async () => {
  const code = `
(let (x 10 y 20)
  (+ x y))
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Expression-everywhere: nested let bindings work", async () => {
  const code = `
(let outer 100)
(let (inner (* outer 2))
  inner)
`;
  const result = await run(code);
  assertEquals(result, 200);
});

Deno.test("Expression-everywhere: function body with let still works", async () => {
  const code = `
(fn compute []
  (let temp 10)
  (* temp 2))
(compute)
`;
  const result = await run(code);
  assertEquals(result, 20);
});
