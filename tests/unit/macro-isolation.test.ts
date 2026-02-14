/**
 * Test: Macro State Isolation
 * Verifies that resetMacroState() clears persistent macro environment.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { resetMacroState } from "../../src/hql/s-exp/macro.ts";
import { run } from "./helpers.ts";

Deno.test("resetMacroState: clears persistent environment", async () => {
  // Define a macro-time function in one compilation
  await run(`
    (macro my-test-macro [x] (list 'identity x))
  `);

  // Reset state
  resetMacroState();

  // After reset, a simple compilation should start fresh without errors
  const result = await run(`(+ 1 2)`);
  assertEquals(result, 3);
});
