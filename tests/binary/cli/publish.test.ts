/**
 * Binary tests for the `hlvm hql publish` command
 * Note: Uses --dry-run to avoid actual publishing
 */

import { assertEquals } from "jsr:@std/assert";
import { runCLI, withTempDir } from "../_shared/binary-helpers.ts";

Deno.test({
  name: "CLI hql publish: --help flag",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runCLI("hql", ["publish", "--help"]);
    const output = result.stdout + result.stderr;
    const hasHelp = output.includes("publish") || output.includes("registry") || output.includes("--dry-run");
    assertEquals(hasHelp, true, `Expected publish help, got: ${output}`);
  },
});

Deno.test({
  name: "CLI hql publish: error without hql.json",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      // No hql.json in this directory
      const result = await runCLI("hql", ["publish", "--dry-run", "-y"], { cwd: dir });
      // Should either fail or prompt for config
      const output = result.stdout + result.stderr;
      const isExpected =
        !result.success || output.includes("hql.json") || output.includes("config") || output.includes("init");
      assertEquals(isExpected, true, `Expected error or config prompt, got: ${output}`);
    });
  },
});
