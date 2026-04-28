import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert";
import { getHlvmInstructionsPath } from "../../../src/common/paths.ts";
import {
  isMemorySystemMessage,
  loadMemorySystemMessage,
} from "../../../src/hlvm/memory/memdir.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

Deno.test("memory prompt: missing or empty HLVM.md returns null when auto-memory is disabled", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    await platform.fs.writeTextFile(getHlvmInstructionsPath(), "   \n");
    const prevDisable = platform.env.get("HLVM_DISABLE_AUTO_MEMORY");
    platform.env.set("HLVM_DISABLE_AUTO_MEMORY", "1");
    try {
      assertEquals(await loadMemorySystemMessage(), null);
    } finally {
      if (prevDisable !== undefined) {
        platform.env.set("HLVM_DISABLE_AUTO_MEMORY", prevDisable);
      } else {
        platform.env.delete("HLVM_DISABLE_AUTO_MEMORY");
      }
    }
  });
});

Deno.test("memory prompt: loads user HLVM.md (HLVM is global-only)", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    await platform.fs.writeTextFile(
      getHlvmInstructionsPath(),
      "Global user instructions.",
    );

    const prevDisable = platform.env.get("HLVM_DISABLE_AUTO_MEMORY");
    platform.env.set("HLVM_DISABLE_AUTO_MEMORY", "1");
    try {
      const message = await loadMemorySystemMessage();
      assertExists(message);
      assertEquals(message.role, "system");
      assertEquals(isMemorySystemMessage(message.content), true);
      assertStringIncludes(message.content, "# Global HLVM Instructions");
      assertStringIncludes(message.content, "Global user instructions.");
    } finally {
      if (prevDisable !== undefined) {
        platform.env.set("HLVM_DISABLE_AUTO_MEMORY", prevDisable);
      } else {
        platform.env.delete("HLVM_DISABLE_AUTO_MEMORY");
      }
    }
  });
});
