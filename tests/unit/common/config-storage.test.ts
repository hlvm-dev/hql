/**
 * Tests for config storage normalization.
 */

import { assertEquals } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import { getConfigPath } from "../../../src/common/paths.ts";
import { loadConfig, saveConfig } from "../../../src/common/config/storage.ts";
import {
  DEFAULT_CONFIG,
  type HlvmConfig,
} from "../../../src/common/config/types.ts";
import { withTempHlvmDir } from "../helpers.ts";

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
