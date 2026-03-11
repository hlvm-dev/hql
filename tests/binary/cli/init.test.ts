import {
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import { runCLI, withTempDir } from "../_shared/binary-helpers.ts";

const platform = getPlatform();

Deno.test({
  name: "CLI hql init: scaffolds the default project files and config",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      const result = await runCLI("hql", ["init", "-y"], { cwd: dir });
      assertEquals(result.success, true, `Init failed: ${result.stderr}`);

      const hqlJson = JSON.parse(await platform.fs.readTextFile(`${dir}/hql.json`));
      const modHql = await platform.fs.readTextFile(`${dir}/mod.hql`);
      const gitignore = await platform.fs.readTextFile(`${dir}/.gitignore`);
      const readme = await platform.fs.readTextFile(`${dir}/README.md`);

      assertEquals(hqlJson.version, "0.0.1");
      assertEquals(hqlJson.exports, "./mod.hql");
      assertEquals(hqlJson.name.startsWith("@"), true);
      assertEquals(hqlJson.name.includes("/"), true);
      assertStringIncludes(modHql, "fn");
      assertStringIncludes(gitignore, ".hlvm-cache");
      assertStringIncludes(readme, "#");
    });
  },
});

Deno.test({
  name: "CLI hql init: help output stays discoverable",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runCLI("hql", ["init", "--help"]);
    const output = result.stdout + result.stderr;
    assertStringIncludes(output, "hlvm hql init");
    assertStringIncludes(output, "--yes");
  },
});
