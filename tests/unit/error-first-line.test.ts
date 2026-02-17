/**
 * Test error on first line
 */

import { assertEquals } from "jsr:@std/assert@1";
import { runFileExpectRuntimeError } from "./helpers.ts";

Deno.test("Error on line 1 of multi-line file", async () => {
  const code = `(let bad undefined_var)
(let x 10)
(let y 20)`;

  const { error } = await runFileExpectRuntimeError(code, {
    prefix: "hlvm-first-",
    fileName: "test.hql",
  });

  assertEquals(
    error.sourceLocation.line,
    1,
    `Error should be on line 1, got ${error.sourceLocation.line}`,
  );
});
