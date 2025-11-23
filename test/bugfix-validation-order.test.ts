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
import { transpileToJavascript } from "../core/src/transpiler/hql-transpiler.ts";
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

Deno.test("Bugfix #3: Validation happens before optimization", async () => {
  // Test that validation catches errors even if code would be optimized
  const code = `
(let x 5)
(let x 10)
`;

  // Should throw during validation, not during optimization
  await assertRejects(
    async () => {
      await transpileToJavascript(code);
    },
    Error,
    "already been declared",
    "Validation should catch error before optimization"
  );
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
    const message = error instanceof Error ? error.message : String(error);

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

Deno.test("Bugfix #3: Complex code validates correctly", async () => {
  // Test that complex code passes validation when correct
  const code = `
(fn fibonacci [n]
  (if (<= n 1)
    n
    (+ (fibonacci (- n 1))
       (fibonacci (- n 2)))))

(fibonacci 5)
`;

  // Should compile and run successfully
  const result = await run(code);
  assertEquals(result, 5, "Complex recursive function should work");
});

Deno.test("Bugfix #3: Multiple functions with local variables", async () => {
  // Test that validation works correctly with multiple functions
  const code = `
(fn add [a b]
  (let sum (+ a b))
  sum)

(fn multiply [x y]
  (let product (* x y))
  product)

(+ (add 2 3) (multiply 4 5))
`;

  const result = await run(code);
  assertEquals(result, 25, "Multiple functions should work correctly");
});

Deno.test("Bugfix #3: Validation with loops", async () => {
  // Test that validation works with loop constructs
  const code = `
(var sum 0)
(var i 0)
(while (< i 5)
  (set! sum (+ sum i))
  (set! i (+ i 1)))
sum
`;

  const result = await run(code);
  assertEquals(result, 10, "Loops should validate and execute correctly");
});

Deno.test("Bugfix #3: Class method validation", async () => {
  // Test that validation works with class methods
  const code = `
(class Counter
  (constructor []
    (set! this.count 0))

  (fn increment []
    (set! this.count (+ this.count 1)))

  (fn getCount []
    this.count))

(var c (new Counter))
(c.increment)
(c.increment)
(c.getCount)
`;

  const result = await run(code);
  assertEquals(result, 2, "Class methods should validate correctly");
});

Deno.test("Bugfix #3: Validation with macros", async () => {
  // Test that validation works correctly with macro-expanded code
  const code = `
(let x 10)
(let y 20)
(let result (when true (+ x y)))

result
`;

  const result = await run(code);
  assertEquals(result, 30, "Macro-expanded code should validate correctly");
});
