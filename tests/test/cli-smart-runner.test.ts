import { assertEquals } from "jsr:@std/assert";
import { join } from "../../src/platform/platform.ts";

const CLI_PATH = join(Deno.cwd(), "src", "cli", "run.ts");

Deno.test({
  name: "CLI Smart Runner: Execute TS file importing HQL",
  async fn() {
    // 1. Create temp directory
    const tempDir = await Deno.makeTempDir({ prefix: "hql_smart_runner_test_" });
    const hqlFile = join(tempDir, "lib.hql");
    const tsFile = join(tempDir, "app.ts");

    try {
      // 2. Write test files
      await Deno.writeTextFile(hqlFile, `
        (var secret "Smart Runner Works")
        (export [secret])
      `);

      await Deno.writeTextFile(tsFile, `
        import { secret } from "./lib.hql";
        console.log(secret);
      `);

      // 3. Run CLI against the TS file
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          CLI_PATH,
          tsFile
        ],
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout).trim();
      const errorOutput = new TextDecoder().decode(stderr).trim();

      // 4. Verify success
      if (code !== 0) {
        console.error("CLI Error:", errorOutput);
      }
      assertEquals(code, 0, "CLI should exit with code 0");
      assertEquals(output, "Smart Runner Works");

    } finally {
      // 5. Cleanup
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "CLI Smart Runner: Execute JS file importing HQL",
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "hql_smart_runner_test_js_" });
    const hqlFile = join(tempDir, "math.hql");
    const jsFile = join(tempDir, "app.js");

    try {
      await Deno.writeTextFile(hqlFile, `
        (fn add [a b] (+ a b))
        (export [add])
      `);

      await Deno.writeTextFile(jsFile, `
        import { add } from "./math.hql";
        console.log("Sum: " + add(10, 20));
      `);

      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          CLI_PATH,
          jsFile
        ],
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout).trim();
      const errorOutput = new TextDecoder().decode(stderr).trim();

      if (code !== 0) {
        console.error("CLI Error:", errorOutput);
      }
      assertEquals(code, 0);
      assertEquals(output, "Sum: 30");

    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});
