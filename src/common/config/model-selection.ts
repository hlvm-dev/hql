import {
  type AgentMode,
  ConfigError,
  type ConfigKey,
  DEFAULT_MODEL_ID,
  type HlvmConfig,
  normalizeModelId,
} from "./types.ts";
import { AGENT_MODEL_SUFFIX } from "../../hlvm/providers/claude-code/provider.ts";
import { isObjectValue } from "../utils.ts";

interface ModelSelectionConfigApi {
  set?: (key: string, value: unknown) => Promise<unknown>;
  patch?: (updates: Partial<Record<ConfigKey, unknown>>) => Promise<unknown>;
}

interface BaseModelSelectionUpdates
  extends Pick<HlvmConfig, "model" | "modelConfigured"> {}

interface ModelSelectionUpdates
  extends BaseModelSelectionUpdates, Pick<HlvmConfig, "agentMode"> {}

interface PreservedAgentModeModelSelectionUpdates
  extends BaseModelSelectionUpdates {}

export interface ModelSelectionState {
  configuredModelId: string;
  activeModelId: string;
  displayLabel: string;
  modelConfigured: boolean;
}

export function isModelSelectionStateEqual(
  left: ModelSelectionState,
  right: ModelSelectionState,
): boolean {
  return left.configuredModelId === right.configuredModelId &&
    left.activeModelId === right.activeModelId &&
    left.displayLabel === right.displayLabel &&
    left.modelConfigured === right.modelConfigured;
}

export function resolveAgentModeForModel(modelId: string): AgentMode {
  return modelId.endsWith(AGENT_MODEL_SUFFIX) ? "claude-code-agent" : "hlvm";
}

export function normalizeSelectedModelId(
  modelId: unknown,
  agentMode?: AgentMode,
): string | undefined {
  const normalizedModel = normalizeModelId(modelId);
  if (!normalizedModel) {
    return undefined;
  }
  if (normalizedModel.endsWith(AGENT_MODEL_SUFFIX)) {
    return normalizedModel;
  }
  if (
    agentMode === "claude-code-agent" &&
    normalizedModel.startsWith("claude-code/")
  ) {
    return `${normalizedModel}${AGENT_MODEL_SUFFIX}`;
  }
  return normalizedModel;
}

export function normalizeModelSelectionConfig(config: HlvmConfig): HlvmConfig {
  const normalizedModel = normalizeSelectedModelId(config.model, config.agentMode);
  if (!normalizedModel) {
    return config;
  }
  const agentMode = resolveAgentModeForModel(normalizedModel);
  if (normalizedModel === config.model && agentMode === config.agentMode) {
    return config;
  }
  return {
    ...config,
    model: normalizedModel,
    agentMode,
  };
}

export function formatSelectedModelLabel(modelId: string | undefined): string {
  return normalizeModelId(modelId) ?? "";
}

export function createModelSelectionState(
  config: unknown,
  activeModelId?: string,
): ModelSelectionState {
  const configAgentMode = isObjectValue(config) &&
      (config.agentMode === "hlvm" || config.agentMode === "claude-code-agent")
    ? config.agentMode
    : undefined;
  const configuredModelId = normalizeSelectedModelId(
      isObjectValue(config) ? config.model : undefined,
      configAgentMode,
    ) ?? DEFAULT_MODEL_ID;
  const normalizedActiveModelId = normalizeSelectedModelId(
      activeModelId,
      configAgentMode,
    ) ??
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
  const normalizedModel = normalizeSelectedModelId(modelName);
  const normalizedCurrentModel = normalizeSelectedModelId(currentModelId);
  return !!normalizedModel &&
    !!normalizedCurrentModel &&
    normalizedModel === normalizedCurrentModel;
}

export function buildSelectedModelConfigUpdates(
  modelName: string,
): ModelSelectionUpdates {
  const normalizedModel = normalizeSelectedModelId(modelName);
  if (!normalizedModel) {
    throw new ConfigError("Invalid model ID");
  }

  return {
    model: normalizedModel,
    modelConfigured: true,
    agentMode: resolveAgentModeForModel(normalizedModel),
  };
}

export function buildSelectedModelConfigUpdatesPreservingAgentMode(
  modelName: string,
): PreservedAgentModeModelSelectionUpdates {
  const normalizedModel = normalizeSelectedModelId(modelName);
  if (!normalizedModel) {
    throw new ConfigError("Invalid model ID");
  }

  return {
    model: normalizedModel,
    modelConfigured: true,
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
