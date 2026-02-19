/**
 * Unit tests for HLVM compile command
 *
 * These tests verify the compile command functionality.
 * Note: Tests involving actual binary compilation are slow and should be run separately.
 *
 * Run with: deno test --allow-all tests/unit/compile-command.test.ts
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { getPlatform } from "../../src/platform/platform.ts";

const p = getPlatform();

// Test helper to capture command output
async function runHqlCompile(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await p.command.output({
    cmd: [p.process.execPath(), "run", "-A", "src/hlvm/cli/cli.ts", "compile", ...args],
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

Deno.test("compile --help shows usage", async () => {
  const result = await runHqlCompile(["--help"]);

  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "HLVM Compile");
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

  // Output file will be created in current working directory
  const baseName = tempFile.split("/").pop()!.replace(".hql", ".js");
  const outputFile = `${p.process.cwd()}/${baseName}`;

  try {
    const result = await runHqlCompile([tempFile]);

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
    const tempDir = p.path.dirname(tempFile);
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

  // Output file will be created in current working directory
  const baseName = tempFile.split("/").pop()!.replace(".hql", ".js");
  const outputFile = `${p.process.cwd()}/${baseName}`;

  try {
    const result = await runHqlCompile([tempFile]);

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
    const tempDir = p.path.dirname(tempFile);
    await p.fs.remove(tempDir, { recursive: true });
    try {
      await p.fs.remove(outputFile);
    } catch { /* ignore */ }
  }
});
