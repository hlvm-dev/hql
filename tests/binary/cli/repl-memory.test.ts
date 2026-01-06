/**
 * Tests for REPL memory functions: (memory), (forget), (inspect), (describe), (help), (exit), (clear)
 *
 * These test the new Lisp-style REPL functions that provide a consistent interface
 * for memory management.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { binaryTest, USE_BINARY } from "../_shared/binary-helpers.ts";

console.log(`Testing REPL memory functions in ${USE_BINARY ? "BINARY" : "DENO RUN"} mode`);

// Helper to run REPL with input and capture output
async function runReplWithInput(input: string): Promise<{ stdout: string; stderr: string }> {
  const args = ["repl"];
  const proc = new Deno.Command(Deno.execPath(), {
    args: USE_BINARY
      ? ["run", "-A", "dist/hql", ...args]
      : ["run", "-A", "src/cli/cli.ts", ...args],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    cwd: Deno.cwd(),
  });

  const child = proc.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(input + "\n"));
  await writer.close();

  const { stdout, stderr } = await child.output();
  return {
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

binaryTest("REPL startup shows memory names", async () => {
  const result = await runReplWithInput("(+ 1 1)");
  // Should show Memory: line with definition names or "empty"
  const hasMemoryLine = result.stdout.includes("Memory:") &&
    (result.stdout.includes("definition") || result.stdout.includes("empty"));
  assertEquals(hasMemoryLine, true, `Expected Memory: line in startup, got: ${result.stdout}`);
});

binaryTest("REPL startup shows AI status", async () => {
  const result = await runReplWithInput("(+ 1 1)");
  // Should show AI: line (either with functions or "not available")
  const hasAILine = result.stdout.includes("AI:");
  assertEquals(hasAILine, true, `Expected AI: line in startup, got: ${result.stdout}`);
});

binaryTest("REPL startup shows function commands", async () => {
  const result = await runReplWithInput("(+ 1 1)");
  // Should show the function commands line
  assertStringIncludes(result.stdout, "(memory)");
  assertStringIncludes(result.stdout, '(forget "x")');
  assertStringIncludes(result.stdout, "(inspect x)");
  assertStringIncludes(result.stdout, "(describe x) AI");
  assertStringIncludes(result.stdout, "(help)");
});

binaryTest("REPL (memory) function returns definition info", async () => {
  const result = await runReplWithInput("(memory)");
  // Should return an object with count, names, path (auto-awaited by REPL)
  assertStringIncludes(result.stdout, "count");
  assertStringIncludes(result.stdout, "names");
  assertStringIncludes(result.stdout, "path");
});

binaryTest("REPL (inspect) function shows source code", async () => {
  // First define the function (persists to memory.hql)
  await runReplWithInput("(defn test_inspect_fn [x] (+ x 1))");

  // Then inspect it in a new session (reads from memory.hql, auto-awaited by REPL)
  const result = await runReplWithInput("(inspect test_inspect_fn)");
  // Should show function name, type, AND source code
  assertStringIncludes(result.stdout, "test_inspect_fn");
  assertStringIncludes(result.stdout, "function");
  assertStringIncludes(result.stdout, "(defn test_inspect_fn");

  // Cleanup
  await runReplWithInput('(forget "test_inspect_fn")');
});

binaryTest("REPL (help) function shows help text", async () => {
  const result = await runReplWithInput("(help)");
  // Should show HQL REPL Functions header and function list
  assertStringIncludes(result.stdout, "HQL REPL Functions");
  assertStringIncludes(result.stdout, "(memory)");
  assertStringIncludes(result.stdout, "(forget");
  assertStringIncludes(result.stdout, "(inspect");
  assertStringIncludes(result.stdout, "(describe");
});

binaryTest("REPL (forget) removes definition from memory", async () => {
  // Define something
  await runReplWithInput("(def test_forget_val 123)");

  // Forget it (auto-awaited by REPL)
  const result = await runReplWithInput('(forget "test_forget_val")');
  assertStringIncludes(result.stdout, "Removed");

  // Verify it's gone by trying to forget again
  const result2 = await runReplWithInput('(forget "test_forget_val")');
  assertStringIncludes(result2.stdout, "not found");
});

binaryTest("REPL (clear) function works without error", async () => {
  const result = await runReplWithInput("(clear)");
  // Should not error - just return nil
  const hasError = result.stderr.includes("Error") || result.stdout.includes("Error");
  assertEquals(hasError, false, `clear should not error, got: ${result.stderr}`);
});

binaryTest("REPL empty memory shows teaching message", async () => {
  // Backup memory file
  const memoryPath = `${Deno.env.get("HOME")}/.hql/memory.hql`;
  const backupPath = `${memoryPath}.test-backup`;

  try {
    // Move memory file temporarily
    try {
      await Deno.rename(memoryPath, backupPath);
    } catch {
      // File might not exist, that's ok
    }

    const result = await runReplWithInput("(+ 1 1)");
    // Should show "empty — def/defn auto-save here"
    assertStringIncludes(result.stdout, "empty");
    assertStringIncludes(result.stdout, "def/defn auto-save");
  } finally {
    // Restore memory file
    try {
      await Deno.rename(backupPath, memoryPath);
    } catch {
      // Backup might not exist
    }
  }
});

binaryTest("REPL dot commands still work as aliases", async () => {
  // Test .help
  const helpResult = await runReplWithInput(".help");
  assertStringIncludes(helpResult.stdout, "HQL REPL Functions");

  // Test .memory
  const memResult = await runReplWithInput(".memory");
  assertStringIncludes(memResult.stdout, "Location:");
  assertStringIncludes(memResult.stdout, "Definitions:");
});
