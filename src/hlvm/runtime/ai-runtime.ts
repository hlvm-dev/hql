/**
 * AI Runtime Manager for HLVM
 *
 * Handles download and lifecycle of the Ollama AI engine.
 * At bootstrap time, downloads the pinned Ollama version from GitHub releases.
 * Exports an AIEngineLifecycle interface so consumers depend on abstraction,
 * not the concrete runtime bootstrap details.
 *
 * SSOT: Uses ai.status() from the API module directly - no fallback fetch.
 */

import { delay } from "@std/async";
import { RuntimeError } from "../../common/error.ts";
import { HLVMErrorCode } from "../../common/error-codes.ts";
import { ai } from "../api/ai.ts";
import { log } from "../api/log.ts";
import {
  ensureRuntimeDir,
  getModelsDir,
  getRuntimeDir,
} from "../../common/paths.ts";
import {
  getPlatform,
  type PlatformCommandProcess,
} from "../../platform/platform.ts";
import {
  DEFAULT_OLLAMA_ENDPOINT,
  DEFAULT_OLLAMA_HOST,
} from "../../common/config/types.ts";
import { http } from "../../common/http-client.ts";
import {
  findListeningPidForPort,
  terminateProcess,
} from "./port-process.ts";

const textDecoder = new TextDecoder();

// ============================================================================
// Interface — consumers depend on this, not concrete internals
// ============================================================================

/** Abstraction for AI engine lifecycle operations. */
export interface AIEngineLifecycle {
  /** Check if the engine daemon is reachable. */
  isRunning(): Promise<boolean>;
  /** Ensure the engine is extracted (if embedded) and running. Returns success. */
  ensureRunning(): Promise<boolean>;
  /** Get the path to the embedded engine binary. */
  getEnginePath(): Promise<string>;
}

// ============================================================================
// Private implementation
// ============================================================================

const AI_STARTUP_POLL_INTERVAL_MS = 300;
const AI_STARTUP_TIMEOUT_MS = 60_000;
const AI_STARTUP_MAX_POLLS = Math.ceil(
  AI_STARTUP_TIMEOUT_MS / AI_STARTUP_POLL_INTERVAL_MS,
);
let initPromise: Promise<void> | null = null;

function normalizeCommandOutput(output: {
  stdout: Uint8Array;
  stderr: Uint8Array;
}): string {
  const stdout = textDecoder.decode(output.stdout).trim();
  const stderr = textDecoder.decode(output.stderr).trim();
  return [stdout, stderr].filter(Boolean).join("\n");
}

function parseOllamaVersion(output: string): string | null {
  const clientMatch = output.match(
    /client version is\s+([0-9]+\.[0-9]+\.[0-9]+)/i,
  );
  if (clientMatch?.[1]) {
    return clientMatch[1];
  }
  const serverMatch = output.match(
    /ollama version is\s+([0-9]+\.[0-9]+\.[0-9]+)/i,
  );
  if (serverMatch?.[1]) {
    return serverMatch[1];
  }
  return null;
}

function getEmbeddedEngineDir(platform = getPlatform()): string {
  return platform.path.join(getRuntimeDir(), "engine");
}

function getEmbeddedEngineBinaryRelativePath(platform = getPlatform()): string {
  if (platform.build.os === "windows") {
    return "ollama.exe";
  }
  if (platform.build.os === "linux") {
    return "bin/ollama";
  }
  return "ollama";
}

function getEmbeddedEnginePath(platform = getPlatform()): string {
  const relativeBinaryPath = getEmbeddedEngineBinaryRelativePath(platform)
    .split("/");
  return platform.path.join(
    getEmbeddedEngineDir(platform),
    ...relativeBinaryPath,
  );
}

function normalizeFsPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function getEmbeddedEngineRootFromBinaryPath(
  enginePath: string,
  platform = getPlatform(),
): string {
  const relativeBinaryPath = getEmbeddedEngineBinaryRelativePath(platform);
  if (relativeBinaryPath.includes("/")) {
    const normalizedEnginePath = normalizeFsPath(enginePath);
    if (normalizedEnginePath.endsWith(`/${relativeBinaryPath}`)) {
      let root = enginePath;
      for (let i = 0; i < relativeBinaryPath.split("/").length; i++) {
        root = platform.path.dirname(root);
      }
      return root;
    }
  }
  return platform.path.dirname(enginePath);
}

function prependPathEntries(
  entries: string[],
  existingValue: string | undefined,
  separator: string,
): string {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (
    const entry of [
      ...entries,
      ...(existingValue ? existingValue.split(separator) : []),
    ]
  ) {
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    ordered.push(entry);
  }

  return ordered.join(separator);
}

async function describeInvalidEngine(
  candidatePath: string,
  platform = getPlatform(),
): Promise<string | null> {
  try {
    const stat = await platform.fs.stat(candidatePath);
    if (!stat.isFile) {
      return "engine path is not a file";
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "unknown validation error";
  }
}

async function removeEmbeddedEngine(
  reason: string,
  platform = getPlatform(),
): Promise<void> {
  const embeddedEngineDir = getEmbeddedEngineDir(platform);
  if (!await platform.fs.exists(embeddedEngineDir)) {
    return;
  }

  try {
    await platform.fs.remove(embeddedEngineDir, { recursive: true });
    log.debug?.(
      `Discarded cached AI engine at ${embeddedEngineDir}: ${reason}`,
    );
  } catch (error) {
    log.debug?.(
      `Failed to remove cached AI engine at ${embeddedEngineDir}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function resolveEmbeddedEnginePath(
  platform = getPlatform(),
): Promise<string | null> {
  const embeddedEnginePath = getEmbeddedEnginePath(platform);
  if (!await platform.fs.exists(embeddedEnginePath)) {
    return null;
  }

  try {
    if (await matchesSelfBinarySize(embeddedEnginePath, platform)) {
      await removeEmbeddedEngine(
        "binary matches the current HLVM executable",
        platform,
      );
      return null;
    }
  } catch {
    // Best-effort guard only.
  }

  const invalidReason = await describeInvalidEngine(
    embeddedEnginePath,
    platform,
  );
  if (invalidReason) {
    log.warn?.(`Discarding extracted embedded AI engine: ${invalidReason}`);
    await removeEmbeddedEngine(invalidReason, platform);
    return null;
  }

  return embeddedEnginePath;
}

export function buildAIEngineEnvironment(
  enginePath: string,
  platform = getPlatform(),
): Record<string, string> {
  const env: Record<string, string> = {
    OLLAMA_HOST: DEFAULT_OLLAMA_HOST,
    OLLAMA_MODELS: getModelsDir(),
  };

  const engineDir = platform.path.dirname(enginePath);
  const pathSeparator = platform.build.os === "windows" ? ";" : ":";
  env.PATH = prependPathEntries(
    [engineDir],
    platform.env.get("PATH"),
    pathSeparator,
  );

  if (platform.build.os === "darwin") {
    env.DYLD_LIBRARY_PATH = prependPathEntries(
      [engineDir],
      platform.env.get("DYLD_LIBRARY_PATH"),
      pathSeparator,
    );
  } else if (platform.build.os === "linux") {
    const engineRoot = getEmbeddedEngineRootFromBinaryPath(
      enginePath,
      platform,
    );
    env.LD_LIBRARY_PATH = prependPathEntries(
      [
        engineDir,
        platform.path.join(engineRoot, "lib"),
        platform.path.join(engineRoot, "lib", "ollama"),
      ],
      platform.env.get("LD_LIBRARY_PATH"),
      pathSeparator,
    );
  }

  return env;
}

async function isAIRunning(): Promise<boolean> {
  try {
    // Direct HTTP check to avoid depending on provider registry initialization order
    // This is more robust than ai.status() which may fail if providers aren't loaded yet
    const response = await http.fetchRaw(DEFAULT_OLLAMA_ENDPOINT, {
      timeout: 2000,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if a candidate engine binary has the same size as the HLVM CLI itself.
 * Same size means the binary was likely overwritten by the CLI → running it
 * would cause recursive spawning.
 */
async function matchesSelfBinarySize(
  candidatePath: string,
  platform = getPlatform(),
): Promise<boolean> {
  const execPath = platform.process.execPath?.();
  if (!execPath) return false;
  const [candidateInfo, selfInfo] = await Promise.all([
    platform.fs.stat(candidatePath).catch(() => null),
    platform.fs.stat(execPath).catch(() => null),
  ]);
  return !!(candidateInfo && selfInfo && candidateInfo.size === selfInfo.size);
}

// ============================================================================
// Engine download — downloads pinned Ollama from GitHub releases at bootstrap
// ============================================================================

/**
 * Read the pinned Ollama version from embedded-ollama-version.txt.
 * This file is baked into the binary at compile time via --include.
 */
async function readPinnedOllamaVersion(
  platform = getPlatform(),
): Promise<string> {
  const candidates = [
    // Compiled binary: resource is beside the entry point
    platform.path.fromFileUrl(
      new URL("../../../embedded-ollama-version.txt", import.meta.url),
    ),
    // Development: repo root
    platform.path.join(
      platform.path.fromFileUrl(new URL("../../../", import.meta.url)),
      "embedded-ollama-version.txt",
    ),
  ];

  for (const candidate of candidates) {
    try {
      const content = await platform.fs.readTextFile(candidate);
      const version = content.trim();
      if (version) return version;
    } catch {
      // Try next candidate
    }
  }

  throw new RuntimeError(
    "Could not read pinned Ollama version from embedded-ollama-version.txt. " +
      "This file must be baked into the binary at compile time.",
    { code: HLVMErrorCode.AI_ENGINE_STARTUP_FAILED },
  );
}

/**
 * Get the Ollama archive URL for the current platform.
 */
function getOllamaArchiveUrl(
  version: string,
  platform = getPlatform(),
): { url: string; archiveType: "tgz" | "tar.zst" | "zip" } {
  const base = `https://github.com/ollama/ollama/releases/download/${version}`;
  const os = platform.build.os;

  if (os === "darwin") {
    return { url: `${base}/ollama-darwin.tgz`, archiveType: "tgz" };
  }
  if (os === "linux") {
    // Ollama Linux releases use zstd-compressed tarballs
    return {
      url: `${base}/ollama-linux-amd64.tar.zst`,
      archiveType: "tar.zst",
    };
  }
  if (os === "windows") {
    return { url: `${base}/ollama-windows-amd64.zip`, archiveType: "zip" };
  }

  throw new RuntimeError(
    `Unsupported platform for Ollama download: ${os}`,
    { code: HLVMErrorCode.AI_ENGINE_STARTUP_FAILED },
  );
}

/**
 * Download and extract Ollama to ~/.hlvm/.runtime/engine/.
 */
async function downloadAndExtractOllama(
  url: string,
  archiveType: "tgz" | "tar.zst" | "zip",
  platform = getPlatform(),
): Promise<void> {
  const engineDir = getEmbeddedEngineDir(platform);
  const enginePath = getEmbeddedEnginePath(platform);
  await ensureRuntimeDir();
  await platform.fs.remove(engineDir, { recursive: true }).catch(() => {});
  await platform.fs.mkdir(engineDir, { recursive: true });

  const ext = archiveType === "tar.zst" ? "tar.zst" : archiveType;
  const tmpArchive = platform.path.join(engineDir, `ollama-archive.${ext}`);

  log.info?.(`Downloading Ollama from ${url}...`);
  const response = await http.fetchRaw(url, { timeout: 300_000 });
  if (!response.ok) {
    throw new RuntimeError(
      `Failed to download Ollama (${response.status}): ${url}`,
      { code: HLVMErrorCode.AI_ENGINE_STARTUP_FAILED },
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await platform.fs.writeFile(tmpArchive, bytes);

  log.info?.("Extracting Ollama archive...");
  let extractCmd: string[];
  if (archiveType === "tgz") {
    extractCmd = ["tar", "-xzf", tmpArchive, "-C", engineDir];
  } else if (archiveType === "tar.zst") {
    // zstd-compressed tarball (Linux). Try tar --zstd first (GNU tar),
    // fall back to piping through zstd if available.
    extractCmd = ["tar", "--zstd", "-xf", tmpArchive, "-C", engineDir];
  } else {
    extractCmd = ["unzip", "-qo", tmpArchive, "-d", engineDir];
  }

  let result = await platform.command.output({
    cmd: extractCmd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });

  // Fallback for tar.zst: if `tar --zstd` fails, try `zstd -dc | tar -xf -`
  if (!result.success && archiveType === "tar.zst") {
    log.debug?.("tar --zstd failed, trying zstd pipe fallback...");
    const fallbackCmd = [
      "sh",
      "-c",
      `zstd -dc "${tmpArchive}" | tar -xf - -C "${engineDir}"`,
    ];
    result = await platform.command.output({
      cmd: fallbackCmd,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
  }

  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new RuntimeError(
      `Failed to extract Ollama archive: ${stderr}`,
      { code: HLVMErrorCode.AI_ENGINE_STARTUP_FAILED },
    );
  }

  // Cleanup archive
  await platform.fs.remove(tmpArchive).catch(() => {});

  // Ensure executable
  await platform.fs.chmod(enginePath, 0o755).catch(() => {});

  if (!await resolveEmbeddedEnginePath(platform)) {
    throw new RuntimeError(
      "Downloaded Ollama binary failed validation after extraction.",
      { code: HLVMErrorCode.AI_ENGINE_STARTUP_FAILED },
    );
  }

  log.info?.(`Ollama installed to ${engineDir}`);
}

/**
 * Ensure the Ollama engine is available on disk.
 * If not already present, downloads the pinned version from GitHub releases.
 * This replaces the old extractAIEngine() which extracted from the binary.
 */
export async function downloadAIEngineIfNeeded(
  platform = getPlatform(),
): Promise<void> {
  if (await resolveEmbeddedEnginePath(platform)) {
    return;
  }

  const version = await readPinnedOllamaVersion(platform);
  const { url, archiveType } = getOllamaArchiveUrl(version, platform);
  await downloadAndExtractOllama(url, archiveType, platform);
}

// Keep backward-compatible alias for callers that import extractAIEngine
export { downloadAIEngineIfNeeded as extractAIEngine };

async function requireEmbeddedEnginePath(
  platform = getPlatform(),
): Promise<string> {
  const embeddedEnginePath = await resolveEmbeddedEnginePath(platform);
  if (embeddedEnginePath) {
    return embeddedEnginePath;
  }
  throw new RuntimeError(
    `AI engine is unavailable. Expected an HLVM-managed engine at ${
      getEmbeddedEnginePath(platform)
    }. Run 'hlvm bootstrap' to download it.`,
    { code: HLVMErrorCode.AI_ENGINE_STARTUP_FAILED },
  );
}

export async function waitForAIEngineReady(
  expectedVersion?: string,
): Promise<boolean> {
  for (let i = 0; i < AI_STARTUP_MAX_POLLS; i++) {
    if (await isCompatibleAIRunning(expectedVersion)) {
      return true;
    }
    await delay(AI_STARTUP_POLL_INTERVAL_MS);
  }
  return false;
}

function getAIEndpointPort(): string {
  return DEFAULT_OLLAMA_HOST.split(":").at(-1) ?? DEFAULT_OLLAMA_HOST;
}

async function getAIEndpointVersion(): Promise<string | null> {
  try {
    const response = await http.fetchRaw(
      `${DEFAULT_OLLAMA_ENDPOINT}/api/version`,
      {
        timeout: 2000,
      },
    );
    if (!response.ok) {
      return null;
    }
    const payload = await response.json().catch(() => null) as {
      version?: unknown;
    } | null;
    return typeof payload?.version === "string" ? payload.version : null;
  } catch {
    return null;
  }
}

export async function getAIEngineBinaryVersion(
  enginePath: string,
  platform = getPlatform(),
): Promise<string | null> {
  try {
    const versionOutput = await platform.command.output({
      cmd: [enginePath, "--version"],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      env: buildAIEngineEnvironment(enginePath, platform),
    });
    return parseOllamaVersion(normalizeCommandOutput(versionOutput));
  } catch {
    return null;
  }
}

export async function isCompatibleAIRunning(
  expectedVersion?: string,
): Promise<boolean> {
  if (!expectedVersion) {
    return await isAIRunning();
  }
  const endpointVersion = await getAIEndpointVersion();
  return endpointVersion === expectedVersion;
}

async function findListeningPidForAIEndpoint(
): Promise<string | null> {
  return await findListeningPidForPort(Number(getAIEndpointPort()));
}

async function waitForAIEndpointRelease(): Promise<void> {
  for (let i = 0; i < AI_STARTUP_MAX_POLLS; i++) {
    if (!await isAIRunning()) {
      return;
    }
    await delay(AI_STARTUP_POLL_INTERVAL_MS);
  }
}

export async function reclaimConflictingAIEndpoint(
  expectedVersion?: string,
): Promise<boolean> {
  const endpointVersion = await getAIEndpointVersion();
  if (!endpointVersion) {
    return false;
  }
  if (!expectedVersion || endpointVersion === expectedVersion) {
    return false;
  }

  const pid = await findListeningPidForAIEndpoint();
  if (!pid) {
    return false;
  }

  log.warn?.(
    `Reclaiming HLVM AI endpoint ${DEFAULT_OLLAMA_HOST} from incompatible Ollama ` +
      `${endpointVersion} (expected ${expectedVersion}).`,
  );

  if (!await terminateProcess(pid)) {
    const error = new Error(`Failed to terminate process ${pid}.`);
    log.warn?.(
      `Failed to terminate incompatible Ollama on ${DEFAULT_OLLAMA_HOST}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }

  await waitForAIEndpointRelease();
  return true;
}

async function startAIEngine(platform = getPlatform()): Promise<void> {
  const enginePath = await requireEmbeddedEnginePath(platform);
  const expectedVersion = await getAIEngineBinaryVersion(enginePath, platform);

  // Guard against recursive self-execution
  try {
    if (await matchesSelfBinarySize(enginePath, platform)) {
      log.warn?.(
        "AI engine binary appears to be the HLVM CLI itself — skipping to avoid recursive spawn",
      );
      return;
    }
  } catch {
    // Best-effort guard only
  }

  if (await isCompatibleAIRunning(expectedVersion ?? undefined)) {
    log.debug?.(`AI engine already running on ${DEFAULT_OLLAMA_HOST}`);
    return;
  }

  await reclaimConflictingAIEndpoint(expectedVersion ?? undefined);

  const killProcess = (proc: PlatformCommandProcess | null) => {
    try {
      proc?.kill?.("SIGTERM");
    } catch { /* best-effort */ }
  };

  let aiProcess: PlatformCommandProcess | null = null;
  try {
    const engineEnv = buildAIEngineEnvironment(enginePath, platform);
    if (platform.build.os === "windows") {
      // Windows: use 'cmd /c start /b' to create a fully detached process.
      // Without this, the child Ollama process's network socket is closed
      // when the parent Deno process exits (Windows handle inheritance).
      aiProcess = platform.command.run({
        cmd: ["cmd", "/c", "start", "/b", "", enginePath, "serve"],
        stdout: "null",
        stderr: "null",
        env: engineEnv,
      });
    } else {
      aiProcess = platform.command.run({
        cmd: [enginePath, "serve"],
        stdout: "null",
        stderr: "null",
        env: engineEnv,
      });
    }
    aiProcess.unref?.();

    if (await waitForAIEngineReady(expectedVersion ?? undefined)) {
      log.debug?.(`AI engine started successfully (${enginePath})`);
      return;
    }
    killProcess(aiProcess);
    throw new RuntimeError("AI engine failed to start", {
      code: HLVMErrorCode.AI_ENGINE_STARTUP_FAILED,
    });
  } catch (error) {
    if (await isCompatibleAIRunning(expectedVersion ?? undefined)) {
      log.debug?.("AI engine already running and compatible");
      return;
    }
    killProcess(aiProcess);
    log.warn(`AI features unavailable: ${(error as Error).message}`);
    throw error;
  }
}

async function resolveEnginePath(): Promise<string> {
  return await requireEmbeddedEnginePath();
}

// ============================================================================
// Concrete singleton — the single AIEngineLifecycle implementation
// ============================================================================

/**
 * Concrete AI engine lifecycle — handles download and startup.
 * Import this when you need engine operations.
 */
export const aiEngine: AIEngineLifecycle = {
  isRunning: isAIRunning,

  async ensureRunning(): Promise<boolean> {
    const platform = getPlatform();
    await downloadAIEngineIfNeeded(platform);
    const enginePath = await requireEmbeddedEnginePath(platform);
    const expectedVersion = await getAIEngineBinaryVersion(
      enginePath,
      platform,
    );
    if (await isCompatibleAIRunning(expectedVersion ?? undefined)) return true;
    await startAIEngine(platform);
    return await isCompatibleAIRunning(expectedVersion ?? undefined);
  },

  getEnginePath: resolveEnginePath,
};

// ============================================================================
// CLI startup hook (uses the disable flag, unlike aiEngine.ensureRunning)
// ============================================================================

/**
 * Initialize AI runtime at CLI startup.
 * Respects HLVM_DISABLE_AI_AUTOSTART (for tests).
 * For explicit setup flows, use aiEngine.ensureRunning() instead.
 */
export function initAIRuntime(): Promise<void> {
  if (!initPromise) {
    initPromise = doInitAIRuntime().catch((e) => {
      initPromise = null; // Allow retry on failure
      throw e;
    });
  }
  return initPromise;
}

async function doInitAIRuntime(): Promise<void> {
  const platform = getPlatform();

  if (platform.env.get("HLVM_DISABLE_AI_AUTOSTART")) {
    return;
  }

  await downloadAIEngineIfNeeded(platform);
  const enginePath = await requireEmbeddedEnginePath(platform);
  const expectedVersion = await getAIEngineBinaryVersion(enginePath, platform);
  if (await isCompatibleAIRunning(expectedVersion ?? undefined)) {
    return;
  }

  await startAIEngine(platform);
}
