/**
 * Tests for REPL memory functions: (memory), (forget), (inspect), (describe), (help), (exit), (clear)
 *
 * These test the new Lisp-style REPL functions that provide a consistent interface
 * for memory management.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";
import {
  BINARY_PATH,
  BINARY_TEST_HLVM_DIR,
  CLI_PATH,
  ensureBinaryCompiled,
  getBinaryTestEnv,
  USE_BINARY,
} from "../_shared/binary-helpers.ts";

const INTERACTIVE_REPL_AVAILABLE = Deno.stdin.isTerminal() && Deno.stdout.isTerminal();

function replMemoryTest(name: string, fn: () => void | Promise<void>): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    ignore: !INTERACTIVE_REPL_AVAILABLE,
    fn,
  });
}

// Helper to run REPL with input and capture output
async function runReplWithInput(input: string): Promise<{ stdout: string; stderr: string }> {
  const args = ["repl"];
  if (USE_BINARY) {
    await ensureBinaryCompiled();
  }

  const proc = USE_BINARY
    ? new Deno.Command(BINARY_PATH, {
        args,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
        cwd: Deno.cwd(),
        env: getBinaryTestEnv(),
      })
    : new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", CLI_PATH, ...args],
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
        cwd: Deno.cwd(),
        env: getBinaryTestEnv(),
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

replMemoryTest("REPL startup shows memory names", async () => {
  const result = await runReplWithInput("(+ 1 1)");
  // Should show Memory: line with definition names or "empty"
  const hasMemoryLine = result.stdout.includes("Memory:") &&
    (result.stdout.includes("definition") || result.stdout.includes("empty"));
  assertEquals(hasMemoryLine, true, `Expected Memory: line in startup, got: ${result.stdout}`);
});

replMemoryTest("REPL startup shows AI status", async () => {
  const result = await runReplWithInput("(+ 1 1)");
  // Should show AI: line (either with functions or "not available")
  const hasAILine = result.stdout.includes("AI:");
  assertEquals(hasAILine, true, `Expected AI: line in startup, got: ${result.stdout}`);
});

replMemoryTest("REPL startup shows function commands", async () => {
  const result = await runReplWithInput("(+ 1 1)");
  // Should show the function commands line
  assertStringIncludes(result.stdout, "(memory)");
  assertStringIncludes(result.stdout, '(forget "x")');
  assertStringIncludes(result.stdout, "(inspect x)");
  assertStringIncludes(result.stdout, "(describe x) AI");
  assertStringIncludes(result.stdout, "(help)");
});

replMemoryTest("REPL (memory) function returns definition info", async () => {
  const result = await runReplWithInput("(memory)");
  // Should return an object with count, names, path (auto-awaited by REPL)
  assertStringIncludes(result.stdout, "count");
  assertStringIncludes(result.stdout, "names");
  assertStringIncludes(result.stdout, "path");
});

replMemoryTest("REPL (inspect) function shows source code", async () => {
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

replMemoryTest("REPL (help) function shows help text", async () => {
  const result = await runReplWithInput("(help)");
  // Should show HLVM REPL Functions header and function list
  assertStringIncludes(result.stdout, "HLVM REPL Functions");
  assertStringIncludes(result.stdout, "(memory)");
  assertStringIncludes(result.stdout, "(forget");
  assertStringIncludes(result.stdout, "(inspect");
  assertStringIncludes(result.stdout, "(describe");
});

replMemoryTest("REPL (forget) removes definition from memory", async () => {
  // Define something
  await runReplWithInput("(def test_forget_val 123)");

  // Forget it (auto-awaited by REPL)
  const result = await runReplWithInput('(forget "test_forget_val")');
  assertStringIncludes(result.stdout, "Removed");

  // Verify it's gone by trying to forget again
  const result2 = await runReplWithInput('(forget "test_forget_val")');
  assertStringIncludes(result2.stdout, "not found");
});

replMemoryTest("REPL (clear) function works without error", async () => {
  const result = await runReplWithInput("(clear)");
  // Should not error - just return nil
  const hasError = result.stderr.includes("Error") || result.stdout.includes("Error");
  assertEquals(hasError, false, `clear should not error, got: ${result.stderr}`);
});

replMemoryTest("REPL empty memory shows teaching message", async () => {
  // Backup memory file
  const memoryPath = `${BINARY_TEST_HLVM_DIR}/memory.hql`;
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
