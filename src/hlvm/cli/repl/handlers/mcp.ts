import { ValidationError } from "../../../../common/error.ts";
import { getPlatform } from "../../../../platform/platform.ts";
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
  type RuntimeMcpMutableScope,
  type RuntimeMcpOauthRequest,
  type RuntimeMcpOauthResponse,
  type RuntimeMcpRemoveRequest,
  type RuntimeMcpRemoveResponse,
} from "../../../runtime/mcp-protocol.ts";
import { jsonError, parseJsonBody } from "../http-utils.ts";

function isMutableScope(value: unknown): value is RuntimeMcpMutableScope {
  return value === "project" || value === "user";
}

function getWorkspaceFromUrl(req: Request): string {
  const workspace = new URL(req.url).searchParams.get("workspace")?.trim();
  return workspace || getPlatform().process.cwd();
}

function getErrorStatus(error: unknown): number {
  return error instanceof ValidationError ? 400 : 500;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  workspace: string,
  name: string,
): Promise<McpServerConfig | null> {
  const servers = await loadMcpConfigMultiScope(workspace);
  const key = normalizeServerName(name);
  return servers.find((server) => normalizeServerName(server.name) === key) ??
    null;
}

export async function handleListMcpServers(req: Request): Promise<Response> {
  const workspace = getWorkspaceFromUrl(req);
  const servers = await loadMcpConfigMultiScope(workspace);
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

  const { workspace, scope, server } = parsed.value;
  if (typeof workspace !== "string" || workspace.trim().length === 0) {
    return jsonError("workspace is required", 400);
  }
  if (!isMutableScope(scope)) {
    return jsonError("scope must be 'project' or 'user'", 400);
  }

  const resolvedServer = resolveServerInput(server);
  if (!resolvedServer) {
    return jsonError("server must define either command[] or url", 400);
  }

  try {
    await addServerToConfig(scope, workspace, resolvedServer);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(getErrorMessage(error), getErrorStatus(error));
  }
}

export async function handleRemoveMcpServer(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<RuntimeMcpRemoveRequest>(req);
  if (!parsed.ok) return parsed.response;

  const { workspace, name, scope } = parsed.value;
  if (typeof workspace !== "string" || workspace.trim().length === 0) {
    return jsonError("workspace is required", 400);
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    return jsonError("name is required", 400);
  }
  if (scope !== undefined && !isMutableScope(scope)) {
    return jsonError("scope must be 'project' or 'user'", 400);
  }

  try {
    let removed = false;
    let removedScope: RuntimeMcpMutableScope | null = null;

    if (scope) {
      removed = await removeServerFromConfig(scope, workspace, name);
      removedScope = removed ? scope : null;
    } else if (await removeServerFromConfig("project", workspace, name)) {
      removed = true;
      removedScope = "project";
    } else if (await removeServerFromConfig("user", workspace, name)) {
      removed = true;
      removedScope = "user";
    }

    const payload: RuntimeMcpRemoveResponse = {
      removed,
      scope: removedScope,
    };
    return Response.json(payload);
  } catch (error) {
    return jsonError(getErrorMessage(error), getErrorStatus(error));
  }
}

export async function handleLoginMcpServer(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<RuntimeMcpOauthRequest>(req);
  if (!parsed.ok) return parsed.response;

  const { workspace, name } = parsed.value;
  if (typeof workspace !== "string" || workspace.trim().length === 0) {
    return jsonError("workspace is required", 400);
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    return jsonError("name is required", 400);
  }

  try {
    const server = await resolveServerByName(workspace, name);
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

  const { workspace, name } = parsed.value;
  if (typeof workspace !== "string" || workspace.trim().length === 0) {
    return jsonError("workspace is required", 400);
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    return jsonError("name is required", 400);
  }

  try {
    const server = await resolveServerByName(workspace, name);
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
