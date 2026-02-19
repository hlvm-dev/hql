/**
 * MCP Config — Loading and validation of MCP server configurations.
 */

import { getPlatform } from "../../../platform/platform.ts";
import { getErrorMessage, isObjectValue } from "../../../common/utils.ts";
import { getAgentLogger } from "../logger.ts";
import type { McpConfig, McpServerConfig } from "./types.ts";

const MCP_FILE_NAME = "mcp.json";
const MCP_DIR_NAME = ".hlvm";
const PLAYWRIGHT_SERVER_NAME = "playwright";
const PLAYWRIGHT_SERVER_SCRIPT = ["scripts", "mcp", "playwright-server.mjs"];

function getDefaultMcpPath(workspace: string): string {
  const platform = getPlatform();
  return platform.path.join(workspace, MCP_DIR_NAME, MCP_FILE_NAME);
}

export async function loadMcpConfig(
  workspace: string,
  configPath?: string,
): Promise<McpConfig | null> {
  const platform = getPlatform();
  const path = configPath ?? getDefaultMcpPath(workspace);

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

export function dedupeServers(servers: McpServerConfig[]): McpServerConfig[] {
  const seenNames = new Set<string>();
  const deduped: McpServerConfig[] = [];
  for (const server of servers) {
    const key = server.name.trim().toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    deduped.push(server);
  }
  return deduped;
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
