import { ai } from "../api/ai.ts";
import {
  getModelDiscoveryModels,
  readStaleWhileRevalidateModelDiscoverySnapshot,
} from "../providers/model-discovery-store.ts";
import { tagModelsForProvider } from "../providers/model-list.ts";
import type { ModelInfo } from "../providers/types.ts";

interface SnapshotBackedModelListOptions {
  includeRemoteCatalog?: boolean;
  includeLocalInstalled?: boolean;
}

function getModelIdentityParts(modelName: string): {
  provider: string | null;
  bareName: string;
  baseName: string;
} {
  const slashIndex = modelName.indexOf("/");
  const provider = slashIndex >= 0 ? modelName.slice(0, slashIndex) : null;
  const bareName = slashIndex >= 0
    ? modelName.slice(slashIndex + 1)
    : modelName;
  return {
    provider,
    bareName,
    baseName: bareName.split(":")[0],
  };
}

function getCandidateProvider(model: ModelInfo): string | null {
  if (typeof model.metadata?.provider === "string") {
    return model.metadata.provider;
  }
  const slashIndex = model.name.indexOf("/");
  return slashIndex >= 0 ? model.name.slice(0, slashIndex) : null;
}

function getCandidateBareName(model: ModelInfo): string {
  const slashIndex = model.name.indexOf("/");
  return slashIndex >= 0 ? model.name.slice(slashIndex + 1) : model.name;
}

async function listInstalledOllamaModels(): Promise<ModelInfo[]> {
  try {
    return tagModelsForProvider("ollama", await ai.models.list("ollama"));
  } catch {
    return [];
  }
}

export async function listSnapshotBackedModels(
  options: SnapshotBackedModelListOptions = {},
): Promise<ModelInfo[]> {
  const [snapshot, localModels] = await Promise.all([
    readStaleWhileRevalidateModelDiscoverySnapshot(),
    options.includeLocalInstalled === false
      ? Promise.resolve([])
      : listInstalledOllamaModels(),
  ]);

  return getModelDiscoveryModels(snapshot, {
    localModels,
    includeRemoteModels: options.includeRemoteCatalog !== false,
  });
}

export function findSnapshotBackedModel(
  models: ModelInfo[],
  modelName: string,
): ModelInfo | null {
  const requested = getModelIdentityParts(modelName);

  return models.find((model) => {
    const candidateProvider = getCandidateProvider(model);
    if (
      requested.provider &&
      candidateProvider &&
      candidateProvider !== requested.provider
    ) {
      return false;
    }

    const candidateBareName = getCandidateBareName(model);
    return model.name === modelName ||
      candidateBareName === requested.bareName ||
      candidateBareName.split(":")[0] === requested.baseName;
  }) ?? null;
}
