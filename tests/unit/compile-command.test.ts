/**
 * Unit tests for HLVM compile command
 *
 * These tests verify the compile command functionality.
 * Note: Tests involving actual binary compilation are slow and should be run separately.
 *
 * Run with: deno test --allow-all tests/unit/compile-command.test.ts
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { getPlatform } from "../../src/platform/platform.ts";

const p = getPlatform();
const CLI_PATH = p.path.fromFileUrl(
  new URL("../../src/hlvm/cli/cli.ts", import.meta.url),
);

// Test helper to capture command output
async function runHqlCompile(
  args: string[],
  options: { cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await p.command.output({
    cmd: [p.process.execPath(), "run", "-A", CLI_PATH, "hql", "compile", ...args],
    cwd: options.cwd,
    stdout: "piped",
    stderr: "piped",
  });

  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

// Create a temporary HQL file for testing (platform has no makeTempFile, so use makeTempDir + writeTextFile)
async function createTempHqlFile(content: string): Promise<string> {
  const tempDir = await p.fs.makeTempDir({ prefix: "hlvm_compile_test_" });
  const tempFile = p.path.join(tempDir, "test.hql");
  await p.fs.writeTextFile(tempFile, content);
  return tempFile;
}

async function createBundledTsFixture(): Promise<{
  tempDir: string;
  tsEntry: string;
}> {
  const tempDir = await p.fs.makeTempDir({ prefix: "hlvm_compile_ts_test_" });
  const libDir = p.path.join(tempDir, "lib");
  await p.fs.mkdir(libDir, { recursive: true });

  await p.fs.writeTextFile(p.path.join(libDir, "check.hql"), `
    (import [assertEqual] from "@hlvm/assert")
    (fn affirm [x]
      (do
        (assertEqual x 7 "x should be 7")
        x))
    (export [affirm])
  `);

  await p.fs.writeTextFile(p.path.join(libDir, "math.hql"), `
    (import [affirm] from "./check.hql")
    (fn add2 [x]
      (affirm (+ x 2)))
    (export [add2])
  `);

  const tsEntry = p.path.join(tempDir, "mod.ts");
  await p.fs.writeTextFile(
    tsEntry,
    `import { add2 } from "./lib/math.hql";\nexport const seven = add2(5);\nconsole.log(seven);\n`,
  );

  return { tempDir, tsEntry };
}

Deno.test("compile --help shows usage", async () => {
  const result = await runHqlCompile(["--help"]);

  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "HQL Compile");
  assertStringIncludes(result.stdout, "--target");
  assertStringIncludes(result.stdout, "js");
  assertStringIncludes(result.stdout, "native");
  assertStringIncludes(result.stdout, "all");
  assertStringIncludes(result.stdout, "linux");
  assertStringIncludes(result.stdout, "macos");
  assertStringIncludes(result.stdout, "windows");
});

Deno.test("compile without file shows error", async () => {
  const result = await runHqlCompile([]);

  assertEquals(result.code, 1);
  // Error could be in stdout or stderr depending on how CLI handles it
  const output = result.stdout + result.stderr;
  // Shows CLI help when no file specified
  assertStringIncludes(output, "compile");
});

Deno.test("compile with invalid target shows error", async () => {
  const tempFile = await createTempHqlFile("(print 1)");

  try {
    const result = await runHqlCompile([tempFile, "--target", "invalid-target"]);

    assertEquals(result.code, 1);
    const output = result.stdout + result.stderr;
    assertStringIncludes(output, "Unknown target");
  } finally {
    // Remove the parent temp directory
    const tempDir = p.path.dirname(tempFile);
    await p.fs.remove(tempDir, { recursive: true });
  }
});

Deno.test("compile to JavaScript (default)", async () => {
  const tempFile = await createTempHqlFile(`
    (fn greet [name]
      (str "Hello, " name "!"))
    (print (greet "World"))
  `);

  const tempDir = p.path.dirname(tempFile);
  const baseName = tempFile.split("/").pop()!.replace(".hql", ".js");
  const outputFile = p.path.join(tempDir, baseName);

  try {
    const result = await runHqlCompile([tempFile], { cwd: tempDir });

    assertEquals(result.code, 0, `Compile failed: ${result.stderr}`);
    assertStringIncludes(result.stdout, "Compiling");
    assertStringIncludes(result.stdout, "JavaScript output");

    // Verify JS file was created
    const stat = await p.fs.stat(outputFile);
    assertEquals(stat.isFile, true);

    // Verify JS runs correctly
    const runResult = await p.command.output({
      cmd: [p.process.execPath(), "run", "-A", outputFile],
      stdout: "piped",
      stderr: "piped",
    });

    const runOutput = new TextDecoder().decode(runResult.stdout);
    assertStringIncludes(runOutput, "Hello, World!");
  } finally {
    await p.fs.remove(tempDir, { recursive: true });
    try {
      await p.fs.remove(outputFile);
    } catch { /* ignore */ }
  }
});

Deno.test("compile with -o flag specifies output path", async () => {
  const tempFile = await createTempHqlFile("(print 42)");
  const outputDir = await p.fs.makeTempDir({ prefix: "hlvm_compile_output_" });
  const customOutput = p.path.join(outputDir, "output.js");
  await p.fs.writeTextFile(customOutput, ""); // Create empty file

  try {
    const result = await runHqlCompile([tempFile, "-o", customOutput]);

    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "JavaScript output");
    assertStringIncludes(result.stdout, customOutput);

    // Verify output file exists
    const stat = await p.fs.stat(customOutput);
    assertEquals(stat.isFile, true);
  } finally {
    const tempDir = p.path.dirname(tempFile);
    await p.fs.remove(tempDir, { recursive: true });
    try {
      await p.fs.remove(outputDir, { recursive: true });
    } catch { /* ignore */ }
  }
});

// Test with complex HQL code (TCO, macros, etc.)
Deno.test("compile complex HQL with TCO", async () => {
  const tempFile = await createTempHqlFile(`
    // Factorial with TCO
    (fn factorial [n acc]
      (if (<= n 1)
        acc
        (factorial (- n 1) (* n acc))))

    (print "factorial 10:" (factorial 10 1))
  `);

  const tempDir = p.path.dirname(tempFile);
  const baseName = tempFile.split("/").pop()!.replace(".hql", ".js");
  const outputFile = p.path.join(tempDir, baseName);

  try {
    const result = await runHqlCompile([tempFile], { cwd: tempDir });

    assertEquals(result.code, 0, `Compile failed: ${result.stderr}`);

    // Run and verify output
    const runResult = await p.command.output({
      cmd: [p.process.execPath(), "run", "-A", outputFile],
      stdout: "piped",
      stderr: "piped",
    });

    const runOutput = new TextDecoder().decode(runResult.stdout);
    assertStringIncludes(runOutput, "factorial 10:");
    assertStringIncludes(runOutput, "3628800");
  } finally {
    await p.fs.remove(tempDir, { recursive: true });
    try {
      await p.fs.remove(outputFile);
    } catch { /* ignore */ }
  }
});

Deno.test("compile TypeScript entry with nested HQL imports and embedded packages", async () => {
  const { tempDir, tsEntry } = await createBundledTsFixture();
  const outputFile = p.path.join(tempDir, "bundle.js");

  try {
    const result = await runHqlCompile([tsEntry, "-o", outputFile], {
      cwd: tempDir,
    });

    assertEquals(result.code, 0, `Compile failed: ${result.stderr}`);
    assertStringIncludes(result.stdout, "JavaScript output");

    const stat = await p.fs.stat(outputFile);
    assertEquals(stat.isFile, true);

    const runResult = await p.command.output({
      cmd: [p.process.execPath(), "run", "-A", outputFile],
      stdout: "piped",
      stderr: "piped",
    });

    const runOutput = new TextDecoder().decode(runResult.stdout);
    assertStringIncludes(runOutput, "7");
  } finally {
    await p.fs.remove(tempDir, { recursive: true });
  }
});
