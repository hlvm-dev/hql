/**
 * Bootstrap verification — checks that the AI engine binary and fallback
 * model blobs exist and match the recorded manifest hashes.
 */

import { getPlatform } from "../../platform/platform.ts";
import { getModelsDir } from "../../common/paths.ts";
import { log } from "../api/log.ts";
import {
  type BootstrapManifest,
  type BootstrapState,
  findOllamaModelManifest,
  LOCAL_FALLBACK_MODEL,
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
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Full verification: reads the manifest, checks existence and hashes of the
 * engine binary and model blobs.
 */
export async function verifyBootstrap(): Promise<BootstrapVerificationResult> {
  const manifest = await readBootstrapManifest();

  if (!manifest) {
    return {
      state: "uninitialized",
      engineOk: false,
      modelOk: false,
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
        log.debug?.(
          "Engine hash mismatch — expected " +
            manifest.engine.hash + ", got " + hash,
        );
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
      if (
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

  const state: BootstrapState = engineOk && modelOk ? "verified" : "degraded";

  const parts: string[] = [];
  if (!engineOk) parts.push("engine missing or corrupt");
  if (!modelOk) parts.push("fallback model missing or corrupt");
  const message = parts.length === 0
    ? "Bootstrap verified."
    : `Bootstrap degraded: ${parts.join("; ")}.`;

  return { state, engineOk, modelOk, message, manifest };
}

/**
 * Check whether the fallback model is actually available by verifying that
 * Ollama's on-disk model manifest exists and has a valid digest.
 * More reliable than just checking if the models directory is non-empty.
 */
export async function isFallbackModelAvailable(): Promise<boolean> {
  try {
    const modelsDir = getModelsDir();
    const manifest = await findOllamaModelManifest(
      modelsDir,
      LOCAL_FALLBACK_MODEL,
    );
    return matchesPinnedFallbackIdentity(manifest?.manifest ?? null);
  } catch {
    return false;
  }
}
