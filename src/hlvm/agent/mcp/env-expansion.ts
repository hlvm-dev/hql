import { getPlatform } from "../../../platform/platform.ts";
import type { McpServerConfig } from "./types.ts";

const MCP_ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

export interface McpEnvExpansionResult<T extends McpServerConfig> {
  server: T;
  missingVars: string[];
}

export interface McpEnvExpansionOptions {
  env?: Record<string, string>;
}

function expandMcpString(
  value: string,
  missingVars: Set<string>,
  options: McpEnvExpansionOptions,
): string {
  return value.replace(MCP_ENV_VAR_PATTERN, (match, rawName: string) => {
    const name = rawName.trim();
    if (name.length === 0) return match;
    const resolved = Object.hasOwn(options.env ?? {}, name)
      ? options.env?.[name]
      : getPlatform().env.get(name);
    if (resolved === undefined) {
      missingVars.add(name);
      return match;
    }
    return resolved;
  });
}

function expandStringRecord(
  value: Record<string, string> | undefined,
  missingVars: Set<string>,
  options: McpEnvExpansionOptions,
): Record<string, string> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([key, recordValue]) => [
      key,
      expandMcpString(recordValue, missingVars, options),
    ]),
  );
}

function expandOAuthConfig(
  server: McpServerConfig,
  missingVars: Set<string>,
  options: McpEnvExpansionOptions,
): McpServerConfig["oauth"] {
  if (!server.oauth) return undefined;
  return {
    ...(server.oauth.clientId
      ? {
        clientId: expandMcpString(server.oauth.clientId, missingVars, options),
      }
      : {}),
    ...(server.oauth.callbackPort
      ? { callbackPort: server.oauth.callbackPort }
      : {}),
    ...(server.oauth.authServerMetadataUrl
      ? {
        authServerMetadataUrl: expandMcpString(
          server.oauth.authServerMetadataUrl,
          missingVars,
          options,
        ),
      }
      : {}),
    ...(server.oauth.xaa !== undefined ? { xaa: server.oauth.xaa } : {}),
  };
}

export function expandMcpServerEnv<T extends McpServerConfig>(
  server: T,
  options: McpEnvExpansionOptions = {},
): McpEnvExpansionResult<T> {
  const missingVars = new Set<string>();
  const expanded = {
    ...server,
    ...(server.command
      ? {
        command: server.command.map((entry) =>
          expandMcpString(entry, missingVars, options)
        ),
      }
      : {}),
    ...(server.cwd
      ? { cwd: expandMcpString(server.cwd, missingVars, options) }
      : {}),
    ...(server.url
      ? { url: expandMcpString(server.url, missingVars, options) }
      : {}),
    ...(server.headers
      ? { headers: expandStringRecord(server.headers, missingVars, options) }
      : {}),
    ...(server.env
      ? { env: expandStringRecord(server.env, missingVars, options) }
      : {}),
    ...(server.oauth
      ? { oauth: expandOAuthConfig(server, missingVars, options) }
      : {}),
  };
  return {
    server: expanded as T,
    missingVars: [...missingVars].sort(),
  };
}
