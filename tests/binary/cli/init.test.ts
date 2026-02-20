/**
 * Binary tests for the `hlvm hql init` command
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { runCLI, withTempDir } from "../_shared/binary-helpers.ts";

Deno.test({
  name: "CLI hql init: creates hql.json with -y flag",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      const result = await runCLI("hql", ["init", "-y"], { cwd: dir });
      assertEquals(result.success, true, `Init failed: ${result.stderr}`);

      // Check hql.json was created
      const hqlJson = await Deno.readTextFile(`${dir}/hql.json`);
      const config = JSON.parse(hqlJson);
      assertEquals(typeof config.name, "string");
      assertEquals(typeof config.version, "string");
    });
  },
});

Deno.test({
  name: "CLI hql init: creates mod.hql",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      const result = await runCLI("hql", ["init", "-y"], { cwd: dir });
      assertEquals(result.success, true, `Init failed: ${result.stderr}`);

      // Check mod.hql was created
      const modHql = await Deno.readTextFile(`${dir}/mod.hql`);
      assertStringIncludes(modHql, "fn"); // Should have sample function code
    });
  },
});

Deno.test({
  name: "CLI hql init: creates .gitignore",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      const result = await runCLI("hql", ["init", "-y"], { cwd: dir });
      assertEquals(result.success, true, `Init failed: ${result.stderr}`);

      // Check .gitignore was created
      const gitignore = await Deno.readTextFile(`${dir}/.gitignore`);
      assertStringIncludes(gitignore, ".hlvm-cache");
    });
  },
});

Deno.test({
  name: "CLI hql init: creates README.md",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      const result = await runCLI("hql", ["init", "-y"], { cwd: dir });
      assertEquals(result.success, true, `Init failed: ${result.stderr}`);

      // Check README.md was created
      const readme = await Deno.readTextFile(`${dir}/README.md`);
      assertStringIncludes(readme, "#"); // Should have markdown header
    });
  },
});

Deno.test({
  name: "CLI hql init: --help flag",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runCLI("hql", ["init", "--help"]);
    // Should show help information
    const output = result.stdout + result.stderr;
    const hasHelp = output.includes("init") || output.includes("Initialize") || output.includes("--yes");
    assertEquals(hasHelp, true, `Expected help output for init, got: ${output}`);
  },
});
