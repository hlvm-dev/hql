/**
 * Unit tests for HQL compile command
 *
 * These tests verify the compile command functionality.
 * Note: Tests involving actual binary compilation are slow and should be run separately.
 *
 * Run with: deno test --allow-all tests/unit/compile-command.test.ts
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";

// Test helper to capture command output
async function runHqlCompile(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "src/cli/cli.ts", "compile", ...args],
    stdout: "piped",
    stderr: "piped",
  });

  const result = await cmd.output();

  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

// Create a temporary HQL file for testing
async function createTempHqlFile(content: string): Promise<string> {
  const tempFile = await Deno.makeTempFile({ suffix: ".hql" });
  await Deno.writeTextFile(tempFile, content);
  return tempFile;
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
    await Deno.remove(tempFile);
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
  const outputFile = `${Deno.cwd()}/${baseName}`;

  try {
    const result = await runHqlCompile([tempFile]);

    assertEquals(result.code, 0, `Compile failed: ${result.stderr}`);
    assertStringIncludes(result.stdout, "Compiling");
    assertStringIncludes(result.stdout, "JavaScript output");

    // Verify JS file was created
    const stat = await Deno.stat(outputFile);
    assertEquals(stat.isFile, true);

    // Verify JS runs correctly
    const runResult = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", outputFile],
      stdout: "piped",
    }).output();

    const runOutput = new TextDecoder().decode(runResult.stdout);
    assertStringIncludes(runOutput, "Hello, World!");
  } finally {
    await Deno.remove(tempFile);
    try {
      await Deno.remove(outputFile);
    } catch { /* ignore */ }
  }
});

Deno.test("compile with -o flag specifies output path", async () => {
  const tempFile = await createTempHqlFile("(print 42)");
  const customOutput = await Deno.makeTempFile({ suffix: ".js" });

  try {
    const result = await runHqlCompile([tempFile, "-o", customOutput]);

    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "JavaScript output");
    assertStringIncludes(result.stdout, customOutput);

    // Verify output file exists
    const stat = await Deno.stat(customOutput);
    assertEquals(stat.isFile, true);
  } finally {
    await Deno.remove(tempFile);
    try {
      await Deno.remove(customOutput);
    } catch { /* ignore */ }
  }
});

// Test with complex HQL code (TCO, macros, etc.)
Deno.test("compile complex HQL with TCO", async () => {
  const tempFile = await createTempHqlFile(`
    ;; Factorial with TCO
    (fn factorial [n acc]
      (if (<= n 1)
        acc
        (factorial (- n 1) (* n acc))))

    (print "factorial 10:" (factorial 10 1))
  `);

  // Output file will be created in current working directory
  const baseName = tempFile.split("/").pop()!.replace(".hql", ".js");
  const outputFile = `${Deno.cwd()}/${baseName}`;

  try {
    const result = await runHqlCompile([tempFile]);

    assertEquals(result.code, 0, `Compile failed: ${result.stderr}`);

    // Run and verify output
    const runResult = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", outputFile],
      stdout: "piped",
    }).output();

    const runOutput = new TextDecoder().decode(runResult.stdout);
    assertStringIncludes(runOutput, "factorial 10:");
    assertStringIncludes(runOutput, "3628800");
  } finally {
    await Deno.remove(tempFile);
    try {
      await Deno.remove(outputFile);
    } catch { /* ignore */ }
  }
});
