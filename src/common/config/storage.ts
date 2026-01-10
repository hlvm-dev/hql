/**
 * HQL Config Storage
 * File I/O with atomic writes for ~/.hql/config.json
 */

import { join } from "jsr:@std/path@1";
import { ensureDir } from "jsr:@std/fs@1";
import { type HqlConfig, DEFAULT_CONFIG, CONFIG_KEYS, type ConfigKey, validateValue } from "./types.ts";

// ============================================================
// Path Helpers
// ============================================================

/** Get the .hql directory path */
export function getHqlDir(): string {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || ".";
  return join(home, ".hql");
}

/** Get the config file path: ~/.hql/config.json */
export function getConfigPath(): string {
  return join(getHqlDir(), "config.json");
}

// ============================================================
// File I/O
// ============================================================

/**
 * Load config from disk, merging with defaults
 * Returns default config if file doesn't exist
 */
export async function loadConfig(): Promise<HqlConfig> {
  const path = getConfigPath();

  try {
    const content = await Deno.readTextFile(path);
    const parsed = JSON.parse(content);

    // Merge with defaults (handles missing keys from older config versions)
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
    };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { ...DEFAULT_CONFIG };
    }
    if (error instanceof SyntaxError) {
      // Corrupted JSON - return defaults
      console.warn("Warning: config.json is corrupted, using defaults");
      return { ...DEFAULT_CONFIG };
    }
    throw error;
  }
}

/**
 * Save config to disk using atomic write (temp file + rename)
 */
export async function saveConfig(config: HqlConfig): Promise<void> {
  const dir = getHqlDir();
  const path = getConfigPath();
  const tempPath = `${path}.tmp`;

  await ensureDir(dir);

  // Write to temp file first
  const content = JSON.stringify(config, null, 2) + "\n";
  await Deno.writeTextFile(tempPath, content);

  // Atomic rename
  await Deno.rename(tempPath, path);
}

// ============================================================
// Config Access Helpers
// ============================================================

/**
 * Get a config value by key
 */
export function getConfigValue(config: HqlConfig, key: ConfigKey): unknown {
  return config[key];
}

/**
 * Set a config value by key (returns new config, validates first)
 */
export function setConfigValue(
  config: HqlConfig,
  key: ConfigKey,
  value: unknown
): { config: HqlConfig; error?: string } {
  const validation = validateValue(key, value);
  if (!validation.valid) {
    return { config, error: validation.error };
  }

  return {
    config: {
      ...config,
      [key]: value,
    },
  };
}

/**
 * Check if a string is a valid config key
 */
export function isConfigKey(key: string): key is ConfigKey {
  return CONFIG_KEYS.includes(key as ConfigKey);
}

/**
 * Reset config to defaults and save
 */
export async function resetConfig(): Promise<HqlConfig> {
  const config = { ...DEFAULT_CONFIG };
  await saveConfig(config);
  return config;
}
