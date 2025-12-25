/**
 * Binary tests for the `hql run` command
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { runCLI, runExpression, withTempDir, USE_BINARY } from "../_shared/binary-helpers.ts";

// Log which mode we're testing
console.log(`Testing 'run' command in ${USE_BINARY ? "BINARY" : "DENO RUN"} mode`);

Deno.test({
  name: "CLI run: execute inline expression",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(+ 1 2)");
    assertEquals(result.success, true, `Execution failed: ${result.stderr}`);
    assertStringIncludes(result.stdout, "3");
  },
});

Deno.test({
  name: "CLI run: auto-print single expression",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(* 5 6)");
    assertEquals(result.success, true, `Execution failed: ${result.stderr}`);
    assertStringIncludes(result.stdout, "30");
  },
});

Deno.test({
  name: "CLI run: explicit print",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(print "Hello World")');
    assertEquals(result.success, true, `Execution failed: ${result.stderr}`);
    assertStringIncludes(result.stdout, "Hello World");
  },
});

Deno.test({
  name: "CLI run: execute HQL file",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      const filePath = `${dir}/test.hql`;
      await Deno.writeTextFile(filePath, `
        (const x 10)
        (const y 20)
        (print (+ x y))
      `);

      const result = await runCLI("run", [filePath]);
      assertEquals(result.success, true, `Execution failed: ${result.stderr}`);
      assertStringIncludes(result.stdout, "30");
    });
  },
});

Deno.test({
  name: "CLI run: stdlib functions work",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(first [1 2 3])");
    assertEquals(result.success, true, `Execution failed: ${result.stderr}`);
    assertStringIncludes(result.stdout, "1");
  },
});

Deno.test({
  name: "CLI run: map function",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (map (fn [x] (* x 2)) [1 2 3]))");
    assertEquals(result.success, true, `Execution failed: ${result.stderr}`);
    // Should output [2, 4, 6] or similar
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "4");
    assertStringIncludes(result.stdout, "6");
  },
});

Deno.test({
  name: "CLI run: reduce function",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(reduce add 0 [1 2 3 4 5])");
    assertEquals(result.success, true, `Execution failed: ${result.stderr}`);
    assertStringIncludes(result.stdout, "15");
  },
});

Deno.test({
  name: "CLI run: filter function",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(vec (filter (fn [x] (> x 2)) [1 2 3 4 5]))");
    assertEquals(result.success, true, `Execution failed: ${result.stderr}`);
    assertStringIncludes(result.stdout, "3");
    assertStringIncludes(result.stdout, "4");
    assertStringIncludes(result.stdout, "5");
  },
});

Deno.test({
  name: "CLI run: error on missing file",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runCLI("run", ["/nonexistent/file.hql"]);
    assertEquals(result.success, false, "Should fail for missing file");
  },
});

Deno.test({
  name: "CLI run: error on syntax error",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(const x");  // Unclosed paren
    assertEquals(result.success, false, "Should fail for syntax error");
  },
});
