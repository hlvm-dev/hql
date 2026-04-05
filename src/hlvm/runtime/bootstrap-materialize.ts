/**
 * Bootstrap materialization — pulls the fallback model into the HLVM-owned
 * model store and writes a verified manifest.
 *
 * During install / `hlvm bootstrap`, the HLVM runtime host may not be running,
 * so this module talks directly to the embedded Ollama engine via HTTP.
 */

import { getPlatform, type PlatformCommandProcess } from "../../platform/platform.ts";
import { ensureRuntimeDir, getModelsDir } from "../../common/paths.ts";
import { DEFAULT_OLLAMA_ENDPOINT } from "../../common/config/types.ts";
import { http } from "../../common/http-client.ts";
import { log } from "../api/log.ts";
import { VERSION } from "../../version.ts";
import {
  type BootstrapManifest,
  getOllamaModelManifestPath,
  matchesPinnedFallbackIdentity,
  LOCAL_FALLBACK_MODEL,
  readOllamaModelManifest,
  writeBootstrapManifest,
} from "./bootstrap-manifest.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaterializeProgress {
  phase: "extract" | "start_engine" | "pull_model" | "hash" | "done";
  message: string;
  /** 0-100 for pull_model phase, undefined otherwise. */
  percent?: number;
}

export interface MaterializeOptions {
  onProgress?: (progress: MaterializeProgress) => void;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function hashFile(path: string): Promise<string> {
  const bytes = await getPlatform().fs.readFile(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Core: extract engine (delegates to ai-runtime's extractAIEngine)
// ---------------------------------------------------------------------------

async function ensureEngine(
  onProgress?: MaterializeOptions["onProgress"],
): Promise<string> {
  onProgress?.({ phase: "extract", message: "Extracting AI engine..." });

  // Dynamic import to break circular dependency with ai-runtime.ts
  const { extractAIEngine, resolveEmbeddedEnginePath } = await import("./ai-runtime.ts");
  await extractAIEngine();

  const enginePath = await resolveEmbeddedEnginePath();
  if (!enginePath) {
    throw new Error("Failed to extract embedded AI engine — no valid binary found.");
  }
  return enginePath;
}

// ---------------------------------------------------------------------------
// Core: start engine with HLVM-owned model store
// ---------------------------------------------------------------------------

async function startEngineForBootstrap(
  enginePath: string,
  onProgress?: MaterializeOptions["onProgress"],
): Promise<PlatformCommandProcess | null> {
  onProgress?.({ phase: "start_engine", message: "Starting AI engine..." });

  const modelsDir = getModelsDir();
  await getPlatform().fs.mkdir(modelsDir, { recursive: true });
  const {
    buildAIEngineEnvironment,
    getAIEngineBinaryVersion,
    isCompatibleAIRunning,
    reclaimConflictingAIEndpoint,
    waitForAIEngineReady,
  } = await import("./ai-runtime.ts");
  const expectedVersion = await getAIEngineBinaryVersion(enginePath);

  if (await isCompatibleAIRunning(expectedVersion ?? undefined)) {
    onProgress?.({
      phase: "start_engine",
      message: "Using existing compatible AI engine on the HLVM endpoint.",
    });
    return null;
  }

  await reclaimConflictingAIEndpoint(expectedVersion ?? undefined);

  const proc = getPlatform().command.run({
    cmd: [enginePath, "serve"],
    stdout: "null",
    stderr: "null",
    env: buildAIEngineEnvironment(enginePath),
  });

  if (!(await waitForAIEngineReady(expectedVersion ?? undefined))) {
    try { proc.kill?.("SIGTERM"); } catch { /* best-effort */ }
    throw new Error("AI engine did not become ready within timeout.");
  }

  return proc;
}

// ---------------------------------------------------------------------------
// Core: pull model
// ---------------------------------------------------------------------------

async function pullModel(
  modelId: string,
  options?: MaterializeOptions,
): Promise<void> {
  options?.onProgress?.({
    phase: "pull_model",
    message: `Pulling ${modelId}...`,
    percent: 0,
  });

  const response = await http.fetchRaw(`${DEFAULT_OLLAMA_ENDPOINT}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: modelId, stream: true }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Model pull failed (${response.status}): ${body}`);
  }

  // Stream NDJSON progress
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    if (options?.signal?.aborted) {
      reader.cancel();
      throw new Error("Bootstrap cancelled.");
    }

    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        if (evt.total && evt.completed) {
          const percent = Math.round((evt.completed / evt.total) * 100);
          options?.onProgress?.({
            phase: "pull_model",
            message: evt.status ?? `Pulling ${modelId}...`,
            percent,
          });
        }
        if (evt.error) {
          throw new Error(`Ollama pull error: ${evt.error}`);
        }
      } catch (e) {
        if ((e as Error).message?.startsWith("Ollama pull error")) throw e;
        // ignore parse errors on partial lines
      }
    }
  }

  options?.onProgress?.({
    phase: "pull_model",
    message: `${modelId} ready.`,
    percent: 100,
  });
}

async function ensurePinnedFallbackModel(
  options?: MaterializeOptions,
): Promise<NonNullable<Awaited<ReturnType<typeof readOllamaModelManifest>>>> {
  const modelsDir = getModelsDir();
  const ollamaManifestPath = getOllamaModelManifestPath(modelsDir, LOCAL_FALLBACK_MODEL);
  const existingManifest = await readOllamaModelManifest(ollamaManifestPath);

  if (existingManifest && matchesPinnedFallbackIdentity(existingManifest)) {
    options?.onProgress?.({
      phase: "pull_model",
      message: `Using existing ${LOCAL_FALLBACK_MODEL} from the HLVM model store.`,
      percent: 100,
    });
    return existingManifest;
  }

  await pullModel(LOCAL_FALLBACK_MODEL, options);

  const pulledManifest = await readOllamaModelManifest(ollamaManifestPath);
  if (!pulledManifest || !matchesPinnedFallbackIdentity(pulledManifest)) {
    throw new Error(
      `Pulled ${LOCAL_FALLBACK_MODEL}, but the saved Ollama manifest did not ` +
      `match the pinned fallback identity at ${ollamaManifestPath}.`,
    );
  }

  return pulledManifest;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Full bootstrap materialization:
 * 1. Extract AI engine
 * 2. Start engine with HLVM-owned model dir
 * 3. Adopt existing pinned fallback or pull it once
 * 4. Hash engine + model blobs
 * 5. Write manifest
 */
export async function materializeBootstrap(
  options?: MaterializeOptions,
): Promise<BootstrapManifest> {
  await ensureRuntimeDir();

  // 1. Extract engine
  const enginePath = await ensureEngine(options?.onProgress);

  // 2. Start engine
  let proc: PlatformCommandProcess | null = null;
  try {
    proc = await startEngineForBootstrap(enginePath, options?.onProgress);

    // 3. Adopt existing pinned model or pull it once.
    const ollamaManifest = await ensurePinnedFallbackModel(options);

    // 4. Hash — read Ollama's own model manifest for authoritative digest + size
    options?.onProgress?.({ phase: "hash", message: "Computing integrity hashes..." });
    const engineHash = await hashFile(enginePath);

    const modelHash = ollamaManifest.digest;
    const modelSize = ollamaManifest.totalSize;

    // 5. Write manifest
    const now = new Date().toISOString();
    const manifest: BootstrapManifest = {
      state: "verified",
      engine: { adapter: "ollama", path: enginePath, hash: engineHash },
      models: [{
        modelId: LOCAL_FALLBACK_MODEL,
        size: modelSize,
        hash: modelHash,
      }],
      buildId: VERSION ?? "dev",
      createdAt: now,
      lastVerifiedAt: now,
    };

    await writeBootstrapManifest(manifest);

    options?.onProgress?.({ phase: "done", message: "Bootstrap complete." });
    return manifest;
  } finally {
    // Kill the bootstrap engine process — the normal runtime lifecycle will
    // start its own engine via `initAIRuntime()`.
    try { proc?.kill?.("SIGTERM"); } catch { /* best-effort */ }
  }
}

/**
 * Pull just the fallback model (assumes the engine is already running).
 */
export async function materializeFallbackModel(
  options?: MaterializeOptions,
): Promise<void> {
  await ensurePinnedFallbackModel(options);
}
