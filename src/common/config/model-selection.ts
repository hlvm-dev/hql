import {
  type AgentMode,
  ConfigError,
  type ConfigKey,
  type HlvmConfig,
  normalizeModelId,
} from "./types.ts";
import { getConfiguredModel } from "./selectors.ts";
import { AGENT_MODEL_SUFFIX } from "../../hlvm/providers/claude-code/provider.ts";
import { isObjectValue } from "../utils.ts";

interface ModelSelectionConfigApi {
  set?: (key: string, value: unknown) => Promise<unknown>;
  patch?: (updates: Partial<Record<ConfigKey, unknown>>) => Promise<unknown>;
}

interface ModelSelectionUpdates
  extends Pick<HlvmConfig, "model" | "modelConfigured" | "agentMode"> {}

export interface ModelSelectionState {
  configuredModelId: string;
  activeModelId: string;
  displayLabel: string;
  modelConfigured: boolean;
}

export function resolveAgentModeForModel(modelId: string): AgentMode {
  return modelId.endsWith(AGENT_MODEL_SUFFIX) ? "claude-code-agent" : "hlvm";
}

export function formatSelectedModelLabel(modelId: string | undefined): string {
  return normalizeModelId(modelId) ?? "";
}

export function createModelSelectionState(
  config: unknown,
  activeModelId?: string,
): ModelSelectionState {
  const configuredModelId = getConfiguredModel(config);
  const normalizedActiveModelId = normalizeModelId(activeModelId) ??
    configuredModelId;

  return {
    configuredModelId,
    activeModelId: normalizedActiveModelId,
    displayLabel: formatSelectedModelLabel(normalizedActiveModelId),
    modelConfigured: isObjectValue(config) && config.modelConfigured === true,
  };
}

export function isSelectedModelActive(
  modelName: string | undefined,
  currentModelId: string | undefined,
): boolean {
  const normalizedModel = normalizeModelId(modelName);
  const normalizedCurrentModel = normalizeModelId(currentModelId);
  return !!normalizedModel &&
    !!normalizedCurrentModel &&
    normalizedModel === normalizedCurrentModel;
}

export function buildSelectedModelConfigUpdates(
  modelName: string,
): ModelSelectionUpdates {
  const normalizedModel = normalizeModelId(modelName);
  if (!normalizedModel) {
    throw new ConfigError("Invalid model ID");
  }

  return {
    model: normalizedModel,
    modelConfigured: true,
    agentMode: resolveAgentModeForModel(normalizedModel),
  };
}

export async function persistSelectedModelConfig(
  configApi: ModelSelectionConfigApi | undefined,
  modelName: string,
): Promise<string> {
  const updates = buildSelectedModelConfigUpdates(modelName);
  const normalizedModel = updates.model;
  if (!configApi) {
    throw new ConfigError("Configuration API not initialized");
  }

  if (typeof configApi.patch === "function") {
    await configApi.patch(updates);
    return normalizedModel;
  }

  if (typeof configApi.set !== "function") {
    throw new ConfigError("Config setter unavailable in this context");
  }

  await configApi.set("model", updates.model);
  await configApi.set("modelConfigured", updates.modelConfigured);
  await configApi.set("agentMode", updates.agentMode);
  return normalizedModel;
}
