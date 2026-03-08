/**
 * CLI Command — hlvm mcp
 * Add, list, and remove MCP (Model Context Protocol) servers.
 */

import { log } from "../../api/log.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { ValidationError } from "../../../common/error.ts";
import {
  addRuntimeMcpServer,
  listRuntimeMcpServers,
  loginRuntimeMcpServer,
  logoutRuntimeMcpServer,
  removeRuntimeMcpServer,
} from "../../runtime/host-client.ts";
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
  --env KEY=VALUE              Environment variable (repeatable)

Examples:
  hlvm mcp add github -- npx -y @modelcontextprotocol/server-github
  hlvm mcp add db --url http://localhost:8080
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
  switch (subcommand) {
    case "add":
      return await mcpAdd(subArgs);
    case "list":
    case "ls":
      return await mcpList();
    case "remove":
    case "rm":
      return await mcpRemove(subArgs);
    case "login":
      return await mcpLogin(subArgs);
    case "logout":
      return await mcpLogout(subArgs);
    default:
      throw new ValidationError(
        `Unknown mcp command: ${subcommand}. Run 'hlvm mcp --help' for usage.`,
        "mcp",
      );
  }
}

// ============================================================
// Add
// ============================================================

function parseEnvVars(args: string[]): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--env" && i + 1 < args.length) {
      const pair = args[i + 1];
      const eqIdx = pair.indexOf("=");
      if (eqIdx <= 0) {
        throw new ValidationError(
          `Invalid --env format: ${pair}. Expected KEY=VALUE.`,
          "mcp",
        );
      }
      env[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
      i++; // skip value
    }
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

async function mcpAdd(args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new ValidationError(
      "Missing server name. Usage: hlvm mcp add <name> -- <command...>",
      "mcp",
    );
  }

  const name = args[0];
  const dashDashIdx = args.indexOf("--");
  const optionArgs = dashDashIdx === -1
    ? args.slice(1)
    : args.slice(1, dashDashIdx);
  const env = parseEnvVars(optionArgs);

  // Check for --url (HTTP transport)
  const urlIdx = optionArgs.indexOf("--url");
  if (urlIdx !== -1) {
    if (urlIdx + 1 >= optionArgs.length) {
      throw new ValidationError("Missing URL after --url.", "mcp");
    }
    const url = optionArgs[urlIdx + 1];
    await addRuntimeMcpServer({
      server: { name, url, env },
    });
    log.raw.log(`Added MCP server "${name}" (global, http)`);
    return;
  }

  // Check for -- (stdio transport)
  if (dashDashIdx === -1) {
    throw new ValidationError(
      "Missing command. Use: hlvm mcp add <name> -- <command...> or hlvm mcp add <name> --url <url>",
      "mcp",
    );
  }

  const command = args.slice(dashDashIdx + 1);
  if (command.length === 0) {
    throw new ValidationError("Empty command after '--'.", "mcp");
  }

  await addRuntimeMcpServer({
    server: { name, command, env },
  });
  log.raw.log(`Added MCP server "${name}" (global, stdio)`);
}

// ============================================================
// List
// ============================================================

async function mcpList(): Promise<void> {
  const servers = await listRuntimeMcpServers();

  if (servers.length === 0) {
    log.raw.log("No MCP servers configured. Use 'hlvm mcp add' to add one.");
    return;
  }

  log.raw.log("MCP Servers:");
  for (const server of servers) {
    log.raw.log(
      `  ${server.name.padEnd(20)} ${server.transport.padEnd(6)} ${
        server.target.padEnd(40)
      } (${server.scopeLabel})`,
    );
  }
}

// ============================================================
// Remove
// ============================================================

async function mcpRemove(args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new ValidationError(
      "Missing server name. Usage: hlvm mcp remove <name>",
      "mcp",
    );
  }

  const name = args[0];
  const result = await removeRuntimeMcpServer({ name });
  if (result.removed) {
    log.raw.log(`Removed MCP server "${name}" from global scope`);
    return;
  }
  log.raw.log(`MCP server "${name}" not found`);
}

async function mcpLogin(args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new ValidationError(
      "Missing server name. Usage: hlvm mcp login <name>",
      "mcp",
    );
  }
  if (!getPlatform().terminal.stdin.isTerminal()) {
    throw new ValidationError(
      "OAuth login requires an interactive terminal.",
      "mcp",
    );
  }

  const result = await loginRuntimeMcpServer({ name: args[0] });
  for (const line of result.messages) {
    log.raw.log(line);
  }
}

async function mcpLogout(args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new ValidationError(
      "Missing server name. Usage: hlvm mcp logout <name>",
      "mcp",
    );
  }
  const result = await logoutRuntimeMcpServer({ name: args[0] });
  if (result.removed) {
    log.raw.log(`Removed OAuth token for MCP server "${result.serverName}"`);
  } else {
    log.raw.log(`No OAuth token stored for MCP server "${result.serverName}"`);
  }
}
