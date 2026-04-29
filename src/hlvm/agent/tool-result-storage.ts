import {
  ensureToolResultsSessionDir,
  getToolResultsDir,
  getToolResultSidecarPath,
  getToolResultsSessionDir,
} from "../../common/paths.ts";
import { getPlatform } from "../../platform/platform.ts";

const TEXT_ENCODER = new TextEncoder();
const STALE_TOOL_RESULT_SESSION_MS = 24 * 60 * 60 * 1000;

let staleSidecarPruneDone = false;
let staleSidecarPrunePromise: Promise<void> | undefined;

type ToolResultSidecarFormat = "txt" | "json";

interface PersistedToolResultSidecar {
  sessionId: string;
  toolCallId: string;
  path: string;
  bytes: number;
  format: ToolResultSidecarFormat;
}

async function pruneStaleToolResultSidecars(
  activeSessionId: string,
): Promise<void> {
  const platform = getPlatform();
  const rootDir = getToolResultsDir();
  const activeDirName = platform.path.basename(
    getToolResultsSessionDir(activeSessionId),
  );

  await platform.fs.mkdir(rootDir, { recursive: true });

  for await (const entry of platform.fs.readDir(rootDir)) {
    if (!entry.isDirectory || entry.name === activeDirName) continue;
    const sessionDir = platform.path.join(rootDir, entry.name);
    try {
      const info = await platform.fs.stat(sessionDir);
      const modifiedAt = typeof info.mtimeMs === "number"
        ? info.mtimeMs
        : undefined;
      if (
        modifiedAt !== undefined &&
        Date.now() - modifiedAt > STALE_TOOL_RESULT_SESSION_MS
      ) {
        await platform.fs.remove(sessionDir, { recursive: true });
      }
    } catch {
      // Best-effort cleanup only.
    }
  }
}

async function ensureStaleToolResultSidecarsPruned(
  activeSessionId: string,
): Promise<void> {
  if (staleSidecarPruneDone) return;
  if (!staleSidecarPrunePromise) {
    staleSidecarPrunePromise = (async () => {
      try {
        await pruneStaleToolResultSidecars(activeSessionId);
      } finally {
        staleSidecarPruneDone = true;
        staleSidecarPrunePromise = undefined;
      }
    })();
  }
  await staleSidecarPrunePromise;
}

export async function clearToolResultSidecars(
  sessionId?: string | null,
): Promise<void> {
  const normalizedSessionId = sessionId?.trim();
  if (!normalizedSessionId) return;
  try {
    await getPlatform().fs.remove(
      getToolResultsSessionDir(normalizedSessionId),
      {
        recursive: true,
      },
    );
  } catch {
    // Best-effort cleanup only.
  }
}

export async function persistToolResultSidecar(options: {
  sessionId?: string;
  toolCallId?: string;
  content: string;
  format: ToolResultSidecarFormat;
}): Promise<PersistedToolResultSidecar> {
  const sessionId = options.sessionId?.trim() || "ephemeral";
  const toolCallId = options.toolCallId?.trim() || crypto.randomUUID();
  await ensureStaleToolResultSidecarsPruned(sessionId);
  await ensureToolResultsSessionDir(sessionId);
  const path = getToolResultSidecarPath(sessionId, toolCallId, options.format);
  await getPlatform().fs.writeTextFile(path, options.content);
  return {
    sessionId,
    toolCallId,
    path,
    bytes: TEXT_ENCODER.encode(options.content).length,
    format: options.format,
  };
}

export function _resetToolResultStorageForTests(): void {
  staleSidecarPruneDone = false;
  staleSidecarPrunePromise = undefined;
}
