/**
 * Single Source of Truth for HLVM Directory Paths
 *
 * All path operations for ~/.hlvm should go through this module.
 * This eliminates duplication and ensures consistent path handling.
 */

import { getPlatform } from "../platform/platform.ts";
import { RuntimeError } from "./error.ts";

// SSOT: Use platform layer for all file/path operations
const path = () => getPlatform().path;
const join = (...paths: string[]) => path().join(...paths);
const resolve = (...paths: string[]) => path().resolve(...paths);

function sanitizeRuntimePathSegment(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "_");
  return normalized.length > 0 ? normalized : "default";
}

// Cached HLVM directory path
let _hlvmDir: string | null = null;
let _claudeCodeMcpDirForTests: string | null = null;

/**
 * Get environment variable value.
 * Shared utility for path resolution across modules.
 */
export function getEnvVar(key: string): string | undefined {
  try {
    return getPlatform().env.get(key);
  } catch {
    return undefined;
  }
}

function resolveHlvmDir(): string {
  const override = getEnvVar("HLVM_DIR");
  if (override) {
    return resolve(override);
  }
  const home = getEnvVar("HOME") || getEnvVar("USERPROFILE") || ".";
  return join(home, ".hlvm");
}

function ensureWritableDir(dirPath: string): boolean {
  const platform = getPlatform();
  const probeId = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : String(Date.now());
  const probePath = join(dirPath, `.hlvm-write-test-${probeId}`);
  try {
    // Create directory synchronously
    try {
      const stat = platform.fs.statSync(dirPath);
      if (!stat.isDirectory) {
        return false;
      }
    } catch {
      // Directory doesn't exist, try to create it
      platform.fs.mkdirSync(dirPath, { recursive: true });
    }
    // Write probe file
    platform.fs.writeTextFileSync(probePath, "");
    platform.fs.removeSync(probePath);
    return true;
  } catch {
    try {
      // Best-effort cleanup if the probe was partially created.
      platform.fs.removeSync(probePath);
    } catch {
      // Ignore cleanup errors.
    }
    return false;
  }
}

/**
 * Get the root HLVM directory (~/.hlvm)
 * Cached after first call for performance.
 */
export function getHlvmDir(): string {
  if (!_hlvmDir) {
    const candidate = resolveHlvmDir();
    if (!ensureWritableDir(candidate)) {
      throw new RuntimeError(
        `Unable to use writable global HLVM directory: ${candidate}`,
      );
    }
    _hlvmDir = candidate;
  }
  return _hlvmDir;
}

/**
 * Reset cached HLVM dir (used in tests)
 */
export function resetHlvmDirCacheForTests(): void {
  _hlvmDir = null;
}

/**
 * Override the cached HLVM dir directly (used in tests).
 * Avoids Deno.env mutations which leak across parallel test workers.
 */
export function setHlvmDirForTests(dir: string): void {
  _hlvmDir = dir;
}

/**
 * Override the Claude Code MCP plugin directory (used in tests).
 */
export function setClaudeCodeMcpDirForTests(dir: string | null): void {
  _claudeCodeMcpDirForTests = dir;
}

/**
 * Get the config file path (~/.hlvm/config.json)
 */
export function getConfigPath(): string {
  return join(getHlvmDir(), "config.json");
}

/**
 * Get the memory file path (~/.hlvm/memory.hql)
 */
export function getMemoryPath(): string {
  return join(getHlvmDir(), "memory.hql");
}

/**
 * Get the memory directory (~/.hlvm/memory)
 */
export function getMemoryDir(): string {
  return join(getHlvmDir(), "memory");
}

/**
 * Get the canonical memory SQLite DB path (~/.hlvm/memory/memory.db)
 */
export function getMemoryDbPath(): string {
  return join(getMemoryDir(), "memory.db");
}

/**
 * Get the user-facing memory notes path (~/.hlvm/memory/MEMORY.md)
 */
export function getMemoryMdPath(): string {
  return join(getMemoryDir(), "MEMORY.md");
}

/**
 * Ensure memory directory exists (~/.hlvm/memory/)
 * Sets owner-only permissions (0o700) for privacy.
 */
export async function ensureMemoryDirs(): Promise<void> {
  const fs = getPlatform().fs;
  const memDir = getMemoryDir();
  await fs.mkdir(memDir, { recursive: true });
  try {
    await fs.chmod(memDir, 0o700);
  } catch {
    // chmod may not be supported on all platforms (e.g., Windows)
  }
}

/** Synchronous version of ensureMemoryDirs — for use in sync-only contexts like SQLite init */
export function ensureMemoryDirsSync(): void {
  const fs = getPlatform().fs;
  const memDir = getMemoryDir();
  fs.mkdirSync(memDir, { recursive: true });
  try {
    fs.chmodSync(memDir, 0o700);
  } catch {
    // chmod may not be supported on all platforms (e.g., Windows)
  }
}

/**
 * Get the web cache file path (~/.hlvm/web-cache.json)
 */
export function getWebCachePath(): string {
  return join(getHlvmDir(), "web-cache.json");
}

/**
 * Get the REPL rollout debug log path (~/.hlvm/debug.log)
 */
export function getDebugLogPath(): string {
  return join(getHlvmDir(), "debug.log");
}

/**
 * End-to-end JSONL trace for REPL main-thread agent turns (~/.hlvm/repl-main-thread-trace.jsonl)
 */
export function getReplMainThreadTracePath(): string {
  return join(getHlvmDir(), "repl-main-thread-trace.jsonl");
}

/**
 * Get the cloud model catalog cache path (~/.hlvm/cloud-model-catalog.json)
 */
export function getCloudModelCatalogCachePath(): string {
  return join(getHlvmDir(), "cloud-model-catalog.json");
}

/**
 * Get the unified model discovery cache path (~/.hlvm/model-discovery.json)
 */
export function getModelDiscoveryCachePath(): string {
  return join(getHlvmDir(), "model-discovery.json");
}

/**
 * Get the Ollama catalog cache path (~/.hlvm/ollama-catalog.json)
 */
export function getOllamaCatalogCachePath(): string {
  return join(getHlvmDir(), "ollama-catalog.json");
}

/**
 * Get the conversations database path (~/.hlvm/conversations.db)
 */
export function getConversationsDbPath(): string {
  return join(getHlvmDir(), "conversations.db");
}

/**
 * Get the attachments root directory (~/.hlvm/attachments)
 */
export function getAttachmentsDir(): string {
  return join(getHlvmDir(), "attachments");
}

/**
 * Get the attachment metadata directory (~/.hlvm/attachments/records)
 */
export function getAttachmentRecordsDir(): string {
  return join(getAttachmentsDir(), "records");
}

/**
 * Get the attachment blob store directory (~/.hlvm/attachments/blobs)
 */
export function getAttachmentBlobsDir(): string {
  return join(getAttachmentsDir(), "blobs");
}

/**
 * Get the prepared-attachment cache directory (~/.hlvm/attachments/prepared)
 */
export function getAttachmentPreparedDir(): string {
  return join(getAttachmentsDir(), "prepared");
}

export function getAttachmentTracePath(): string {
  return join(getHlvmDir(), "attachment-pipeline.jsonl");
}

/**
 * Get the extracted-text cache directory (~/.hlvm/attachments/extracted)
 */
export function getAttachmentExtractedDir(): string {
  return join(getAttachmentsDir(), "extracted");
}

/**
 * Ensure attachment storage directories exist.
 */
export async function ensureAttachmentDirs(): Promise<void> {
  const fs = getPlatform().fs;
  await fs.mkdir(getAttachmentRecordsDir(), { recursive: true });
  await fs.mkdir(getAttachmentBlobsDir(), { recursive: true });
  await fs.mkdir(getAttachmentPreparedDir(), { recursive: true });
  await fs.mkdir(getAttachmentExtractedDir(), { recursive: true });
}

/**
 * Get the runtime directory (~/.hlvm/.runtime)
 * Used for embedded binaries and runtime state.
 */
export function getRuntimeDir(): string {
  return join(getHlvmDir(), ".runtime");
}

/**
 * Get the tool-result sidecar root directory (~/.hlvm/.runtime/tool-results)
 */
export function getToolResultsDir(): string {
  return join(getRuntimeDir(), "tool-results");
}

/**
 * Get the session-scoped tool-result directory (~/.hlvm/.runtime/tool-results/{sessionId})
 */
export function getToolResultsSessionDir(sessionId: string): string {
  return join(getToolResultsDir(), sanitizeRuntimePathSegment(sessionId));
}

/**
 * Get a persisted tool-result sidecar path.
 */
export function getToolResultSidecarPath(
  sessionId: string,
  toolCallId: string,
  extension: "txt" | "json",
): string {
  return join(
    getToolResultsSessionDir(sessionId),
    `${sanitizeRuntimePathSegment(toolCallId)}.${extension}`,
  );
}

/**
 * Get the history file path (~/.hlvm/history.jsonl)
 * JSONL format: one JSON entry per line for append-only operations
 */
export function getHistoryPath(): string {
  return join(getHlvmDir(), "history.jsonl");
}

/**
 * Get the history pasted-text store directory (~/.hlvm/history-pastes)
 */
export function getHistoryPasteStoreDir(): string {
  return join(getHlvmDir(), "history-pastes");
}

/**
 * Get the user-global MCP config path (~/.hlvm/mcp.json)
 */
export function getMcpConfigPath(): string {
  return join(getHlvmDir(), "mcp.json");
}

/**
 * Get the MCP OAuth credential store path (~/.hlvm/mcp-oauth.json)
 */
export function getMcpOAuthPath(): string {
  return join(getHlvmDir(), "mcp-oauth.json");
}

/**
 * Get the global agent policy path (~/.hlvm/agent-policy.json)
 */
export function getAgentPolicyPath(): string {
  return join(getHlvmDir(), "agent-policy.json");
}

/**
 * Get the global custom instructions path (~/.hlvm/HLVM.md)
 */
export function getCustomInstructionsPath(): string {
  return join(getHlvmDir(), "HLVM.md");
}

/**
 * Get the project-level custom instructions path (<workspace>/.hlvm/HLVM.md)
 */
export function getProjectInstructionsPath(workspace: string): string {
  return join(workspace, ".hlvm", "HLVM.md");
}

/**
 * Get the trusted workspaces registry path (~/.hlvm/trusted-workspaces.json)
 */
export function getTrustedWorkspacesPath(): string {
  return join(getHlvmDir(), "trusted-workspaces.json");
}

/**
 * Get the Claude Code external MCP plugins directory.
 * Claude Code stores installed MCP servers as subdirectories here,
 * each with a `.mcp.json` config file.
 */
export function getClaudeCodeMcpDir(): string {
  if (_claudeCodeMcpDirForTests !== null) {
    return _claudeCodeMcpDirForTests;
  }
  const home = getEnvVar("HOME") || getEnvVar("USERPROFILE") || ".";
  return join(
    home,
    ".claude",
    "plugins",
    "marketplaces",
    "claude-plugins-official",
    "external_plugins",
  );
}

/**
 * Ensure the HLVM directory exists
 */
export async function ensureHlvmDir(): Promise<void> {
  try {
    await getPlatform().fs.mkdir(getHlvmDir(), { recursive: true });
  } catch {
    // Ignore errors to keep callers resilient in restricted environments.
  }
}

/**
 * Ensure the HLVM directory exists (sync).
 */
export function ensureHlvmDirSync(): void {
  try {
    getPlatform().fs.mkdirSync(getHlvmDir(), { recursive: true });
  } catch {
    // Ignore errors to keep callers resilient in restricted environments.
  }
}

/**
 * Ensure the runtime directory exists
 */
export async function ensureRuntimeDir(): Promise<void> {
  await getPlatform().fs.mkdir(getRuntimeDir(), { recursive: true });
}

/** Ensure the session-scoped tool-result sidecar directory exists. */
export async function ensureToolResultsSessionDir(
  sessionId: string,
): Promise<void> {
  await getPlatform().fs.mkdir(getToolResultsSessionDir(sessionId), {
    recursive: true,
  });
}

/** Absolute path to the HLVM-owned model store (inside the runtime dir). */
export function getModelsDir(): string {
  return join(getRuntimeDir(), "models");
}

/** Ensure the models directory exists. */
export async function ensureModelsDir(): Promise<void> {
  await getPlatform().fs.mkdir(getModelsDir(), { recursive: true });
}

// ── Agent Team Paths ──────────────────────────────────────────────────

// ============================================================
// Skills & Rules Paths
// ============================================================

/** Unified settings file: ~/.hlvm/settings.json */
export function getSettingsPath(): string {
  return join(getHlvmDir(), "settings.json");
}

/** User-global skills directory: ~/.hlvm/skills/ */
export function getSkillsDir(): string {
  return join(getHlvmDir(), "skills");
}

/** Project-local skills directory: <workspace>/.hlvm/skills/ */
export function getProjectSkillsDir(workspace: string): string {
  return join(workspace, ".hlvm", "skills");
}

/** User-global legacy commands directory: ~/.hlvm/commands/ */
export function getCommandsDir(): string {
  return join(getHlvmDir(), "commands");
}

/** Project-local legacy commands directory: <workspace>/.hlvm/commands/ */
export function getProjectCommandsDir(workspace: string): string {
  return join(workspace, ".hlvm", "commands");
}

/** User-global rules directory: ~/.hlvm/rules/ */
export function getRulesDir(): string {
  return join(getHlvmDir(), "rules");
}

/** Project-local rules directory: <workspace>/.hlvm/rules/ */
export function getProjectRulesDir(workspace: string): string {
  return join(workspace, ".hlvm", "rules");
}
