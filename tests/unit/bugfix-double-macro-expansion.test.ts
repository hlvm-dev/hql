// test/bugfix-double-macro-expansion.test.ts
// Tests for BUG #1: Double Macro Expansion Fix
//
// Bug: Macros were being expanded twice in the pipeline:
//   - Once in hql-transpiler.ts:87
//   - Again in transformer.ts:95
//
// This caused macros with side effects to run twice, stateful macros
// to produce wrong results, and 100% slower compilation.
//
// Fix: Removed the second expansion in transformer.ts

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";
import { transpileToJavascript } from "../../src/hql/transpiler/hql-transpiler.ts";

Deno.test("Bugfix #1: Built-in macros compile correctly after fix", async () => {
  // Test that built-in macros (when, unless, cond) work correctly
  // This ensures we didn't break macro expansion by removing the second pass

  const code = `
(when true
  (+ 1 2))
`;

  const result = await run(code);
  assertEquals(result, 3, "when macro should expand correctly");
});

Deno.test("Bugfix #1: Multiple macro uses work correctly", async () => {
  const code = `
(let a (when true 1))
(let b (unless false 2))
(let c (when true 3))
(+ a (+ b c))
`;

  const result = await run(code);
  assertEquals(result, 6, "All macros should expand once and correctly");
});

Deno.test("Bugfix #1: Nested macro expansion works", async () => {
  const code = `
(when true
  (when true
    (when true
      42)))
`;

  const result = await run(code);
  assertEquals(result, 42, "Nested macros should expand correctly");
});

Deno.test("Bugfix #1: Transpilation produces valid code", async () => {
  // Verify the transpiler produces valid JavaScript
  const code = `
(when true
  (console.log "test")
  (+ 1 2))
`;

  const result = await transpileToJavascript(code);

  assertExists(result, "Should return transpiled result");
  assertExists(result.code, "Should have JavaScript code");
  assertEquals(typeof result.code, "string", "Code should be a string");

  // The transpiled code should contain the expanded ternary operator
  assertEquals(
    result.code.includes("?"),
    true,
    "when macro should expand to ternary operator"
  );

  // Should contain the condition 'true'
  assertEquals(
    result.code.includes("true"),
    true,
    "transpiled code should contain the condition"
  );
});

Deno.test("Bugfix #1: Macro expansion with complex expressions", async () => {
  const code = `
(when (> 5 3)
  "yes")
`;

  const result = await run(code);
  assertEquals(result, "yes", "when macro with expression should evaluate correctly");
});

Deno.test("Bugfix #1: unless macro works correctly", async () => {
  const code = `
(unless false
  (+ 10 20))
`;

  const result = await run(code);
  assertEquals(result, 30, "unless macro should expand correctly");
});

Deno.test("Bugfix #1: when with multiple expressions", async () => {
  const code = `
(var result 0)
(when true
  (= result (+ result 1))
  (= result (+ result 2))
  (= result (+ result 3)))
result
`;

  const result = await run(code);
  assertEquals(result, 6, "when with multiple expressions should work");
});

Deno.test("Bugfix #1: Verify expandMacros not called in transformer", async () => {
  // This is a meta-test that verifies the fix by checking the code
  // Read transformer.ts and ensure expandMacros is not called

  const transformerPath = new URL("../../src/hql/transformer.ts", import.meta.url);
  const transformerCode = await Deno.readTextFile(transformerPath);

  // Check that expandMacros is not imported
  const hasExpandMacrosImport = transformerCode.includes('import { expandMacros }') ||
                                  transformerCode.includes('import { expandMacros,') ||
                                  transformerCode.includes('expandMacros } from');

  assertEquals(
    hasExpandMacrosImport,
    false,
    "transformer.ts should NOT import expandMacros"
  );

  // Check that expandMacros is not called
  const hasExpandMacrosCall = transformerCode.includes('expandMacros(');

  assertEquals(
    hasExpandMacrosCall,
    false,
    "transformer.ts should NOT call expandMacros()"
  );

  console.log("✓ Verified: expandMacros is not used in transformer.ts");
});
