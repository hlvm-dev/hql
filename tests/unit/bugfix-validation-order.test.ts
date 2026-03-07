// test/bugfix-validation-order.test.ts
// Tests for BUG #3: Validation Order Fix
//
// Bug: Semantic validation happened AFTER optimization in the pipeline:
//   AST → IR → Optimize → Validate → ESTree → JS
//                  ↑         ↑
//              Wrong order!
//
// This caused:
// - Errors reported in optimized code, not original code
// - Wrong line numbers in error messages
// - Confusing error messages
// - Can't validate invariants before transformation
//
// Industry Standard (TypeScript, Rust, Go):
//   Parse → Type Check → Optimize → Codegen
//            ↑ Validate BEFORE optimizing
//
// Fix: Moved validateSemantics() call before optimization:
//   AST → IR → Validate → Optimize → ESTree → JS
//                  ↑ Now correct!

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { transpileToJavascript } from "../../src/hql/transpiler/hql-transpiler.ts";
import { getErrorMessage } from "../../src/common/utils.ts";
import { run } from "./helpers.ts";

Deno.test("Bugfix #3: Duplicate variable declarations detected", async () => {
  // Test that duplicate declarations at top level are caught during validation
  const code = `
(let x 10)
(let x 20)
`;

  // Should throw error during validation (before optimization)
  await assertRejects(
    async () => {
      await transpileToJavascript(code);
    },
    Error,
    "already been declared",
    "Should detect duplicate declaration"
  );
});

Deno.test("Bugfix #3: Valid code with similar names passes validation", async () => {
  // Test that validation doesn't produce false positives
  const code = `
(fn foo []
  (let x 10)
  (let y 20)
  (+ x y))

(foo)
`;

  // Should compile successfully
  const result = await run(code);
  assertEquals(result, 30, "Valid code should compile and run correctly");
});

Deno.test("Bugfix #3: Nested scope variables are allowed", async () => {
  // Test that same variable name in different scopes is allowed
  const code = `
(fn outer []
  (let x 10)
  (fn inner []
    (let x 20)
    x)
  (+ x (inner)))

(outer)
`;

  // Should compile successfully
  const result = await run(code);
  assertEquals(result, 30, "Nested scopes should allow same variable name");
});

Deno.test("Bugfix #3: Error messages are clear and accurate", async () => {
  // Test that error messages make sense (not based on optimized code)
  const code = `
(var result 0)
(var result 1)
`;

  try {
    await transpileToJavascript(code);
    throw new Error("Should have thrown validation error");
  } catch (error) {
    const message = getErrorMessage(error);

    // Error message should mention 'result' variable or declare/declaration
    assertEquals(
      message.toLowerCase().includes("result") ||
      message.toLowerCase().includes("declared") ||
      message.toLowerCase().includes("declaration"),
      true,
      `Error message should be clear: ${message}`
    );
  }
});

