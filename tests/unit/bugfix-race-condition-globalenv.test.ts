// test/bugfix-race-condition-globalenv.test.ts
// Tests for BUG #2: Race Condition in globalEnv Initialization Fix
//
// Bug: Classic check-then-act race condition where multiple concurrent calls
// to getGlobalEnv() could create multiple Environment instances:
//   - Thread A checks: globalEnv === null → true
//   - Thread B checks: globalEnv === null → true
//   - Both threads create new Environment
//   - Both threads call loadSystemMacros()
//   - Second one overwrites the first
//
// This caused:
// - Macros loaded twice
// - System macros duplicated
// - Possible memory leaks
// - Inconsistent environment state
// - Hard to reproduce bugs
//
// Fix: Implemented Promise-based singleton pattern using globalEnvPromise
// to ensure only one initialization happens even under concurrent load.

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { transpileToJavascript } from "../../src/hql/transpiler/hql-transpiler.ts";

Deno.test("Bugfix #2: Concurrent transpilation works correctly", async () => {
  // Test that multiple concurrent transpilations don't create race conditions
  const code1 = `(+ 1 2)`;
  const code2 = `(* 3 4)`;
  const code3 = `(- 10 5)`;

  // Run all transpilations concurrently
  const results = await Promise.all([
    transpileToJavascript(code1),
    transpileToJavascript(code2),
    transpileToJavascript(code3),
  ]);

  // All should complete successfully
  assertEquals(results.length, 3, "All transpilations should complete");
  assertExists(results[0].code, "First transpilation should have code");
  assertExists(results[1].code, "Second transpilation should have code");
  assertExists(results[2].code, "Third transpilation should have code");
});

Deno.test("Bugfix #2: Macros work correctly under concurrent load", async () => {
  // Test that macros expand correctly even under concurrent load
  const codes = [
    "(when true 1)",
    "(unless false 2)",
    "(when (> 5 3) 3)",
    "(unless (< 5 3) 4)",
    "(when true (+ 1 2))",
  ];

  const promises = codes.map(code => transpileToJavascript(code));
  const results = await Promise.all(promises);

  // All should transpile successfully
  assertEquals(results.length, codes.length);
  results.forEach((result, i) => {
    assertExists(result.code, `Macro code ${i} should transpile`);
    // when/unless macros should expand to ternary expressions (condition ? then : else)
    // Check for the ternary pattern, not just the presence of random keywords
    const hasTernary = /\?.*:/.test(result.code);
    assertEquals(
      hasTernary,
      true,
      `Macro ${i} should expand to ternary expression. Got: ${result.code.slice(0, 100)}`
    );
  });
});

Deno.test("Bugfix #2: Complex code under concurrent load", async () => {
  // Test more complex code to ensure system macros and environment are properly initialized
  const complexCode = `
(fn add [x y]
  (+ x y))

(let result (add 10 20))
result
`;

  // Run same complex code multiple times concurrently
  const promises = Array(10).fill(null).map(() =>
    transpileToJavascript(complexCode)
  );

  const results = await Promise.all(promises);

  // All should complete successfully
  assertEquals(results.length, 10);
  results.forEach((result) => {
    assertExists(result.code, "Complex code should transpile");
    // Should contain function definition
    assertEquals(result.code.includes("function"), true, "Should contain function");
  });
});
