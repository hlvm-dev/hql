import { assertEquals } from "jsr:@std/assert";
import { getPlatform } from "../../src/platform/platform.ts";

const p = getPlatform();
const join = (...paths: string[]) => p.path.join(...paths);
const CLI_PATH = join(p.process.cwd(), "src", "hlvm", "cli", "run.ts");

Deno.test({
  name: "CLI Smart Runner: Execute TS file importing HQL",
  async fn() {
    // 1. Create temp directory
    const tempDir = await p.fs.makeTempDir({ prefix: "hlvm_smart_runner_test_" });
    const hqlFile = join(tempDir, "lib.hql");
    const tsFile = join(tempDir, "app.ts");

    try {
      // 2. Write test files
      await p.fs.writeTextFile(hqlFile, `
        (var secret "Smart Runner Works")
        (export [secret])
      `);

      await p.fs.writeTextFile(tsFile, `
        import { secret } from "./lib.hql";
        console.log(secret);
      `);

      // 3. Run CLI against the TS file
      const { code, stdout, stderr } = await p.command.output({
        cmd: [
          p.process.execPath(),
          "run",
          "-A",
          CLI_PATH,
          tsFile
        ],
        stdout: "piped",
        stderr: "piped",
      });

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
      await p.fs.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "CLI Smart Runner: Execute JS file importing HQL",
  async fn() {
    const tempDir = await p.fs.makeTempDir({ prefix: "hlvm_smart_runner_test_js_" });
    const hqlFile = join(tempDir, "math.hql");
    const jsFile = join(tempDir, "app.js");

    try {
      await p.fs.writeTextFile(hqlFile, `
        (fn add [a b] (+ a b))
        (export [add])
      `);

      await p.fs.writeTextFile(jsFile, `
        import { add } from "./math.hql";
        console.log("Sum: " + add(10, 20));
      `);

      const { code, stdout, stderr } = await p.command.output({
        cmd: [
          p.process.execPath(),
          "run",
          "-A",
          CLI_PATH,
          jsFile
        ],
        stdout: "piped",
        stderr: "piped",
      });

      const output = new TextDecoder().decode(stdout).trim();
      const errorOutput = new TextDecoder().decode(stderr).trim();

      if (code !== 0) {
        console.error("CLI Error:", errorOutput);
      }
      assertEquals(code, 0);
      assertEquals(output, "Sum: 30");

    } finally {
      await p.fs.remove(tempDir, { recursive: true });
    }
  },
});
