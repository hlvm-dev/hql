/**
 * HQL Config Runtime
 * Startup helpers that delegate to the config API (SSOT)
 */

import { type HqlConfig, type ConfigKey, type KeybindingsConfig, DEFAULT_CONFIG } from "./types.ts";
import { debugLog } from "./debug-log.ts";
import { ai } from "../../api/ai.ts";
import { parseModelString } from "../../providers/index.ts";
import { config } from "../../api/config.ts";

/**
 * Initialize config runtime at CLI startup
 * Loads config from file and verifies model selection
 */
export async function initConfigRuntime(): Promise<HqlConfig> {
  const loaded = await config.reload();
  await debugLog("CONFIG", "initConfigRuntime() called", loaded);

  // Verify and auto-select model if needed
  await verifyAndSelectModel();

  return config.snapshot;
}

/**
 * Verify configured model exists and auto-select if needed
 * Called during startup to ensure a valid model is configured
 */
async function verifyAndSelectModel(): Promise<void> {
  try {
    const currentConfig = await config.all;

    // Extract provider/model from config
    const [providerName, modelName] = parseModelString(currentConfig.model);
    const configuredModel = modelName || extractModelName(currentConfig.model);

    // Query available models via SSOT AI API
    const models = await ai.models.list(providerName ?? undefined);

    if (models.length === 0) {
      // No models installed - warn user
      console.warn("\x1b[33m⚠ No models installed. Use the Model Browser (Tab → Enter on Model) to download one.\x1b[0m");
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
      const providerPrefix = providerName ?? ai.providers.default ?? "ollama";
      const newModelConfig = `${providerPrefix}/${firstModel}`;

      console.warn(`\x1b[33m⚠ Model '${configuredModel}' not found. Auto-selecting '${firstModel}'.\x1b[0m`);

      // Update config
      await config.set("model", newModelConfig);

      await debugLog("CONFIG", "Auto-selected model", { from: configuredModel, to: firstModel });
    }
  } catch (error) {
    // Provider not running or unreachable - silently continue
    // User will see error when they try to use AI
    await debugLog("CONFIG", "Model verification failed (provider unreachable?)", { error: String(error) });
  }
}

/**
 * Update a config value at runtime (hot reload)
 * Updates both file and globalThis
 * Validates value before updating (defense in depth)
 */
export async function updateConfigRuntime(key: ConfigKey, value: unknown): Promise<void> {
  await debugLog("CONFIG", `updateConfigRuntime(${key})`, { key, value });

  await config.set(key, value);
  await debugLog("CONFIG", `updateConfigRuntime SUCCESS`, { key, value, fullConfig: config.snapshot });
}

/**
 * Reset config to defaults at runtime
 * Updates both file and globalThis
 */
export async function resetConfigRuntime(): Promise<HqlConfig> {
  await debugLog("CONFIG", "resetConfigRuntime() called");

  const next = await config.reset();
  await debugLog("CONFIG", "resetConfigRuntime SUCCESS", next);
  return next;
}

/**
 * Get current runtime config
 */
export function getConfigRuntime(): HqlConfig {
  return config.snapshot ?? { ...DEFAULT_CONFIG };
}

/**
 * Update a keybinding at runtime
 * keybindingId: the ID of the keybinding (e.g., "paredit.slurp-forward")
 * keyCombo: the new key combination as a string (e.g., "Ctrl+Shift+S")
 */
export async function updateKeybindingRuntime(keybindingId: string, keyCombo: string): Promise<void> {
  await debugLog("CONFIG", `updateKeybindingRuntime(${keybindingId})`, { keybindingId, keyCombo });

  await config.keybindings.set(keybindingId, keyCombo);
  await debugLog("CONFIG", `updateKeybindingRuntime SUCCESS`, {
    keybindingId,
    keyCombo,
    keybindings: config.keybindings.snapshot,
  });
}

/**
 * Get custom keybindings from config
 */
export function getKeybindingsRuntime(): KeybindingsConfig {
  return config.keybindings.snapshot ?? {};
}

/**
 * Extract model name from "provider/model" format
 * "ollama/llama3.2" -> "llama3.2"
 */
export function extractModelName(model: string): string {
  const i = model.indexOf("/");
  return i >= 0 ? model.slice(i + 1) : model;
}
