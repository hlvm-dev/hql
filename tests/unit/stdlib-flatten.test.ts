// tests/test/stdlib-flatten.test.ts
// Comprehensive tests for flatten function (recursive depth)

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

Deno.test("flatten: empty array", async () => {
  const code = `(flatten [])`;
  const result = await run(code);
  // HQL lazy sequence prints as empty string or array depending on realization
  // The test helper returns the raw result from eval() which might be a LazySeq object
  // We need to force realization to array for comparison
  const realized = Array.from(result); 
  assertEquals(realized, []);
});

Deno.test("flatten: flat array", async () => {
  const code = `(flatten [1 2 3])`;
  const result = await run(code);
  assertEquals(Array.from(result), [1, 2, 3]);
});

Deno.test("flatten: depth 1", async () => {
  const code = `(flatten [[1] [2]])`;
  const result = await run(code);
  assertEquals(Array.from(result), [1, 2]);
});

Deno.test("flatten: depth 2 (deep recursion check)", async () => {
  const code = `(flatten [1 [2 [3]] 4])`;
  const result = await run(code);
  assertEquals(Array.from(result), [1, 2, 3, 4]);
});

Deno.test("flatten: deep nesting", async () => {
  const code = `(flatten [1 [2 [3 [4 [5]]]]])`;
  const result = await run(code);
  assertEquals(Array.from(result), [1, 2, 3, 4, 5]);
});

Deno.test("flatten: mixed types", async () => {
  const code = `(flatten [1 ["a" ["b"]] 2])`;
  const result = await run(code);
  assertEquals(Array.from(result), [1, "a", "b", 2]);
});

Deno.test("flatten: ignores strings (does not flatten chars)", async () => {
  const code = `(flatten ["hello" ["world"]])`;
  const result = await run(code);
  assertEquals(Array.from(result), ["hello", "world"]);
});

Deno.test("flatten: with nil", async () => {
  const code = `(flatten [1 nil [2 nil] 3])`;
  const result = await run(code);
  // Note: HQL array with nil might have holes or explicit nulls
  assertEquals(Array.from(result), [1, null, 2, null, 3]);
});