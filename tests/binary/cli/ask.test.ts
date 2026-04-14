import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import { normalizeCliOutput } from "../../shared/light-helpers.ts";
import { binaryTest, runCLI, withTempDir } from "../_shared/binary-helpers.ts";

const platform = getPlatform();

binaryTest(
  "CLI ask: rejects unsupported legacy isolation flags",
  async () => {
    await withTempDir(async (dir) => {
      const result = await runCLI("ask", ["--fresh", "inspect the project"], {
        cwd: dir,
        env: {
          HLVM_DIR: dir,
        },
      });

      const output = normalizeCliOutput(result.stdout + result.stderr);
      assertEquals(result.success, false, output);
      assertStringIncludes(output, "Unknown option: --fresh");
    });
  },
);

binaryTest(
  "CLI ask: --attach rejects models without attachment support",
  async () => {
    await withTempDir(async (dir) => {
      const imagePath = platform.path.join(dir, "sample.png");
      await platform.fs.writeFile(
        imagePath,
        new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      );

      const result = await runCLI(
        "ask",
        [
          "--model",
          "ollama/llama3.1:8b",
          "--attach",
          imagePath,
          "describe this screenshot",
        ],
        {
          cwd: dir,
          env: {
            HLVM_DIR: dir,
          },
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      assertEquals(result.success, false, output);
      assertStringIncludes(
        output,
        "does not support image attachments",
      );
    });
  },
);

