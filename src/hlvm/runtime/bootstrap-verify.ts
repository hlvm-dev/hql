/**
 * Bootstrap verification — checks that the managed engine, fallback model,
 * and Python sidecar runtime exist and match the recorded manifest state.
 */

import { getPlatform } from "../../platform/platform.ts";
import { getModelsDir } from "../../common/paths.ts";
import { log } from "../api/log.ts";
import {
  findAvailableLocalFallbackModel,
  type BootstrapManifest,
  type BootstrapState,
  findOllamaModelManifest,
  getKnownLocalFallbackIdentity,
  LOCAL_FALLBACK_MODEL,
  matchesFallbackIdentity,
  matchesPinnedFallbackIdentity,
  readBootstrapManifest,
} from "./bootstrap-manifest.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BootstrapVerificationResult {
  /** Resolved state after verification. */
  state: BootstrapState;
  /** True when both engine and model are present and hashes match. */
  engineOk: boolean;
  modelOk: boolean;
  /** True when the managed Python runtime and default sidecar pack are present and verified. */
  pythonOk: boolean;
  /** True when Chromium is present and hash matches (optional — false if not in manifest). */
  browserOk: boolean;
  /** Human-readable summary. */
  message: string;
  /** The manifest that was checked (null if missing). */
  manifest: BootstrapManifest | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
  try {
    await getPlatform().fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compute SHA-256 hex digest of a file.
 * Uses the Web Crypto API (available in Deno and modern runtimes).
 */
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Full verification: reads the manifest, checks existence and hashes of the
 * engine binary, model blobs, and managed Python sidecar runtime.
 */
export async function verifyBootstrap(): Promise<BootstrapVerificationResult> {
  const manifest = await readBootstrapManifest();

  if (!manifest) {
    return {
      state: "uninitialized",
      engineOk: false,
      modelOk: false,
      pythonOk: false,
      browserOk: false,
      message: "No bootstrap manifest found.",
      manifest: null,
    };
  }

  // --- Engine ---
  let engineOk = false;
  if (await fileExists(manifest.engine.path)) {
    try {
      const hash = await hashFile(manifest.engine.path);
      engineOk = hash === manifest.engine.hash;
      if (!engineOk) {
        log.debug?.(`Engine hash mismatch — expected ${manifest.engine.hash}, got ${hash}`);
      }
    } catch (err) {
      log.debug?.(`Engine hash check failed: ${(err as Error).message}`);
    }
  }

  // --- Model ---
  let modelOk = false;
  const modelsDir = getModelsDir();
  if (manifest.models.length > 0 && await fileExists(modelsDir)) {
    // Verify each model by reading Ollama's on-disk manifest and comparing
    // the digest against what we recorded during materialization.
    modelOk = true;
    for (const m of manifest.models) {
      if (!m.hash || !m.size) {
        log.debug?.(
          `Model ${m.modelId}: manifest record has empty hash or zero size`,
        );
        modelOk = false;
        break;
      }
      const resolvedManifest = await findOllamaModelManifest(
        modelsDir,
        m.modelId,
      );
      if (!resolvedManifest) {
        log.debug?.(
          `Model ${m.modelId}: Ollama manifest not found anywhere under ${modelsDir}`,
        );
        modelOk = false;
        break;
      }
      const ollamaManifest = resolvedManifest.manifest;
      const fallbackIdentity = getKnownLocalFallbackIdentity(m.modelId);
      if (fallbackIdentity) {
        if (!matchesFallbackIdentity(ollamaManifest, fallbackIdentity)) {
          log.debug?.(
            `Model ${m.modelId}: does not match a known fallback identity`,
          );
          modelOk = false;
          break;
        }
      } else if (
        m.modelId === LOCAL_FALLBACK_MODEL &&
        !matchesPinnedFallbackIdentity(ollamaManifest)
      ) {
        log.debug?.(
          `Model ${m.modelId}: does not match the pinned fallback identity`,
        );
        modelOk = false;
        break;
      }
      if (ollamaManifest.digest !== m.hash) {
        log.debug?.(
          `Model ${m.modelId}: digest mismatch — ` +
            `expected ${m.hash}, got ${ollamaManifest.digest}`,
        );
        modelOk = false;
        break;
      }
      if (ollamaManifest.totalSize !== m.size) {
        log.debug?.(
          `Model ${m.modelId}: size mismatch — ` +
            `expected ${m.size}, got ${ollamaManifest.totalSize}`,
        );
        modelOk = false;
        break;
      }
    }
  }

  let pythonOk = false;
  if (manifest.python) {
    try {
      const { verifyManagedPythonEnvironment } = await import(
        "./python-runtime.ts"
      );
      pythonOk = await verifyManagedPythonEnvironment(manifest.python);
      if (!pythonOk) {
        log.debug?.("Managed Python runtime verification failed.");
      }
    } catch (err) {
      log.debug?.(
        `Managed Python runtime verification failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      pythonOk = false;
    }
  }

  // --- Browser (optional — Chromium for Playwright) ---
  let browserOk = true; // default true if no browsers in manifest (optional)
  if (manifest.browsers?.length) {
    for (const b of manifest.browsers) {
      if (!await fileExists(b.path)) {
        log.debug?.(`Browser ${b.browser}: binary not found at ${b.path}`);
        browserOk = false;
        break;
      }
      try {
        const hash = await hashFile(b.path);
        if (hash !== b.hash) {
          log.debug?.(
            `Browser ${b.browser}: hash mismatch — expected ${b.hash}, got ${hash}`,
          );
          browserOk = false;
          break;
        }
      } catch (err) {
        log.debug?.(`Browser ${b.browser}: hash check failed: ${(err as Error).message}`);
        browserOk = false;
        break;
      }
    }
  }

  // Engine + model are required; browser is optional (degraded, not broken)
  const state: BootstrapState = engineOk && modelOk && pythonOk
    ? "verified"
    : "degraded";

  const parts: string[] = [];
  if (!engineOk) parts.push("engine missing or corrupt");
  if (!modelOk) parts.push("fallback model missing or corrupt");
  if (!pythonOk) {
    parts.push("managed Python runtime missing or corrupt");
  }
  if (!browserOk) parts.push("Chromium missing or corrupt (browser automation unavailable)");
  const message = parts.length === 0
    ? "Bootstrap verified."
    : `Bootstrap degraded: ${parts.join("; ")}.`;

  return { state, engineOk, modelOk, pythonOk, browserOk, message, manifest };
}

/**
 * Check whether the fallback model is actually available by verifying that
 * Ollama's on-disk model manifest exists and has a valid digest.
 * More reliable than just checking if the models directory is non-empty.
 */
export async function isFallbackModelAvailable(
  modelId = LOCAL_FALLBACK_MODEL,
): Promise<boolean> {
  try {
    const modelsDir = getModelsDir();
    const resolvedModelId = modelId === LOCAL_FALLBACK_MODEL
      ? await findAvailableLocalFallbackModel(modelsDir) ?? modelId
      : modelId;
    const manifest = await findOllamaModelManifest(modelsDir, resolvedModelId);
    const fallbackIdentity = getKnownLocalFallbackIdentity(resolvedModelId);
    if (fallbackIdentity) {
      return matchesFallbackIdentity(manifest?.manifest ?? null, fallbackIdentity);
    }
    return matchesPinnedFallbackIdentity(manifest?.manifest ?? null);
  } catch {
    return false;
  }
}
