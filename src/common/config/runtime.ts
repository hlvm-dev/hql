/**
 * HQL Config Runtime
 * Bridge between config file and globalThis for live reload
 */

import { loadConfig, saveConfig } from "./storage.ts";
import { type HqlConfig, type ConfigKey, CONFIG_KEYS, DEFAULT_CONFIG, validateValue } from "./types.ts";
import { debugLog } from "./debug-log.ts";
import { initOllamaRuntime, updateOllamaEndpoint } from "../../runtime/ollama-runtime.ts";

// In-memory config state
let currentConfig: HqlConfig = { ...DEFAULT_CONFIG };

/**
 * Initialize config runtime at CLI startup
 * Loads config from file, validates, and sets globalThis.__hqlConfig
 */
export async function initConfigRuntime(): Promise<HqlConfig> {
  currentConfig = await loadConfig();

  await debugLog("CONFIG", "initConfigRuntime() called", currentConfig);

  // Validate and warn about invalid values
  for (const key of CONFIG_KEYS) {
    const value = currentConfig[key as keyof HqlConfig];
    const result = validateValue(key, value);
    if (!result.valid) {
      console.warn(`Warning: config.${key} invalid - ${result.error}. Using default.`);
      (currentConfig as unknown as Record<string, unknown>)[key] = DEFAULT_CONFIG[key as keyof HqlConfig];
    }
  }

  // Set global for embedded packages to read
  (globalThis as Record<string, unknown>).__hqlConfig = currentConfig;

  // Initialize ollama runtime with endpoint from config
  initOllamaRuntime(currentConfig.endpoint);

  await debugLog("CONFIG", "globalThis.__hqlConfig set", currentConfig);

  return currentConfig;
}

/**
 * Update a config value at runtime (hot reload)
 * Updates both file and globalThis
 * Validates value before updating (defense in depth)
 */
export async function updateConfigRuntime(key: ConfigKey, value: unknown): Promise<void> {
  await debugLog("CONFIG", `updateConfigRuntime(${key})`, { key, value });

  // Validate before updating (defense in depth)
  const result = validateValue(key, value);
  if (!result.valid) {
    await debugLog("CONFIG", `updateConfigRuntime VALIDATION FAILED`, { key, value, error: result.error });
    throw new Error(`Invalid config value for ${key}: ${result.error}`);
  }
  currentConfig = { ...currentConfig, [key]: value };
  await saveConfig(currentConfig);
  (globalThis as Record<string, unknown>).__hqlConfig = currentConfig;

  // Update ollama runtime if endpoint changed
  if (key === "endpoint") {
    updateOllamaEndpoint(value as string);
  }

  await debugLog("CONFIG", `updateConfigRuntime SUCCESS - globalThis updated`, { key, value, fullConfig: currentConfig });
}

/**
 * Reset config to defaults at runtime
 * Updates both file and globalThis
 */
export async function resetConfigRuntime(): Promise<HqlConfig> {
  await debugLog("CONFIG", "resetConfigRuntime() called");

  currentConfig = { ...DEFAULT_CONFIG };
  await saveConfig(currentConfig);
  (globalThis as Record<string, unknown>).__hqlConfig = currentConfig;

  await debugLog("CONFIG", "resetConfigRuntime SUCCESS", currentConfig);
  return currentConfig;
}

/**
 * Get current runtime config
 */
export function getConfigRuntime(): HqlConfig {
  return currentConfig;
}

/**
 * Extract model name from "provider/model" format
 * "ollama/llama3.2" -> "llama3.2"
 */
export function extractModelName(model: string): string {
  const i = model.indexOf("/");
  return i >= 0 ? model.slice(i + 1) : model;
}
