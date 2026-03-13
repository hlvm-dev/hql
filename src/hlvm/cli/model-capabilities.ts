import { log } from "../api/log.ts";
import type { ModelInfo, ProviderCapability } from "../providers/types.ts";
import {
  findSnapshotBackedModel,
  listSnapshotBackedModels,
} from "./model-discovery.ts";
import { CLI_CACHE_TTL_MS } from "./repl-ink/ui-constants.ts";

let catalogCache: {
  data: ModelInfo[];
  expiry: number;
} | null = null;

export async function modelSupportsCapability(
  modelName: string,
  capability: ProviderCapability,
  modelInfo: ModelInfo | null,
): Promise<{ supported: boolean; catalogFailed?: boolean }> {
  if (modelInfo?.capabilities) {
    return { supported: modelInfo.capabilities.includes(capability) };
  }

  try {
    const now = Date.now();
    if (!catalogCache || now > catalogCache.expiry) {
      catalogCache = {
        data: await listSnapshotBackedModels({
          includeRemoteCatalog: true,
        }),
        expiry: now + CLI_CACHE_TTL_MS,
      };
    }
    const match = findSnapshotBackedModel(catalogCache.data, modelName);
    if (match) {
      return { supported: match.capabilities?.includes(capability) ?? false };
    }
  } catch (error) {
    log.warn(
      `Model catalog unavailable for ${capability} support check`,
      error,
    );
    return { supported: false, catalogFailed: true };
  }

  return { supported: false };
}

export async function modelSupportsTools(
  modelName: string,
  modelInfo: ModelInfo | null,
): Promise<{ supported: boolean; catalogFailed?: boolean }> {
  return await modelSupportsCapability(modelName, "tools", modelInfo);
}

export async function modelSupportsVision(
  modelName: string,
  modelInfo: ModelInfo | null,
): Promise<{ supported: boolean; catalogFailed?: boolean }> {
  return await modelSupportsCapability(modelName, "vision", modelInfo);
}
