/**
 * CRITICAL TEST: Verify error on middle line (not last line)
 * This tests if the fix is a real fix or just a heuristic that caps to file length
 */

import { assertEquals } from "jsr:@std/assert@1";
import { runFileExpectRuntimeError } from "./helpers.ts";

Deno.test("CRITICAL: Error on line 2 of 4-line file", async () => {
  const code = `(let x 10)
(let bad undefined_var)
(let y 20)
(let z 30)`;

  const { error } = await runFileExpectRuntimeError(code, {
    prefix: "hlvm-middle-",
    fileName: "test.hql",
  });

  // The error should be on line 2, NOT capped to line 4
  assertEquals(
    error.sourceLocation.line,
    2,
    `If this fails with line=${error.sourceLocation.line}, then the fix is just capping to file length, not a real fix!`,
  );
});
