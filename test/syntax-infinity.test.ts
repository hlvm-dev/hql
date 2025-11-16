/**
 * Test: Infinity Value
 * Verifies that Infinity literal works correctly
 */

import { assertEquals } from "jsr:@std/assert";
import { run } from "./helpers.ts";

// =============================================================================
// INFINITY VALUE TESTS
// =============================================================================

Deno.test("Infinity: basic Infinity value", async () => {
  const code = `Infinity`;
  const result = await run(code);
  assertEquals(result, Infinity);
});

Deno.test("Infinity: comparison with numbers", async () => {
  const code = `(> Infinity 1000000)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Infinity: arithmetic operations", async () => {
  const code = `(+ Infinity 100)`;
  const result = await run(code);
  assertEquals(result, Infinity);
});

Deno.test("Infinity: used in variable binding", async () => {
  const code = `
(var x Infinity)
(> x 999999999)
`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Infinity: negative Infinity", async () => {
  const code = `(* Infinity -1)`;
  const result = await run(code);
  assertEquals(result, -Infinity);
});
