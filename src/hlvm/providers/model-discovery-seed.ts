import seedSnapshot from "./model-discovery-seed.json" with { type: "json" };
import type { ModelInfo } from "./types.ts";

export interface BundledModelDiscoverySnapshot {
  timestamp: number;
  remoteModels: ModelInfo[];
  cloudModels: ModelInfo[];
}

function cloneModels(models: ModelInfo[]): ModelInfo[] {
  return models.map((model) => ({
    ...model,
    metadata: model.metadata ? { ...model.metadata } : undefined,
  }));
}

export function getBundledModelDiscoverySnapshot(): BundledModelDiscoverySnapshot {
  const snapshot = seedSnapshot as BundledModelDiscoverySnapshot;
  return {
    timestamp: snapshot.timestamp,
    remoteModels: cloneModels(snapshot.remoteModels),
    cloudModels: cloneModels(snapshot.cloudModels),
  };
}
