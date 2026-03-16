/**
 * MCP Config — Loading, saving, and global management of MCP server configurations.
 */

import { getPlatform } from "../../../platform/platform.ts";
import { getErrorMessage, isObjectValue } from "../../../common/utils.ts";
import { getAgentLogger } from "../logger.ts";
import {
  getClaudeCodeMcpDir,
  getMcpConfigPath,
} from "../../../common/paths.ts";
import type { McpConfig, McpServerConfig } from "./types.ts";

const DOT_MCP_FILE = ".mcp.json";

// ============================================================
// Loading
// ============================================================

export async function loadMcpConfig(): Promise<McpConfig | null> {
  return await loadMcpConfigFromPath(getMcpConfigPath());
}

async function loadMcpConfigFromPath(path: string): Promise<McpConfig | null> {
  const platform = getPlatform();
  let content: string;
  try {
    content = await platform.fs.readTextFile(path);
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    getAgentLogger().warn(
      `MCP config JSON invalid (${path}): ${getErrorMessage(error)}`,
    );
    return null;
  }

  if (!isObjectValue(parsed) || parsed.version !== 1) {
    getAgentLogger().warn(`MCP config invalid (${path}): expected version 1`);
    return null;
  }

  const servers = Array.isArray(parsed.servers)
    ? parsed.servers.filter(isMcpServerConfig)
    : [];

  if (servers.length === 0) return null;
  return { version: 1, servers };
}

/** Scope tag for display and identification */
export type McpScope = "user" | "claude-code";

export interface McpServerWithScope extends McpServerConfig {
  scope: McpScope;
}

/**
 * Load MCP servers from all global scopes, merged with deduplication.
 * Priority: ~/.hlvm/mcp.json (user) > Claude Code plugins
 */
export async function loadMcpConfigMultiScope(): Promise<McpServerWithScope[]> {
  const [userConfig, claudeServers] = await Promise.all([
    loadMcpConfigFromPath(getMcpConfigPath()),
    loadClaudeCodeMcpServers(),
  ]);

  // Dedupe: first occurrence wins (highest priority)
  return dedupeServers([
    ...(userConfig?.servers ?? []).map((s) => ({
      ...s,
      scope: "user" as const,
    })),
    ...claudeServers.map((s) => ({ ...s, scope: "claude-code" as const })),
  ]);
}

// ============================================================
// Claude Code Plugin Import
// ============================================================

/**
 * Parse a single Claude Code .mcp.json server entry into McpServerConfig.
 * Handles: stdio (command+args), HTTP (url), SSE (url+type:sse), uvx shorthand.
 */
function parseClaudeCodeServerEntry(
  name: string,
  entry: Record<string, unknown>,
): McpServerConfig | null {
  const env = isObjectValue(entry.env)
    ? Object.fromEntries(
      Object.entries(entry.env as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => [k, v as string]),
    )
    : undefined;

  const disabled_tools = Array.isArray(entry.disabled_tools)
    ? entry.disabled_tools.filter((t: unknown) =>
      typeof t === "string"
    ) as string[]
    : undefined;
  const connection_timeout_ms =
    typeof entry.connection_timeout_ms === "number" &&
      Number.isFinite(entry.connection_timeout_ms) &&
      entry.connection_timeout_ms > 0
      ? Math.floor(entry.connection_timeout_ms)
      : undefined;

  // HTTP / SSE transport
  if (typeof entry.url === "string") {
    return { name, url: entry.url, env, disabled_tools, connection_timeout_ms };
  }

  // Stdio transport: command + args
  if (typeof entry.command === "string") {
    const args = Array.isArray(entry.args)
      ? entry.args.filter((a: unknown) => typeof a === "string") as string[]
      : [];
    return {
      name,
      command: [entry.command, ...args],
      env,
      disabled_tools,
      connection_timeout_ms,
    };
  }

  return null;
}

/**
 * Parse a Claude Code `.mcp.json` file content.
 * Handles two formats:
 *   1. Direct: `{ "<name>": { command, args, url, env, ... } }`
 *   2. Wrapped: `{ "mcpServers": { "<name>": { ... } } }`
 *
 * @param content Raw JSON string
 * @param fileName Used as fallback server name when only one unnamed entry
 */
export function parseClaudeCodeMcpJson(
  content: string,
  fileName: string,
): McpServerConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  if (!isObjectValue(parsed)) return [];
  const obj = parsed as Record<string, unknown>;

  // Wrapped format: { mcpServers: { name: { ... } } }
  if (isObjectValue(obj.mcpServers)) {
    const servers: McpServerConfig[] = [];
    for (
      const [name, value] of Object.entries(
        obj.mcpServers as Record<string, unknown>,
      )
    ) {
      if (!isObjectValue(value)) continue;
      const config = parseClaudeCodeServerEntry(
        name,
        value as Record<string, unknown>,
      );
      if (config) servers.push(config);
    }
    return servers;
  }

  // Direct format: { name: { command, args, ... } }
  const servers: McpServerConfig[] = [];
  for (const [name, value] of Object.entries(obj)) {
    if (!isObjectValue(value)) continue;
    const config = parseClaudeCodeServerEntry(
      name,
      value as Record<string, unknown>,
    );
    if (config) servers.push(config);
  }

  // If no named entries found, treat entire object as a single unnamed server
  if (servers.length === 0) {
    const config = parseClaudeCodeServerEntry(fileName, obj);
    if (config) servers.push(config);
  }

  return servers;
}

/**
 * Scan Claude Code's external_plugins directory for installed MCP servers.
 * Each subdirectory may contain a `.mcp.json` file.
 * Returns empty array if the directory doesn't exist or is unreadable.
 */
async function loadClaudeCodeMcpServers(): Promise<McpServerConfig[]> {
  const platform = getPlatform();
  const pluginsDir = getClaudeCodeMcpDir();

  // Collect directory entries (readDir returns AsyncIterable)
  const dirs: string[] = [];
  try {
    for await (const entry of platform.fs.readDir(pluginsDir)) {
      if (entry.isDirectory) {
        dirs.push(entry.name);
      }
    }
  } catch {
    // Directory doesn't exist or is unreadable — no Claude Code plugins
    return [];
  }

  if (dirs.length === 0) return [];

  // Read all .mcp.json files in parallel
  const results = await Promise.allSettled(
    dirs.map(async (dirName) => {
      const mcpPath = platform.path.join(pluginsDir, dirName, DOT_MCP_FILE);
      const content = await platform.fs.readTextFile(mcpPath);
      return parseClaudeCodeMcpJson(content, dirName);
    }),
  );

  const servers: McpServerConfig[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      servers.push(...result.value);
    }
  }
  return servers;
}

// ============================================================
// Saving
// ============================================================

async function saveMcpConfig(path: string, config: McpConfig): Promise<void> {
  const platform = getPlatform();
  const dir = platform.path.dirname(path);
  await platform.fs.mkdir(dir, { recursive: true });
  await platform.fs.writeTextFile(path, JSON.stringify(config, null, 2) + "\n");
}

export async function addServerToConfig(
  server: McpServerConfig,
): Promise<void> {
  const path = getMcpConfigPath();
  const existing = await loadMcpConfigFromPath(path);
  const servers = existing?.servers ?? [];

  // Dedup by name (replace if exists)
  const key = normalizeServerName(server.name);
  const filtered = servers.filter(
    (s) => normalizeServerName(s.name) !== key,
  );
  filtered.push(server);

  await saveMcpConfig(path, { version: 1, servers: filtered });
}

export async function removeServerFromConfig(
  serverName: string,
): Promise<boolean> {
  const path = getMcpConfigPath();
  const existing = await loadMcpConfigFromPath(path);
  if (!existing) return false;

  const key = normalizeServerName(serverName);
  const filtered = existing.servers.filter(
    (s) => normalizeServerName(s.name) !== key,
  );

  if (filtered.length === existing.servers.length) return false;
  await saveMcpConfig(path, { version: 1, servers: filtered });
  return true;
}

// ============================================================
// Shared Utilities
// ============================================================

export function normalizeServerName(name: string): string {
  return name.trim().toLowerCase();
}

export function dedupeServers<T extends McpServerConfig>(servers: T[]): T[] {
  const seenNames = new Set<string>();
  const deduped: T[] = [];
  for (const server of servers) {
    const key = normalizeServerName(server.name);
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    deduped.push(server);
  }
  return deduped;
}

/** Format a server entry for display (shared by CLI and REPL) */
export function formatServerEntry(s: McpServerWithScope): {
  transport: string;
  target: string;
  scopeLabel: string;
} {
  return {
    transport: s.url ? "http" : "stdio",
    target: s.url ?? (s.command?.join(" ") ?? ""),
    scopeLabel: s.scope === "claude-code" ? "Claude Code" : "user",
  };
}

export function isMcpServerConfig(value: unknown): value is McpServerConfig {
  if (!isObjectValue(value)) return false;
  if (typeof value.name !== "string") return false;
  // Stdio transport: requires command array of strings
  if (Array.isArray(value.command) && value.command.length > 0) {
    return value.command.every((c: unknown) => typeof c === "string");
  }
  // HTTP transport: requires url
  if (typeof value.url === "string" && value.url.length > 0) return true;
  return false;
}
