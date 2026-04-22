import {
  ensureHlvmDir,
  ensureHlvmDirSync,
  getModelDiscoveryCachePath,
} from "../../common/paths.ts";
import { getPlatform } from "../../platform/platform.ts";
import { getProvider } from "./registry.ts";
import type { ModelInfo } from "./types.ts";
import { getBundledModelDiscoverySnapshot } from "./model-discovery-seed.ts";
import {
  dedupeModelList,
  listAllProviderModels,
  suppressRedundantUnconfiguredProviders,
  tagModelsForProvider,
} from "./model-list.ts";
import {
  LOCAL_FALLBACK_IDENTITY,
  LOCAL_FALLBACK_MODEL,
} from "../runtime/bootstrap-manifest.ts";
import { getLocalModelDisplayName } from "../runtime/local-llm.ts";

export interface ModelDiscoverySnapshot {
  timestamp: number;
  remoteModels: ModelInfo[];
  cloudModels: ModelInfo[];
}

export interface ModelDiscoveryRefreshResult {
  snapshot: ModelDiscoverySnapshot;
  failed: boolean;
}

interface ModelDiscoverySourceResult {
  models: ModelInfo[];
  authoritativeEmpty?: boolean;
}

interface ModelDiscoveryStoreDeps {
  readTextFile(path: string): Promise<string>;
  readTextFileSync(path: string): string;
  writeTextFile(path: string, content: string): Promise<void>;
  writeTextFileSync(path: string, content: string): void;
  listOllamaCatalog(): Promise<ModelInfo[] | ModelDiscoverySourceResult>;
  listCloudModels(): Promise<ModelInfo[] | ModelDiscoverySourceResult>;
  now(): number;
}

const EMPTY_MODEL_DISCOVERY_SNAPSHOT: ModelDiscoverySnapshot = {
  timestamp: 0,
  remoteModels: [],
  cloudModels: [],
};

function formatPinnedModelSize(sizeBytes: number): string {
  const sizeGb = sizeBytes / 1_000_000_000;
  return sizeGb >= 10 ? `${Math.round(sizeGb)}GB` : `${sizeGb.toFixed(1)}GB`;
}

function buildPinnedDefaultLocalModel(): ModelInfo {
  const [family = LOCAL_FALLBACK_MODEL, parameterSize = ""] =
    LOCAL_FALLBACK_MODEL.split(":");
  const [tagged] = tagModelsForProvider("ollama", [{
    name: LOCAL_FALLBACK_MODEL,
    displayName: getLocalModelDisplayName(),
    family,
    parameterSize: parameterSize.toUpperCase(),
    size: LOCAL_FALLBACK_IDENTITY.publishedTotalSizeBytes,
    capabilities: ["generate", "chat", "tools"],
    metadata: {
      description:
        "HLVM pinned local default model. Prepared automatically during local bootstrap.",
      sizes: [formatPinnedModelSize(
        LOCAL_FALLBACK_IDENTITY.publishedTotalSizeBytes,
      )],
      defaultPinned: true,
      localFallback: true,
    },
  }]);
  return tagged;
}

function injectPinnedDefaultRemoteModel(models: ModelInfo[]): ModelInfo[] {
  return dedupeModelList([
    buildPinnedDefaultLocalModel(),
    ...models,
  ]);
}

function normalizeSnapshot(snapshot: ModelDiscoverySnapshot): ModelDiscoverySnapshot {
  return {
    timestamp: snapshot.timestamp,
    remoteModels: injectPinnedDefaultRemoteModel(snapshot.remoteModels),
    cloudModels: dedupeModelList(snapshot.cloudModels),
  };
}

function getDefaultDeps(): ModelDiscoveryStoreDeps {
  const fs = getPlatform().fs;
  return {
    readTextFile: (path) => fs.readTextFile(path),
    readTextFileSync: (path) => fs.readTextFileSync(path),
    writeTextFile: (path, content) => fs.writeTextFile(path, content),
    writeTextFileSync: (path, content) => fs.writeTextFileSync(path, content),
    listOllamaCatalog: async () => {
      const provider = getProvider("ollama");
      if (!provider?.models?.catalog) {
        return { models: [], authoritativeEmpty: false };
      }
      return {
        models: tagModelsForProvider("ollama", await provider.models.catalog()),
        authoritativeEmpty: false,
      };
    },
    listCloudModels: async () => ({
      models: await listAllProviderModels({ excludeProviders: ["ollama"] }),
      authoritativeEmpty: false,
    }),
    now: () => Date.now(),
  };
}

function cloneSnapshot(
  snapshot: ModelDiscoverySnapshot,
): ModelDiscoverySnapshot {
  return normalizeSnapshot({
    timestamp: snapshot.timestamp,
    remoteModels: [...snapshot.remoteModels],
    cloudModels: [...snapshot.cloudModels],
  });
}

function hasDiscoveryData(snapshot: ModelDiscoverySnapshot): boolean {
  return snapshot.remoteModels.length > 0 || snapshot.cloudModels.length > 0;
}

function parsePersistedSnapshot(
  raw: string,
): ModelDiscoverySnapshot | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ModelDiscoverySnapshot>;
    if (
      typeof parsed.timestamp !== "number" ||
      !Array.isArray(parsed.remoteModels) ||
      !Array.isArray(parsed.cloudModels)
    ) {
      return null;
    }
    return {
      timestamp: parsed.timestamp,
      remoteModels: injectPinnedDefaultRemoteModel(parsed.remoteModels as ModelInfo[]),
      cloudModels: dedupeModelList(parsed.cloudModels as ModelInfo[]),
    };
  } catch {
    return null;
  }
}

function normalizeSourceResult(
  value: ModelInfo[] | ModelDiscoverySourceResult,
): ModelDiscoverySourceResult {
  return Array.isArray(value) ? { models: value } : value;
}

export interface ModelDiscoveryModelOptions {
  includeRemoteModels?: boolean;
  localModels?: ModelInfo[];
}

export function getModelDiscoveryModels(
  snapshot: ModelDiscoverySnapshot,
  options: ModelDiscoveryModelOptions = {},
): ModelInfo[] {
  return suppressRedundantUnconfiguredProviders(dedupeModelList([
    ...(options.localModels ?? []),
    ...(options.includeRemoteModels === false ? [] : snapshot.remoteModels),
    ...snapshot.cloudModels,
  ]));
}

export function createModelDiscoveryStore(
  deps: Partial<ModelDiscoveryStoreDeps> = {},
) {
  const resolvedDeps = { ...getDefaultDeps(), ...deps };
  let cachedSnapshot: ModelDiscoverySnapshot | null = null;
  let inFlightRefresh: Promise<ModelDiscoveryRefreshResult> | null = null;

  function getSeedSnapshot(): ModelDiscoverySnapshot {
    return getBundledModelDiscoverySnapshot();
  }

  async function readDiskSnapshot(): Promise<ModelDiscoverySnapshot | null> {
    try {
      const raw = await resolvedDeps.readTextFile(getModelDiscoveryCachePath());
      return parsePersistedSnapshot(raw);
    } catch {
      return null;
    }
  }

  function readDiskSnapshotSync(): ModelDiscoverySnapshot | null {
    try {
      const raw = resolvedDeps.readTextFileSync(getModelDiscoveryCachePath());
      return parsePersistedSnapshot(raw);
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

  function writeDiskSnapshotSync(snapshot: ModelDiscoverySnapshot): void {
    try {
      ensureHlvmDirSync();
      resolvedDeps.writeTextFileSync(
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
    cachedSnapshot = diskSnapshot ?? getSeedSnapshot() ??
      EMPTY_MODEL_DISCOVERY_SNAPSHOT;
    if (!diskSnapshot && hasDiscoveryData(cachedSnapshot)) {
      await writeDiskSnapshot(cachedSnapshot);
    }
    return cloneSnapshot(cachedSnapshot);
  }

  function readSnapshotSync(): ModelDiscoverySnapshot {
    if (cachedSnapshot) {
      return cloneSnapshot(cachedSnapshot);
    }

    const diskSnapshot = readDiskSnapshotSync();
    cachedSnapshot = diskSnapshot ?? getSeedSnapshot() ??
      EMPTY_MODEL_DISCOVERY_SNAPSHOT;
    if (!diskSnapshot && hasDiscoveryData(cachedSnapshot)) {
      writeDiskSnapshotSync(cachedSnapshot);
    }
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
          .then((result) => ({
            ...normalizeSourceResult(result),
            failed: false,
          }))
          .catch(() => ({
            models: [] as ModelInfo[],
            authoritativeEmpty: false,
            failed: true,
          })),
        resolvedDeps.listCloudModels()
          .then((result) => ({
            ...normalizeSourceResult(result),
            failed: false,
          }))
          .catch(() => ({
            models: [] as ModelInfo[],
            authoritativeEmpty: false,
            failed: true,
          })),
      ]);

      const remoteFailed = remoteResult.failed ||
        (
          remoteResult.models.length === 0 &&
          current.remoteModels.length > 0 &&
          remoteResult.authoritativeEmpty !== true
        );
      const cloudFailed = cloudResult.failed ||
        (
          cloudResult.models.length === 0 &&
          current.cloudModels.length > 0 &&
          cloudResult.authoritativeEmpty !== true
        );
      const remoteModels = remoteFailed
        ? current.remoteModels
        : remoteResult.models;
      const cloudModels = cloudFailed
        ? current.cloudModels
        : cloudResult.models;
      const failed = remoteFailed || cloudFailed;

      const nextSnapshot: ModelDiscoverySnapshot = {
        timestamp: (!remoteFailed || !cloudFailed)
          ? resolvedDeps.now()
          : current.timestamp,
        remoteModels: injectPinnedDefaultRemoteModel(remoteModels),
        cloudModels: dedupeModelList(cloudModels),
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

  async function readStaleWhileRevalidateSnapshot(): Promise<
    ModelDiscoverySnapshot
  > {
    const snapshot = await readSnapshot();
    if (hasDiscoveryData(snapshot)) {
      void refreshSnapshot();
      return snapshot;
    }

    const refreshed = await refreshSnapshot();
    return refreshed.snapshot;
  }

  function resetCacheForTests(): void {
    cachedSnapshot = null;
    inFlightRefresh = null;
  }

  return {
    readSnapshot,
    readSnapshotSync,
    refreshSnapshot,
    readStaleWhileRevalidateSnapshot,
    resetCacheForTests,
  };
}

const defaultModelDiscoveryStore = createModelDiscoveryStore();

export const readModelDiscoverySnapshot =
  defaultModelDiscoveryStore.readSnapshot;
export const refreshModelDiscoverySnapshot =
  defaultModelDiscoveryStore.refreshSnapshot;
export const readStaleWhileRevalidateModelDiscoverySnapshot =
  defaultModelDiscoveryStore.readStaleWhileRevalidateSnapshot;
export { hasDiscoveryData as hasModelDiscoveryData };
