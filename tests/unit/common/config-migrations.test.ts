import { assertEquals } from "jsr:@std/assert";
import { getConfigPath } from "../../../src/common/config/storage.ts";
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
      await getPlatform().fs.readTextFile(getConfigPath()),
    ) as Record<string, unknown>;
    assertEquals(stored.version, CURRENT_CONFIG_VERSION);
    assertEquals(stored.model, "anthropic/claude-haiku");
  });
});

Deno.test("config migrations: loadConfig migrates persisted config once and preserves unknown fields", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const configPath = getConfigPath();
    await platform.fs.ensureDir(platform.path.dirname(configPath));
    await platform.fs.writeTextFile(
      configPath,
      JSON.stringify({
        version: 0,
        model: "google/gemini-2.5-pro",
        customField: { x: 1 },
      }, null, 2),
    );

    const loaded = await loadConfig();
    const persisted = JSON.parse(
      await platform.fs.readTextFile(configPath),
    ) as Record<string, unknown>;

    assertEquals(loaded.version, CURRENT_CONFIG_VERSION);
    assertEquals(loaded.model, "google/gemini-2.5-pro");
    assertEquals((loaded as unknown as Record<string, unknown>).customField, { x: 1 });
    assertEquals(persisted.version, CURRENT_CONFIG_VERSION);
    assertEquals(persisted.customField, { x: 1 });

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
