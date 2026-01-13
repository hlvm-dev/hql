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
  loadKeybindings,
  saveKeybindings,
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
      _config = await loadConfig();
    }
    return _config;
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

      // Update globalThis.__hqlConfig for live reload
      if (typeof globalThis !== "undefined") {
        (globalThis as Record<string, unknown>).__hqlConfig = newConfig;
      }
    },

    /**
     * Reset config to defaults
     * @example (config.reset)
     */
    reset: async (): Promise<HqlConfig> => {
      _config = await resetConfig();

      // Update globalThis.__hqlConfig
      if (typeof globalThis !== "undefined") {
        (globalThis as Record<string, unknown>).__hqlConfig = _config;
      }

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
      _config = await loadConfig();

      // Update globalThis.__hqlConfig
      if (typeof globalThis !== "undefined") {
        (globalThis as Record<string, unknown>).__hqlConfig = _config;
      }

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
        return loadKeybindings();
      },

      /**
       * Update a keybinding
       * @example (config.keybindings.set "show-palette" "Ctrl+P")
       */
      set: async (id: string, combo: string): Promise<void> => {
        const bindings = await loadKeybindings();
        const newBindings = { ...bindings, [id]: combo };
        await saveKeybindings(newBindings);
        
        // Update global runtime cache if needed
        if (typeof globalThis !== "undefined") {
          const rt = (globalThis as Record<string, unknown>).__hqlKeybindings;
          if (rt && typeof rt === 'object') {
            (rt as Record<string, string>)[id] = combo;
          }
        }
      },
    },
  };
}

/**
 * Default config API instance
 */
export const config = createConfigApi();
