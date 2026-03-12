import {
  getCheckpointDir,
  getCheckpointManifestPath,
  getSessionCheckpointsDir,
} from "../../common/paths.ts";
import { RuntimeError } from "../../common/error.ts";
import { RESOURCE_LIMITS } from "./constants.ts";
import { getPlatform } from "../../platform/platform.ts";

type CheckpointFileStatus = "created" | "modified" | "deleted";

interface AgentCheckpointFileEntry {
  path: string;
  status: CheckpointFileStatus;
  backupFile?: string;
  sizeBytes?: number;
}

interface AgentCheckpointManifest {
  id: string;
  sessionId: string;
  requestId: string;
  createdAt: number;
  reversible: boolean;
  files: AgentCheckpointFileEntry[];
  restoredAt?: number;
}

export interface AgentCheckpointSummary {
  id: string;
  requestId: string;
  createdAt: number;
  fileCount: number;
  reversible: boolean;
  restoredAt?: number;
}

export interface CheckpointRecorder {
  captureFileMutation: (
    path: string,
    options?: { status?: Exclude<CheckpointFileStatus, "deleted"> },
  ) => Promise<AgentCheckpointSummary>;
  getSummary: () => AgentCheckpointSummary | undefined;
}

const MAX_CHECKPOINT_BYTES = RESOURCE_LIMITS.maxTotalToolResultBytes;

function toSummary(manifest: AgentCheckpointManifest): AgentCheckpointSummary {
  return {
    id: manifest.id,
    requestId: manifest.requestId,
    createdAt: manifest.createdAt,
    fileCount: manifest.files.length,
    reversible: manifest.reversible,
    ...(manifest.restoredAt ? { restoredAt: manifest.restoredAt } : {}),
  };
}

async function ensureCheckpointDir(
  sessionId: string,
  checkpointId: string,
): Promise<string> {
  const platform = getPlatform();
  const dir = getCheckpointDir(sessionId, checkpointId);
  await platform.fs.mkdir(getSessionCheckpointsDir(sessionId), {
    recursive: true,
  });
  await platform.fs.mkdir(dir, { recursive: true });
  return dir;
}

async function writeManifest(
  manifest: AgentCheckpointManifest,
): Promise<void> {
  const platform = getPlatform();
  await ensureCheckpointDir(manifest.sessionId, manifest.id);
  await platform.fs.writeTextFile(
    getCheckpointManifestPath(manifest.sessionId, manifest.id),
    JSON.stringify(manifest, null, 2),
  );
}

export async function loadCheckpointManifest(
  sessionId: string,
  checkpointId: string,
): Promise<AgentCheckpointManifest | null> {
  const platform = getPlatform();
  const manifestPath = getCheckpointManifestPath(sessionId, checkpointId);
  if (!await platform.fs.exists(manifestPath)) return null;

  try {
    const content = await platform.fs.readTextFile(manifestPath);
    const parsed = JSON.parse(content) as AgentCheckpointManifest;
    if (
      !parsed || typeof parsed !== "object" || parsed.id !== checkpointId ||
      parsed.sessionId !== sessionId || !Array.isArray(parsed.files)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createCheckpointRecorder(options: {
  sessionId: string;
  requestId: string;
  onSummaryChanged?: (summary: AgentCheckpointSummary) => void;
}): CheckpointRecorder {
  const platform = getPlatform();
  let manifest: AgentCheckpointManifest | null = null;
  let totalCapturedBytes = 0;
  const trackedPaths = new Set<string>();

  const notify = (): AgentCheckpointSummary => {
    if (!manifest) {
      throw new RuntimeError("Checkpoint manifest unavailable");
    }
    const summary = toSummary(manifest);
    options.onSummaryChanged?.(summary);
    return summary;
  };

  const ensureManifest = async (): Promise<AgentCheckpointManifest> => {
    if (manifest) return manifest;
    manifest = {
      id: crypto.randomUUID(),
      sessionId: options.sessionId,
      requestId: options.requestId,
      createdAt: Date.now(),
      reversible: true,
      files: [],
    };
    await writeManifest(manifest);
    return manifest;
  };

  return {
    captureFileMutation: async (
      path: string,
      mutationOptions?: { status?: Exclude<CheckpointFileStatus, "deleted"> },
    ): Promise<AgentCheckpointSummary> => {
      const status = mutationOptions?.status ?? "modified";
      const currentManifest = await ensureManifest();
      if (trackedPaths.has(path)) {
        return notify();
      }

      const entry: AgentCheckpointFileEntry = { path, status };
      if (await platform.fs.exists(path)) {
        const stat = await platform.fs.stat(path);
        if (stat.isDirectory) {
          throw new RuntimeError(
            `Checkpoint unavailable; mutation not executed for directory path: ${path}`,
          );
        }
        const sizeBytes = stat.size ?? 0;
        if (totalCapturedBytes + sizeBytes > MAX_CHECKPOINT_BYTES) {
          throw new RuntimeError(
            "Checkpoint unavailable; mutation not executed because checkpoint storage limit was exceeded.",
          );
        }
        const backupFile = `file-${currentManifest.files.length}.bak`;
        const dir = await ensureCheckpointDir(currentManifest.sessionId, currentManifest.id);
        const bytes = await platform.fs.readFile(path);
        await platform.fs.writeFile(platform.path.join(dir, backupFile), bytes);
        entry.backupFile = backupFile;
        entry.sizeBytes = sizeBytes;
        totalCapturedBytes += sizeBytes;
      }

      currentManifest.files.push(entry);
      trackedPaths.add(path);
      await writeManifest(currentManifest);
      return notify();
    },
    getSummary: () => manifest ? toSummary(manifest) : undefined,
  };
}

export async function restoreCheckpoint(
  sessionId: string,
  checkpointId: string,
): Promise<{ restored: boolean; restoredFileCount: number }> {
  const platform = getPlatform();
  const manifest = await loadCheckpointManifest(sessionId, checkpointId);
  if (!manifest) {
    return { restored: false, restoredFileCount: 0 };
  }

  const checkpointDir = getCheckpointDir(sessionId, checkpointId);
  let restoredFileCount = 0;
  for (let index = manifest.files.length - 1; index >= 0; index -= 1) {
    const file = manifest.files[index]!;
    if (file.status === "created") {
      if (await platform.fs.exists(file.path)) {
        await platform.fs.remove(file.path);
      }
      restoredFileCount += 1;
      continue;
    }

    if (!file.backupFile) continue;
    const backupPath = platform.path.join(checkpointDir, file.backupFile);
    if (!await platform.fs.exists(backupPath)) continue;
    const bytes = await platform.fs.readFile(backupPath);
    await platform.fs.mkdir(platform.path.dirname(file.path), { recursive: true });
    await platform.fs.writeFile(file.path, bytes);
    restoredFileCount += 1;
  }

  manifest.restoredAt = Date.now();
  await writeManifest(manifest);
  return { restored: true, restoredFileCount };
}
