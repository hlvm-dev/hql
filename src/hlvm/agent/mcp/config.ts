/**
 * MCP Config — Loading, saving, and multi-scope management of MCP server configurations.
 */

import { getPlatform } from "../../../platform/platform.ts";
import { getErrorMessage, isObjectValue } from "../../../common/utils.ts";
import { getAgentLogger } from "../logger.ts";
import { getMcpConfigPath } from "../../../common/paths.ts";
import type { McpConfig, McpServerConfig } from "./types.ts";

const MCP_FILE_NAME = "mcp.json";
const MCP_DIR_NAME = ".hlvm";
const DOT_MCP_FILE = ".mcp.json";
const PLAYWRIGHT_SERVER_NAME = "playwright";
const PLAYWRIGHT_SERVER_SCRIPT = ["scripts", "mcp", "playwright-server.mjs"];

function getProjectMcpPath(workspace: string): string {
  const platform = getPlatform();
  return platform.path.join(workspace, MCP_DIR_NAME, MCP_FILE_NAME);
}

// ============================================================
// Loading
// ============================================================

export async function loadMcpConfig(
  workspace: string,
  configPath?: string,
): Promise<McpConfig | null> {
  const path = configPath ?? getProjectMcpPath(workspace);
  return await loadMcpConfigFromPath(path);
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

// ============================================================
// .mcp.json (Claude Code convention)
// ============================================================

/**
 * Load servers from project-root `.mcp.json` (Claude Code convention).
 * Format: { "mcpServers": { "<name>": { command, args, env, url } } }
 */
async function loadDotMcpJson(
  workspace: string,
): Promise<McpServerConfig[]> {
  const platform = getPlatform();
  const filePath = platform.path.join(workspace, DOT_MCP_FILE);

  let content: string;
  try {
    content = await platform.fs.readTextFile(filePath);
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    getAgentLogger().warn(
      `.mcp.json invalid (${filePath}): ${getErrorMessage(error)}`,
    );
    return [];
  }

  if (!isObjectValue(parsed)) return [];
  const mcpServers = (parsed as Record<string, unknown>).mcpServers;
  if (!isObjectValue(mcpServers)) return [];

  const servers: McpServerConfig[] = [];
  for (const [name, value] of Object.entries(mcpServers as Record<string, unknown>)) {
    if (!isObjectValue(value)) continue;
    const entry = value as Record<string, unknown>;

    const env = isObjectValue(entry.env)
      ? Object.fromEntries(
        Object.entries(entry.env as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string")
          .map(([k, v]) => [k, v as string]),
      )
      : undefined;

    // HTTP transport
    if (typeof entry.url === "string") {
      servers.push({ name, url: entry.url, env });
      continue;
    }

    // Stdio transport: command + args
    if (typeof entry.command === "string") {
      const args = Array.isArray(entry.args)
        ? entry.args.filter((a: unknown) => typeof a === "string") as string[]
        : [];
      servers.push({ name, command: [entry.command, ...args], env });
    }
  }

  return servers;
}

// ============================================================
// Multi-Scope Loading
// ============================================================

/** Scope tag for display and identification */
export type McpScope = "dotmcp" | "project" | "user";

export interface McpServerWithScope extends McpServerConfig {
  scope: McpScope;
}

/**
 * Load MCP servers from all scopes, merged with deduplication.
 * Priority: .mcp.json > .hlvm/mcp.json (project) > ~/.hlvm/mcp.json (user)
 */
export async function loadMcpConfigMultiScope(
  workspace: string,
): Promise<McpServerWithScope[]> {
  const [dotMcp, projectConfig, userConfig] = await Promise.all([
    loadDotMcpJson(workspace),
    loadMcpConfigFromPath(getProjectMcpPath(workspace)),
    loadMcpConfigFromPath(getMcpConfigPath()),
  ]);

  // Dedupe: first occurrence wins (highest priority)
  return dedupeServers([
    ...dotMcp.map((s) => ({ ...s, scope: "dotmcp" as const })),
    ...(projectConfig?.servers ?? []).map((s) => ({ ...s, scope: "project" as const })),
    ...(userConfig?.servers ?? []).map((s) => ({ ...s, scope: "user" as const })),
  ]);
}

// ============================================================
// Saving
// ============================================================

async function saveMcpConfig(
  path: string,
  config: McpConfig,
): Promise<void> {
  const platform = getPlatform();
  const dir = platform.path.dirname(path);
  await platform.fs.mkdir(dir, { recursive: true });
  await platform.fs.writeTextFile(path, JSON.stringify(config, null, 2) + "\n");
}

function getScopePath(scope: "project" | "user", workspace: string): string {
  return scope === "user" ? getMcpConfigPath() : getProjectMcpPath(workspace);
}

export async function addServerToConfig(
  scope: "project" | "user",
  workspace: string,
  server: McpServerConfig,
): Promise<void> {
  const path = getScopePath(scope, workspace);
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
  scope: "project" | "user",
  workspace: string,
  serverName: string,
): Promise<boolean> {
  const path = getScopePath(scope, workspace);
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
// Built-in Server Discovery
// ============================================================

export async function resolveBuiltinMcpServers(
  workspace: string,
): Promise<McpServerConfig[]> {
  const platform = getPlatform();
  const scriptPath = platform.path.join(workspace, ...PLAYWRIGHT_SERVER_SCRIPT);
  try {
    const stat = await platform.fs.stat(scriptPath);
    if (stat.isFile) {
      return [{
        name: PLAYWRIGHT_SERVER_NAME,
        command: ["node", scriptPath],
      }];
    }
  } catch {
    // Optional built-in server is unavailable in this workspace.
  }
  return [];
}

// ============================================================
// Shared Utilities
// ============================================================

function normalizeServerName(name: string): string {
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
    scopeLabel: s.scope === "dotmcp" ? ".mcp.json" : s.scope,
  };
}

export function isMcpServerConfig(value: unknown): value is McpServerConfig {
  if (!isObjectValue(value)) return false;
  if (typeof value.name !== "string") return false;
  // Stdio transport: requires command array
  if (Array.isArray(value.command) && value.command.length > 0) {
    if (!value.command.every((c: unknown) => typeof c === "string")) {
      return false;
    }
    return true;
  }
  // HTTP transport: requires url
  if (typeof value.url === "string" && value.url.length > 0) return true;
  return false;
}
