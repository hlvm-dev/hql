/**
 * Binary tests for the `hql repl` command
 * Note: REPL is interactive, so testing is limited
 */

import { assertEquals } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { binaryTest, runRawCLI, USE_BINARY } from "../_shared/binary-helpers.ts";

console.log(`Testing 'repl' command in ${USE_BINARY ? "BINARY" : "DENO RUN"} mode`);

binaryTest("CLI repl: --version flag", async () => {
  const result = await runRawCLI(["--version"]);
  const combined = result.stdout + result.stderr;
  const hasVersion = combined.includes("0.") || combined.includes("1.") || combined.includes("version");
  assertEquals(hasVersion, true, `Expected version output, got: ${combined}`);
});

binaryTest("CLI repl: --help flag shows global help", async () => {
  const result = await runRawCLI(["--help"]);
  assertEquals(result.stdout.includes("repl"), true, `Expected 'repl' in help output`);
  assertEquals(result.stdout.includes("run"), true, `Expected 'run' in help output`);
  assertEquals(result.stdout.includes("transpile"), true, `Expected 'transpile' in help output`);
});
