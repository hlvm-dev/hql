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

