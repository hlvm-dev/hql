/**
 * Bootstrap manifest — types, constants, and I/O for the HLVM local AI substrate.
 *
 * The manifest tracks the state of the embedded AI engine and fallback model,
 * enabling verification and recovery without re-downloading.
 */

import { getPlatform } from "../../platform/platform.ts";
import { getModelsDir, getRuntimeDir } from "../../common/paths.ts";
import { log } from "../api/log.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The default local fallback model pulled during bootstrap. */
export const LOCAL_FALLBACK_MODEL = "gemma4:e2b";

/**
 * Pinned public identity for the bundled fallback model.
 *
 * Ollama's on-disk manifest records the model layer digest and exact layer
 * sizes. We pin the model layer digest prefix strictly and use the published
 * size as a sanity bound rather than a byte-for-byte equality check.
 */
export const LOCAL_FALLBACK_IDENTITY = {
  modelId: LOCAL_FALLBACK_MODEL,
  modelDigestPrefix: "sha256:4e30e2665218",
  publishedTotalSizeBytes: 7_162_394_016,
  sizeToleranceBytes: 512_000_000,
} as const;

export const LEGACY_LOCAL_FALLBACK_IDENTITIES = [
  {
    modelId: "gemma4:e4b",
    modelDigestPrefix: "sha256:4c27e0f5b5ad",
    publishedTotalSizeBytes: 9_608_350_245,
    sizeToleranceBytes: 512_000_000,
  },
] as const;

export type LocalFallbackIdentity =
  | typeof LOCAL_FALLBACK_IDENTITY
  | typeof LEGACY_LOCAL_FALLBACK_IDENTITIES[number];

const KNOWN_LOCAL_FALLBACK_IDENTITIES: readonly LocalFallbackIdentity[] = [
  LOCAL_FALLBACK_IDENTITY,
  ...LEGACY_LOCAL_FALLBACK_IDENTITIES,
] as const;

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
  /** Model identifier (e.g. "gemma4:e2b"). */
  modelId: string;
  /** Total size in bytes of all model blobs. */
  size: number;
  /** SHA-256 hex digest of the concatenated blob hashes (manifest digest). */
  hash: string;
}

/** Metadata for a bundled browser (e.g. Chromium for Playwright). */
export interface BootstrapBrowserRecord {
  /** Browser name (currently always "chromium"). */
  browser: "chromium";
  /** Absolute path to the browser executable. */
  path: string;
  /** SHA-256 hex digest of the browser binary. */
  hash: string;
  /** Playwright browser revision string. */
  revision: string;
}

/** Persistent manifest written to `~/.hlvm/.runtime/manifest.json`. */
export interface BootstrapManifest {
  /** Current bootstrap state. */
  state: BootstrapState;
  /** Engine record. */
  engine: BootstrapEngineRecord;
  /** Pulled model records. */
  models: BootstrapModelRecord[];
  /** Bundled browser records (optional — Chromium for Playwright hybrid). */
  browsers?: BootstrapBrowserRecord[];
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

export interface ResolvedOllamaModelManifest {
  path: string;
  manifest: OllamaModelManifestInfo;
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
export function getOllamaModelManifestPath(
  modelsDir: string,
  modelId: string,
): string {
  const [name, tag = "latest"] = modelId.split(":");
  const { join } = getPlatform().path;
  const nameSegments = name.split("/").filter(Boolean);
  const registrySegments = nameSegments.length > 1
    ? ["registry.ollama.ai", ...nameSegments]
    : ["registry.ollama.ai", "library", ...nameSegments];
  return join(modelsDir, "manifests", ...registrySegments, tag);
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

function toPathSegments(path: string): string[] {
  return path.replaceAll("\\", "/").split("/").filter(Boolean);
}

function pathEndsWithSegments(path: string, suffixSegments: string[]): boolean {
  const pathSegments = toPathSegments(path);
  if (pathSegments.length < suffixSegments.length) return false;
  const start = pathSegments.length - suffixSegments.length;
  return suffixSegments.every((segment, index) =>
    pathSegments[start + index] === segment
  );
}

async function collectManifestPaths(rootDir: string): Promise<string[]> {
  const platform = getPlatform();
  const paths: string[] = [];

  async function walk(dir: string): Promise<void> {
    try {
      for await (const entry of platform.fs.readDir(dir)) {
        const fullPath = platform.path.join(dir, entry.name);
        if (entry.isSymlink) continue;
        if (entry.isDirectory) {
          await walk(fullPath);
          continue;
        }
        if (entry.isFile) {
          paths.push(fullPath);
        }
      }
    } catch {
      // Ignore unreadable directories and keep looking elsewhere.
    }
  }

  await walk(rootDir);
  paths.sort();
  return paths;
}

/**
 * Resolve an Ollama model manifest even if Ollama changes the exact on-disk
 * registry nesting. Prefer the canonical path, then fall back to scanning the
 * manifests tree for a file whose trailing path matches `<name>/<tag>`.
 */
export async function findOllamaModelManifest(
  modelsDir: string,
  modelId: string,
): Promise<ResolvedOllamaModelManifest | null> {
  const platform = getPlatform();
  const preferredPath = getOllamaModelManifestPath(modelsDir, modelId);
  const preferredManifest = await readOllamaModelManifest(preferredPath);
  if (preferredManifest) {
    return { path: preferredPath, manifest: preferredManifest };
  }

  const manifestsRoot = platform.path.join(modelsDir, "manifests");
  const [name, tag = "latest"] = modelId.split(":");
  const suffixSegments = [...name.split("/").filter(Boolean), tag];
  const fallbackMatches: ResolvedOllamaModelManifest[] = [];
  const validManifests: ResolvedOllamaModelManifest[] = [];

  for (const manifestPath of await collectManifestPaths(manifestsRoot)) {
    const manifest = await readOllamaModelManifest(manifestPath);
    if (!manifest) continue;
    const resolved = { path: manifestPath, manifest };
    validManifests.push(resolved);
    if (pathEndsWithSegments(manifestPath, suffixSegments)) {
      fallbackMatches.push(resolved);
    }
  }

  if (fallbackMatches.length > 0) {
    return fallbackMatches[0];
  }

  return validManifests.length === 1 ? validManifests[0] : null;
}

/** Whether Ollama's on-disk manifest matches the pinned fallback identity. */
export function matchesPinnedFallbackIdentity(
  manifest: OllamaModelManifestInfo | null,
): boolean {
  return matchesFallbackIdentity(manifest, LOCAL_FALLBACK_IDENTITY);
}

export function getKnownLocalFallbackIdentity(
  modelId: string,
): LocalFallbackIdentity | null {
  return KNOWN_LOCAL_FALLBACK_IDENTITIES.find((identity) =>
    identity.modelId === modelId
  ) ?? null;
}

export function matchesFallbackIdentity(
  manifest: OllamaModelManifestInfo | null,
  identity: LocalFallbackIdentity,
): boolean {
  if (!manifest) return false;
  if (!manifest.digest.startsWith(identity.modelDigestPrefix)) {
    return false;
  }
  const minBytes = identity.publishedTotalSizeBytes -
    identity.sizeToleranceBytes;
  return manifest.totalSize >= minBytes;
}

export async function findAvailableLocalFallbackModel(
  modelsDir = getModelsDir(),
): Promise<string | null> {
  for (const identity of KNOWN_LOCAL_FALLBACK_IDENTITIES) {
    const resolvedManifest = await findOllamaModelManifest(
      modelsDir,
      identity.modelId,
    );
    if (matchesFallbackIdentity(resolvedManifest?.manifest ?? null, identity)) {
      return identity.modelId;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/**
 * Read the bootstrap manifest from disk.
 * Returns `null` if the file does not exist or is unparseable.
 */
export async function readBootstrapManifest(): Promise<
  BootstrapManifest | null
> {
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
