/**
 * Bootstrap manifest — types, constants, and I/O for the HLVM local AI substrate.
 *
 * The manifest tracks the state of the embedded AI engine and fallback model,
 * enabling verification and recovery without re-downloading.
 */

import { getPlatform } from "../../platform/platform.ts";
import { getRuntimeDir } from "../../common/paths.ts";
import { log } from "../api/log.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The default local fallback model pulled during bootstrap. */
export const LOCAL_FALLBACK_MODEL = "gemma4:e4b";

/**
 * Pinned public identity for the bundled fallback model.
 *
 * Ollama's on-disk manifest records the model layer digest and exact layer
 * sizes. We pin the model layer digest prefix strictly and use the published
 * 9.6 GB size as a sanity bound rather than a byte-for-byte equality check.
 */
export const LOCAL_FALLBACK_IDENTITY = {
  modelId: LOCAL_FALLBACK_MODEL,
  modelDigestPrefix: "sha256:4c27e0f5b5ad",
  publishedTotalSizeBytes: 9_600_000_000,
  sizeToleranceBytes: 512_000_000,
} as const;

/** Filename for the manifest inside the runtime directory. */
const MANIFEST_FILENAME = "manifest.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Overall state of the bootstrap substrate. */
export type BootstrapState = "uninitialized" | "verified" | "degraded";

/** Metadata for the embedded AI engine binary. */
export interface BootstrapEngineRecord {
  /** Adapter name (currently always "ollama"). */
  adapter: string;
  /** Absolute path to the engine binary. */
  path: string;
  /** SHA-256 hex digest of the engine binary. */
  hash: string;
}

/** Metadata for a single model in the bootstrap store. */
export interface BootstrapModelRecord {
  /** Model identifier (e.g. "gemma4:e4b"). */
  modelId: string;
  /** Total size in bytes of all model blobs. */
  size: number;
  /** SHA-256 hex digest of the concatenated blob hashes (manifest digest). */
  hash: string;
}

/** Persistent manifest written to `~/.hlvm/.runtime/manifest.json`. */
export interface BootstrapManifest {
  /** Current bootstrap state. */
  state: BootstrapState;
  /** Engine record. */
  engine: BootstrapEngineRecord;
  /** Pulled model records. */
  models: BootstrapModelRecord[];
  /** HLVM build identifier that created this manifest. */
  buildId: string;
  /** ISO-8601 timestamp when the manifest was first written. */
  createdAt: string;
  /** ISO-8601 timestamp of the last successful verification. */
  lastVerifiedAt: string;
}

export interface OllamaModelManifestInfo {
  digest: string;
  totalSize: number;
}

// ---------------------------------------------------------------------------
// Manifest path
// ---------------------------------------------------------------------------

/** Absolute path to the bootstrap manifest file. */
export function getManifestPath(): string {
  const { join } = getPlatform().path;
  return join(getRuntimeDir(), MANIFEST_FILENAME);
}

// ---------------------------------------------------------------------------
// Ollama model manifest path
// ---------------------------------------------------------------------------

/**
 * Returns the path where Ollama writes its model manifest after a pull.
 * Ollama stores manifests at: `<models>/manifests/registry.ollama.ai/library/<name>/<tag>`
 */
export function getOllamaModelManifestPath(modelsDir: string, modelId: string): string {
  const [name, tag = "latest"] = modelId.split(":");
  const { join } = getPlatform().path;
  return join(modelsDir, "manifests", "registry.ollama.ai", "library", name, tag);
}

/**
 * Parse an Ollama model manifest file. Returns `{ digest, totalSize }` or null.
 * Ollama manifests store the model identity on the `application/vnd.ollama.image.model`
 * layer, not on a top-level `digest` field.
 */
export async function readOllamaModelManifest(
  manifestPath: string,
): Promise<OllamaModelManifestInfo | null> {
  try {
    const raw = await getPlatform().fs.readTextFile(manifestPath);
    const data = JSON.parse(raw);
    let digest = "";
    let totalSize = 0;
    if (Array.isArray(data?.layers)) {
      for (const layer of data.layers) {
        totalSize += layer?.size ?? 0;
        if (
          !digest &&
          layer?.mediaType === "application/vnd.ollama.image.model" &&
          typeof layer?.digest === "string"
        ) {
          digest = layer.digest;
        }
      }
    }
    if (!digest) return null;
    return { digest, totalSize };
  } catch {
    return null;
  }
}

/** Whether Ollama's on-disk manifest matches the pinned fallback identity. */
export function matchesPinnedFallbackIdentity(
  manifest: OllamaModelManifestInfo | null,
): boolean {
  if (!manifest) return false;
  if (!manifest.digest.startsWith(LOCAL_FALLBACK_IDENTITY.modelDigestPrefix)) {
    return false;
  }
  const minBytes = LOCAL_FALLBACK_IDENTITY.publishedTotalSizeBytes -
    LOCAL_FALLBACK_IDENTITY.sizeToleranceBytes;
  return manifest.totalSize >= minBytes;
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/**
 * Read the bootstrap manifest from disk.
 * Returns `null` if the file does not exist or is unparseable.
 */
export async function readBootstrapManifest(): Promise<BootstrapManifest | null> {
  const fs = getPlatform().fs;
  try {
    const raw = await fs.readTextFile(getManifestPath());
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.state) return null;
    return parsed as BootstrapManifest;
  } catch {
    return null;
  }
}

/**
 * Write the bootstrap manifest to disk atomically.
 * Creates the runtime directory if it does not exist.
 */
export async function writeBootstrapManifest(
  manifest: BootstrapManifest,
): Promise<void> {
  const fs = getPlatform().fs;
  const manifestPath = getManifestPath();
  const dir = getPlatform().path.dirname(manifestPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeTextFile(manifestPath, JSON.stringify(manifest, null, 2));
  log.debug?.(`Bootstrap manifest written to ${manifestPath}`);
}
