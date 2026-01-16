/**
 * AI Provider Sync
 *
 * Keep provider configuration aligned with current config.
 * This ensures config is the single source of truth for AI endpoint/model.
 */

import type { HlvmConfig } from "./types.ts";
import {
  hasProvider,
  initializeProviders,
  parseModelString,
  setDefaultProvider,
} from "../../hlvm/providers/index.ts";

export function syncProvidersFromConfig(config: HlvmConfig): void {
  const modelValue = config.model ?? "";
  const [providerName, modelName] = parseModelString(modelValue);
  const defaultModel = modelName || undefined;

  // Default config assumes ollama; keep endpoint/model in sync with provider registry.
  if (!providerName || providerName === "ollama") {
    initializeProviders({
      ollama: {
        endpoint: config.endpoint,
        defaultModel,
      },
    });
    return;
  }

  // If a non-ollama provider is configured and registered, make it default.
  if (hasProvider(providerName)) {
    setDefaultProvider(providerName);
  }
}
