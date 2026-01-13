/**
 * HQL Config Runtime
 * Bridge between config file and globalThis for live reload
 */

import { loadConfig, saveConfig } from "./storage.ts";
import { type HqlConfig, type ConfigKey, type KeybindingsConfig, CONFIG_KEYS, DEFAULT_CONFIG, validateValue } from "./types.ts";
import { debugLog } from "./debug-log.ts";
import { initOllamaRuntime, updateOllamaEndpoint } from "../../runtime/ollama-runtime.ts";
import { listModels } from "../../providers/ollama/api.ts";

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

  // Initialize ollama runtime with endpoint from config
  initOllamaRuntime(currentConfig.endpoint);

  // Verify and auto-select model if needed
  await verifyAndSelectModel();

  // Set global for embedded packages to read
  (globalThis as Record<string, unknown>).__hqlConfig = currentConfig;

  await debugLog("CONFIG", "globalThis.__hqlConfig set", currentConfig);

  return currentConfig;
}

/**
 * Verify configured model exists and auto-select if needed
 * Called during startup to ensure a valid model is configured
 */
async function verifyAndSelectModel(): Promise<void> {
  try {
    // Extract model name from provider/model format
    const configuredModel = extractModelName(currentConfig.model);

    // Query available models from Ollama
    const models = await listModels(currentConfig.endpoint);

    if (models.length === 0) {
      // No models installed - warn user
      console.warn("\x1b[33m⚠ No Ollama models installed. Use the Model Browser (Tab → Enter on Model) to download one.\x1b[0m");
      return;
    }

    // Check if configured model exists (match by base name without tag)
    const configuredBase = configuredModel.split(":")[0];
    const modelExists = models.some(m => {
      const modelBase = m.name.split(":")[0];
      return m.name === configuredModel || modelBase === configuredBase;
    });

    if (!modelExists) {
      // Auto-select first available model
      const firstModel = models[0].name;
      const newModelConfig = `ollama/${firstModel}`;

      console.warn(`\x1b[33m⚠ Model '${configuredModel}' not found. Auto-selecting '${firstModel}'.\x1b[0m`);

      // Update config
      currentConfig = { ...currentConfig, model: newModelConfig };
      await saveConfig(currentConfig);

      await debugLog("CONFIG", "Auto-selected model", { from: configuredModel, to: firstModel });
    }
  } catch (error) {
    // Ollama not running or unreachable - silently continue
    // User will see error when they try to use AI
    await debugLog("CONFIG", "Model verification failed (Ollama unreachable?)", { error: String(error) });
  }
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
 * Update a keybinding at runtime
 * keybindingId: the ID of the keybinding (e.g., "paredit.slurp-forward")
 * keyCombo: the new key combination as a string (e.g., "Ctrl+Shift+S")
 */
export async function updateKeybindingRuntime(keybindingId: string, keyCombo: string): Promise<void> {
  await debugLog("CONFIG", `updateKeybindingRuntime(${keybindingId})`, { keybindingId, keyCombo });

  // Get or create keybindings object
  const keybindings: KeybindingsConfig = currentConfig.keybindings ?? {};
  keybindings[keybindingId] = keyCombo;

  // Update config
  currentConfig = { ...currentConfig, keybindings };
  await saveConfig(currentConfig);
  (globalThis as Record<string, unknown>).__hqlConfig = currentConfig;

  await debugLog("CONFIG", `updateKeybindingRuntime SUCCESS`, { keybindingId, keyCombo, keybindings });
}

/**
 * Get custom keybindings from config
 */
export function getKeybindingsRuntime(): KeybindingsConfig {
  return currentConfig.keybindings ?? {};
}

/**
 * Extract model name from "provider/model" format
 * "ollama/llama3.2" -> "llama3.2"
 */
export function extractModelName(model: string): string {
  const i = model.indexOf("/");
  return i >= 0 ? model.slice(i + 1) : model;
}
