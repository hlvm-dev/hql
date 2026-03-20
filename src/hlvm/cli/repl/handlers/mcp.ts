import { ValidationError } from "../../../../common/error.ts";
import { getErrorMessage } from "../../../../common/utils.ts";
import {
  addServerToConfig,
  formatServerEntry,
  isMcpServerConfig,
  loadMcpConfigMultiScope,
  normalizeServerName,
  removeServerFromConfig,
} from "../../../agent/mcp/config.ts";
import {
  loginMcpHttpServer,
  logoutMcpHttpServer,
} from "../../../agent/mcp/oauth.ts";
import type { McpServerConfig } from "../../../agent/mcp/types.ts";
import {
  type RuntimeMcpAddRequest,
  type RuntimeMcpListResponse,
  type RuntimeMcpOauthRequest,
  type RuntimeMcpOauthResponse,
  type RuntimeMcpRemoveRequest,
  type RuntimeMcpRemoveResponse,
} from "../../../runtime/mcp-protocol.ts";
import { jsonError, parseJsonBody } from "../http-utils.ts";

function getErrorStatus(error: unknown): number {
  return error instanceof ValidationError ? 400 : 500;
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
    ...(server.url ? { url: server.url } : {}),
    ...(server.env ? { env: server.env } : {}),
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
    servers: servers.map((server) => {
      const entry = formatServerEntry(server);
      return {
        name: server.name,
        command: server.command,
        url: server.url,
        env: server.env,
        scope: server.scope,
        transport: server.url ? "http" : "stdio",
        target: entry.target,
        scopeLabel: entry.scopeLabel,
      };
    }),
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
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(getErrorMessage(error), getErrorStatus(error));
  }
}

export async function handleRemoveMcpServer(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<RuntimeMcpRemoveRequest>(req);
  if (!parsed.ok) return parsed.response;

  const { name } = parsed.value;
  if (typeof name !== "string" || name.trim().length === 0) {
    return jsonError("name is required", 400);
  }

  try {
    const removed = await removeServerFromConfig(name);
    const payload: RuntimeMcpRemoveResponse = {
      removed,
    };
    return Response.json(payload);
  } catch (error) {
    return jsonError(getErrorMessage(error), getErrorStatus(error));
  }
}

export async function handleLoginMcpServer(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<RuntimeMcpOauthRequest>(req);
  if (!parsed.ok) return parsed.response;

  const { name } = parsed.value;
  if (typeof name !== "string" || name.trim().length === 0) {
    return jsonError("name is required", 400);
  }

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
    return jsonError(getErrorMessage(error), getErrorStatus(error));
  }
}

export async function handleLogoutMcpServer(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<RuntimeMcpOauthRequest>(req);
  if (!parsed.ok) return parsed.response;

  const { name } = parsed.value;
  if (typeof name !== "string" || name.trim().length === 0) {
    return jsonError("name is required", 400);
  }

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
    return jsonError(getErrorMessage(error), getErrorStatus(error));
  }
}
