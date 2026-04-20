/**
 * Config API Object
 *
 * Programmable access to HLVM configuration.
 * Usage in REPL:
 *   (config.get "model")      // Get a value
 *   (config.set "model" "ollama/llama3.2")  // Set a value
 *   (config.reset)            // Reset to defaults
 *   (config.all)              // Get entire config
 *   (config.keys)             // List available keys
 *   (config.defaults)         // Get default values
 */

import {
  isConfigKey,
  loadConfig,
  resetConfig,
  saveConfig,
} from "../../common/config/storage.ts";
import { getSettingsPath } from "../../common/paths.ts";

import {
  CONFIG_KEYS,
  type ConfigKey,
  DEFAULT_CONFIG,
  type HlvmConfig,
  type KeybindingsConfig,
  parseValue,
  validateValue,
} from "../../common/config/types.ts";
import { normalizeModelSelectionConfig } from "../../common/config/model-selection.ts";
import { syncProvidersFromConfig } from "../../common/config/provider-sync.ts";
import { log } from "./log.ts";
import { ValidationError } from "../../common/error.ts";

// ============================================================================
// Config API Object
// ============================================================================

/**
 * Create the config API object
 * This is designed to be registered on globalThis for REPL access
 */
function createConfigApi() {
  type ConfigListener = (config: HlvmConfig) => void;

  /**
   * Internal reference to current config
   * Updated on load/save operations
   */
  let _config: HlvmConfig | null = null;
  let _configSignature: string | null = null;
  const listeners = new Set<ConfigListener>();
  const VALID_CONFIG_KEYS_TEXT = CONFIG_KEYS.join(", ");
  const PARSEABLE_STRING_KEYS = new Set<ConfigKey>([
    "temperature",
    "maxTokens",
  ]);

  // Serialize read-modify-write so concurrent writers can't lose updates.
  let writeChain: Promise<unknown> = Promise.resolve();
  const withWriteLock = <T>(run: () => Promise<T>): Promise<T> => {
    const next = writeChain.then(run);
    writeChain = next.catch(() => {});
    return next;
  };

  /**
   * Get current config, loading from disk if needed
   */
  async function ensureConfig(): Promise<HlvmConfig> {
    if (!_config) {
      _config = await loadAndSyncConfig();
    }
    return _config;
  }

  function assertConfigKeyOrThrow(
    key: string,
    context: "config.get" | "config.set",
  ): asserts key is ConfigKey {
    if (!isConfigKey(key)) {
      throw new ValidationError(
        `Unknown config key: ${key}. Valid keys: ${VALID_CONFIG_KEYS_TEXT}`,
        context,
      );
    }
  }

  function maybeParseConfigValue(key: ConfigKey, value: unknown): unknown {
    if (typeof value === "string" && PARSEABLE_STRING_KEYS.has(key)) {
      return parseValue(key, value);
    }
    return value;
  }

  function parseAndValidateConfigValue(key: ConfigKey, value: unknown): unknown {
    const parsed = maybeParseConfigValue(key, value);
    const validation = validateValue(key, parsed);
    if (!validation.valid) {
      throw new ValidationError(
        validation.error ?? "Invalid value",
        "config.set",
      );
    }
    return parsed;
  }

  function buildValidatedConfigUpdates(
    updates: Partial<Record<ConfigKey, unknown>>,
  ): Partial<Record<ConfigKey, unknown>> {
    const next: Partial<Record<ConfigKey, unknown>> = {};

    for (const [key, value] of Object.entries(updates)) {
      assertConfigKeyOrThrow(key, "config.set");
      next[key] = parseAndValidateConfigValue(key, value);
    }

    return next;
  }

  function mergeConfigUpdates(
    config: HlvmConfig,
    updates: Partial<Record<ConfigKey, unknown>>,
  ): HlvmConfig {
    const next = { ...config, ...updates } as HlvmConfig;
    if ("model" in updates || "agentMode" in updates) {
      return {
        ...normalizeModelSelectionConfig(next),
        modelConfigured: true,
      };
    }
    return next;
  }

  function updateCachedConfig(
    nextConfig: HlvmConfig,
    syncProviders = false,
  ): HlvmConfig {
    _config = nextConfig;
    _configSignature = JSON.stringify(nextConfig);
    if (syncProviders) {
      syncProvidersFromConfig(nextConfig);
    }
    for (const listener of listeners) {
      try {
        listener({ ...nextConfig });
      } catch {
        // Ignore listener errors
      }
    }
    return nextConfig;
  }

  async function loadAndSyncConfig(): Promise<HlvmConfig> {
    const nextConfig = normalizeConfig(await loadConfig());
    return updateCachedConfig(nextConfig, true);
  }

  function normalizeConfig(config: HlvmConfig): HlvmConfig {
    const next = { ...config };
    for (const key of CONFIG_KEYS) {
      const value = next[key as keyof HlvmConfig];
      const result = validateValue(key, value);
      if (!result.valid) {
        log.warn(`config.${key} invalid: ${result.error}. Using default.`);
        (next as Record<string, unknown>)[key] =
          DEFAULT_CONFIG[key as keyof HlvmConfig];
      }
    }
    return normalizeModelSelectionConfig(next);
  }

  return {
    /**
     * Get a config value by key
     * @example (config.get "model")
     */
    get: async (key: string): Promise<unknown> => {
      assertConfigKeyOrThrow(key, "config.get");
      const cfg = await ensureConfig();
      return cfg[key];
    },

    /**
     * Set a config value
     * @example (config.set "model" "ollama/llama3.2")
     */
    set: (key: string, value: unknown): Promise<void> =>
      withWriteLock(async () => {
        const updates = buildValidatedConfigUpdates({ [key]: value });
        const cfg = await ensureConfig();
        const newConfig = mergeConfigUpdates(cfg, updates);
        await saveConfig(newConfig);
        updateCachedConfig(newConfig, true);
      }),

    patch: (
      updates: Partial<Record<ConfigKey, unknown>>,
    ): Promise<HlvmConfig> =>
      withWriteLock(async () => {
        const cfg = await ensureConfig();
        const normalizedUpdates = buildValidatedConfigUpdates(updates);
        const next = mergeConfigUpdates(cfg, normalizedUpdates);

        await saveConfig(next);
        return updateCachedConfig(next, true);
      }),

    /**
     * Reset config to defaults
     * @example (config.reset)
     */
    reset: (): Promise<HlvmConfig> =>
      withWriteLock(async () =>
        updateCachedConfig(normalizeConfig(await resetConfig()), true)
      ),

    /**
     * Get entire config object
     * @example (config.all)
     */
    get all(): Promise<HlvmConfig> {
      return ensureConfig();
    },

    /**
     * Get cached config snapshot (sync)
     * @example (config.snapshot)
     */
    get snapshot(): HlvmConfig {
      return { ...(_config ?? DEFAULT_CONFIG) };
    },

    /**
     * Get list of available config keys
     * @example (config.keys)
     */
    get keys(): readonly string[] {
      return CONFIG_KEYS;
    },

    /**
     * Get default config values
     * @example (config.defaults)
     */
    get defaults(): HlvmConfig {
      return { ...DEFAULT_CONFIG };
    },

    /**
     * Get config file path
     * @example (config.path)
     */
    get path(): string {
      return getSettingsPath();
    },

    /**
     * Reload config from disk
     * @example (config.reload)
     */
    reload: async (): Promise<HlvmConfig> => {
      return await loadAndSyncConfig();
    },

    reloadIfChanged: async (): Promise<boolean> => {
      const nextConfig = normalizeConfig(await loadConfig());
      const nextSignature = JSON.stringify(nextConfig);
      if (_configSignature === nextSignature) {
        return false;
      }
      updateCachedConfig(nextConfig, true);
      return true;
    },

    /**
     * Check if a key is valid
     * @example (config.isKey "model")
     */
    isKey: (key: string): boolean => {
      return isConfigKey(key);
    },

    /**
     * Validate a value for a key
     * @example (config.validate "temperature" 0.5)
     */
    validate: (
      key: string,
      value: unknown,
    ): { valid: boolean; error?: string } => {
      if (!isConfigKey(key)) {
        return { valid: false, error: `Unknown config key: ${key}` };
      }
      return validateValue(key, value);
    },

    /**
     * Keybindings management
     */
    keybindings: {
      /**
       * Get all keybindings
       * @example (config.keybindings.get)
       */
      get: async (): Promise<KeybindingsConfig> => {
        const cfg = await ensureConfig();
        return cfg.keybindings ?? {};
      },

      /**
       * Update a keybinding
       * @example (config.keybindings.set "show-palette" "Ctrl+P")
       */
      set: (id: string, combo: string): Promise<void> =>
        withWriteLock(async () => {
          const cfg = await ensureConfig();
          const newBindings = { ...(cfg.keybindings ?? {}), [id]: combo };
          const newConfig = { ...cfg, keybindings: newBindings };
          await saveConfig(newConfig);
          updateCachedConfig(newConfig);
        }),

      /**
       * Get cached keybindings snapshot (sync)
       * @example (config.keybindings.snapshot)
       */
      get snapshot(): KeybindingsConfig {
        return { ...(_config?.keybindings ?? {}) };
      },
    },

    subscribe: (listener: ConfigListener): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Default config API instance
 */
export const config = createConfigApi();
