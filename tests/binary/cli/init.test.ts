/**
 * Binary tests for the `hlvm hql init` command
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { runCLI, withTempDir } from "../_shared/binary-helpers.ts";

const platform = getPlatform();

Deno.test({
  name: "CLI hql init: creates hql.json with default config",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      const result = await runCLI("hql", ["init", "-y"], { cwd: dir });
      assertEquals(result.success, true, `Init failed: ${result.stderr}`);

      const hqlJson = await platform.fs.readTextFile(`${dir}/hql.json`);
      const config = JSON.parse(hqlJson);
      assertEquals(config.version, "0.0.1");
      assertEquals(config.exports, "./mod.hql");
      assertEquals(config.name.startsWith("@"), true);
      assertEquals(config.name.includes("/"), true);
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

      const modHql = await platform.fs.readTextFile(`${dir}/mod.hql`);
      assertStringIncludes(modHql, "fn");
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

      const gitignore = await platform.fs.readTextFile(`${dir}/.gitignore`);
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

      const readme = await platform.fs.readTextFile(`${dir}/README.md`);
      assertStringIncludes(readme, "#");
    });
  },
});

Deno.test({
  name: "CLI hql init: --help flag",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runCLI("hql", ["init", "--help"]);
    const output = result.stdout + result.stderr;
    assertStringIncludes(output, "hlvm hql init");
    assertStringIncludes(output, "--yes");
  },
});
