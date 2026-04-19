import { log } from "../../api/log.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { ValidationError } from "../../../common/error.ts";
import { getMcpConfigPath } from "../../../common/paths.ts";
import { normalizeServerName } from "../../agent/mcp/config.ts";
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
  -t, --transport <transport>    Transport: stdio | http | sse
                                 (defaults to stdio if omitted)
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

function showMcpAddHelp(): void {
  log.raw.log(`
Add an MCP server to HLVM.

Usage: hlvm mcp add <name> <commandOrUrl> [args...] [options]

Examples:
  # Add HTTP server:
  hlvm mcp add --transport http sentry https://mcp.sentry.dev/mcp

  # Add HTTP server with headers:
  hlvm mcp add --transport http corridor https://app.corridor.dev/api/mcp --header "Authorization: Bearer ..."

  # Add stdio server with environment variables:
  hlvm mcp add -e API_KEY=xxx my-server -- npx my-mcp-server

  # Add stdio server with subprocess flags:
  hlvm mcp add my-server -- my-command --some-flag arg1

Options:
  -t, --transport <transport>    Transport type (stdio, sse, http). Defaults to stdio if not specified.
  -e, --env <env...>             Set environment variables (e.g. -e KEY=value)
  -H, --header <header...>       Set WebSocket headers (e.g. -H "X-Api-Key: abc123" -H "X-Custom: value")
      --client-id <clientId>     OAuth client ID for HTTP/SSE servers
      --client-secret            Prompt for OAuth client secret (or set MCP_CLIENT_SECRET env var)
      --callback-port <port>     Fixed port for OAuth callback (for servers requiring pre-registered redirect URIs)
  -h, --help                     Display help for command
`);
}

function showMcpAddJsonHelp(): void {
  log.raw.log(`
Add an MCP server (stdio or SSE) with a JSON string

Usage: hlvm mcp add-json <name> <json> [options]

Options:
      --client-secret      Prompt for OAuth client secret (or set MCP_CLIENT_SECRET env var)
  -h, --help               Display help for command
`);
}

function showMcpGetHelp(): void {
  log.raw.log(`
Get details about an MCP server. Note: stdio servers are spawned for health checks. Only use this command in directories you trust.

Usage: hlvm mcp get <name>

Options:
  -h, --help  Display help for command
`);
}

function showMcpListHelp(): void {
  log.raw.log(`
List configured MCP servers. Note: stdio servers are spawned for health checks. Only use this command in directories you trust.

Usage: hlvm mcp list

Options:
  -h, --help  Display help for command
`);
}

function showMcpRemoveHelp(): void {
  log.raw.log(`
Remove an MCP server

Usage: hlvm mcp remove <name> [options]

Options:
  -h, --help  Display help for command
`);
}

function showMcpLoginHelp(): void {
  log.raw.log(`
Authenticate an HTTP MCP server via OAuth

Usage: hlvm mcp login <name>

Options:
  -h, --help  Display help for command
`);
}

function showMcpLogoutHelp(): void {
  log.raw.log(`
Remove stored OAuth token for server

Usage: hlvm mcp logout <name>

Options:
  -h, --help  Display help for command
`);
}

function isHelpToken(value: string | undefined): boolean {
  return value === "--help" || value === "-h";
}

export async function mcpCommand(args: string[]): Promise<void> {
  if (args.length === 0 || isHelpToken(args[0])) {
    showMcpHelp();
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);
  switch (subcommand) {
    case "add":
      if (hasHelpFlag(subArgs)) {
        showMcpAddHelp();
        return;
      }
      return await mcpAdd(subArgs);
    case "add-json":
      if (hasHelpFlag(subArgs)) {
        showMcpAddJsonHelp();
        return;
      }
      return await mcpAddJson(subArgs);
    case "get":
      if (hasHelpFlag(subArgs)) {
        showMcpGetHelp();
        return;
      }
      return await mcpGet(subArgs);
    case "list":
    case "ls":
      if (hasHelpFlag(subArgs)) {
        showMcpListHelp();
        return;
      }
      return await mcpList();
    case "remove":
    case "rm":
      if (hasHelpFlag(subArgs)) {
        showMcpRemoveHelp();
        return;
      }
      return await mcpRemove(subArgs);
    case "login":
      if (hasHelpFlag(subArgs)) {
        showMcpLoginHelp();
        return;
      }
      return await mcpLogin(subArgs);
    case "logout":
      if (hasHelpFlag(subArgs)) {
        showMcpLogoutHelp();
        return;
      }
      return await mcpLogout(subArgs);
    default:
      throw new ValidationError(
        `Unknown mcp command: ${subcommand}. Run 'hlvm mcp --help' for usage.`,
        "mcp",
      );
  }
}

// ============================================================
// add
// ============================================================

interface AddFlags {
  transport?: "stdio" | "http" | "sse";
  env: Record<string, string>;
  headers: Record<string, string>;
  clientId?: string;
  clientSecret: boolean;
  callbackPort?: number;
}

const URL_LIKE_RE =
  /^(https?:\/\/|localhost[:/])|(?:\/sse$)|(?:\/mcp$)/i;

function isUrlLike(value: string): boolean {
  return URL_LIKE_RE.test(value);
}

function parseHeaderPair(raw: string): [string, string] {
  const colonIdx = raw.indexOf(":");
  if (colonIdx === -1) {
    throw new ValidationError(
      `Invalid header format: "${raw}". Expected format: "Header-Name: value"`,
      "mcp",
    );
  }
  const name = raw.slice(0, colonIdx).trim();
  const value = raw.slice(colonIdx + 1).trim();
  if (!name) {
    throw new ValidationError(
      `Invalid header: "${raw}". Header name cannot be empty.`,
      "mcp",
    );
  }
  return [name, value];
}

function parseEnvPair(raw: string): [string, string] {
  const eqIdx = raw.indexOf("=");
  if (eqIdx <= 0) {
    throw new ValidationError(
      `Invalid environment variable format: ${raw}, environment variables should be added as: -e KEY1=value1 -e KEY2=value2`,
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
 * Parse `hlvm mcp add`: `add [opts] <name> <commandOrUrl> [args...]`.
 */
function parseAddArgs(args: string[]): {
  name: string;
  commandOrUrl: string;
  rest: string[];
  flags: AddFlags;
} {
  const { opts: preSep, rest: postSep } = splitStdioSeparator(args);

  const flags: AddFlags = {
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
        if (Number.isFinite(n) && n > 0) {
          flags.callbackPort = n;
        }
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

async function readClientSecret(): Promise<string> {
  const envSecret = getPlatform().env.get("MCP_CLIENT_SECRET");
  if (envSecret) {
    return envSecret;
  }

  const stdin = getPlatform().terminal.stdin;
  if (!stdin.isTerminal()) {
    throw new ValidationError(
      "No TTY available to prompt for client secret. Set MCP_CLIENT_SECRET env var instead.",
      "mcp",
    );
  }

  log.raw.write("Enter OAuth client secret: ");
  stdin.setRaw(true);
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  try {
    while (true) {
      const buf = new Uint8Array(1);
      const n = await stdin.read(buf);
      if (n === null || n === 0) break;
      const char = decoder.decode(buf.subarray(0, n));
      if (char === "\n" || char === "\r") break;
      if (char === "\u0003") {
        throw new ValidationError("Cancelled", "mcp");
      }
      if (char === "\u007F" || char === "\b") {
        chunks.pop();
        continue;
      }
      chunks.push(char);
    }
  } finally {
    stdin.setRaw(false);
    log.raw.write("\n");
  }
  return chunks.join("");
}

async function buildOAuthConfig(
  flags: AddFlags,
): Promise<{
  oauth?: RuntimeMcpServerInput["oauth"];
  clientSecret?: string;
}> {
  const hasOAuth = flags.clientId !== undefined ||
    flags.clientSecret || flags.callbackPort !== undefined;
  if (!hasOAuth) return {};
  const clientSecret = flags.clientSecret && flags.clientId
    ? await readClientSecret()
    : undefined;
  return {
    oauth: {
      ...(flags.clientId ? { clientId: flags.clientId } : {}),
      ...(clientSecret ? { clientSecret } : {}),
      ...(flags.callbackPort ? { callbackPort: flags.callbackPort } : {}),
    },
    clientSecret,
  };
}

async function mcpAdd(args: string[]): Promise<void> {
  const { name, commandOrUrl, rest, flags } = parseAddArgs(args);

  const looksLikeUrl = isUrlLike(commandOrUrl);
  const transport = flags.transport ?? "stdio";

  const env = Object.keys(flags.env).length > 0 ? flags.env : undefined;
  const headers = Object.keys(flags.headers).length > 0
    ? flags.headers
    : undefined;
  const { oauth } = await buildOAuthConfig(flags);

  if (transport === "stdio") {
    if (looksLikeUrl && flags.transport === undefined) {
      log.raw.error(
        `Warning: The command "${commandOrUrl}" looks like a URL, but is being interpreted as a stdio server as --transport was not specified.`,
      );
      log.raw.error(
        `If this is an HTTP server, use: hlvm mcp add --transport http ${name} ${commandOrUrl}`,
      );
      log.raw.error(
        `If this is an SSE server, use: hlvm mcp add --transport sse ${name} ${commandOrUrl}`,
      );
    }
    if (
      flags.clientId ||
      flags.clientSecret ||
      flags.callbackPort !== undefined
    ) {
      log.raw.error(
        "Warning: --client-id, --client-secret, and --callback-port are only supported for HTTP/SSE transports and will be ignored for stdio.",
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
      `Added stdio MCP server ${name} with command: ${commandOrUrl}${restStr} to user config`,
    );
    log.raw.log(`File modified: ${getMcpConfigPath()}`);
    return;
  }

  // HTTP / SSE
  await addRuntimeMcpServer({
    server: {
      name,
      url: commandOrUrl,
      headers,
      oauth,
      transport,
    },
  });
  log.raw.log(
    `Added ${transport.toUpperCase()} MCP server ${name} with URL: ${commandOrUrl} to user config`,
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
  clientSecret: boolean;
}

type AddJsonIssue = {
  path: string;
  message: string;
};

function throwInvalidAddJsonConfig(issues: AddJsonIssue[]): never {
  const formatted = issues.map(({ path, message }) =>
    `${path}: ${message}`
  ).join(", ");
  throw new ValidationError(`Invalid configuration: ${formatted}`, "mcp");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function expectStringRecord(
  value: unknown,
  basePath: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  if (!record) {
    throwInvalidAddJsonConfig([{ path: "", message: "Invalid input" }]);
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== "string") {
      throwInvalidAddJsonConfig([{
        path: "",
        message: "Invalid input",
      }]);
    }
    result[key] = entry;
  }
  return result;
}

function resolveAuthServerMetadataIssues(
  value: string,
): AddJsonIssue[] {
  const issues: AddJsonIssue[] = [];
  try {
    new URL(value);
  } catch {
    issues.push({
      path: "oauth.authServerMetadataUrl",
      message: "Invalid URL",
    });
  }
  if (!value.startsWith("https://")) {
    issues.push({
      path: "oauth.authServerMetadataUrl",
      message: "authServerMetadataUrl must use https://",
    });
  }
  return issues;
}

function normalizeAddJsonServer(
  parsed: unknown,
): {
  server: Omit<RuntimeMcpServerInput, "name">;
  transport: "stdio" | "http" | "sse";
} {
  const obj = asRecord(parsed);
  if (!obj) {
    throwInvalidAddJsonConfig([{ path: "", message: "Invalid input" }]);
  }

  const type = typeof obj.type === "string" ? obj.type : undefined;

  if (type === undefined || type === "stdio") {
    if (typeof obj.command !== "string") {
      throwInvalidAddJsonConfig([{ path: "", message: "Invalid input" }]);
    }
    if (obj.command.length === 0) {
      throwInvalidAddJsonConfig([{
        path: "command",
        message: "Command cannot be empty",
      }]);
    }
    if (
      obj.args !== undefined &&
      (!Array.isArray(obj.args) || obj.args.some((arg) => typeof arg !== "string"))
    ) {
      throwInvalidAddJsonConfig([{ path: "", message: "Invalid input" }]);
    }
    const env = expectStringRecord(obj.env, "env");
    return {
      server: {
        command: [obj.command, ...((obj.args as string[] | undefined) ?? [])],
        ...(env ? { env } : {}),
        ...(type === "stdio" ? { transport: "stdio" as const } : {}),
      },
      transport: "stdio",
    };
  }

  if (type !== "http" && type !== "sse") {
    throwInvalidAddJsonConfig([{ path: "", message: "Invalid input" }]);
  }
  if (typeof obj.url !== "string") {
    throwInvalidAddJsonConfig([{ path: "", message: "Invalid input" }]);
  }

  const headers = expectStringRecord(obj.headers, "headers");

  let oauth: RuntimeMcpServerInput["oauth"] | undefined;
  if (obj.oauth !== undefined) {
    const oauthObj = asRecord(obj.oauth);
    if (!oauthObj) {
      throwInvalidAddJsonConfig([{ path: "", message: "Invalid input" }]);
    }

    const clientId = oauthObj.clientId;
    if (clientId !== undefined && typeof clientId !== "string") {
      throwInvalidAddJsonConfig([{ path: "", message: "Invalid input" }]);
    }

    const callbackPort = oauthObj.callbackPort;
    if (
      callbackPort !== undefined &&
      (
        typeof callbackPort !== "number" ||
        !Number.isFinite(callbackPort) ||
        !Number.isInteger(callbackPort)
      )
    ) {
      throwInvalidAddJsonConfig([{ path: "", message: "Invalid input" }]);
    }
    if (typeof callbackPort === "number" && callbackPort <= 0) {
      throwInvalidAddJsonConfig([{
        path: "oauth.callbackPort",
        message: "Too small: expected number to be >0",
      }]);
    }

    const authServerMetadataUrl = oauthObj.authServerMetadataUrl;
    if (
      authServerMetadataUrl !== undefined &&
      typeof authServerMetadataUrl !== "string"
    ) {
      throwInvalidAddJsonConfig([{ path: "", message: "Invalid input" }]);
    }
    if (typeof authServerMetadataUrl === "string") {
      const issues = resolveAuthServerMetadataIssues(authServerMetadataUrl);
      if (issues.length > 0) {
        throwInvalidAddJsonConfig(issues);
      }
    }

    const xaa = oauthObj.xaa;
    if (xaa !== undefined && typeof xaa !== "boolean") {
      throwInvalidAddJsonConfig([{ path: "", message: "Invalid input" }]);
    }

    oauth = {
      ...(typeof clientId === "string" ? { clientId } : {}),
      ...(typeof callbackPort === "number" ? { callbackPort } : {}),
      ...(typeof authServerMetadataUrl === "string"
        ? { authServerMetadataUrl }
        : {}),
      ...(typeof xaa === "boolean" ? { xaa } : {}),
    };
  }

  return {
    server: {
      transport: type,
      url: obj.url,
      ...(headers ? { headers } : {}),
      ...(oauth ? { oauth } : {}),
    },
    transport: type,
  };
}

function parseAddJsonArgs(
  args: string[],
): { name: string; json: string; flags: AddJsonFlags } {
  const flags: AddJsonFlags = { clientSecret: false };
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    switch (tok) {
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

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = null;
  }
  const normalized = normalizeAddJsonServer(parsed);
  const server: RuntimeMcpServerInput = {
    name,
    ...normalized.server,
  };

  if (flags.clientSecret && server.url && server.oauth?.clientId) {
    server.oauth = {
      ...server.oauth,
      clientSecret: await readClientSecret(),
    };
  }

  await addRuntimeMcpServer({ server });
  log.raw.log(
    `Added ${normalized.transport} MCP server ${name} to user config`,
  );
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
  const key = normalizeServerName(name);
  const found = servers.find((s) => normalizeServerName(s.name) === key);
  if (!found) {
    throw new ValidationError(
      `No MCP server found with name: ${name}`,
      "mcp",
    );
  }

  log.raw.log(`${found.name}:`);
  log.raw.log(`  Scope: ${found.scopeDescription}`);
  log.raw.log(`  Status: ${found.status}`);
  log.raw.log(`  Type: ${found.transport}`);
  if (found.url) {
    log.raw.log(`  URL: ${found.url}`);
    if (found.headers && Object.keys(found.headers).length > 0) {
      log.raw.log(`  Headers:`);
      for (const [k, v] of Object.entries(found.headers)) {
        log.raw.log(`    ${k}: ${v}`);
      }
    }
    if (
      found.oauth?.clientId ||
      found.oauth?.callbackPort ||
      found.oauth?.clientSecretConfigured
    ) {
      const parts: string[] = [];
      if (found.oauth?.clientId) {
        parts.push("client_id configured");
      }
      if (found.oauth?.clientSecretConfigured) {
        parts.push("client_secret configured");
      }
      if (found.oauth?.callbackPort) {
        parts.push(`callback_port ${found.oauth.callbackPort}`);
      }
      log.raw.log(`  OAuth: ${parts.join(", ")}`);
    }
  } else if (found.command && found.command.length > 0) {
    log.raw.log(`  Command: ${found.command[0]}`);
    log.raw.log(`  Args: ${found.command.slice(1).join(" ")}`);
  }
  if (found.env && Object.keys(found.env).length > 0) {
    log.raw.log(`  Environment:`);
    for (const [k, v] of Object.entries(found.env)) {
      log.raw.log(`    ${k}=${v}`);
    }
  }
  log.raw.log(`\nTo remove this server, run: hlvm mcp remove "${found.name}"`);
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
    // Inherited-source servers (Cursor/Windsurf/Zed/Codex/Gemini/CC plugins)
    // get a trailing ` [source]` suffix so users can see where each came from.
    const scopeSuffix = server.scope === "user"
      ? ""
      : ` [${server.scopeLabel}]`;
    let line: string;
    if (server.transport === "sse") {
      line =
        `${server.name}: ${server.target} (SSE) - ${server.status}${scopeSuffix}`;
    } else if (server.transport === "http") {
      line =
        `${server.name}: ${server.target} (HTTP) - ${server.status}${scopeSuffix}`;
    } else {
      line = `${server.name}: ${server.target} - ${server.status}${scopeSuffix}`;
    }
    log.raw.log(line);
  }
}

// ============================================================
// remove
// ============================================================

async function mcpRemove(args: string[]): Promise<void> {
  const positionals: string[] = [];
  for (const tok of args) {
    if (tok.startsWith("-")) {
      throw new ValidationError(`Unknown option: ${tok}`, "mcp");
    }
    positionals.push(tok);
  }
  if (positionals.length === 0) {
    throw new ValidationError(
      "Usage: hlvm mcp remove <name>",
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
