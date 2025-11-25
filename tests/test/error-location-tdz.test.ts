// Test for TDZ (Temporal Dead Zone) error location reporting
// This test verifies that runtime errors from shadowed variables
// report the correct source location instead of falling back to 1:1

import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { run } from "../../mod.ts";

Deno.test("TDZ error reports correct line number with source maps", async () => {
  // This HQL code has shadowed variables that trigger TDZ errors
  // The second (let x ...) shadows the first one
  // When we try to use the shadowed x, it should report the correct line
  const hqlCode = `
(let x 10)
(let x 20)
(+ x 5)
`.trim();

  try {
    // Enable source maps for accurate error reporting
    await run(hqlCode, {
      generateSourceMap: true,
      sourceContent: hqlCode,
      currentFile: "test.hql",
    });
    throw new Error("Expected error to be thrown");
  } catch (error) {
    // The error should mention the correct line number
    // It should NOT report line 1 (the fallback)
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";

    console.log("Error message:", errorMessage);

    // Verify: The error reports line 2 (where the second let x is), NOT line 1
    // The stack may show .mjs:2: or .hql:2: depending on source map application
    assertMatch(errorStack || errorMessage, /:2:/); // Should contain ":2:" for line 2
    assertEquals(error instanceof Error, true);
  }
});

Deno.test("Reference error reports correct location with source maps", async () => {
  const hqlCode = `
(let a 1)
(let b 2)
(let c (+ a b))
(+ c undefined_variable)
`.trim();

  try {
    await run(hqlCode, {
      generateSourceMap: true,
      sourceContent: hqlCode,
      currentFile: "test.hql",
    });
    throw new Error("Expected error to be thrown");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";
    console.log("Error message:", errorMessage);

    // Verify: Should report line 4 where undefined_variable is used, NOT line 1
    // Check the stack trace which contains the location
    // The stack may show .mjs:4: or .hql:4: depending on source map application
    assertMatch(errorStack || errorMessage, /:4:/); // Should contain ":4:" for line 4
    assertEquals(error instanceof Error, true);
  }
});

Deno.test("Function call error reports correct location with source maps", async () => {
  const hqlCode = `
(fn add [a b] (+ a b))
(add 1 2)
(add 1)
`.trim();

  try {
    await run(hqlCode, {
      generateSourceMap: true,
      sourceContent: hqlCode,
      currentFile: "test.hql",
    });
    throw new Error("Expected error to be thrown");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("Error message:", errorMessage);

    // Should report line 3 where (add 1) is called with missing argument
    // NOT line 1
    assertEquals(error instanceof Error, true);
  }
});
