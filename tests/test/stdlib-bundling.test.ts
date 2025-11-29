/**
 * Tests for stdlib bundling - verifying that transpiled HQL produces
 * self-contained JavaScript that works without any external dependencies.
 *
 * These tests verify the core promise of HQL: transpiled code runs standalone
 * in any JavaScript environment (Deno, Node.js, browser) without needing
 * the HQL runtime.
 */

import { assertEquals, assertStringIncludes, assertMatch } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { transpileCLI } from "../../src/bundler.ts";

/**
 * Helper to create a temp HQL file, transpile it, and return the output
 */
async function transpileHQL(hqlCode: string): Promise<string> {
  const tempDir = await Deno.makeTempDir();
  const inputPath = `${tempDir}/test.hql`;
  const outputPath = `${tempDir}/test.js`;

  await Deno.writeTextFile(inputPath, hqlCode);

  try {
    const result = await transpileCLI(inputPath, outputPath, {
      verbose: false,
      showTiming: false,
      force: true,
    });
    return await Deno.readTextFile(result);
  } finally {
    // Cleanup
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Helper to transpile HQL and run the output in a subprocess
 */
async function transpileAndRun(hqlCode: string): Promise<{ stdout: string; stderr: string; success: boolean }> {
  const tempDir = await Deno.makeTempDir();
  const inputPath = `${tempDir}/test.hql`;
  const outputPath = `${tempDir}/test.js`;

  await Deno.writeTextFile(inputPath, hqlCode);

  try {
    await transpileCLI(inputPath, outputPath, {
      verbose: false,
      showTiming: false,
      force: true,
    });

    // Run with Deno using spawn
    const cmd = new Deno.Command("deno", {
      args: ["run", outputPath],
      stdout: "piped",
      stderr: "piped",
    });

    const child = cmd.spawn();

    // Read stdout and stderr
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    // Wait for process to complete
    const status = await child.status;

    return {
      stdout,
      stderr,
      success: status.success,
    };
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

Deno.test({
  name: "stdlib-bundling: output contains no external imports",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const hqlCode = `(print (first [1 2 3]))`;
    const output = await transpileHQL(hqlCode);

    // Should not contain any import statements (they get bundled)
    const importMatches = output.match(/^import\s+/gm);
    assertEquals(importMatches, null, "Output should not contain import statements");

    // Should not contain require()
    const requireMatches = output.match(/require\s*\(/g);
    assertEquals(requireMatches, null, "Output should not contain require() calls");
  },
});

Deno.test({
  name: "stdlib-bundling: first function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`(print (first [10 20 30]))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertStringIncludes(result.stdout.trim(), "10");
  },
});

Deno.test({
  name: "stdlib-bundling: rest function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`(print (rest [1 2 3]))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertMatch(result.stdout, /2.*3/);
  },
});

Deno.test({
  name: "stdlib-bundling: map function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`(print (map (fn (x) (* x 2)) [1 2 3]))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertMatch(result.stdout, /2.*4.*6/);
  },
});

Deno.test({
  name: "stdlib-bundling: filter function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`(print (filter (fn (x) (> x 2)) [1 2 3 4 5]))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertMatch(result.stdout, /3.*4.*5/);
  },
});

Deno.test({
  name: "stdlib-bundling: reduce function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`(print (reduce (fn (a b) (+ a b)) 0 [1 2 3 4 5]))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertStringIncludes(result.stdout.trim(), "15");
  },
});

Deno.test({
  name: "stdlib-bundling: take function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`(print (take 3 [1 2 3 4 5]))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertMatch(result.stdout, /1.*2.*3/);
  },
});

Deno.test({
  name: "stdlib-bundling: drop function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`(print (drop 2 [1 2 3 4 5]))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertMatch(result.stdout, /3.*4.*5/);
  },
});

Deno.test({
  name: "stdlib-bundling: concat function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`(print (concat [1 2] [3 4]))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertMatch(result.stdout, /1.*2.*3.*4/);
  },
});

Deno.test({
  name: "stdlib-bundling: cons function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`(print (cons 0 [1 2 3]))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertMatch(result.stdout, /0.*1.*2.*3/);
  },
});

Deno.test({
  name: "stdlib-bundling: distinct function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`(print (distinct [1 2 2 3 3 3]))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertMatch(result.stdout, /1.*2.*3/);
  },
});

Deno.test({
  name: "stdlib-bundling: flatten function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`(print (flatten [[1 2] [3 4]]))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertMatch(result.stdout, /1.*2.*3.*4/);
  },
});

Deno.test({
  name: "stdlib-bundling: nth function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`(print (nth [10 20 30] 1))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertStringIncludes(result.stdout.trim(), "20");
  },
});

Deno.test({
  name: "stdlib-bundling: last function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`(print (last [1 2 3 4 5]))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertStringIncludes(result.stdout.trim(), "5");
  },
});

Deno.test({
  name: "stdlib-bundling: count function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`(print (count [1 2 3 4 5]))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertStringIncludes(result.stdout.trim(), "5");
  },
});

Deno.test({
  name: "stdlib-bundling: combined operations work standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const hqlCode = `
(let (nums [1 2 3 4 5])
  (let (doubled (map (fn (x) (* x 2)) nums))
    (let (filtered (filter (fn (x) (> x 5)) doubled))
      (print "Result:" (reduce (fn (a b) (+ a b)) 0 filtered)))))
`;
    const result = await transpileAndRun(hqlCode);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    // [1,2,3,4,5] -> [2,4,6,8,10] -> filter >5 -> [6,8,10] -> sum = 24
    assertStringIncludes(result.stdout, "24");
  },
});

Deno.test({
  name: "stdlib-bundling: output works with Node.js",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const tempDir = await Deno.makeTempDir();
    const inputPath = `${tempDir}/test.hql`;
    const outputPath = `${tempDir}/test.js`;

    await Deno.writeTextFile(inputPath, `(print (first [100 200 300]))`);

    try {
      await transpileCLI(inputPath, outputPath, {
        verbose: false,
        showTiming: false,
        force: true,
      });

      // Run with Node.js
      const cmd = new Deno.Command("node", {
        args: [outputPath],
        stdout: "piped",
        stderr: "piped",
      });

      const child = cmd.spawn();
      const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      const status = await child.status;

      assertEquals(status.success, true, `Node.js execution should succeed. stderr: ${stderr}`);
      assertStringIncludes(stdout.trim(), "100");
    } finally {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

Deno.test({
  name: "stdlib-bundling: tree-shaking - output size is reasonable",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Only use `first` - check output size is reasonable
    const hqlCode = `(print (first [1 2 3]))`;
    const output = await transpileHQL(hqlCode);

    const sizeKB = output.length / 1024;
    console.log(`Output size: ${sizeKB.toFixed(2)} KB`);

    // The size should be reasonable (under 200KB with all bundling overhead)
    assertEquals(sizeKB < 200, true, `Output should be under 200KB, got ${sizeKB.toFixed(2)} KB`);
  },
});
