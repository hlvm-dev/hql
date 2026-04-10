import { assertEquals } from "jsr:@std/assert";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_OLLAMA_ENDPOINT,
} from "../../../src/common/config/types.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { findFreePort } from "../../shared/light-helpers.ts";
import { binaryTest, runCLI, withTempDir } from "../_shared/binary-helpers.ts";

const platform = getPlatform();
const FIRST_RUN_FIXTURE = JSON.stringify({
  version: 1,
  name: "first-run guard fixture",
  cases: [{
    name: "default",
    steps: [{ response: "ok" }],
  }],
});

async function writeAskFixture(dir: string): Promise<string> {
  const fixturePath = `${dir}/first-run-fixture.json`;
  await platform.fs.writeTextFile(fixturePath, FIRST_RUN_FIXTURE);
  return fixturePath;
}

binaryTest(
  "first-run gate: setup stays skipped for piped input, explicit model, and configured installs",
  async () => {
    await withTempDir(async (dir) => {
      const port = await findFreePort();
      const fixturePath = await writeAskFixture(dir);
      const piped = await runCLI("ask", ["hello"], {
        cwd: dir,
        env: {
          HLVM_DIR: dir,
          HLVM_REPL_PORT: String(port),
          HLVM_ASK_FIXTURE_PATH: fixturePath,
        },
      });
      const pipedOutput = piped.stdout + piped.stderr;
      assertEquals(pipedOutput.includes("Welcome to HLVM!"), false);
      assertEquals(pipedOutput.includes("Continue? [Y/n]"), false);
    });

    await withTempDir(async (dir) => {
      const port = await findFreePort();
      const fixturePath = await writeAskFixture(dir);
      const explicitModel = await runCLI(
        "ask",
        ["--model", DEFAULT_MODEL_ID, "what is 2+2"],
        {
          cwd: dir,
          env: {
            HLVM_DIR: dir,
            HLVM_REPL_PORT: String(port),
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
        },
      );
      const output = explicitModel.stdout + explicitModel.stderr;
      assertEquals(output.includes("Welcome to HLVM!"), false);
    });

    await withTempDir(async (dir) => {
      const fixturePath = await writeAskFixture(dir);
      await platform.fs.writeTextFile(
        `${dir}/config.json`,
        JSON.stringify({
          version: 1,
          model: DEFAULT_MODEL_ID,
          endpoint: DEFAULT_OLLAMA_ENDPOINT,
          temperature: 0.7,
          maxTokens: 4096,
          theme: "dracula",
          modelConfigured: true,
        }),
      );

      const port = await findFreePort();
      const configured = await runCLI("ask", ["hello"], {
        cwd: dir,
        env: {
          HLVM_DIR: dir,
          HLVM_REPL_PORT: String(port),
          HLVM_ASK_FIXTURE_PATH: fixturePath,
        },
      });
      const output = configured.stdout + configured.stderr;
      assertEquals(output.includes("Welcome to HLVM!"), false);
    });
  },
);
