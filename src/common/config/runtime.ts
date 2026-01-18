/**
 * HLVM Config Runtime
 * Startup helpers that delegate to the config API (SSOT)
 */

import { type HlvmConfig } from "./types.ts";
import { debugLog } from "./debug-log.ts";
import { ai } from "../../hlvm/api/ai.ts";
import { log } from "../../hlvm/api/log.ts";
import { parseModelString } from "../../hlvm/providers/index.ts";
import { config } from "../../hlvm/api/config.ts";

/**
 * Initialize config runtime at CLI startup
 * Loads config from file and verifies model selection
 */
export async function initConfigRuntime(): Promise<HlvmConfig> {
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
    const configuredModel = modelName;

    // Query available models via SSOT AI API
    const models = await ai.models.list(providerName ?? undefined);

    if (models.length === 0) {
      // No models installed - warn user
      log.raw.warn("\x1b[33m⚠ No models installed. Use the Model Browser (Tab → Enter on Model) to download one.\x1b[0m");
      return;
    }

    // Check if configured model exists (strict if tagged, fallback to :latest if untagged)
    const configuredHasTag = configuredModel.includes(":");
    const modelExists = models.some((m) => {
      if (configuredHasTag) {
        return m.name === configuredModel;
      }
      return m.name === configuredModel || m.name === `${configuredModel}:latest`;
    });

    if (!modelExists) {
      log.raw.warn(
        `\x1b[33m⚠ Model '${configuredModel}' not found. It will be downloaded on startup.\x1b[0m`
      );
    }
  } catch (error) {
    // Provider not running or unreachable - silently continue
    // User will see error when they try to use AI
    await debugLog("CONFIG", "Model verification failed (provider unreachable?)", { error: String(error) });
  }
}
