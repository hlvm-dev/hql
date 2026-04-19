/**
 * CLI Command — hlvm mcp
 *
 * Surface is intentionally kept compatible with Claude Code's
 * `claude mcp ...` CLI so users coming from CC hit zero learning curve:
 *   - same subcommand names: add, add-json, get, list, remove, login, logout
 *   - same flag names: -s/--scope, -t/--transport, -e/--env, -H/--header,
 *     --client-id, --client-secret, --callback-port
 *   - same positional layout for add: `add <name> <commandOrUrl> [args...]`
 */

import { log } from "../../api/log.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { ValidationError } from "../../../common/error.ts";
import { getMcpConfigPath } from "../../../common/paths.ts";
import {
  addRuntimeMcpServer,
  listRuntimeMcpServers,
  loginRuntimeMcpServer,
  logoutRuntimeMcpServer,
  removeRuntimeMcpServer,
} from "../../runtime/host-client.ts";
import type { RuntimeMcpServerInput } from "../../runtime/mcp-protocol.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";

export function showMcpHelp(): void {
  log.raw.log(`
MCP (Model Context Protocol) — Connect AI to external tools

Usage: hlvm mcp <command> [options]

Commands:
  add <name> <commandOrUrl> [args...]   Add an MCP server
  add-json <name> <json>                Add an MCP server from a JSON config
  get <name>                            Show details for one MCP server
  list                                  List configured MCP servers
  remove <name>                         Remove an MCP server
  login <name>                          Authenticate an HTTP MCP server via OAuth
  logout <name>                         Remove stored OAuth token for server

Options for 'add':
  -s, --scope <scope>            Config scope: user (default)
                                 [project / local not yet persisted separately]
  -t, --transport <transport>    Transport: stdio | http | sse
                                 (auto-detected from URL if omitted)
  -e, --env KEY=VALUE            Environment variable (repeatable)
  -H, --header "Name: value"     HTTP/SSE header (repeatable)
      --client-id <id>           OAuth client ID (HTTP/SSE only)
      --client-secret            Prompt for OAuth client secret (or env MCP_CLIENT_SECRET)
      --callback-port <port>     OAuth callback port

Examples:
  hlvm mcp add github npx -y @modelcontextprotocol/server-github
  hlvm mcp add github -- npx -y @modelcontextprotocol/server-github
  hlvm mcp add notion https://mcp.notion.com/mcp
  hlvm mcp add db --transport http http://localhost:8080 --header "X-API-Key: foo"
  hlvm mcp add-json gh '{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-github"]}'
  hlvm mcp get notion
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
    case "add-json":
      return await mcpAddJson(subArgs);
    case "get":
      return await mcpGet(subArgs);
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
// add — Claude-Code-compatible grammar
// ============================================================

interface AddFlags {
  scope: "user" | "project" | "local";
  transport?: "stdio" | "http" | "sse";
  env: Record<string, string>;
  headers: Record<string, string>;
  clientId?: string;
  clientSecret: boolean;
  callbackPort?: number;
}

const URL_LIKE_RE = /^(https?:\/\/|localhost[:/])/i;

function isUrlLike(value: string): boolean {
  return URL_LIKE_RE.test(value);
}

function parseHeaderPair(raw: string): [string, string] {
  const colonIdx = raw.indexOf(":");
  if (colonIdx <= 0) {
    throw new ValidationError(
      `Invalid --header format: ${raw}. Expected "Name: value".`,
      "mcp",
    );
  }
  const name = raw.slice(0, colonIdx).trim();
  const value = raw.slice(colonIdx + 1).trim();
  if (!name || !value) {
    throw new ValidationError(
      `Invalid --header format: ${raw}. Expected "Name: value".`,
      "mcp",
    );
  }
  return [name, value];
}

function parseEnvPair(raw: string): [string, string] {
  const eqIdx = raw.indexOf("=");
  if (eqIdx <= 0) {
    throw new ValidationError(
      `Invalid --env format: ${raw}. Expected KEY=VALUE.`,
      "mcp",
    );
  }
  return [raw.slice(0, eqIdx), raw.slice(eqIdx + 1)];
}

function parseTransport(value: string): "stdio" | "http" | "sse" {
  if (value !== "stdio" && value !== "http" && value !== "sse") {
    throw new ValidationError(
      `Invalid transport type: ${value}. Must be one of: stdio, sse, http`,
      "mcp",
    );
  }
  return value;
}

function parseScope(value: string): "user" | "project" | "local" {
  if (value !== "user" && value !== "project" && value !== "local") {
    throw new ValidationError(
      `Invalid scope: ${value}. Must be one of: local, project, user`,
      "mcp",
    );
  }
  return value;
}

/**
 * Split args around the optional `--` separator. Everything after `--` is
 * stdio command+args (passed through untouched). Everything before is
 * subject to option parsing.
 */
function splitStdioSeparator(
  args: string[],
): { opts: string[]; rest: string[] } {
  const idx = args.indexOf("--");
  if (idx === -1) return { opts: args, rest: [] };
  return { opts: args.slice(0, idx), rest: args.slice(idx + 1) };
}

/**
 * Parse `hlvm mcp add` style flags + positionals.
 * Grammar mirrors Claude Code: `add [opts] <name> <commandOrUrl> [args...]`.
 */
function parseAddArgs(args: string[]): {
  name: string;
  commandOrUrl: string;
  rest: string[];
  flags: AddFlags;
} {
  const { opts: preSep, rest: postSep } = splitStdioSeparator(args);

  const flags: AddFlags = {
    scope: "user",
    env: {},
    headers: {},
    clientSecret: false,
  };
  const positionals: string[] = [];

  // Commander-style: once we've collected the name + commandOrUrl (2 positionals),
  // remaining tokens are all positional (variadic command args), even if
  // they look like flags. That way `hlvm mcp add gh npx -y @pkg` works
  // without requiring `--`.
  for (let i = 0; i < preSep.length; i++) {
    const tok = preSep[i];
    const takeNext = (flag: string): string => {
      if (i + 1 >= preSep.length) {
        throw new ValidationError(`Missing value after ${flag}`, "mcp");
      }
      return preSep[++i];
    };

    if (positionals.length >= 2) {
      positionals.push(tok);
      continue;
    }

    switch (tok) {
      case "-s":
      case "--scope":
        flags.scope = parseScope(takeNext(tok));
        break;
      case "-t":
      case "--transport":
        flags.transport = parseTransport(takeNext(tok));
        break;
      case "-e":
      case "--env": {
        const [k, v] = parseEnvPair(takeNext(tok));
        flags.env[k] = v;
        break;
      }
      case "-H":
      case "--header": {
        const [k, v] = parseHeaderPair(takeNext(tok));
        flags.headers[k] = v;
        break;
      }
      case "--client-id":
        flags.clientId = takeNext(tok);
        break;
      case "--client-secret":
        flags.clientSecret = true;
        break;
      case "--callback-port": {
        const raw = takeNext(tok);
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n <= 0) {
          throw new ValidationError(
            `--callback-port must be a positive integer (got "${raw}")`,
            "mcp",
          );
        }
        flags.callbackPort = n;
        break;
      }
      default:
        if (tok.startsWith("-")) {
          throw new ValidationError(`Unknown option: ${tok}`, "mcp");
        }
        positionals.push(tok);
    }
  }

  if (positionals.length < 1) {
    throw new ValidationError(
      "Error: Server name is required.\nUsage: hlvm mcp add <name> <commandOrUrl> [args...]",
      "mcp",
    );
  }
  const name = positionals[0];

  let commandOrUrl: string;
  let rest: string[];
  if (postSep.length > 0) {
    // `hlvm mcp add <name> -- <cmd> [args...]`
    if (positionals.length > 1) {
      throw new ValidationError(
        "Error: Cannot specify positional arguments before '--'.",
        "mcp",
      );
    }
    commandOrUrl = postSep[0];
    rest = postSep.slice(1);
    if (!commandOrUrl) {
      throw new ValidationError("Error: Command is required after '--'.", "mcp");
    }
  } else {
    // `hlvm mcp add <name> <cmdOrUrl> [args...]`
    if (positionals.length < 2) {
      throw new ValidationError(
        "Error: Command is required when server name is provided.\nUsage: hlvm mcp add <name> <commandOrUrl> [args...]",
        "mcp",
      );
    }
    commandOrUrl = positionals[1];
    rest = positionals.slice(2);
  }

  return { name, commandOrUrl, rest, flags };
}

function ensureScopeSupported(scope: "user" | "project" | "local"): void {
  if (scope !== "user") {
    throw new ValidationError(
      `--scope ${scope} is not yet supported (tracked as follow-up). Use --scope user.`,
      "mcp",
    );
  }
}

function buildOAuthConfig(
  flags: AddFlags,
): RuntimeMcpServerInput["oauth"] | undefined {
  const hasOAuth = flags.clientId !== undefined ||
    flags.clientSecret || flags.callbackPort !== undefined;
  if (!hasOAuth) return undefined;
  // Validate --client-secret companion requirement (env)
  if (flags.clientSecret && !getPlatform().env.get("MCP_CLIENT_SECRET")) {
    throw new ValidationError(
      "--client-secret requires MCP_CLIENT_SECRET env var to be set.",
      "mcp",
    );
  }
  return {
    ...(flags.clientId ? { clientId: flags.clientId } : {}),
    ...(flags.callbackPort ? { callbackPort: flags.callbackPort } : {}),
  };
}

async function mcpAdd(args: string[]): Promise<void> {
  const { name, commandOrUrl, rest, flags } = parseAddArgs(args);
  ensureScopeSupported(flags.scope);

  const looksLikeUrl = isUrlLike(commandOrUrl);
  let transport = flags.transport;
  if (!transport) {
    transport = looksLikeUrl ? "http" : "stdio";
  }

  const env = Object.keys(flags.env).length > 0 ? flags.env : undefined;
  const headers = Object.keys(flags.headers).length > 0
    ? flags.headers
    : undefined;
  const oauth = buildOAuthConfig(flags);

  if (transport === "stdio") {
    if (looksLikeUrl && flags.transport === undefined) {
      log.raw.log(
        `Warning: The command "${commandOrUrl}" looks like a URL, but is being interpreted as a stdio server as --transport was not specified.`,
      );
      log.raw.log(
        `If this is an HTTP server, use: hlvm mcp add --transport http ${name} ...`,
      );
      log.raw.log(
        `If this is an SSE server, use: hlvm mcp add --transport sse ${name} ...`,
      );
    }
    if (headers || oauth) {
      log.raw.log(
        `Warning: --header / --client-id / --callback-port are ignored for stdio transport.`,
      );
    }
    await addRuntimeMcpServer({
      server: {
        name,
        command: [commandOrUrl, ...rest],
        env,
        transport: "stdio",
      },
    });
    const restStr = rest.length > 0 ? ` ${rest.join(" ")}` : "";
    log.raw.log(
      `Added stdio MCP server ${name} with command: ${commandOrUrl}${restStr} to ${flags.scope} config`,
    );
    log.raw.log(`File modified: ${getMcpConfigPath()}`);
    return;
  }

  // HTTP / SSE
  if (!looksLikeUrl) {
    throw new ValidationError(
      `Error: URL is required for ${transport.toUpperCase()} transport.`,
      "mcp",
    );
  }
  if (rest.length > 0) {
    throw new ValidationError(
      `Error: Extra arguments (${
        rest.join(" ")
      }) are not valid for ${transport} transport.`,
      "mcp",
    );
  }
  await addRuntimeMcpServer({
    server: {
      name,
      url: commandOrUrl,
      env,
      headers,
      oauth,
      transport,
    },
  });
  log.raw.log(
    `Added ${transport.toUpperCase()} MCP server ${name} with URL: ${commandOrUrl} to ${flags.scope} config`,
  );
  if (headers) {
    log.raw.log(`Headers: ${JSON.stringify(headers, null, 2)}`);
  }
  log.raw.log(`File modified: ${getMcpConfigPath()}`);
}

// ============================================================
// add-json
// ============================================================

interface AddJsonFlags {
  scope: "user" | "project" | "local";
  clientSecret: boolean;
}

function parseAddJsonArgs(
  args: string[],
): { name: string; json: string; flags: AddJsonFlags } {
  const flags: AddJsonFlags = { scope: "user", clientSecret: false };
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    const takeNext = (flag: string): string => {
      if (i + 1 >= args.length) {
        throw new ValidationError(`Missing value after ${flag}`, "mcp");
      }
      return args[++i];
    };
    switch (tok) {
      case "-s":
      case "--scope":
        flags.scope = parseScope(takeNext(tok));
        break;
      case "--client-secret":
        flags.clientSecret = true;
        break;
      default:
        if (tok.startsWith("-")) {
          throw new ValidationError(`Unknown option: ${tok}`, "mcp");
        }
        positionals.push(tok);
    }
  }

  if (positionals.length < 2) {
    throw new ValidationError(
      "Usage: hlvm mcp add-json <name> <json>",
      "mcp",
    );
  }
  return { name: positionals[0], json: positionals[1], flags };
}

async function mcpAddJson(args: string[]): Promise<void> {
  const { name, json, flags } = parseAddJsonArgs(args);
  ensureScopeSupported(flags.scope);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new ValidationError(
      `Error: invalid JSON for add-json: ${
        err instanceof Error ? err.message : String(err)
      }`,
      "mcp",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError(
      "Error: add-json expects a JSON object.",
      "mcp",
    );
  }
  const obj = parsed as Record<string, unknown>;
  const type = typeof obj.type === "string"
    ? (obj.type as "stdio" | "http" | "sse")
    : undefined;
  if (type && type !== "stdio" && type !== "http" && type !== "sse") {
    throw new ValidationError(
      `Invalid transport type: ${type}. Must be one of: stdio, sse, http`,
      "mcp",
    );
  }

  const server: RuntimeMcpServerInput = { name };
  if (typeof obj.command === "string") {
    const args = Array.isArray(obj.args)
      ? obj.args.filter((a): a is string => typeof a === "string")
      : [];
    server.command = [obj.command, ...args];
  }
  if (typeof obj.url === "string") server.url = obj.url;
  if (obj.env && typeof obj.env === "object" && !Array.isArray(obj.env)) {
    server.env = Object.fromEntries(
      Object.entries(obj.env as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
  }
  if (
    obj.headers && typeof obj.headers === "object" && !Array.isArray(obj.headers)
  ) {
    server.headers = Object.fromEntries(
      Object.entries(obj.headers as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
  }
  if (
    obj.oauth && typeof obj.oauth === "object" && !Array.isArray(obj.oauth)
  ) {
    const o = obj.oauth as Record<string, unknown>;
    const oauth: NonNullable<RuntimeMcpServerInput["oauth"]> = {};
    if (typeof o.clientId === "string") oauth.clientId = o.clientId;
    if (typeof o.callbackPort === "number") {
      oauth.callbackPort = o.callbackPort;
    }
    server.oauth = oauth;
  }
  if (type) server.transport = type;
  else server.transport = server.url ? "http" : "stdio";

  if (!server.command && !server.url) {
    throw new ValidationError(
      "Error: add-json requires 'command' (stdio) or 'url' (http/sse).",
      "mcp",
    );
  }

  await addRuntimeMcpServer({ server });
  const typeLabel = (server.transport ?? "stdio") === "stdio"
    ? "stdio"
    : (server.transport ?? "").toUpperCase();
  const descriptor = server.url
    ? `with URL: ${server.url}`
    : `with command: ${(server.command ?? []).join(" ")}`;
  log.raw.log(
    `Added ${typeLabel} MCP server ${name} ${descriptor} to ${flags.scope} config`,
  );
  log.raw.log(`File modified: ${getMcpConfigPath()}`);
}

// ============================================================
// get
// ============================================================

async function mcpGet(args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new ValidationError(
      "Usage: hlvm mcp get <name>",
      "mcp",
    );
  }
  const name = args[0];
  const servers = await listRuntimeMcpServers();
  const key = name.trim().toLowerCase();
  const found = servers.find((s) => s.name.trim().toLowerCase() === key);
  if (!found) {
    throw new ValidationError(
      `No MCP server found with name: ${name}`,
      "mcp",
    );
  }

  log.raw.log(`${found.name}:`);
  log.raw.log(`  Scope: ${found.scopeDescription}`);
  log.raw.log(`  Status: configured`);
  log.raw.log(`  Type: ${found.transport}`);
  if (found.url) {
    log.raw.log(`  URL: ${found.url}`);
    if (found.headers && Object.keys(found.headers).length > 0) {
      log.raw.log(`  Headers:`);
      for (const [k, v] of Object.entries(found.headers)) {
        log.raw.log(`    ${k}: ${v}`);
      }
    }
  } else if (found.command && found.command.length > 0) {
    log.raw.log(`  Command: ${found.command[0]}`);
    if (found.command.length > 1) {
      log.raw.log(`  Args: ${found.command.slice(1).join(" ")}`);
    }
  }
  if (found.env && Object.keys(found.env).length > 0) {
    log.raw.log(`  Environment:`);
    for (const [k, v] of Object.entries(found.env)) {
      log.raw.log(`    ${k}=${v}`);
    }
  }
  const removeHint = found.scope === "user"
    ? `hlvm mcp remove "${found.name}" -s user`
    : `hlvm mcp remove "${found.name}"`;
  log.raw.log(`\nTo remove this server, run: ${removeHint}`);
}

// ============================================================
// list
// ============================================================

async function mcpList(): Promise<void> {
  const servers = await listRuntimeMcpServers();

  if (servers.length === 0) {
    log.raw.log(
      "No MCP servers configured. Use `hlvm mcp add` to add a server.",
    );
    return;
  }

  log.raw.log("Checking MCP server health...\n");
  for (const server of servers) {
    const status = "configured";
    // Scopes CC has ("user") render exactly like CC. Scopes HLVM adds
    // (inherited from Cursor/Codex/etc.) get a trailing ` [source]` suffix
    // so users can see at a glance where a server came from — CC has no
    // equivalent information to match, so this doesn't break parity.
    const scopeSuffix = server.scope === "user"
      ? ""
      : ` [${server.scopeLabel}]`;
    let line: string;
    if (server.transport === "sse") {
      line = `${server.name}: ${server.target} (SSE) - ${status}${scopeSuffix}`;
    } else if (server.transport === "http") {
      line = `${server.name}: ${server.target} (HTTP) - ${status}${scopeSuffix}`;
    } else {
      line = `${server.name}: ${server.target} - ${status}${scopeSuffix}`;
    }
    log.raw.log(line);
  }
}

// ============================================================
// remove
// ============================================================

async function mcpRemove(args: string[]): Promise<void> {
  // Accept optional -s/--scope for parity; we only support user today.
  let scope: "user" | "project" | "local" | undefined;
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (tok === "-s" || tok === "--scope") {
      if (i + 1 >= args.length) {
        throw new ValidationError(`Missing value after ${tok}`, "mcp");
      }
      scope = parseScope(args[++i]);
    } else if (tok.startsWith("-")) {
      throw new ValidationError(`Unknown option: ${tok}`, "mcp");
    } else {
      positionals.push(tok);
    }
  }
  if (positionals.length === 0) {
    throw new ValidationError(
      "Usage: hlvm mcp remove <name>",
      "mcp",
    );
  }
  if (scope && scope !== "user") {
    throw new ValidationError(
      `--scope ${scope} is not yet supported (tracked as follow-up). Use --scope user.`,
      "mcp",
    );
  }

  const name = positionals[0];
  const result = await removeRuntimeMcpServer({ name });
  if (result.removed) {
    log.raw.log(`Removed MCP server "${name}" from user config`);
    log.raw.log(`File modified: ${getMcpConfigPath()}`);
    return;
  }
  throw new ValidationError(
    `No MCP server found with name: "${name}"`,
    "mcp",
  );
}

// ============================================================
// login / logout
// ============================================================

async function mcpLogin(args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new ValidationError(
      "Usage: hlvm mcp login <name>",
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
      "Usage: hlvm mcp logout <name>",
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
