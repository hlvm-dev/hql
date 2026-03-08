import {
  autoConfigureInitialClaudeCodeModel,
  ensureInitialModelConfigured as ensureInitialModelConfiguredCommon,
  type EnsureInitialModelConfiguredOptions,
  type EnsureInitialModelConfiguredResult,
  reconcileConfiguredClaudeCodeModel,
  resolveCompatibleClaudeCodeModel,
} from "../../common/ai-default-model.ts";
import { type ConfigKey, type HlvmConfig } from "../../common/config/types.ts";
import {
  getApprovedProviders,
  getConfiguredModel,
  getContextWindow,
  getPermissionMode,
  getTheme,
} from "../../common/config/selectors.ts";
import {
  getRuntimeConfig,
  getRuntimeModelDiscovery,
  getRuntimeProviderStatus,
  listRuntimeInstalledModels,
  patchRuntimeConfig,
} from "./host-client.ts";
import {
  evaluateProviderApproval,
  type ProviderApprovalDecision,
} from "../providers/approval.ts";

function listRuntimeModels(providerName?: string) {
  return listRuntimeInstalledModels(providerName);
}

export interface RuntimeConfigManager {
  getConfig: () => HlvmConfig;
  sync: () => Promise<HlvmConfig>;
  patch: (updates: Partial<Record<ConfigKey, unknown>>) => Promise<HlvmConfig>;
  getConfiguredModel: () => string;
  getContextWindow: () => number | undefined;
  getPermissionMode: () => HlvmConfig["permissionMode"];
  getApprovedProviders: () => string[];
  getTheme: () => string;
  evaluateProviderApproval: (modelId: string) => ProviderApprovalDecision;
  approveProvider: (provider: string) => Promise<HlvmConfig>;
  ensureInitialModelConfigured: (
    options?: EnsureInitialModelConfiguredOptions,
  ) => Promise<EnsureInitialModelConfiguredResult>;
  autoConfigureInitialClaudeCodeModel: () => Promise<string | null>;
  reconcileConfiguredClaudeCodeModel: () => Promise<string | null>;
  resolveCompatibleClaudeCodeModel: (modelId: string) => Promise<string>;
}

export async function createRuntimeConfigManager(): Promise<
  RuntimeConfigManager
> {
  let runtimeConfig = await getRuntimeConfig();

  const patchRuntimeSnapshot = async (
    updates: Partial<Record<ConfigKey, unknown>>,
  ): Promise<HlvmConfig> => {
    runtimeConfig = await patchRuntimeConfig(updates);
    return runtimeConfig;
  };

  const patchConfig = async (
    updates: Partial<Record<ConfigKey, unknown>>,
  ): Promise<void> => {
    await patchRuntimeSnapshot(updates);
  };

  const syncRuntimeConfig = async (): Promise<HlvmConfig> => {
    runtimeConfig = await getRuntimeConfig();
    return runtimeConfig;
  };

  return {
    getConfig: () => runtimeConfig,
    sync: syncRuntimeConfig,
    patch: patchRuntimeSnapshot,
    getConfiguredModel: () => getConfiguredModel(runtimeConfig),
    getContextWindow: () => getContextWindow(runtimeConfig),
    getPermissionMode: () => getPermissionMode(runtimeConfig),
    getApprovedProviders: () => getApprovedProviders(runtimeConfig),
    getTheme: () => getTheme(runtimeConfig),
    evaluateProviderApproval: (modelId: string) =>
      evaluateProviderApproval(modelId, getApprovedProviders(runtimeConfig)),
    approveProvider: async (provider: string) => {
      const approvedProviders = getApprovedProviders(runtimeConfig);
      if (approvedProviders.includes(provider)) {
        return runtimeConfig;
      }
      return await patchRuntimeSnapshot({
        approvedProviders: [...approvedProviders, provider],
      });
    },
    ensureInitialModelConfigured: async (options = {}) => {
      return await ensureInitialModelConfiguredCommon(options, {
        getSnapshot: () => runtimeConfig,
        getStatus: (providerName?: string) =>
          getRuntimeProviderStatus(providerName),
        listModels: listRuntimeModels,
        listCatalogModels: async () => {
          const snapshot = await getRuntimeModelDiscovery();
          return snapshot.remoteModels;
        },
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
