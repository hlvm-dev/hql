import {
  autoConfigureInitialClaudeCodeModel,
  ensureInitialModelConfigured as ensureInitialModelConfiguredCommon,
  reconcileConfiguredClaudeCodeModel,
  resolveCompatibleClaudeCodeModel,
  type EnsureInitialModelConfiguredOptions,
  type EnsureInitialModelConfiguredResult,
} from "../../common/ai-default-model.ts";
import {
  DEFAULT_MODEL_ID,
  type ConfigKey,
  type HlvmConfig,
  type PermissionMode,
} from "../../common/config/types.ts";
import { isObjectValue } from "../../common/utils.ts";
import {
  getRuntimeConfig,
  getRuntimeProviderStatus,
  listRuntimeInstalledModels,
  patchRuntimeConfig,
} from "./host-client.ts";
import { isProviderApprovedForProviders } from "../providers/approval.ts";

function listRuntimeModels(providerName?: string) {
  return listRuntimeInstalledModels(providerName);
}

function getConfiguredModelFromConfig(config: Pick<HlvmConfig, "model">): string {
  return typeof config.model === "string" && config.model.length > 0
    ? config.model
    : DEFAULT_MODEL_ID;
}

function getContextWindowFromConfig(config: unknown): number | undefined {
  const rawContextWindow = isObjectValue(config)
    ? config.contextWindow
    : undefined;
  return typeof rawContextWindow === "number" &&
      Number.isInteger(rawContextWindow) && rawContextWindow > 0
    ? rawContextWindow
    : undefined;
}

function getPermissionModeFromConfig(config: unknown): PermissionMode | undefined {
  const rawPermissionMode = isObjectValue(config)
    ? config.permissionMode
    : undefined;
  return rawPermissionMode === "default" || rawPermissionMode === "auto-edit" ||
      rawPermissionMode === "yolo"
    ? rawPermissionMode
    : undefined;
}

export interface RuntimeModelConfigManager {
  getConfig: () => HlvmConfig;
  sync: () => Promise<HlvmConfig>;
  getConfiguredModel: () => string;
  getContextWindow: () => number | undefined;
  getPermissionMode: () => PermissionMode | undefined;
  isProviderApproved: (modelId: string) => boolean;
  ensureInitialModelConfigured: (
    options?: EnsureInitialModelConfiguredOptions,
  ) => Promise<EnsureInitialModelConfiguredResult>;
  autoConfigureInitialClaudeCodeModel: () => Promise<string | null>;
  reconcileConfiguredClaudeCodeModel: () => Promise<string | null>;
  resolveCompatibleClaudeCodeModel: (modelId: string) => Promise<string>;
}

export async function createRuntimeModelConfigManager(): Promise<RuntimeModelConfigManager> {
  let runtimeConfig = await getRuntimeConfig();

  const patchConfig = async (
    updates: Partial<Record<ConfigKey, unknown>>,
  ): Promise<void> => {
    runtimeConfig = await patchRuntimeConfig(updates);
  };

  const syncRuntimeConfig = async (): Promise<HlvmConfig> => {
    runtimeConfig = await getRuntimeConfig();
    return runtimeConfig;
  };

  return {
    getConfig: () => runtimeConfig,
    sync: syncRuntimeConfig,
    getConfiguredModel: () => getConfiguredModelFromConfig(runtimeConfig),
    getContextWindow: () => getContextWindowFromConfig(runtimeConfig),
    getPermissionMode: () => getPermissionModeFromConfig(runtimeConfig),
    isProviderApproved: (modelId: string) =>
      isProviderApprovedForProviders(modelId, runtimeConfig.approvedProviders),
    ensureInitialModelConfigured: async (options = {}) => {
      return await ensureInitialModelConfiguredCommon(options, {
        getSnapshot: () => runtimeConfig,
        getStatus: (providerName?: string) =>
          getRuntimeProviderStatus(providerName),
        listModels: listRuntimeModels,
        patchConfig,
        syncSnapshot: syncRuntimeConfig,
      });
    },
    autoConfigureInitialClaudeCodeModel: async () => {
      return await autoConfigureInitialClaudeCodeModel({
        getSnapshot: () => runtimeConfig,
        getStatus: (providerName?: string) =>
          getRuntimeProviderStatus(providerName),
        listModels: listRuntimeModels,
        patchConfig,
      });
    },
    reconcileConfiguredClaudeCodeModel: async () => {
      return await reconcileConfiguredClaudeCodeModel({
        getSnapshot: () => runtimeConfig,
        listModels: listRuntimeModels,
        patchConfig,
      });
    },
    resolveCompatibleClaudeCodeModel: async (modelId: string) => {
      return await resolveCompatibleClaudeCodeModel(modelId, {
        listModels: listRuntimeModels,
      });
    },
  };
}
