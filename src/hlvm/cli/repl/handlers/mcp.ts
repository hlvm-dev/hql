import { ValidationError } from "../../../../common/error.ts";
import { getErrorMessage } from "../../../../common/utils.ts";
import {
  addServerToConfig,
  formatServerEntry,
  getScopeDescription,
  isMcpServerConfig,
  loadMcpConfig,
  loadMcpConfigMultiScope,
  normalizeServerName,
  pickOAuthConfigFields,
  removeServerFromConfig,
} from "../../../agent/mcp/config.ts";
import {
  clearMcpClientConfig,
  getMcpClientConfig,
  loginMcpHttpServer,
  logoutMcpHttpServer,
  saveMcpClientSecret,
} from "../../../agent/mcp/oauth.ts";
import { createSdkMcpClient } from "../../../agent/mcp/sdk-client.ts";
import type { McpServerConfig } from "../../../agent/mcp/types.ts";
import {
  type RuntimeMcpAddRequest,
  type RuntimeMcpListResponse,
  type RuntimeMcpOauthRequest,
  type RuntimeMcpOauthResponse,
  type RuntimeMcpRemoveRequest,
  type RuntimeMcpRemoveResponse,
} from "../../../runtime/mcp-protocol.ts";
import {
  jsonError,
  jsonErrorFromUnknown,
  parseJsonBody,
} from "../http-utils.ts";

function getErrorStatus(error: unknown): number {
  return error instanceof ValidationError ? 400 : 500;
}

function requireServerName(value: unknown): string | Response {
  if (typeof value !== "string" || value.trim().length === 0) {
    return jsonError("name is required", 400);
  }
  return value;
}

function isAuthStatus(message: string): boolean {
  return /401|403|unauthor|forbidden|oauth|needs auth|authentication|bearer|access token/i
    .test(message);
}

function isConnectionStatus(message: string): boolean {
  return /timeout|timed out|econnrefused|econnreset|connection|socket|network|enotfound/i
    .test(message);
}

async function checkMcpServerHealth(server: McpServerConfig): Promise<string> {
  const timeoutMs = server.connection_timeout_ms ?? 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`MCP connect timeout (${timeoutMs}ms)`));
  }, timeoutMs);
  let client: Awaited<ReturnType<typeof createSdkMcpClient>> | null = null;
  try {
    client = await createSdkMcpClient(server, controller.signal, {
      interactiveAuth: false,
    });
    return "✓ Connected";
  } catch (error) {
    const message = getErrorMessage(error).toLowerCase();
    if (isAuthStatus(message)) return "! Needs authentication";
    if (isConnectionStatus(message)) return "✗ Connection error";
    return "✗ Failed to connect";
  } finally {
    clearTimeout(timer);
    await client?.close().catch(() => undefined);
  }
}

async function resolveUserServerByName(
  name: string,
): Promise<McpServerConfig | null> {
  const config = await loadMcpConfig();
  if (!config) return null;
  const key = normalizeServerName(name);
  return config.servers.find((server) => normalizeServerName(server.name) === key) ??
    null;
}

function resolveServerInput(
  server: RuntimeMcpAddRequest["server"],
): McpServerConfig | null {
  if (!server || typeof server !== "object" || !isMcpServerConfig(server)) {
    return null;
  }
  return {
    name: server.name,
    ...(server.command ? { command: server.command } : {}),
    ...(server.cwd ? { cwd: server.cwd } : {}),
    ...(server.headers ? { headers: server.headers } : {}),
    ...(server.url ? { url: server.url } : {}),
    ...(server.env ? { env: server.env } : {}),
    ...(server.transport ? { transport: server.transport } : {}),
    ...(server.oauth ? { oauth: pickOAuthConfigFields(server.oauth) } : {}),
    ...(server.disabled_tools ? { disabled_tools: server.disabled_tools } : {}),
    ...(server.connection_timeout_ms
      ? { connection_timeout_ms: server.connection_timeout_ms }
      : {}),
  };
}

async function resolveServerByName(
  name: string,
): Promise<McpServerConfig | null> {
  const servers = await loadMcpConfigMultiScope();
  const key = normalizeServerName(name);
  return servers.find((server) => normalizeServerName(server.name) === key) ??
    null;
}

export async function handleListMcpServers(): Promise<Response> {
  const servers = await loadMcpConfigMultiScope();
  const payload: RuntimeMcpListResponse = {
    servers: await Promise.all(servers.map(async (server) => {
      const entry = formatServerEntry(server);
      const clientConfig = server.url
        ? await getMcpClientConfig(server)
        : undefined;
      return {
        name: server.name,
        command: server.command,
        cwd: server.cwd,
        headers: server.headers,
        url: server.url,
        env: server.env,
        ...(server.oauth
          ? {
            oauth: {
              ...(pickOAuthConfigFields(server.oauth) ?? {}),
              ...(clientConfig?.clientSecret
                ? { clientSecretConfigured: true }
                : {}),
            },
          }
          : {}),
        scope: server.scope,
        transport: server.url ? (server.transport ?? "http") : "stdio",
        target: entry.target,
        status: await checkMcpServerHealth(server),
        scopeLabel: entry.scopeLabel,
        scopeDescription: getScopeDescription(server.scope),
      };
    })),
  };
  return Response.json(payload);
}

export async function handleAddMcpServer(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<RuntimeMcpAddRequest>(req);
  if (!parsed.ok) return parsed.response;

  const { server } = parsed.value;

  const resolvedServer = resolveServerInput(server);
  if (!resolvedServer) {
    return jsonError("server must define either command[] or url", 400);
  }

  try {
    await addServerToConfig(resolvedServer);
    if (resolvedServer.url && server.oauth?.clientSecret) {
      await saveMcpClientSecret(resolvedServer, server.oauth.clientSecret);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return await jsonErrorFromUnknown(error, getErrorStatus(error));
  }
}

export async function handleRemoveMcpServer(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<RuntimeMcpRemoveRequest>(req);
  if (!parsed.ok) return parsed.response;

  const nameOrErr = requireServerName(parsed.value.name);
  if (nameOrErr instanceof Response) return nameOrErr;
  const name = nameOrErr;

  try {
    const serverBeforeRemoval = await resolveUserServerByName(name);
    const removed = await removeServerFromConfig(name);
    if (removed && serverBeforeRemoval?.url) {
      await logoutMcpHttpServer(serverBeforeRemoval).catch(() => false);
      await clearMcpClientConfig(serverBeforeRemoval);
    }
    const payload: RuntimeMcpRemoveResponse = {
      removed,
    };
    return Response.json(payload);
  } catch (error) {
    return await jsonErrorFromUnknown(error, getErrorStatus(error));
  }
}

export async function handleLoginMcpServer(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<RuntimeMcpOauthRequest>(req);
  if (!parsed.ok) return parsed.response;

  const nameOrErr = requireServerName(parsed.value.name);
  if (nameOrErr instanceof Response) return nameOrErr;
  const name = nameOrErr;

  try {
    const server = await resolveServerByName(name);
    if (!server) {
      return jsonError(
        `MCP server '${name}' not found. Run 'hlvm mcp list'.`,
        404,
      );
    }
    if (!server.url) {
      return jsonError(
        `MCP server '${name}' is stdio-only. OAuth login is for HTTP servers.`,
        400,
      );
    }

    const messages: string[] = [];
    await loginMcpHttpServer(server, {
      output: (line) => messages.push(line),
    });

    const payload: RuntimeMcpOauthResponse = {
      serverName: server.name,
      messages,
    };
    return Response.json(payload);
  } catch (error) {
    return await jsonErrorFromUnknown(error, getErrorStatus(error));
  }
}

export async function handleLogoutMcpServer(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<RuntimeMcpOauthRequest>(req);
  if (!parsed.ok) return parsed.response;

  const nameOrErr = requireServerName(parsed.value.name);
  if (nameOrErr instanceof Response) return nameOrErr;
  const name = nameOrErr;

  try {
    const server = await resolveServerByName(name);
    if (!server) {
      return jsonError(
        `MCP server '${name}' not found. Run 'hlvm mcp list'.`,
        404,
      );
    }
    if (!server.url) {
      return jsonError(
        `MCP server '${name}' is stdio-only. No OAuth token to remove.`,
        400,
      );
    }

    const removed = await logoutMcpHttpServer(server);
    const payload: RuntimeMcpOauthResponse = {
      serverName: server.name,
      messages: [],
      removed,
    };
    return Response.json(payload);
  } catch (error) {
    return await jsonErrorFromUnknown(error, getErrorStatus(error));
  }
}
