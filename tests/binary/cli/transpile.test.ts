/**
 * Binary tests for the `hql transpile` command
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { runCLI, transpileCode, withTempDir, USE_BINARY } from "../_shared/binary-helpers.ts";

Deno.test({
  name: "CLI transpile: basic transpilation",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { js, result } = await transpileCode(`(print (+ 1 2))`);

    assertEquals(result.success, true, `Transpilation failed: ${result.stderr}`);
    assertStringIncludes(js, "console.log");
    assertStringIncludes(js, "1 + 2");
  },
});

Deno.test({
  name: "CLI transpile: custom output path",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      const inputPath = `${dir}/input.hql`;
      const outputPath = `${dir}/custom-output.js`;

      await Deno.writeTextFile(inputPath, `(def x 42)`);

      const result = await runCLI("transpile", [inputPath, outputPath]);
      assertEquals(result.success, true, `Transpilation failed: ${result.stderr}`);

      const output = await Deno.readTextFile(outputPath);
      assertStringIncludes(output, "42");
    });
  },
});

Deno.test({
  name: "CLI transpile: --print flag outputs to stdout",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      const inputPath = `${dir}/test.hql`;
      await Deno.writeTextFile(inputPath, `(def greeting "hello")`);

      const result = await runCLI("transpile", [inputPath, "--print"]);
      assertEquals(result.success, true, `Transpilation failed: ${result.stderr}`);
      assertStringIncludes(result.stdout, "hello");
    });
  },
});

Deno.test({
  name: "CLI transpile: output is self-contained (no imports)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { js, result } = await transpileCode(`
      (def data [1 2 3])
      (print (first data))
    `);

    assertEquals(result.success, true, `Transpilation failed: ${result.stderr}`);

    // Output should not have external imports
    const importMatches = js.match(/^import\s+/gm);
    assertEquals(importMatches, null, "Output should not contain import statements");

    // Should contain the bundled first function
    assertStringIncludes(js, "first");
  },
});

Deno.test({
  name: "CLI transpile: error on missing input file",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runCLI("transpile", ["/nonexistent/file.hql"]);
    assertEquals(result.success, false, "Should fail for missing file");
  },
});

Deno.test({
  name: "CLI transpile: error on syntax error",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { result } = await transpileCode(`(def x`);  // Unclosed paren
    assertEquals(result.success, false, "Should fail for syntax error");
  },
});

// Log which mode we're testing
console.log(`Testing in ${USE_BINARY ? "BINARY" : "DENO RUN"} mode`);
