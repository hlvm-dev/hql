import {
  ensureHlvmDir,
  getModelDiscoveryCachePath,
} from "../../common/paths.ts";
import { getPlatform } from "../../platform/platform.ts";
import { getProvider } from "./registry.ts";
import type { ModelInfo } from "./types.ts";
import { listAllProviderModels } from "./model-list.ts";

export interface ModelDiscoverySnapshot {
  timestamp: number;
  remoteModels: ModelInfo[];
  cloudModels: ModelInfo[];
}

export interface ModelDiscoveryRefreshResult {
  snapshot: ModelDiscoverySnapshot;
  failed: boolean;
}

interface PersistedModelDiscoverySnapshot extends ModelDiscoverySnapshot {}

interface ModelDiscoveryStoreDeps {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  listOllamaCatalog(): Promise<ModelInfo[]>;
  listCloudModels(): Promise<ModelInfo[]>;
  now(): number;
}

const EMPTY_MODEL_DISCOVERY_SNAPSHOT: ModelDiscoverySnapshot = {
  timestamp: 0,
  remoteModels: [],
  cloudModels: [],
};

function getDefaultDeps(): ModelDiscoveryStoreDeps {
  const fs = getPlatform().fs;
  return {
    readTextFile: (path) => fs.readTextFile(path),
    writeTextFile: (path, content) => fs.writeTextFile(path, content),
    listOllamaCatalog: async () => {
      const provider = getProvider("ollama");
      if (!provider?.models?.catalog) {
        return [];
      }
      return await provider.models.catalog();
    },
    listCloudModels: async () =>
      await listAllProviderModels({ excludeProviders: ["ollama"] }),
    now: () => Date.now(),
  };
}

function cloneSnapshot(
  snapshot: ModelDiscoverySnapshot,
): ModelDiscoverySnapshot {
  return {
    timestamp: snapshot.timestamp,
    remoteModels: [...snapshot.remoteModels],
    cloudModels: [...snapshot.cloudModels],
  };
}

function hasDiscoveryData(snapshot: ModelDiscoverySnapshot): boolean {
  return snapshot.remoteModels.length > 0 || snapshot.cloudModels.length > 0;
}

export function createModelDiscoveryStore(
  deps: Partial<ModelDiscoveryStoreDeps> = {},
) {
  const resolvedDeps = { ...getDefaultDeps(), ...deps };
  let cachedSnapshot: ModelDiscoverySnapshot | null = null;
  let inFlightRefresh: Promise<ModelDiscoveryRefreshResult> | null = null;

  async function readDiskSnapshot(): Promise<ModelDiscoverySnapshot | null> {
    try {
      const raw = await resolvedDeps.readTextFile(getModelDiscoveryCachePath());
      const parsed = JSON.parse(raw) as Partial<
        PersistedModelDiscoverySnapshot
      >;
      if (
        typeof parsed.timestamp !== "number" ||
        !Array.isArray(parsed.remoteModels) ||
        !Array.isArray(parsed.cloudModels)
      ) {
        return null;
      }
      return {
        timestamp: parsed.timestamp,
        remoteModels: parsed.remoteModels as ModelInfo[],
        cloudModels: parsed.cloudModels as ModelInfo[],
      };
    } catch {
      return null;
    }
  }

  async function writeDiskSnapshot(
    snapshot: ModelDiscoverySnapshot,
  ): Promise<void> {
    try {
      await ensureHlvmDir();
      await resolvedDeps.writeTextFile(
        getModelDiscoveryCachePath(),
        JSON.stringify(snapshot),
      );
    } catch {
      // Best-effort persistence only.
    }
  }

  async function readSnapshot(): Promise<ModelDiscoverySnapshot> {
    if (cachedSnapshot) {
      return cloneSnapshot(cachedSnapshot);
    }

    const diskSnapshot = await readDiskSnapshot();
    cachedSnapshot = diskSnapshot ?? EMPTY_MODEL_DISCOVERY_SNAPSHOT;
    return cloneSnapshot(cachedSnapshot);
  }

  async function refreshSnapshot(): Promise<ModelDiscoveryRefreshResult> {
    if (inFlightRefresh) {
      return await inFlightRefresh;
    }

    inFlightRefresh = (async (): Promise<ModelDiscoveryRefreshResult> => {
      const current = await readSnapshot();

      const [remoteResult, cloudResult] = await Promise.all([
        resolvedDeps.listOllamaCatalog()
          .then((models) => ({ models, failed: models.length === 0 }))
          .catch(() => ({ models: [] as ModelInfo[], failed: true })),
        resolvedDeps.listCloudModels()
          .then((models) => ({ models, failed: models.length === 0 }))
          .catch(() => ({ models: [] as ModelInfo[], failed: true })),
      ]);

      const remoteModels = remoteResult.failed
        ? current.remoteModels
        : remoteResult.models;
      const cloudModels = cloudResult.failed
        ? current.cloudModels
        : cloudResult.models;
      const failed = remoteResult.failed || cloudResult.failed;

      if (
        !hasDiscoveryData({
          timestamp: current.timestamp,
          remoteModels,
          cloudModels,
        })
      ) {
        cachedSnapshot = current;
        return { snapshot: cloneSnapshot(current), failed };
      }

      const nextSnapshot: ModelDiscoverySnapshot = {
        timestamp: (!remoteResult.failed || !cloudResult.failed)
          ? resolvedDeps.now()
          : current.timestamp,
        remoteModels,
        cloudModels,
      };

      cachedSnapshot = nextSnapshot;
      if (!failed || nextSnapshot.timestamp !== current.timestamp) {
        await writeDiskSnapshot(nextSnapshot);
      }
      return { snapshot: cloneSnapshot(nextSnapshot), failed };
    })().finally(() => {
      inFlightRefresh = null;
    });

    return await inFlightRefresh;
  }

  function resetCacheForTests(): void {
    cachedSnapshot = null;
    inFlightRefresh = null;
  }

  return {
    readSnapshot,
    refreshSnapshot,
    resetCacheForTests,
  };
}

const defaultModelDiscoveryStore = createModelDiscoveryStore();

export const readModelDiscoverySnapshot =
  defaultModelDiscoveryStore.readSnapshot;
export const refreshModelDiscoverySnapshot =
  defaultModelDiscoveryStore.refreshSnapshot;
export const resetModelDiscoverySnapshotCacheForTests =
  defaultModelDiscoveryStore.resetCacheForTests;
export { hasDiscoveryData as hasModelDiscoveryData };
