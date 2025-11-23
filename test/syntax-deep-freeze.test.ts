/**
 * Test: Deep Freeze
 * Verifies that let bindings deeply freeze nested objects/arrays
 */

import { assertEquals } from "jsr:@std/assert";
import { run } from "./helpers.ts";

// =============================================================================
// DEEP FREEZE TESTS
// =============================================================================

Deno.test("Deep Freeze: nested object is frozen", async () => {
  const code = `
(let nested {"outer": {"inner": 42}})
(var outer (get nested "outer"))
(try
  (do
    (set! outer.inner 100)
    false)
  (catch e
    true))
`;
  const result = await run(code);
  // Should throw error when trying to mutate nested property
  assertEquals(result, true);
});

Deno.test("Deep Freeze: nested array is frozen", async () => {
  const code = `
(let arr [[1 2] [3 4]])
(try
  (do
    (.push (get arr 0) 999)
    false)
  (catch e
    true))
`;
  const result = await run(code);
  // Should throw error when trying to push to nested array
  assertEquals(result, true);
});

Deno.test("Deep Freeze: deeply nested object is frozen", async () => {
  const code = `
(let deep {"a": {"b": {"c": {"d": 1}}}})
(var c (get (get (get deep "a") "b") "c"))
(try
  (do
    (set! c.d 999)
    false)
  (catch e
    true))
`;
  const result = await run(code);
  // Should throw error when trying to mutate deeply nested property
  assertEquals(result, true);
});

Deno.test("Deep Freeze: mixed nested structures are frozen", async () => {
  const code = `
(let mixed {"arr": [1 2 {"nested": "value"}]})
(var obj (get mixed.arr 2))
(try
  (do
    (set! obj.nested "changed")
    false)
  (catch e
    true))
`;
  const result = await run(code);
  // Should throw error when trying to mutate object inside array inside object
  assertEquals(result, true);
});

Deno.test("Deep Freeze: reading nested values still works", async () => {
  const code = `
(let data {"level1": {"level2": {"level3": "deep value"}}})
(get (get (get data "level1") "level2") "level3")
`;
  const result = await run(code);
  // Reading should work fine
  assertEquals(result, "deep value");
});

Deno.test("Deep Freeze: Object.isFrozen confirms deep freeze", async () => {
  const code = `
(let obj {"nested": {"inner": 42}})
(js-call Object "isFrozen" obj.nested)
`;
  const result = await run(code);
  // Nested object should also be frozen
  assertEquals(result, true);
});

Deno.test("Deep Freeze: array elements are frozen", async () => {
  const code = `
(let arr [{"a": 1} {"b": 2}])
(js-call Object "isFrozen" (get arr 0))
`;
  const result = await run(code);
  // Array elements (objects) should be frozen
  assertEquals(result, true);
});

Deno.test("Deep Freeze: primitives in let bindings work", async () => {
  const code = `
(let x 42)
x
`;
  const result = await run(code);
  // Primitives should work normally (they can't be frozen anyway)
  assertEquals(result, 42);
});

Deno.test("Deep Freeze: comparing with var (mutable)", async () => {
  const code = `
(var mutable {"nested": {"value": 10}})
(var nested (get mutable "nested"))
(try
  (do
    (set! nested.value 20)
    nested.value)
  (catch e
    "error"))
`;
  const result = await run(code);
  // var should allow mutation
  assertEquals(result, 20);
});

Deno.test("Deep Freeze: let prevents array mutation", async () => {
  const code = `
(let arr [1 2 3])
(try
  (do
    (.push arr 4)
    false)
  (catch e
    true))
`;
  const result = await run(code);
  // Should throw error when trying to push to frozen array
  assertEquals(result, true);
});
