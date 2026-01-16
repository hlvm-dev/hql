/**
 * Config API Object
 *
 * Programmable access to HQL configuration.
 * Usage in REPL:
 *   (config.get "model")      ; Get a value
 *   (config.set "model" "ollama/llama3.2")  ; Set a value
 *   (config.reset)            ; Reset to defaults
 *   (config.all)              ; Get entire config
 *   (config.keys)             ; List available keys
 *   (config.defaults)         ; Get default values
 */

import {
  loadConfig,
  saveConfig,
  resetConfig,
  isConfigKey,
  getConfigPath,
} from "../common/config/storage.ts";

import {
  type HqlConfig,
  type ConfigKey,
  type KeybindingsConfig,
  DEFAULT_CONFIG,
  CONFIG_KEYS,
  validateValue,
  parseValue,
} from "../common/config/types.ts";
import { syncProvidersFromConfig } from "../common/config/provider-sync.ts";

// ============================================================================
// Config API Object
// ============================================================================

/**
 * Create the config API object
 * This is designed to be registered on globalThis for REPL access
 */
export function createConfigApi() {
  /**
   * Internal reference to current config
   * Updated on load/save operations
   */
  let _config: HqlConfig | null = null;

  /**
   * Get current config, loading from disk if needed
   */
  async function ensureConfig(): Promise<HqlConfig> {
    if (!_config) {
      _config = normalizeConfig(await loadConfig());
      syncProvidersFromConfig(_config);
    }
    return _config;
  }

  function normalizeConfig(config: HqlConfig): HqlConfig {
    const next = { ...config };
    for (const key of CONFIG_KEYS) {
      const value = next[key as keyof HqlConfig];
      const result = validateValue(key, value);
      if (!result.valid) {
        console.warn(`Warning: config.${key} invalid - ${result.error}. Using default.`);
        (next as unknown as Record<string, unknown>)[key] = DEFAULT_CONFIG[key as keyof HqlConfig];
      }
    }
    return next;
  }

  return {
    /**
     * Get a config value by key
     * @example (config.get "model")
     */
    get: async (key: string): Promise<unknown> => {
      if (!isConfigKey(key)) {
        throw new Error(`Unknown config key: ${key}. Valid keys: ${CONFIG_KEYS.join(", ")}`);
      }
      const cfg = await ensureConfig();
      return cfg[key];
    },

    /**
     * Set a config value
     * @example (config.set "model" "ollama/llama3.2")
     */
    set: async (key: string, value: unknown): Promise<void> => {
      if (!isConfigKey(key)) {
        throw new Error(`Unknown config key: ${key}. Valid keys: ${CONFIG_KEYS.join(", ")}`);
      }

      // Parse string values for numeric keys
      let parsedValue = value;
      if (typeof value === "string" && (key === "temperature" || key === "maxTokens")) {
        parsedValue = parseValue(key, value);
      }

      const validation = validateValue(key, parsedValue);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const cfg = await ensureConfig();
      const newConfig = { ...cfg, [key]: parsedValue };
      await saveConfig(newConfig);
      _config = newConfig;
      syncProvidersFromConfig(newConfig);
    },

    /**
     * Reset config to defaults
     * @example (config.reset)
     */
    reset: async (): Promise<HqlConfig> => {
      _config = await resetConfig();
      syncProvidersFromConfig(_config);
      return _config;
    },

    /**
     * Get entire config object
     * @example (config.all)
     */
    get all(): Promise<HqlConfig> {
      return ensureConfig();
    },

    /**
     * Get cached config snapshot (sync)
     * @example (config.snapshot)
     */
    get snapshot(): HqlConfig {
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
    get defaults(): HqlConfig {
      return { ...DEFAULT_CONFIG };
    },

    /**
     * Get config file path
     * @example (config.path)
     */
    get path(): string {
      return getConfigPath();
    },

    /**
     * Reload config from disk
     * @example (config.reload)
     */
    reload: async (): Promise<HqlConfig> => {
      _config = normalizeConfig(await loadConfig());
      syncProvidersFromConfig(_config);
      return _config;
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
    validate: (key: string, value: unknown): { valid: boolean; error?: string } => {
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
      set: async (id: string, combo: string): Promise<void> => {
        const cfg = await ensureConfig();
        const newBindings = { ...(cfg.keybindings ?? {}), [id]: combo };
        const newConfig = { ...cfg, keybindings: newBindings };
        await saveConfig(newConfig);
        _config = newConfig;
      },

      /**
       * Get cached keybindings snapshot (sync)
       * @example (config.keybindings.snapshot)
       */
      get snapshot(): KeybindingsConfig {
        return { ...(_config?.keybindings ?? {}) };
      },
    },
  };
}

/**
 * Default config API instance
 */
export const config = createConfigApi();
