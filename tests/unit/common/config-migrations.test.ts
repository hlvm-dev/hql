import { assertEquals } from "jsr:@std/assert";
import { getSettingsPath } from "../../../src/common/paths.ts";
import {
  CURRENT_CONFIG_VERSION,
  migrateConfig,
  stampCurrentConfigVersion,
} from "../../../src/common/config/migrations.ts";
import {
  DEFAULT_CONFIG,
  type HlvmConfig,
} from "../../../src/common/config/types.ts";
import { loadConfig, saveConfig } from "../../../src/common/config/storage.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

function asConfig(value: Partial<HlvmConfig> & Record<string, unknown>): HlvmConfig {
  return {
    ...DEFAULT_CONFIG,
    ...value,
    version: CURRENT_CONFIG_VERSION,
  };
}

Deno.test("config migrations: current version remains unchanged and unknown fields survive", () => {
  const raw = {
    version: CURRENT_CONFIG_VERSION,
    model: "anthropic/claude-haiku",
    customField: { enabled: true },
  };

  const result = migrateConfig(raw);

  assertEquals(result.migrated, false);
  assertEquals(result.config?.version, CURRENT_CONFIG_VERSION);
  assertEquals(result.config?.customField, { enabled: true });
});

Deno.test("config migrations: legacy or missing version migrates to current version idempotently", () => {
  const raw = {
    model: "openai/gpt-5.4",
    endpoint: "https://example.com",
    extra: "keep-me",
  };

  const once = migrateConfig(raw);
  const twice = migrateConfig(once.config);

  assertEquals(once.migrated, true);
  assertEquals(once.config?.version, CURRENT_CONFIG_VERSION);
  assertEquals(twice.config, once.config);
  assertEquals(twice.config?.extra, "keep-me");
});

Deno.test("config migrations: saveConfig always stamps the current version", async () => {
  await withTempHlvmDir(async () => {
    const config = {
      ...DEFAULT_CONFIG,
      version: 0,
      model: "anthropic/claude-haiku",
    } as HlvmConfig;

    await saveConfig(config);

    const stored = JSON.parse(
      await getPlatform().fs.readTextFile(getSettingsPath()),
    ) as Record<string, unknown>;
    assertEquals(stored.version, CURRENT_CONFIG_VERSION);
    assertEquals(stored.model, "anthropic/claude-haiku");
  });
});

Deno.test("config migrations: loadConfig migrates persisted config once and preserves unknown fields", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const settingsPath = getSettingsPath();
    await platform.fs.ensureDir(platform.path.dirname(settingsPath));
    await platform.fs.writeTextFile(
      settingsPath,
      JSON.stringify({
        version: 0,
        model: "google/gemini-2.5-pro",
        customField: { x: 1 },
      }, null, 2),
    );

    const loaded = await loadConfig();

    // loadConfig migrates in-memory but does NOT write back to disk.
    // Verify the in-memory result is correct.
    assertEquals(loaded.version, CURRENT_CONFIG_VERSION);
    assertEquals(loaded.model, "google/gemini-2.5-pro");
    assertEquals((loaded as unknown as Record<string, unknown>).customField, { x: 1 });

    // On-disk file remains at original version (loadConfig is read-only).
    const persisted = JSON.parse(
      await platform.fs.readTextFile(settingsPath),
    ) as Record<string, unknown>;
    assertEquals(persisted.version, 0);
    assertEquals(persisted.customField, { x: 1 });

    // Second load also returns migrated version.
    const loadedAgain = await loadConfig();
    assertEquals(loadedAgain.version, CURRENT_CONFIG_VERSION);
    assertEquals(
      (loadedAgain as unknown as Record<string, unknown>).customField,
      { x: 1 },
    );
  });
});

Deno.test("config migrations: stampCurrentConfigVersion normalizes arbitrary config objects", () => {
  const stamped = stampCurrentConfigVersion(asConfig({ version: 0, theme: "sicp" }));
  assertEquals(stamped.version, CURRENT_CONFIG_VERSION);
  assertEquals(stamped.theme, "sicp");
});

Deno.test("config migrations: channels survive save/load in unified settings.json", async () => {
  await withTempHlvmDir(async () => {
    const config = asConfig({
      channels: {
        telegram: {
          enabled: true,
          allowedIds: ["123456789"],
          transport: {
            mode: "relay",
            deviceId: "device-1",
            relayUrl: "wss://relay.hlvm.app",
            cursor: 42,
          },
        },
      },
    });

    await saveConfig(config);

    const loaded = await loadConfig();
    assertEquals(loaded.channels?.telegram?.enabled, true);
    assertEquals(loaded.channels?.telegram?.allowedIds, ["123456789"]);
    assertEquals(loaded.channels?.telegram?.transport?.mode, "relay");
    assertEquals(loaded.channels?.telegram?.transport?.cursor, 42);
  });
});
