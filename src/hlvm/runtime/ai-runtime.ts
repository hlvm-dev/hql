/**
 * AI Runtime Manager for HLVM
 *
 * Handles extraction and lifecycle of the embedded AI engine (Ollama).
 * Exports an AIEngineLifecycle interface so consumers depend on abstraction,
 * not the concrete embedded-vs-system implementation details.
 *
 * SSOT: Uses ai.status() from the API module directly - no fallback fetch.
 */

import { delay } from "@std/async";
import { RuntimeError } from "../../common/error.ts";
import { HLVMErrorCode } from "../../common/error-codes.ts";
import { ai } from "../api/ai.ts";
import { log } from "../api/log.ts";
import { ensureRuntimeDir, getModelsDir, getRuntimeDir } from "../../common/paths.ts";
import { findLegacyRuntimeEngine } from "../../common/legacy-migration.ts";
import { getPlatform, type PlatformCommandProcess } from "../../platform/platform.ts";
import { DEFAULT_OLLAMA_ENDPOINT, DEFAULT_OLLAMA_HOST } from "../../common/config/types.ts";
import { http } from "../../common/http-client.ts";

// ============================================================================
// Interface — consumers depend on this, not concrete internals
// ============================================================================

/** Abstraction for AI engine lifecycle operations. */
export interface AIEngineLifecycle {
  /** Check if the engine daemon is reachable. */
  isRunning(): Promise<boolean>;
  /** Ensure the engine is extracted (if embedded) and running. Returns success. */
  ensureRunning(): Promise<boolean>;
  /** Get the path to the engine binary (embedded or system). */
  getEnginePath(): Promise<string>;
}

// ============================================================================
// Private implementation
// ============================================================================

const SYSTEM_AI_ENGINE = "ollama";
const AI_STARTUP_MAX_POLLS = 30;
const AI_STARTUP_POLL_INTERVAL_MS = 300;
const textDecoder = new TextDecoder();

let initPromise: Promise<void> | null = null;

function parseOllamaVersion(output: string): string | null {
  const clientMatch = output.match(/client version is\s+([0-9]+\.[0-9]+\.[0-9]+)/i);
  if (clientMatch?.[1]) {
    return clientMatch[1];
  }
  const serverMatch = output.match(/ollama version is\s+([0-9]+\.[0-9]+\.[0-9]+)/i);
  if (serverMatch?.[1]) {
    return serverMatch[1];
  }
  return null;
}

function isMissingEmbeddedEngineError(error: unknown): boolean {
  return error instanceof Error &&
    (error.message.includes("No such file") || error.message.includes("path not found"));
}

function getEmbeddedEngineDir(platform = getPlatform()): string {
  return platform.path.join(getRuntimeDir(), "engine");
}

function getEmbeddedEngineBinaryName(platform = getPlatform()): string {
  return platform.build.os === "windows" ? "ollama.exe" : "ollama";
}

function getEmbeddedEnginePath(platform = getPlatform()): string {
  return platform.path.join(
    getEmbeddedEngineDir(platform),
    getEmbeddedEngineBinaryName(platform),
  );
}

function getBundledEngineResourcePath(platform = getPlatform()): string {
  return platform.path.fromFileUrl(new URL("../../../resources/ai-engine", import.meta.url));
}

function getBundledEngineFallbackResourceRoot(platform = getPlatform()): string {
  return platform.path.fromFileUrl(new URL("../../../", import.meta.url));
}

async function resolveBundledEngineResourcePath(
  fileName: string,
  platform = getPlatform(),
): Promise<string | null> {
  const candidateRoots = [
    getBundledEngineResourcePath(platform),
    getBundledEngineFallbackResourceRoot(platform),
  ];

  for (const root of candidateRoots) {
    const candidate = platform.path.join(root, fileName);
    if (await platform.fs.exists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function readBundledEngineManifest(
  platform = getPlatform(),
): Promise<string[]> {
  const manifestPath = await resolveBundledEngineResourcePath("manifest.json", platform);
  if (!manifestPath) {
    throw new Error("Bundled AI engine manifest was not embedded in this build.");
  }

  const raw = await platform.fs.readTextFile(manifestPath);
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed?.files)
    ? parsed.files.filter((value: unknown): value is string => typeof value === "string")
    : [];
}

function normalizeCommandOutput(output: {
  stdout: Uint8Array;
  stderr: Uint8Array;
}): string {
  const stdout = textDecoder.decode(output.stdout).trim();
  const stderr = textDecoder.decode(output.stderr).trim();
  return [stdout, stderr].filter(Boolean).join("\n");
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

  const invalidReason = await describeInvalidEngine(embeddedEnginePath, platform);
  if (invalidReason) {
    log.warn?.(`Discarding extracted embedded AI engine: ${invalidReason}`);
    await removeEmbeddedEngine(invalidReason, platform);
    return null;
  }

  return embeddedEnginePath;
}

export async function hasEmbeddedAIEngineResource(
  platform = getPlatform(),
): Promise<boolean> {
  try {
    const files = await readBundledEngineManifest(platform);
    if (!files.includes(getEmbeddedEngineBinaryName(platform))) {
      return false;
    }
    const bundledBinaryPath = await resolveBundledEngineResourcePath(
      getEmbeddedEngineBinaryName(platform),
      platform,
    );
    if (!bundledBinaryPath) {
      return false;
    }
    await platform.fs.readFile(bundledBinaryPath);
    return true;
  } catch {
    return false;
  }
}

export function buildAIEngineEnvironment(
  enginePath: string,
  platform = getPlatform(),
): Record<string, string> {
  const env: Record<string, string> = {
    OLLAMA_HOST: DEFAULT_OLLAMA_HOST,
    OLLAMA_MODELS: getModelsDir(),
  };

  if (enginePath === SYSTEM_AI_ENGINE) {
    return env;
  }

  const engineDir = platform.path.dirname(enginePath);
  const pathSeparator = platform.build.os === "windows" ? ";" : ":";
  const currentPath = platform.env.get("PATH");
  env.PATH = currentPath ? `${engineDir}${pathSeparator}${currentPath}` : engineDir;

  if (platform.build.os === "darwin") {
    env.DYLD_LIBRARY_PATH = engineDir;
  } else if (platform.build.os === "linux") {
    env.LD_LIBRARY_PATH = engineDir;
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

export async function extractAIEngine(platform = getPlatform()): Promise<void> {
  if (await resolveEmbeddedEnginePath(platform)) {
    return;
  }

  try {
    const legacyEnginePath = await findLegacyRuntimeEngine();
    if (legacyEnginePath) {
      if (await matchesSelfBinarySize(legacyEnginePath, platform)) {
        log.debug?.("Legacy engine binary matches HLVM CLI size — skipping copy");
        // Fall through to embedded resource extraction below
      } else {
        const invalidLegacyReason = await describeInvalidEngine(
          legacyEnginePath,
          platform,
        );
        if (invalidLegacyReason) {
          log.debug?.(
            `Skipping legacy AI engine at ${legacyEnginePath}: ${invalidLegacyReason}`,
          );
        } else {
          const embeddedEnginePath = getEmbeddedEnginePath(platform);
          await ensureRuntimeDir();
          await platform.fs.remove(getEmbeddedEngineDir(platform), {
            recursive: true,
          }).catch(() => {});
          await platform.fs.mkdir(getEmbeddedEngineDir(platform), { recursive: true });
          await platform.fs.copyFile(legacyEnginePath, embeddedEnginePath);
          await platform.fs.chmod(embeddedEnginePath, 0o755);
          if (await resolveEmbeddedEnginePath(platform)) {
            return;
          }
        }
      }
    }

    const bundledFiles = await readBundledEngineManifest(platform);
    const embeddedEngineDir = getEmbeddedEngineDir(platform);
    const embeddedEnginePath = getEmbeddedEnginePath(platform);
    await ensureRuntimeDir();
    await platform.fs.remove(embeddedEngineDir, { recursive: true }).catch(() => {});
    await platform.fs.mkdir(embeddedEngineDir, { recursive: true });
    for (const fileName of bundledFiles) {
      const sourcePath = await resolveBundledEngineResourcePath(fileName, platform);
      if (!sourcePath) {
        throw new Error(`Bundled AI engine file missing from build: ${fileName}`);
      }
      const targetPath = platform.path.join(embeddedEngineDir, fileName);
      const fileBytes = await platform.fs.readFile(sourcePath);
      await platform.fs.writeFile(targetPath, fileBytes);
    }
    await platform.fs.chmod(embeddedEnginePath, 0o755);
    if (await resolveEmbeddedEnginePath(platform)) {
      return;
    }
    log.debug?.(
      "Embedded AI engine failed validation after extraction; falling back to system Ollama",
    );
  } catch (error) {
    // In development mode, AI engine might not be embedded — fall back to system
    if (isMissingEmbeddedEngineError(error)) {
      return;
    }
    throw error;
  }
}

export async function waitForAIEngineReady(expectedVersion?: string): Promise<boolean> {
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
    const response = await http.fetchRaw(`${DEFAULT_OLLAMA_ENDPOINT}/api/version`, {
      timeout: 2000,
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json().catch(() => null) as { version?: unknown } | null;
    return typeof payload?.version === "string" ? payload.version : null;
  } catch {
    return null;
  }
}

export async function getAIEngineBinaryVersion(
  enginePath: string,
  platform = getPlatform(),
): Promise<string | null> {
  if (enginePath === SYSTEM_AI_ENGINE) {
    return null;
  }

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

export async function isCompatibleAIRunning(expectedVersion?: string): Promise<boolean> {
  if (!expectedVersion) {
    return await isAIRunning();
  }
  const endpointVersion = await getAIEndpointVersion();
  return endpointVersion === expectedVersion;
}

async function findListeningPidForAIEndpoint(platform = getPlatform()): Promise<string | null> {
  try {
    if (platform.build.os === "windows") {
      const output = await platform.command.output({
        cmd: ["cmd", "/c", `netstat -ano -p tcp | findstr LISTENING | findstr :${getAIEndpointPort()}`],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });
      const text = normalizeCommandOutput(output);
      const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
      const pid = lines.at(0)?.split(/\s+/).at(-1);
      return pid && /^\d+$/.test(pid) ? pid : null;
    }

    const output = await platform.command.output({
      cmd: ["lsof", "-nP", `-iTCP:${getAIEndpointPort()}`, "-sTCP:LISTEN", "-t"],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    const pid = normalizeCommandOutput(output).split("\n")[0]?.trim();
    return pid && /^\d+$/.test(pid) ? pid : null;
  } catch {
    return null;
  }
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
  platform = getPlatform(),
): Promise<boolean> {
  const endpointVersion = await getAIEndpointVersion();
  if (!endpointVersion) {
    return false;
  }
  if (!expectedVersion || endpointVersion === expectedVersion) {
    return false;
  }

  const pid = await findListeningPidForAIEndpoint(platform);
  if (!pid) {
    return false;
  }

  log.warn?.(
    `Reclaiming HLVM AI endpoint ${DEFAULT_OLLAMA_HOST} from incompatible Ollama ` +
    `${endpointVersion} (expected ${expectedVersion}).`,
  );

  try {
    if (platform.build.os === "windows") {
      await platform.command.output({
        cmd: ["taskkill", "/PID", pid, "/T", "/F"],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });
    } else {
      await platform.command.output({
        cmd: ["kill", "-TERM", pid],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });
    }
  } catch (error) {
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
  const enginePath = await resolveEmbeddedEnginePath(platform) ??
    SYSTEM_AI_ENGINE;
  const expectedVersion = await getAIEngineBinaryVersion(enginePath, platform);

  // Guard against recursive self-execution
  if (enginePath !== SYSTEM_AI_ENGINE) {
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
  }

  if (await isCompatibleAIRunning(expectedVersion ?? undefined)) {
    log.debug?.(`AI engine already running on ${DEFAULT_OLLAMA_HOST}`);
    return;
  }

  await reclaimConflictingAIEndpoint(expectedVersion ?? undefined, platform);

  const killProcess = (proc: PlatformCommandProcess | null) => {
    try { proc?.kill?.("SIGTERM"); } catch { /* best-effort */ }
  };

  let aiProcess: PlatformCommandProcess | null = null;
  try {
    aiProcess = platform.command.run({
      cmd: [enginePath, "serve"],
      stdout: "null",
      stderr: "null",
      env: buildAIEngineEnvironment(enginePath, platform),
    });
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
  const platform = getPlatform();
  const embeddedEnginePath = await resolveEmbeddedEnginePath(platform);
  if (embeddedEnginePath) {
    return embeddedEnginePath;
  }
  return SYSTEM_AI_ENGINE;
}

// ============================================================================
// Concrete singleton — the single AIEngineLifecycle implementation
// ============================================================================

/**
 * Concrete AI engine lifecycle — handles embedded extraction + system fallback.
 * Import this when you need engine operations.
 */
export const aiEngine: AIEngineLifecycle = {
  isRunning: isAIRunning,

  async ensureRunning(): Promise<boolean> {
    const platform = getPlatform();
    await extractAIEngine(platform);
    const enginePath = await resolveEmbeddedEnginePath(platform) ?? SYSTEM_AI_ENGINE;
    const expectedVersion = await getAIEngineBinaryVersion(enginePath, platform);
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

  await extractAIEngine(platform);
  const enginePath = await resolveEmbeddedEnginePath(platform) ?? SYSTEM_AI_ENGINE;
  const expectedVersion = await getAIEngineBinaryVersion(enginePath, platform);
  if (await isCompatibleAIRunning(expectedVersion ?? undefined)) {
    return;
  }

  await startAIEngine(platform);
}
