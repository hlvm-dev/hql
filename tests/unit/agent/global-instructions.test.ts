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

Deno.test("memory prompt: missing or empty HLVM.md and no project file → null", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const projectRoot = await platform.fs.makeTempDir({
      prefix: "hlvm-mem-empty-",
    });
    try {
      // Empty user HLVM.md
      await platform.fs.writeTextFile(getHlvmInstructionsPath(), "   \n");
      // Disable auto-memory so the result is purely the user/project sections.
      const prevDisable = platform.env.get("HLVM_DISABLE_AUTO_MEMORY");
      platform.env.set("HLVM_DISABLE_AUTO_MEMORY", "1");
      try {
        assertEquals(await loadMemorySystemMessage(projectRoot), null);
      } finally {
        if (prevDisable !== undefined) {
          platform.env.set("HLVM_DISABLE_AUTO_MEMORY", prevDisable);
        } else {
          platform.env.delete("HLVM_DISABLE_AUTO_MEMORY");
        }
      }
    } finally {
      await platform.fs.remove(projectRoot, { recursive: true });
    }
  });
});

Deno.test("memory prompt: loads user HLVM.md and project HLVM.md (CC parity)", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const projectRoot = await platform.fs.makeTempDir({
      prefix: "hlvm-mem-both-",
    });
    try {
      await platform.fs.writeTextFile(
        getHlvmInstructionsPath(),
        "Global user instructions.",
      );
      await platform.fs.writeTextFile(
        platform.path.join(projectRoot, "HLVM.md"),
        "Project instructions for this repo.",
      );

      const prevDisable = platform.env.get("HLVM_DISABLE_AUTO_MEMORY");
      platform.env.set("HLVM_DISABLE_AUTO_MEMORY", "1");
      try {
        const message = await loadMemorySystemMessage(projectRoot);
        assertExists(message);
        assertEquals(message.role, "system");
        assertEquals(isMemorySystemMessage(message.content), true);
        // Both user and project sections should appear.
        assertStringIncludes(message.content, "# Global HLVM Instructions");
        assertStringIncludes(message.content, "Global user instructions.");
        assertStringIncludes(message.content, "# Project HLVM Instructions");
        assertStringIncludes(message.content, "Project instructions for this repo.");
      } finally {
        if (prevDisable !== undefined) {
          platform.env.set("HLVM_DISABLE_AUTO_MEMORY", prevDisable);
        } else {
          platform.env.delete("HLVM_DISABLE_AUTO_MEMORY");
        }
      }
    } finally {
      await platform.fs.remove(projectRoot, { recursive: true });
    }
  });
});
