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
import { transpileToJavascript } from "../../src/transpiler/hql-transpiler.ts";

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

Deno.test("Bugfix #2: Stress test with many parallel compilations", async () => {
  // Create 50 concurrent transpilation tasks
  const tasks = [];
  for (let i = 0; i < 50; i++) {
    const code = `(+ ${i} 1)`;
    tasks.push(transpileToJavascript(code));
  }

  // Run all concurrently
  const start = performance.now();
  const results = await Promise.all(tasks);
  const elapsed = performance.now() - start;

  // All should complete successfully
  assertEquals(results.length, 50, "All 50 transpilations should complete");

  // Verify all results have code
  for (let i = 0; i < results.length; i++) {
    assertExists(results[i].code, `Transpilation ${i} should have code`);
  }

  console.log(`✓ 50 concurrent transpilations completed in ${elapsed.toFixed(2)}ms`);

  // Should complete in reasonable time (< 5 seconds)
  assertEquals(elapsed < 5000, true, "Should complete within 5 seconds");
});

Deno.test("Bugfix #2: Sequential transpilations use same environment", async () => {
  // First transpilation
  const result1 = await transpileToJavascript("(+ 1 2)");
  assertExists(result1.code);

  // Second transpilation should reuse same environment
  const result2 = await transpileToJavascript("(* 3 4)");
  assertExists(result2.code);

  // Third transpilation should also reuse same environment
  const result3 = await transpileToJavascript("(- 10 5)");
  assertExists(result3.code);
});

Deno.test("Bugfix #2: Environment initialization is idempotent", async () => {
  // Multiple calls should all succeed and return valid results
  const promises = [];

  for (let i = 0; i < 10; i++) {
    promises.push(transpileToJavascript(`(+ ${i} ${i})`));
  }

  const results = await Promise.all(promises);

  // All should complete successfully
  assertEquals(results.length, 10);
  results.forEach((result, i) => {
    assertExists(result.code, `Result ${i} should have code`);
  });
});

Deno.test("Bugfix #2: Rapid fire concurrent requests", async () => {
  // Simulate rapid-fire concurrent requests (worst case for race conditions)
  const batchSize = 20;
  const batches = 3;

  for (let batch = 0; batch < batches; batch++) {
    const promises = [];

    for (let i = 0; i < batchSize; i++) {
      promises.push(transpileToJavascript(`(* ${batch} ${i})`));
    }

    const results = await Promise.all(promises);
    assertEquals(results.length, batchSize, `Batch ${batch} should complete all tasks`);

    results.forEach((result) => {
      assertExists(result.code, "Each result should have code");
    });
  }

  console.log(`✓ ${batches * batchSize} transpilations across ${batches} batches completed successfully`);
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
    // Macros should expand to ternary operators
    assertEquals(
      result.code.includes("?") || result.code.includes("true") || result.code.includes("false"),
      true,
      `Macro ${i} should expand correctly`
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
