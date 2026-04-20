/**
 * Bootstrap materialization — prepares the HLVM-owned engine, fallback model,
 * Python sidecar runtime, and runtime manifest.
 *
 * During install / `hlvm bootstrap`, the HLVM runtime host may not be running,
 * so this module talks directly to the embedded Ollama engine via HTTP.
 */

import {
  getPlatform,
  type PlatformCommandProcess,
} from "../../platform/platform.ts";
import { ensureRuntimeDir, getModelsDir } from "../../common/paths.ts";
import {
  DEFAULT_OLLAMA_ENDPOINT,
} from "../../common/config/types.ts";
import { http } from "../../common/http-client.ts";
import { log } from "../api/log.ts";
import { VERSION } from "../../common/version.ts";
import {
  type BootstrapManifest,
  findOllamaModelManifest,
  getOllamaModelManifestPath,
  matchesPinnedFallbackIdentity,
  type OllamaModelManifestInfo,
  writeBootstrapManifest,
} from "./bootstrap-manifest.ts";
import { getKnownLocalFallbackIdentity, matchesFallbackIdentity } from "./bootstrap-manifest.ts";
import { selectBootstrapModelForHost } from "./bootstrap-model-selection.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaterializeProgress {
  phase:
    | "extract"
    | "install_python"
    | "start_engine"
    | "pull_model"
    | "hash"
    | "done";
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
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
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
  onProgress?.({ phase: "extract", message: "Downloading AI engine..." });

  // Dynamic import to break circular dependency with ai-runtime.ts
  const { downloadAIEngineIfNeeded, resolveEmbeddedEnginePath } = await import(
    "./ai-runtime.ts"
  );
  await downloadAIEngineIfNeeded();

  const enginePath = await resolveEmbeddedEnginePath();
  if (!enginePath) {
    throw new Error(
      "Failed to download AI engine — no valid binary found after download.",
    );
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
    try {
      proc.kill?.("SIGTERM");
    } catch { /* best-effort */ }
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
  modelId: string,
  options?: MaterializeOptions,
): Promise<OllamaModelManifestInfo> {
  const modelsDir = getModelsDir();
  const ollamaManifestPath = getOllamaModelManifestPath(
    modelsDir,
    modelId,
  );
  const existingManifest = await findOllamaModelManifest(
    modelsDir,
    modelId,
  );
  const fallbackIdentity = getKnownLocalFallbackIdentity(modelId);
  const matchesRequestedIdentity = (manifest: OllamaModelManifestInfo | null) =>
    fallbackIdentity
      ? matchesFallbackIdentity(manifest, fallbackIdentity)
      : matchesPinnedFallbackIdentity(manifest);

  if (
    existingManifest && matchesRequestedIdentity(existingManifest.manifest)
  ) {
    options?.onProgress?.({
      phase: "pull_model",
      message:
        `Using existing ${modelId} from the HLVM model store.`,
      percent: 100,
    });
    return existingManifest.manifest;
  }

  // If the model is already present (e.g. from a previous bootstrap),
  // the existingManifest check above should have already returned.
  // Fall back to a network pull.
  await pullModel(modelId, options);

  const pulledManifest = await findOllamaModelManifest(
    modelsDir,
    modelId,
  );
  if (!pulledManifest || !matchesRequestedIdentity(pulledManifest.manifest)) {
    throw new Error(
      `Pulled ${modelId}, but the saved Ollama manifest did not ` +
        `match the pinned fallback identity at ${
          pulledManifest?.path ?? ollamaManifestPath
        }.`,
    );
  }

  return pulledManifest.manifest;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Full bootstrap materialization:
 * 1.   Download AI engine (if not already present)
 * 1.5. Download Chromium (if not already present)
 * 1.6. Install the managed Python sidecar runtime and default package pack
 * 2.   Start engine with HLVM-owned model dir
 * 3.   Adopt existing pinned fallback or pull it once
 * 4.   Hash engine + model blobs
 * 5.   Write manifest
 */
export async function materializeBootstrap(
  options?: MaterializeOptions,
): Promise<BootstrapManifest> {
  await ensureRuntimeDir();
  const selectedModel = await selectBootstrapModelForHost();
  const selectedModelId = selectedModel.modelId;

  // 1. Extract engine
  const enginePath = await ensureEngine(options?.onProgress);

  // 1.5. Chromium: download via playwright-core
  let chromiumPath: string | null = null;
  let chromiumHash: string | null = null;
  let python: BootstrapManifest["python"];
  try {
    const {
      downloadChromium,
      resolveChromiumExecutablePath, hashChromiumBinary,
    } = await import("./chromium-runtime.ts");

    chromiumPath = await resolveChromiumExecutablePath();
    if (!chromiumPath) {
      options?.onProgress?.({
        phase: "extract",
        message: "Downloading Chromium (~200 MB)...",
      });
      await downloadChromium((message) => {
        options?.onProgress?.({ phase: "extract", message });
      });
      chromiumPath = await resolveChromiumExecutablePath();
    }
    if (chromiumPath) {
      chromiumHash = await hashChromiumBinary();
    }
  } catch (err) {
    // Chromium is optional — bootstrap succeeds without it
    log.debug?.(
      `[bootstrap] Chromium setup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  options?.onProgress?.({
    phase: "install_python",
    message: "Installing managed Python runtime...",
  });
  python = await (await import("./python-runtime.ts")).ensureManagedPythonEnvironment(
    (message) => {
      options?.onProgress?.({ phase: "install_python", message });
    },
  );

  // 2. Start engine
  let proc: PlatformCommandProcess | null = null;
  try {
    proc = await startEngineForBootstrap(enginePath, options?.onProgress);

    // 3. Adopt existing pinned model or pull it once.
    const ollamaManifest = await ensurePinnedFallbackModel(
      selectedModelId,
      options,
    );

    // 4. Hash — read Ollama's own model manifest for authoritative digest + size
    options?.onProgress?.({
      phase: "hash",
      message: "Computing integrity hashes...",
    });
    const engineHash = await hashFile(enginePath);

    const modelHash = ollamaManifest.digest;
    const modelSize = ollamaManifest.totalSize;

    // 5. Write manifest
    const now = new Date().toISOString();
    const manifest: BootstrapManifest = {
      state: "verified",
      engine: { adapter: "ollama", path: enginePath, hash: engineHash },
      models: [{
        modelId: selectedModelId,
        size: modelSize,
        hash: modelHash,
      }],
      ...(chromiumPath && chromiumHash ? {
        browsers: [{
          browser: "chromium" as const,
          path: chromiumPath,
          hash: chromiumHash,
          revision: "playwright-core-1.59.1",
        }],
      } : {}),
      ...(python ? { python } : {}),
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
    try {
      proc?.kill?.("SIGTERM");
    } catch { /* best-effort */ }
  }
}

/**
 * Pull just the fallback model (assumes the engine is already running).
 */
export async function materializeFallbackModel(
  options?: MaterializeOptions,
): Promise<void> {
  const selectedModel = await selectBootstrapModelForHost();
  await ensurePinnedFallbackModel(selectedModel.modelId, options);
}
