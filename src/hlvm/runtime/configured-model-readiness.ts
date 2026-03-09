import { getErrorMessage } from "../../common/utils.ts";
import { createRuntimeConfigManager } from "./model-config.ts";
import { getRuntimeProviderStatus } from "./host-client.ts";
import {
  getRuntimeModelAvailability,
  resolveModelAvailabilityTarget,
} from "./model-availability.ts";

export type ConfiguredModelReadinessState =
  | "available"
  | "setup_required"
  | "unavailable";

export interface ConfiguredModelReadiness {
  modelId: string;
  modelName: string;
  providerName?: string;
  supportsLocalInstall: boolean;
  providerAvailable: boolean;
  modelAvailable: boolean;
  requiresLocalInstall: boolean;
  state: ConfiguredModelReadinessState;
  error?: string;
}

export async function getModelReadiness(
  modelId: string,
): Promise<ConfiguredModelReadiness> {
  const target = resolveModelAvailabilityTarget(modelId);

  let providerStatus;
  try {
    providerStatus = await getRuntimeProviderStatus(target.providerName);
  } catch (error) {
    return {
      ...target,
      providerAvailable: false,
      modelAvailable: false,
      requiresLocalInstall: target.supportsLocalInstall,
      state: "unavailable",
      error: getErrorMessage(error),
    };
  }

  if (!providerStatus.available) {
    return {
      ...target,
      providerAvailable: false,
      modelAvailable: false,
      requiresLocalInstall: target.supportsLocalInstall,
      state: "unavailable",
      error: providerStatus.error,
    };
  }

  if (!target.supportsLocalInstall) {
    return {
      ...target,
      providerAvailable: true,
      modelAvailable: true,
      requiresLocalInstall: false,
      state: "available",
    };
  }

  try {
    const availability = await getRuntimeModelAvailability(target.modelId);
    return {
      ...target,
      providerAvailable: true,
      modelAvailable: availability.available,
      requiresLocalInstall: availability.requiresLocalInstall,
      state: availability.available ? "available" : "setup_required",
    };
  } catch (error) {
    return {
      ...target,
      providerAvailable: true,
      modelAvailable: false,
      requiresLocalInstall: target.supportsLocalInstall,
      state: "unavailable",
      error: `Unable to inspect model availability: ${getErrorMessage(error)}`,
    };
  }
}

export async function getConfiguredModelReadiness(): Promise<
  ConfiguredModelReadiness
> {
  const runtimeConfig = await createRuntimeConfigManager();
  const { model } = await runtimeConfig.ensureInitialModelConfigured();
  return await getModelReadiness(model);
}
