// test/syntax-binding.test.ts
// Tests for let, var, set! bindings

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "../../../helpers.ts";

Deno.test("Binding: let creates immutable binding", async () => {
  const code = `
(let x 10)
x
`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Binding: var creates mutable binding", async () => {
  const code = `
(var x 10)
(set! x 20)
x
`;
  const result = await run(code);
  assertEquals(result, 20);
});

Deno.test("Binding: let with multiple values", async () => {
  const code = `
(let (x 10 y 20 z 30)
  (+ x y z))
`;
  const result = await run(code);
  assertEquals(result, 60);
});

Deno.test("Binding: var with multiple values", async () => {
  const code = `
(var (x 10 y 20)
  (set! x 100)
  (+ x y))
`;
  const result = await run(code);
  assertEquals(result, 120);
});

Deno.test("Binding: set! updates existing var", async () => {
  const code = `
(var counter 0)
(set! counter (+ counter 1))
(set! counter (+ counter 1))
counter
`;
  const result = await run(code);
  assertEquals(result, 2);
});

Deno.test("Binding: let with expression", async () => {
  const code = `
(let x (+ 5 5))
x
`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Binding: var with expression", async () => {
  const code = `
(var x (+ 5 5))
(set! x (* x 2))
x
`;
  const result = await run(code);
  assertEquals(result, 20);
});

Deno.test("Binding: nested let", async () => {
  const code = `
(let x 10)
(let y 20)
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Binding: set! with property access", async () => {
  const code = `
(var obj {"count": 0})
(set! obj.count 42)
obj.count
`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Binding: let with object", async () => {
  const code = `
(let person {"name": "Alice", "age": 30})
person.name
`;
  const result = await run(code);
  assertEquals(result, "Alice");
});

Deno.test("Binding: var with array", async () => {
  const code = `
(var nums [1, 2, 3])
(.push nums 4)
nums.length
`;
  const result = await run(code);
  assertEquals(result, 4);
});

Deno.test("Binding: multiple set! operations", async () => {
  const code = `
(var x 1)
(var y 2)
(set! x 10)
(set! y 20)
(+ x y)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Binding: let with array is frozen (immutable)", async () => {
  const code = `
(let nums [1, 2, 3])
(try
  (do
    (.push nums 4)
    "mutation-succeeded")
  (catch e
    "mutation-failed"))
`;
  const result = await run(code);
  assertEquals(result, "mutation-failed");
});

Deno.test("Binding: let with object is frozen (immutable)", async () => {
  const code = `
(let person {"name": "Alice"})
(try
  (do
    (set! person.age 30)
    person.age)
  (catch e
    "error-caught"))
`;
  const result = await run(code);
  // In strict mode, setting properties on frozen objects throws an error
  assertEquals(result, "error-caught");
});

Deno.test("Binding: var with array is mutable", async () => {
  const code = `
(var nums [1, 2, 3])
(.push nums 4)
nums.length
`;
  const result = await run(code);
  assertEquals(result, 4);
});

Deno.test("Binding: var with object is mutable", async () => {
  const code = `
(var person {"name": "Alice"})
(set! person.age 30)
person.age
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Binding: let freezes nested objects (deep freeze)", async () => {
  const code = `
(let data {"user": {"name": "Bob"}})
(var user (get data "user"))
(try
  (do
    (set! user.name "Charlie")
    "mutation-succeeded")
  (catch e
    "mutation-failed"))
`;
  const result = await run(code);
  // Deep freeze is now implemented, so nested objects are frozen
  // In strict mode, mutation throws an error
  assertEquals(result, "mutation-failed");
});

Deno.test("Binding: top-level let with helper and brace literal preserves helper result", async () => {
  const code = `
(let msg "{")
(doall (range 3))
`;
  const result = await run(code);
  assertEquals(result, [0, 1, 2]);
});

Deno.test("Binding: top-level let with helper and parenthesis literal preserves helper result", async () => {
  const code = `
(let msg "(")
(doall (range 2))
`;
  const result = await run(code);
  assertEquals(result, [0, 1]);
});
