import { assertEquals } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { findFreePort } from "../../shared/light-helpers.ts";
import { runCLI, withTempDir } from "../_shared/binary-helpers.ts";

const platform = getPlatform();

Deno.test({
  name: "first-run gate: setup stays skipped for piped input, explicit model, and configured installs",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      const port = await findFreePort();
      const piped = await runCLI("ask", ["hello"], {
        cwd: dir,
        env: { HLVM_DIR: dir, HLVM_REPL_PORT: String(port) },
      });
      const pipedOutput = piped.stdout + piped.stderr;
      assertEquals(pipedOutput.includes("Welcome to HLVM!"), false);
      assertEquals(pipedOutput.includes("Continue? [Y/n]"), false);
    });

    await withTempDir(async (dir) => {
      const port = await findFreePort();
      const explicitModel = await runCLI(
        "ask",
        ["--model", "ollama/llama3.1:8b", "what is 2+2"],
        { cwd: dir, env: { HLVM_DIR: dir, HLVM_REPL_PORT: String(port) } },
      );
      const output = explicitModel.stdout + explicitModel.stderr;
      assertEquals(output.includes("Welcome to HLVM!"), false);
    });

    await withTempDir(async (dir) => {
      await platform.fs.writeTextFile(
        `${dir}/config.json`,
        JSON.stringify({
          version: 1,
          model: "ollama/llama3.1:8b",
          endpoint: "http://localhost:11434",
          temperature: 0.7,
          maxTokens: 4096,
          theme: "dracula",
          modelConfigured: true,
        }),
      );

      const port = await findFreePort();
      const configured = await runCLI("ask", ["hello"], {
        cwd: dir,
        env: { HLVM_DIR: dir, HLVM_REPL_PORT: String(port) },
      });
      const output = configured.stdout + configured.stderr;
      assertEquals(output.includes("Welcome to HLVM!"), false);
    });
  },
});
