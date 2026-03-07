/**
 * Tests for correct line number reporting when helpers are injected
 *
 * When runtime helpers like __hql_get are injected at the top of generated code,
 * they shift all user code down by several lines. The lineOffset in the source map
 * must be correctly applied to report accurate error locations.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { runFileExpectRuntimeError } from "./helpers.ts";

Deno.test("Line offset: Error location with array access helper injection", async () => {
  // This code will trigger __hql_get helper injection
  // The error is on line 3
  const code = `(let data [1 2 3])
(let result (map (fn [x] (* x 2)) data))
(let bad (/ 10 undefined_var))`;

  const { error } = await runFileExpectRuntimeError(code, {
    prefix: "hlvm-offset-",
    fileName: "test.hql",
  });

  // The error should be on line 3, NOT some inflated number like line 11
  assertEquals(
    error.sourceLocation.line,
    3,
    `Error should be on line 3, but was reported on line ${error.sourceLocation.line}. This indicates lineOffset is not being applied.`,
  );
});

Deno.test("Line offset: Error location with get/range/map helpers", async () => {
  // This code uses multiple features that inject helpers
  const code = `(let nums [1 2 3 4 5])
(let doubled (map (fn [n] (* n 2)) nums))
(let first (get nums 0))
(let bad_var undefined_thing)`;

  const { error } = await runFileExpectRuntimeError(code, {
    prefix: "hlvm-offset-",
    fileName: "test2.hql",
  });

  // The error should be on line 4
  assertEquals(
    error.sourceLocation.line,
    4,
    `Error should be on line 4, but was reported on line ${error.sourceLocation.line}`,
  );
});

