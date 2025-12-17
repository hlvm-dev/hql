/**
 * Tests for stdlib bundling - verifying that transpiled HQL produces
 * self-contained JavaScript that works without any external dependencies.
 *
 * These tests verify the core promise of HQL: transpiled code runs standalone
 * in any JavaScript environment (Deno, Node.js, browser) without needing
 * the HQL runtime.
 */

import { assertEquals, assertStringIncludes, assertMatch } from "https://deno.land/std@0.218.0/assert/mod.ts";

// Path to CLI entry point
const CLI_PATH = new URL("../../src/cli/cli.ts", import.meta.url).pathname;

// Binary test mode: set HQL_TEST_BINARY=1 for genuine binary testing
// Default: quick mode using deno run (same code path, faster)
const USE_BINARY = Deno.env.get("HQL_TEST_BINARY") === "1";

// Cross-platform binary path
const IS_WINDOWS = Deno.build.os === "windows";
const TEMP_DIR = (Deno.env.get(IS_WINDOWS ? "TEMP" : "TMPDIR") || (IS_WINDOWS ? "C:\\Temp" : "/tmp")).replace(/[\/\\]$/, "");
const BINARY_NAME = IS_WINDOWS ? "hql-test-binary.exe" : "hql-test-binary";
const BINARY_PATH = IS_WINDOWS ? `${TEMP_DIR}\\${BINARY_NAME}` : `${TEMP_DIR}/${BINARY_NAME}`;

// Track if binary is compiled (only relevant when USE_BINARY=true)
let binaryCompiled = false;

/**
 * Compile the HQL binary (only when USE_BINARY mode is enabled)
 */
async function ensureBinaryCompiled(): Promise<void> {
  if (!USE_BINARY || binaryCompiled) return;

  console.log("🔨 Compiling HQL binary for genuine binary testing...");
  const cmd = new Deno.Command("deno", {
    args: ["compile", "-A", "--output", BINARY_PATH, CLI_PATH],
    stdout: "piped",
    stderr: "piped",
  });

  const { success, stderr } = await cmd.output();
  if (!success) {
    throw new Error(`Failed to compile binary: ${new TextDecoder().decode(stderr)}`);
  }

  binaryCompiled = true;
  console.log("✅ Binary compiled: " + BINARY_PATH);
}

/**
 * Helper to compile HQL to JavaScript
 * - USE_BINARY=true: uses compiled binary (genuine production test)
 * - USE_BINARY=false: uses deno run (quick test, same code path)
 *
 * Uses the `compile` command with `--target js -o <output>` (transpile was removed)
 */
async function runTranspileCLI(inputPath: string, outputPath: string): Promise<{ success: boolean; stderr: string }> {
  await ensureBinaryCompiled();

  let cmd: Deno.Command;
  if (USE_BINARY) {
    cmd = new Deno.Command(BINARY_PATH, {
      args: ["compile", inputPath, "--target", "js", "-o", outputPath],
      stdout: "piped",
      stderr: "piped",
    });
  } else {
    cmd = new Deno.Command("deno", {
      args: ["run", "-A", CLI_PATH, "compile", inputPath, "--target", "js", "-o", outputPath],
      stdout: "piped",
      stderr: "piped",
    });
  }

  const { success, stderr } = await cmd.output();
  return {
    success,
    stderr: new TextDecoder().decode(stderr),
  };
}

/**
 * Helper to create a temp HQL file, transpile it, and return the output
 */
async function transpileHQL(hqlCode: string): Promise<string> {
  const tempDir = await Deno.makeTempDir();
  const inputPath = `${tempDir}/test.hql`;
  const outputPath = `${tempDir}/test.js`;

  await Deno.writeTextFile(inputPath, hqlCode);

  try {
    const { success, stderr } = await runTranspileCLI(inputPath, outputPath);
    if (!success) {
      throw new Error(`Transpilation failed: ${stderr}`);
    }
    return await Deno.readTextFile(outputPath);
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
    // Transpile using subprocess
    const transpileResult = await runTranspileCLI(inputPath, outputPath);
    if (!transpileResult.success) {
      return {
        stdout: "",
        stderr: `Transpilation failed: ${transpileResult.stderr}`,
        success: false,
      };
    }

    // Run the output with Deno
    const cmd = new Deno.Command("deno", {
      args: ["run", outputPath],
      stdout: "piped",
      stderr: "piped",
    });

    const { success, stdout, stderr } = await cmd.output();

    return {
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
      success,
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
    // Use doall to realize the lazy sequence for printing
    const result = await transpileAndRun(`(print (doall (map (fn (x) (* x 2)) [1 2 3])))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertMatch(result.stdout, /2.*4.*6/);
  },
});

Deno.test({
  name: "stdlib-bundling: filter function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Use doall to realize the lazy sequence for printing
    const result = await transpileAndRun(`(print (doall (filter (fn (x) (> x 2)) [1 2 3 4 5])))`);
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
    // Use doall to realize the lazy sequence for printing
    const result = await transpileAndRun(`(print (doall (take 3 [1 2 3 4 5])))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertMatch(result.stdout, /1.*2.*3/);
  },
});

Deno.test({
  name: "stdlib-bundling: drop function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Use doall to realize the lazy sequence for printing
    const result = await transpileAndRun(`(print (doall (drop 2 [1 2 3 4 5])))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertMatch(result.stdout, /3.*4.*5/);
  },
});

Deno.test({
  name: "stdlib-bundling: concat function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Use doall to realize the lazy sequence for printing
    const result = await transpileAndRun(`(print (doall (concat [1 2] [3 4])))`);
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
    // Use doall to realize the lazy sequence for printing
    const result = await transpileAndRun(`(print (doall (distinct [1 2 2 3 3 3])))`);
    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertMatch(result.stdout, /1.*2.*3/);
  },
});

Deno.test({
  name: "stdlib-bundling: flatten function works standalone",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Use doall to realize the lazy sequence for printing
    const result = await transpileAndRun(`(print (doall (flatten [[1 2] [3 4]])))`);
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
      // Transpile using subprocess
      const transpileResult = await runTranspileCLI(inputPath, outputPath);
      assertEquals(transpileResult.success, true, `Transpilation should succeed. stderr: ${transpileResult.stderr}`);

      // Run with Node.js
      const cmd = new Deno.Command("node", {
        args: [outputPath],
        stdout: "piped",
        stderr: "piped",
      });

      const { success, stdout, stderr } = await cmd.output();

      assertEquals(success, true, `Node.js execution should succeed. stderr: ${new TextDecoder().decode(stderr)}`);
      assertStringIncludes(new TextDecoder().decode(stdout).trim(), "100");
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

    // The size should be reasonable (under 330KB with all bundling overhead)
    // Increased from 310KB after adding Phase 3 self-hosted functions (mapIndexed, keepIndexed, mapcat, keep)
    assertEquals(sizeKB < 330, true, `Output should be under 330KB, got ${sizeKB.toFixed(2)} KB`);
  },
});
