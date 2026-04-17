import { assertEquals } from "jsr:@std/assert";
import {
  findAvailableLocalFallbackModel,
} from "../../../src/hlvm/runtime/bootstrap-manifest.ts";
import { isFallbackModelAvailable } from "../../../src/hlvm/runtime/bootstrap-verify.ts";
import {
  getHlvmDir,
  resetHlvmDirCacheForTests,
} from "../../../src/common/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withEnv } from "../../shared/light-helpers.ts";

async function withTempHlvmDir(
  fn: () => Promise<void>,
): Promise<void> {
  const platform = getPlatform();
  const tempDir = await Deno.makeTempDir();
  try {
    await withEnv("HLVM_DIR", tempDir, async () => {
      resetHlvmDirCacheForTests();
      await fn();
    });
  } finally {
    resetHlvmDirCacheForTests();
    await platform.fs.remove(tempDir, { recursive: true }).catch(() => {});
  }
}

Deno.test("bootstrap fallback discovery accepts a verified legacy gemma4:e4b install", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const manifestPath = platform.path.join(
      getHlvmDir(),
      ".runtime",
      "models",
      "manifests",
      "registry.ollama.ai",
      "library",
      "gemma4",
      "e4b",
    );
    await platform.fs.mkdir(platform.path.dirname(manifestPath), {
      recursive: true,
    });
    await platform.fs.writeTextFile(
      manifestPath,
      JSON.stringify({
        layers: [
          {
            mediaType: "application/vnd.ollama.image.model",
            digest:
              "sha256:4c27e0f5b5adf02ac956c7322bd2ee7636fe3f45a8512c9aba5385242cb6e09a",
            size: 9_608_350_245,
          },
        ],
      }),
    );

    assertEquals(await findAvailableLocalFallbackModel(), "gemma4:e4b");
    assertEquals(await isFallbackModelAvailable(), true);
    assertEquals(await isFallbackModelAvailable("gemma4:e4b"), true);
  });
});
