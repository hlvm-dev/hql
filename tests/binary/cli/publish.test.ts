/**
 * Binary tests for the `hlvm publish` command
 * Note: Uses --dry-run to avoid actual publishing
 */

import { assertEquals } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { runCLI, withTempDir, USE_BINARY } from "../_shared/binary-helpers.ts";

// Log which mode we're testing
console.log(`Testing 'publish' command in ${USE_BINARY ? "BINARY" : "DENO RUN"} mode`);

Deno.test({
  name: "CLI publish: --help flag",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runCLI("publish", ["--help"]);
    const output = result.stdout + result.stderr;
    const hasHelp = output.includes("publish") || output.includes("registry") || output.includes("--dry-run");
    assertEquals(hasHelp, true, `Expected publish help, got: ${output}`);
  },
});

Deno.test({
  name: "CLI publish: error without hlvm.json",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      const originalCwd = Deno.cwd();
      try {
        Deno.chdir(dir);
        // No hlvm.json in this directory
        const result = await runCLI("publish", ["--dry-run", "-y"]);
        // Should either fail or prompt for config
        const output = result.stdout + result.stderr;
        const isExpected = !result.success || output.includes("hlvm.json") || output.includes("config") || output.includes("init");
        assertEquals(isExpected, true, `Expected error or config prompt, got: ${output}`);
      } finally {
        Deno.chdir(originalCwd);
      }
    });
  },
});
