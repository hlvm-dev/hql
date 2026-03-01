/**
 * Test: Macro State Isolation
 * Verifies that resetMacroState() clears persistent macro environment.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { resetMacroState } from "../../src/hql/s-exp/macro.ts";
import { macroexpand } from "../../mod.ts";
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

Deno.test("macro expansion is hermetic across compile calls by default", async () => {
  resetMacroState();

  // First compilation registers a named fn in macro-time interpreter env.
  await macroexpand("(fn triple [x] (* x 3))");

  // Second compilation should NOT see fn from first call.
  const [expanded] = await macroexpand("(macro m [x] (triple x)) (m 4)");
  assertEquals(expanded, "(triple 4)");
});

Deno.test("preserveMacroState option keeps macro-time functions across calls", async () => {
  resetMacroState();

  await run("(fn triple [x] (* x 3))", { preserveMacroState: true });
  const result = await run("(macro m [x] (triple x)) (m 4)", {
    preserveMacroState: true,
  });

  assertEquals(result, 12);
});
