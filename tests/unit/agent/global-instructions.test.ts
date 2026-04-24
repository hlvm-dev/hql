import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert";
import { getHlvmInstructionsPath } from "../../../src/common/paths.ts";
import {
  isHlvmInstructionsSystemMessage,
  loadHlvmInstructionsSystemMessage,
} from "../../../src/hlvm/agent/global-instructions.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

Deno.test("global instructions: missing or empty HLVM.md is ignored", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();

    assertEquals(await loadHlvmInstructionsSystemMessage(), null);

    await platform.fs.writeTextFile(getHlvmInstructionsPath(), "   \n");
    assertEquals(await loadHlvmInstructionsSystemMessage(), null);
  });
});

Deno.test("global instructions: loads only ~/.hlvm/HLVM.md", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const originalCwd = Deno.cwd();
    const runtimeTarget = await platform.fs.makeTempDir({
      prefix: "hlvm-instructions-target-",
    });
    await platform.fs.writeTextFile(
      platform.path.join(runtimeTarget, "HLVM.md"),
      "Local runtime-target instructions must not load.",
    );

    try {
      Deno.chdir(runtimeTarget);
      assertEquals(await loadHlvmInstructionsSystemMessage(), null);

      await platform.fs.writeTextFile(
        getHlvmInstructionsPath(),
        "Global user instructions.",
      );
      const message = await loadHlvmInstructionsSystemMessage();
      assertExists(message);
      assertEquals(message.role, "system");
      assertEquals(isHlvmInstructionsSystemMessage(message.content), true);
      assertStringIncludes(message.content, "# Global HLVM Instructions");
      assertStringIncludes(message.content, "Global user instructions.");
      assertEquals(
        message.content.includes("Local runtime-target instructions"),
        false,
      );
    } finally {
      Deno.chdir(originalCwd);
      await platform.fs.remove(runtimeTarget, { recursive: true });
    }
  });
});
