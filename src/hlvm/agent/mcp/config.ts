/**
 * MCP Config — Loading, saving, and global management of MCP server configurations.
 */

import { parse as parseToml } from "@std/toml";
import { getPlatform } from "../../../platform/platform.ts";
import { atomicWriteTextFile } from "../../../common/atomic-file.ts";
import { getErrorMessage, isObjectValue } from "../../../common/utils.ts";
import { getAgentLogger } from "../logger.ts";
import {
  getClaudeCodeMcpDir,
  getCodexConfigPath,
  getCursorMcpPath,
  getGeminiSettingsPath,
  getMcpConfigPath,
  getWindsurfMcpPaths,
  getZedSettingsPath,
} from "../../../common/paths.ts";
import type { McpConfig, McpServerConfig } from "./types.ts";
import { expandMcpServerEnv } from "./env-expansion.ts";
import { sanitizeToolName } from "../tool-schema.ts";

const DOT_MCP_FILE = ".mcp.json";
const CLAUDE_PLUGIN_COLLECTION_DIRS = new Set(["external_plugins", "plugins"]);

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

  const rawServers = Array.isArray(parsed.servers)
    ? parsed.servers.filter(isMcpServerConfig)
    : [];
  const servers = expandServersWithWarnings(rawServers, path);

  if (servers.length === 0) return null;
  return { version: 1, servers };
}

/** Scope tag for display and identification */
export type McpScope =
  | "user"
  | "cursor"
  | "windsurf"
  | "zed"
  | "codex"
  | "gemini"
  | "claude-code";

export interface McpServerWithScope extends McpServerConfig {
  scope: McpScope;
}

/**
 * Load MCP servers from all global scopes, merged with deduplication.
 *
 * Priority (first match wins):
 *   user (~/.hlvm/mcp.json) > cursor > windsurf > zed > codex > gemini > claude-code
 *
 * Each source is read independently; a malformed or missing source never
 * blocks the others. HLVM inherits MCP servers already configured in any
 * supported agent tool, giving the user zero-config continuity.
 */
export async function loadMcpConfigMultiScope(): Promise<McpServerWithScope[]> {
  const [
    userConfig,
    cursorServers,
    windsurfServers,
    zedServers,
    codexServers,
    geminiServers,
    claudeServers,
  ] = await Promise.all([
    loadMcpConfigFromPath(getMcpConfigPath()),
    loadCursorMcpServers(),
    loadWindsurfMcpServers(),
    loadZedMcpServers(),
    loadCodexMcpServers(),
    loadGeminiMcpServers(),
    loadClaudeCodeMcpServers(),
  ]);

  return dedupeServers([
    ...(userConfig?.servers ?? []).map((s) => ({
      ...s,
      scope: "user" as const,
    })),
    ...cursorServers.map((s) => ({ ...s, scope: "cursor" as const })),
    ...windsurfServers.map((s) => ({ ...s, scope: "windsurf" as const })),
    ...zedServers.map((s) => ({ ...s, scope: "zed" as const })),
    ...codexServers.map((s) => ({ ...s, scope: "codex" as const })),
    ...geminiServers.map((s) => ({ ...s, scope: "gemini" as const })),
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
  const rawType = typeof entry.type === "string" ? entry.type : undefined;
  const type = rawType === undefined
    ? undefined
    : rawType === "streamableHttp" || rawType === "streamable-http"
    ? "http"
    : rawType;
  if (
    type !== undefined &&
    type !== "stdio" &&
    type !== "http" &&
    type !== "sse"
  ) {
    return null;
  }

  const env = isObjectValue(entry.env)
    ? Object.fromEntries(
      Object.entries(entry.env as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => [k, v as string]),
    )
    : undefined;

  const disabledToolsValue = Array.isArray(entry.disabled_tools)
    ? entry.disabled_tools
    : Array.isArray(entry.excludeTools)
    ? entry.excludeTools
    : undefined;
  const disabled_tools = Array.isArray(disabledToolsValue)
    ? disabledToolsValue.filter((t: unknown) =>
      typeof t === "string"
    ) as string[]
    : undefined;
  const connection_timeout_ms =
    typeof entry.connection_timeout_ms === "number" &&
      Number.isFinite(entry.connection_timeout_ms) &&
      entry.connection_timeout_ms > 0
      ? Math.floor(entry.connection_timeout_ms)
      : typeof entry.timeout === "number" &&
          Number.isFinite(entry.timeout) &&
          entry.timeout > 0
      ? Math.floor(entry.timeout)
      : undefined;
  const cwd = typeof entry.cwd === "string" && entry.cwd.length > 0
    ? entry.cwd
    : undefined;
  const headers = isObjectValue(entry.headers)
    ? Object.fromEntries(
      Object.entries(entry.headers as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => [k, v as string]),
    )
    : undefined;
  const transport = type === "sse"
    ? "sse"
    : type === "http"
    ? "http"
    : undefined;
  const oauth = isObjectValue(entry.oauth)
    ? parseClaudeCodeOAuthConfig(entry.oauth as Record<string, unknown>)
    : undefined;
  const url = typeof entry.url === "string"
    ? entry.url
    : typeof entry.serverUrl === "string"
    ? entry.serverUrl
    : undefined;

  // HTTP / SSE transport
  if (typeof url === "string") {
    if (type === "stdio") return null;
    return {
      name,
      url,
      ...(transport ? { transport } : {}),
      ...(cwd ? { cwd } : {}),
      ...(headers ? { headers } : {}),
      ...(oauth ? { oauth } : {}),
      ...(env ? { env } : {}),
      ...(disabled_tools ? { disabled_tools } : {}),
      ...(connection_timeout_ms ? { connection_timeout_ms } : {}),
    };
  }

  // Stdio transport: command + args
  if (typeof entry.command === "string") {
    if (type === "http" || type === "sse") return null;
    const args = Array.isArray(entry.args)
      ? entry.args.filter((a: unknown) => typeof a === "string") as string[]
      : [];
    return {
      name,
      command: [entry.command, ...args],
      ...(cwd ? { cwd } : {}),
      ...(env ? { env } : {}),
      ...(oauth ? { oauth } : {}),
      ...(disabled_tools ? { disabled_tools } : {}),
      ...(connection_timeout_ms ? { connection_timeout_ms } : {}),
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
  const mcpPaths = await collectClaudeCodeMcpPaths(pluginsDir);
  if (mcpPaths.length === 0) return [];

  // Read all .mcp.json files in parallel
  const results = await Promise.allSettled(
    mcpPaths.map(async (mcpPath) => {
      const content = await platform.fs.readTextFile(mcpPath);
      const claudePluginEnv = await buildClaudePluginEnv(mcpPath);
      return expandServersWithWarnings(
        parseClaudeCodeMcpJson(
          content,
          platform.path.basename(platform.path.dirname(mcpPath)),
        ),
        mcpPath,
        claudePluginEnv,
      );
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
// Cross-Tool MCP Imports (Cursor, Windsurf, Zed, Codex, Gemini)
// ============================================================

function parseMcpServersMap(
  map: Record<string, unknown>,
): McpServerConfig[] {
  const servers: McpServerConfig[] = [];
  for (const [name, value] of Object.entries(map)) {
    if (!isObjectValue(value)) continue;
    const config = parseClaudeCodeServerEntry(
      name,
      value as Record<string, unknown>,
    );
    if (config) servers.push(config);
  }
  return servers;
}

async function readServersFromJsonKey(
  paths: string | string[],
  key: string,
  sourceLabel: string,
): Promise<McpServerConfig[]> {
  const platform = getPlatform();
  const candidates = Array.isArray(paths) ? paths : [paths];
  const servers: McpServerConfig[] = [];

  for (const path of candidates) {
    let content: string;
    try {
      content = await platform.fs.readTextFile(path);
    } catch {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      getAgentLogger().warn(
        `${sourceLabel} MCP config JSON invalid (${path}): ${
          getErrorMessage(error)
        }`,
      );
      continue;
    }

    if (!isObjectValue(parsed)) continue;
    const section = (parsed as Record<string, unknown>)[key];
    if (!isObjectValue(section)) continue;

    servers.push(
      ...expandServersWithWarnings(
        parseMcpServersMap(section as Record<string, unknown>),
        path,
      ),
    );
  }

  return dedupeServers(servers);
}

async function loadCursorMcpServers(): Promise<McpServerConfig[]> {
  return await readServersFromJsonKey(
    getCursorMcpPath(),
    "mcpServers",
    "Cursor",
  );
}

async function loadWindsurfMcpServers(): Promise<McpServerConfig[]> {
  return await readServersFromJsonKey(
    getWindsurfMcpPaths(),
    "mcpServers",
    "Windsurf",
  );
}

async function loadGeminiMcpServers(): Promise<McpServerConfig[]> {
  return await readServersFromJsonKey(
    getGeminiSettingsPath(),
    "mcpServers",
    "Gemini CLI",
  );
}

/**
 * Zed settings use either a flat custom-server shape (`command`, `args`, `env`)
 * or a nested command object (`command.{path,args,env}`).
 * We reshape each entry into the Claude Code style before parsing so the
 * existing validator/OAuth handling applies uniformly.
 */
async function loadZedMcpServers(): Promise<McpServerConfig[]> {
  const platform = getPlatform();
  const path = getZedSettingsPath();
  let content: string;
  try {
    content = await platform.fs.readTextFile(path);
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    getAgentLogger().warn(
      `Zed settings JSON invalid (${path}): ${getErrorMessage(error)}`,
    );
    return [];
  }

  if (!isObjectValue(parsed)) return [];
  const section = (parsed as Record<string, unknown>).context_servers;
  if (!isObjectValue(section)) return [];

  const normalized: Record<string, unknown> = {};
  for (
    const [name, raw] of Object.entries(section as Record<string, unknown>)
  ) {
    if (!isObjectValue(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (entry.enabled === false) continue;

    if (isObjectValue(entry.command)) {
      const cmd = entry.command as Record<string, unknown>;
      if (typeof cmd.path !== "string") continue;
      const args = Array.isArray(cmd.args)
        ? cmd.args.filter((a: unknown) => typeof a === "string")
        : [];
      const env = isObjectValue(cmd.env)
        ? cmd.env
        : isObjectValue(entry.env)
        ? entry.env
        : undefined;
      normalized[name] = {
        command: cmd.path,
        args,
        ...(env ? { env } : {}),
        ...(typeof entry.cwd === "string" ? { cwd: entry.cwd } : {}),
      };
      continue;
    }

    if (typeof entry.command === "string") {
      normalized[name] = {
        command: entry.command,
        ...(Array.isArray(entry.args) ? { args: entry.args } : {}),
        ...(isObjectValue(entry.env) ? { env: entry.env } : {}),
        ...(typeof entry.cwd === "string" ? { cwd: entry.cwd } : {}),
      };
      continue;
    }

    if (
      typeof entry.url === "string" || typeof entry.serverUrl === "string"
    ) {
      normalized[name] = { ...entry };
    }
  }

  return expandServersWithWarnings(parseMcpServersMap(normalized), path);
}

/**
 * Codex CLI stores MCP servers in TOML under `[mcp_servers.<name>]`.
 * Normalize into the Claude Code-compatible shape and reuse parsing.
 */
async function loadCodexMcpServers(): Promise<McpServerConfig[]> {
  const platform = getPlatform();
  const path = getCodexConfigPath();
  let content: string;
  try {
    content = await platform.fs.readTextFile(path);
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = parseToml(content);
  } catch (error) {
    getAgentLogger().warn(
      `Codex config TOML invalid (${path}): ${getErrorMessage(error)}`,
    );
    return [];
  }

  if (!isObjectValue(parsed)) return [];
  const section = (parsed as Record<string, unknown>).mcp_servers;
  if (!isObjectValue(section)) return [];

  return expandServersWithWarnings(
    parseMcpServersMap(section as Record<string, unknown>),
    path,
  );
}

function parseClaudeCodeOAuthConfig(
  value: Record<string, unknown>,
): McpServerConfig["oauth"] {
  const clientId = typeof value.clientId === "string"
    ? value.clientId
    : undefined;
  const callbackPort = typeof value.callbackPort === "number" &&
      Number.isFinite(value.callbackPort) &&
      value.callbackPort > 0
    ? Math.floor(value.callbackPort)
    : undefined;
  const authServerMetadataUrl = typeof value.authServerMetadataUrl === "string"
    ? value.authServerMetadataUrl
    : undefined;
  const xaa = typeof value.xaa === "boolean" ? value.xaa : undefined;
  if (
    clientId === undefined &&
    callbackPort === undefined &&
    authServerMetadataUrl === undefined &&
    xaa === undefined
  ) {
    return undefined;
  }
  return {
    ...(clientId ? { clientId } : {}),
    ...(callbackPort ? { callbackPort } : {}),
    ...(authServerMetadataUrl ? { authServerMetadataUrl } : {}),
    ...(xaa !== undefined ? { xaa } : {}),
  };
}

async function collectClaudeCodeMcpPaths(rootDir: string): Promise<string[]> {
  const platform = getPlatform();
  const rootName = platform.path.basename(rootDir);
  if (CLAUDE_PLUGIN_COLLECTION_DIRS.has(rootName)) {
    return await collectPluginCollectionMcpPaths(rootDir);
  }

  const results: string[] = [];
  try {
    for await (const entry of platform.fs.readDir(rootDir)) {
      if (!entry.isDirectory) continue;
      if (CLAUDE_PLUGIN_COLLECTION_DIRS.has(entry.name)) {
        results.push(
          ...await collectPluginCollectionMcpPaths(
            platform.path.join(rootDir, entry.name),
          ),
        );
        continue;
      }
      if (rootName === "marketplaces") {
        results.push(
          ...await collectClaudeCodeMcpPaths(
            platform.path.join(rootDir, entry.name),
          ),
        );
      }
    }
  } catch {
    return [];
  }

  return results;
}

async function collectPluginCollectionMcpPaths(
  rootDir: string,
): Promise<string[]> {
  const platform = getPlatform();
  const results: string[] = [];
  try {
    for await (const entry of platform.fs.readDir(rootDir)) {
      if (!entry.isDirectory) continue;
      const mcpPath = platform.path.join(rootDir, entry.name, DOT_MCP_FILE);
      try {
        const info = await platform.fs.stat(mcpPath);
        if (info.isFile) {
          results.push(mcpPath);
        }
      } catch {
        // Ignore plugin directories without MCP manifests.
      }
    }
  } catch {
    return [];
  }
  return results;
}

async function buildClaudePluginEnv(
  mcpPath: string,
): Promise<Record<string, string> | undefined> {
  const platform = getPlatform();
  const pluginRoot = platform.path.dirname(mcpPath);
  const parentDir = platform.path.dirname(pluginRoot);
  const parentName = platform.path.basename(parentDir);
  if (!CLAUDE_PLUGIN_COLLECTION_DIRS.has(parentName)) {
    return { CLAUDE_PLUGIN_ROOT: pluginRoot };
  }

  const marketplaceDir = platform.path.dirname(parentDir);
  const marketplaceName = platform.path.basename(marketplaceDir);
  const pluginsDir = platform.path.dirname(
    platform.path.dirname(marketplaceDir),
  );
  const pluginId = sanitizeClaudePluginId(
    `${platform.path.basename(pluginRoot)}-${marketplaceName}`,
  );
  const pluginDataDir = platform.path.join(pluginsDir, "data", pluginId);
  await platform.fs.mkdir(pluginDataDir, { recursive: true });
  return {
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    CLAUDE_PLUGIN_DATA: pluginDataDir,
  };
}

function sanitizeClaudePluginId(value: string): string {
  return value.replace(/[^a-zA-Z0-9\-_]/g, "-");
}

// ============================================================
// Saving
// ============================================================

async function saveMcpConfig(path: string, config: McpConfig): Promise<void> {
  const platform = getPlatform();
  const dir = platform.path.dirname(path);
  await platform.fs.mkdir(dir, { recursive: true });
  await atomicWriteTextFile(path, JSON.stringify(config, null, 2) + "\n");
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

function tokenizeMcpSearchText(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function buildMcpServerSearchText(server: McpServerConfig): string {
  return tokenizeMcpSearchText([
    server.name,
    ...(server.command ?? []),
    server.url ?? "",
    server.transport ?? "",
  ].join(" ")).join(" ");
}

function scoreMcpServerMatch(
  server: McpServerConfig,
  query: string,
): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;

  const normalizedName = normalizeServerName(server.name);
  const haystack = buildMcpServerSearchText(server);
  const tokens = tokenizeMcpSearchText(query);
  let score = 0;

  if (normalizedName === normalizedQuery) {
    score += 12;
  } else if (normalizedName.startsWith(normalizedQuery)) {
    score += 8;
  } else if (normalizedName.includes(normalizedQuery)) {
    score += 6;
  }

  for (const token of tokens) {
    if (normalizedName === token) {
      score += 6;
      continue;
    }
    if (normalizedName.startsWith(token)) {
      score += 4;
      continue;
    }
    if (normalizedName.includes(token)) {
      score += 3;
      continue;
    }
    if (haystack.includes(token)) {
      score += 1;
    }
  }

  if (tokens.length > 0 && tokens.every((token) => haystack.includes(token))) {
    score += 4;
  }

  return score;
}

export function rankMcpServersForQuery<T extends McpServerConfig>(
  servers: readonly T[],
  query: string,
): T[] {
  return servers
    .map((server, index) => ({
      server,
      index,
      score: scoreMcpServerMatch(server, query),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.server.name.length !== b.server.name.length) {
        return a.server.name.length - b.server.name.length;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.server);
}

export function findMcpServersForExactToolName<T extends McpServerConfig>(
  servers: readonly T[],
  toolName: string,
): T[] {
  if (!toolName.startsWith("mcp_")) return [];

  const matches = servers
    .map((server) => ({
      server,
      prefix: sanitizeToolName(`mcp_${server.name}_`),
    }))
    .filter(({ prefix }) => toolName.startsWith(prefix));

  if (matches.length === 0) return [];

  const longestPrefix = Math.max(...matches.map((match) => match.prefix.length));
  return matches
    .filter((match) => match.prefix.length === longestPrefix)
    .map((match) => match.server);
}

const SCOPE_LABELS: Record<McpScope, string> = {
  "user": "user",
  "cursor": "Cursor",
  "windsurf": "Windsurf",
  "zed": "Zed",
  "codex": "Codex",
  "gemini": "Gemini CLI",
  "claude-code": "Claude Code",
};

/**
 * Full-sentence scope descriptions, used in `hlvm mcp get` output.
 * Style mirrors Claude Code's `get` output (e.g. "User config (available
 * in all your projects)").
 */
const SCOPE_DESCRIPTIONS: Record<McpScope, string> = {
  "user": "User config (available in all your projects)",
  "cursor": "Cursor config (inherited from ~/.cursor/mcp.json)",
  "windsurf":
    "Windsurf config (inherited from ~/.codeium/windsurf/mcp_config.json)",
  "zed": "Zed config (inherited from ~/.config/zed/settings.json)",
  "codex": "Codex CLI config (inherited from ~/.codex/config.toml)",
  "gemini": "Gemini CLI config (inherited from ~/.gemini/settings.json)",
  "claude-code":
    "Claude Code plugin config (inherited from ~/.claude/plugins/...)",
};

export function getScopeDescription(scope: McpScope): string {
  return SCOPE_DESCRIPTIONS[scope] ?? String(scope);
}

/** Format a server entry for display (shared by CLI and REPL) */
export function formatServerEntry(s: McpServerWithScope): {
  transport: string;
  target: string;
  scopeLabel: string;
} {
  return {
    transport: s.url ? (s.transport ?? "http") : "stdio",
    target: s.url ?? (s.command?.join(" ") ?? ""),
    scopeLabel: SCOPE_LABELS[s.scope] ?? s.scope,
  };
}

export function isMcpServerConfig(value: unknown): value is McpServerConfig {
  if (!isObjectValue(value)) return false;
  if (typeof value.name !== "string") return false;
  if (
    value.oauth !== undefined &&
    !isMcpOAuthConfig(value.oauth)
  ) {
    return false;
  }
  if (
    value.transport !== undefined &&
    value.transport !== "stdio" &&
    value.transport !== "http" &&
    value.transport !== "sse"
  ) {
    return false;
  }
  // Stdio transport: requires command array of strings
  if (Array.isArray(value.command) && value.command.length > 0) {
    return value.command.every((c: unknown) => typeof c === "string");
  }
  // HTTP transport: requires url
  if (typeof value.url === "string" && value.url.length > 0) return true;
  return false;
}

function expandServersWithWarnings(
  servers: readonly McpServerConfig[],
  sourceLabel: string,
  env?: Record<string, string>,
): McpServerConfig[] {
  return servers.map((server) => {
    const expanded = expandMcpServerEnv(server, { env });
    if (expanded.missingVars.length > 0) {
      getAgentLogger().warn(
        `MCP config '${server.name}' in ${sourceLabel} references unset env vars: ${
          expanded.missingVars.join(", ")
        }`,
      );
    }
    if (!env || expanded.server.url) {
      return expanded.server;
    }
    return {
      ...expanded.server,
      env: {
        ...env,
        ...(expanded.server.env ?? {}),
      },
    };
  });
}

function isMcpOAuthConfig(
  value: unknown,
): value is NonNullable<McpServerConfig["oauth"]> {
  if (!isObjectValue(value)) return false;
  if (
    value.clientId !== undefined &&
    typeof value.clientId !== "string"
  ) {
    return false;
  }
  if (
    value.callbackPort !== undefined &&
    (
      typeof value.callbackPort !== "number" ||
      !Number.isFinite(value.callbackPort) ||
      value.callbackPort <= 0
    )
  ) {
    return false;
  }
  if (
    value.authServerMetadataUrl !== undefined &&
    typeof value.authServerMetadataUrl !== "string"
  ) {
    return false;
  }
  if (value.xaa !== undefined && typeof value.xaa !== "boolean") {
    return false;
  }
  return true;
}
