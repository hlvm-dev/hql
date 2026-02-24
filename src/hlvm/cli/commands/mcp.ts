/**
 * CLI Command — hlvm mcp
 * Add, list, and remove MCP (Model Context Protocol) servers.
 */

import { log } from "../../api/log.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { ValidationError } from "../../../common/error.ts";
import {
  addServerToConfig,
  formatServerEntry,
  loadMcpConfigMultiScope,
  normalizeServerName,
  removeServerFromConfig,
} from "../../agent/mcp/config.ts";
import {
  loginMcpHttpServer,
  logoutMcpHttpServer,
} from "../../agent/mcp/oauth.ts";
import type { McpServerConfig } from "../../agent/mcp/types.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";

export function showMcpHelp(): void {
  log.raw.log(`
MCP (Model Context Protocol) — Connect AI to external tools

Usage: hlvm mcp <command> [options]

Commands:
  add <name> -- <command...>   Add a stdio MCP server
  add <name> --url <url>       Add an HTTP MCP server
  list                         List configured MCP servers
  remove <name>                Remove an MCP server
  login <name>                 Authenticate an HTTP MCP server via OAuth
  logout <name>                Remove stored OAuth token for server

Options:
  --scope project|user         Config scope (default: project)
  --env KEY=VALUE              Environment variable (repeatable)

Examples:
  hlvm mcp add github -- npx -y @modelcontextprotocol/server-github
  hlvm mcp add db --url http://localhost:8080 --scope user
  hlvm mcp list
  hlvm mcp remove github
  hlvm mcp login notion
  hlvm mcp logout notion
`);
}

export async function mcpCommand(args: string[]): Promise<void> {
  if (args.length === 0 || hasHelpFlag(args)) {
    showMcpHelp();
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);
  const workspace = getPlatform().process.cwd();

  switch (subcommand) {
    case "add":
      return await mcpAdd(subArgs, workspace);
    case "list":
    case "ls":
      return await mcpList(workspace);
    case "remove":
    case "rm":
      return await mcpRemove(subArgs, workspace);
    case "login":
      return await mcpLogin(subArgs, workspace);
    case "logout":
      return await mcpLogout(subArgs, workspace);
    default:
      throw new ValidationError(
        `Unknown mcp command: ${subcommand}. Run 'hlvm mcp --help' for usage.`,
      );
  }
}

// ============================================================
// Add
// ============================================================

function parseScope(
  args: string[],
  defaultScope: "project" | "user" = "project",
): "project" | "user" {
  const idx = args.indexOf("--scope");
  if (idx === -1) return defaultScope;
  if (idx + 1 >= args.length) {
    throw new ValidationError(
      "Missing value after --scope. Must be 'project' or 'user'.",
    );
  }
  const val = args[idx + 1];
  if (val === "user") return "user";
  if (val === "project") return "project";
  throw new ValidationError(
    `Invalid scope: ${val}. Must be 'project' or 'user'.`,
  );
}

function parseEnvVars(args: string[]): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--env" && i + 1 < args.length) {
      const pair = args[i + 1];
      const eqIdx = pair.indexOf("=");
      if (eqIdx <= 0) {
        throw new ValidationError(
          `Invalid --env format: ${pair}. Expected KEY=VALUE.`,
        );
      }
      env[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
      i++; // skip value
    }
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

async function mcpAdd(args: string[], workspace: string): Promise<void> {
  if (args.length === 0) {
    throw new ValidationError(
      "Missing server name. Usage: hlvm mcp add <name> -- <command...>",
    );
  }

  const name = args[0];
  const dashDashIdx = args.indexOf("--");
  const optionArgs = dashDashIdx === -1
    ? args.slice(1)
    : args.slice(1, dashDashIdx);
  const scope = parseScope(optionArgs);
  const env = parseEnvVars(optionArgs);

  // Check for --url (HTTP transport)
  const urlIdx = optionArgs.indexOf("--url");
  if (urlIdx !== -1) {
    if (urlIdx + 1 >= optionArgs.length) {
      throw new ValidationError("Missing URL after --url.");
    }
    const url = optionArgs[urlIdx + 1];
    const server: McpServerConfig = { name, url, env };
    await addServerToConfig(scope, workspace, server);
    log.raw.log(`Added MCP server "${name}" (${scope} scope, http)`);
    return;
  }

  // Check for -- (stdio transport)
  if (dashDashIdx === -1) {
    throw new ValidationError(
      "Missing command. Use: hlvm mcp add <name> -- <command...> or hlvm mcp add <name> --url <url>",
    );
  }

  const command = args.slice(dashDashIdx + 1);
  if (command.length === 0) {
    throw new ValidationError("Empty command after '--'.");
  }

  const server: McpServerConfig = { name, command, env };
  await addServerToConfig(scope, workspace, server);
  log.raw.log(`Added MCP server "${name}" (${scope} scope, stdio)`);
}

// ============================================================
// List
// ============================================================

async function mcpList(workspace: string): Promise<void> {
  const servers = await loadMcpConfigMultiScope(workspace);

  if (servers.length === 0) {
    log.raw.log("No MCP servers configured. Use 'hlvm mcp add' to add one.");
    return;
  }

  log.raw.log("MCP Servers:");
  for (const s of servers) {
    const { transport, target, scopeLabel } = formatServerEntry(s);
    log.raw.log(
      `  ${s.name.padEnd(20)} ${transport.padEnd(6)} ${
        target.padEnd(40)
      } (${scopeLabel})`,
    );
  }
}

// ============================================================
// Remove
// ============================================================

async function mcpRemove(args: string[], workspace: string): Promise<void> {
  if (args.length === 0) {
    throw new ValidationError(
      "Missing server name. Usage: hlvm mcp remove <name>",
    );
  }

  const name = args[0];
  const scopeFlag = args.indexOf("--scope");

  if (scopeFlag !== -1) {
    // Explicit scope
    const scope = parseScope(args);
    const removed = await removeServerFromConfig(scope, workspace, name);
    if (removed) {
      log.raw.log(`Removed MCP server "${name}" from ${scope} scope`);
    } else {
      log.raw.log(`MCP server "${name}" not found in ${scope} scope`);
    }
    return;
  }

  // Default: try project first, then user
  if (await removeServerFromConfig("project", workspace, name)) {
    log.raw.log(`Removed MCP server "${name}" from project scope`);
    return;
  }
  if (await removeServerFromConfig("user", workspace, name)) {
    log.raw.log(`Removed MCP server "${name}" from user scope`);
    return;
  }
  log.raw.log(`MCP server "${name}" not found in any scope`);
}

// ============================================================
// OAuth Login / Logout
// ============================================================

async function resolveServerByName(
  workspace: string,
  name: string,
): Promise<McpServerConfig | null> {
  const servers = await loadMcpConfigMultiScope(workspace);
  const key = normalizeServerName(name);
  return servers.find((s) => normalizeServerName(s.name) === key) ?? null;
}

async function mcpLogin(args: string[], workspace: string): Promise<void> {
  if (args.length === 0) {
    throw new ValidationError(
      "Missing server name. Usage: hlvm mcp login <name>",
    );
  }
  if (!getPlatform().terminal.stdin.isTerminal()) {
    throw new ValidationError(
      "OAuth login requires an interactive terminal.",
      "mcp",
    );
  }

  const name = args[0];
  const server = await resolveServerByName(workspace, name);
  if (!server) {
    throw new ValidationError(
      `MCP server '${name}' not found. Run 'hlvm mcp list'.`,
      "mcp",
    );
  }
  if (!server.url) {
    throw new ValidationError(
      `MCP server '${name}' is stdio-only. OAuth login is for HTTP servers.`,
      "mcp",
    );
  }

  await loginMcpHttpServer(server, {
    output: (line) => log.raw.log(line),
    openBrowser: (url) => getPlatform().openUrl(url),
  });
}

async function mcpLogout(args: string[], workspace: string): Promise<void> {
  if (args.length === 0) {
    throw new ValidationError(
      "Missing server name. Usage: hlvm mcp logout <name>",
    );
  }
  const name = args[0];
  const server = await resolveServerByName(workspace, name);
  if (!server) {
    throw new ValidationError(
      `MCP server '${name}' not found. Run 'hlvm mcp list'.`,
      "mcp",
    );
  }
  if (!server.url) {
    throw new ValidationError(
      `MCP server '${name}' is stdio-only. No OAuth token to remove.`,
      "mcp",
    );
  }
  const removed = await logoutMcpHttpServer(server);
  if (removed) {
    log.raw.log(`Removed OAuth token for MCP server "${server.name}"`);
  } else {
    log.raw.log(`No OAuth token stored for MCP server "${server.name}"`);
  }
}
