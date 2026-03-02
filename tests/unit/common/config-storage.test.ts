/**
 * Tests for config storage normalization.
 */

import { assertEquals } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  getConfigPath,
  resetHlvmDirCacheForTests,
} from "../../../src/common/paths.ts";
import { loadConfig, saveConfig } from "../../../src/common/config/storage.ts";
import {
  DEFAULT_CONFIG,
  type HlvmConfig,
} from "../../../src/common/config/types.ts";

async function withTempHlvmDir(fn: () => Promise<void>): Promise<void> {
  const platform = getPlatform();
  const previousHlvmDir = platform.env.get("HLVM_DIR");
  const tempDir = await platform.fs.makeTempDir({
    prefix: "hlvm-config-storage-test-",
  });

  platform.env.set("HLVM_DIR", tempDir);
  resetHlvmDirCacheForTests();

  try {
    await fn();
  } finally {
    if (previousHlvmDir === undefined) {
      platform.env.delete("HLVM_DIR");
    } else {
      platform.env.set("HLVM_DIR", previousHlvmDir);
    }
    resetHlvmDirCacheForTests();

    try {
      await platform.fs.remove(tempDir, { recursive: true });
    } catch {
      // Best-effort cleanup for temp test directory.
    }
  }
}

Deno.test("loadConfig - preserves permissionMode when persisted", async () => {
  await withTempHlvmDir(async () => {
    const config: HlvmConfig = {
      ...DEFAULT_CONFIG,
      permissionMode: "auto-edit",
    };
    await saveConfig(config);

    const loaded = await loadConfig();
    assertEquals(loaded.permissionMode, "auto-edit");
  });
});

Deno.test("loadConfig - ignores invalid permissionMode values", async () => {
  await withTempHlvmDir(async () => {
    const configPath = getConfigPath();
    await getPlatform().fs.writeTextFile(
      configPath,
      JSON.stringify(
        {
          ...DEFAULT_CONFIG,
          permissionMode: "invalid-mode",
        },
        null,
        2,
      ),
    );

    const loaded = await loadConfig();
    assertEquals(loaded.permissionMode, undefined);
  });
});
