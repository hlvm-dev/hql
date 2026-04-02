import { getPlatform } from "../../../platform/platform.ts";
import type { McpServerConfig } from "./types.ts";

const MCP_ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

export interface McpEnvExpansionResult<T extends McpServerConfig> {
  server: T;
  missingVars: string[];
}

function expandMcpString(
  value: string,
  missingVars: Set<string>,
): string {
  return value.replace(MCP_ENV_VAR_PATTERN, (match, rawName: string) => {
    const name = rawName.trim();
    if (name.length === 0) return match;
    const resolved = getPlatform().env.get(name);
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
): Record<string, string> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([key, recordValue]) => [
      key,
      expandMcpString(recordValue, missingVars),
    ]),
  );
}

export function expandMcpServerEnv<T extends McpServerConfig>(
  server: T,
): McpEnvExpansionResult<T> {
  const missingVars = new Set<string>();
  const expanded = {
    ...server,
    ...(server.command
      ? {
        command: server.command.map((entry) =>
          expandMcpString(entry, missingVars)
        ),
      }
      : {}),
    ...(server.cwd
      ? { cwd: expandMcpString(server.cwd, missingVars) }
      : {}),
    ...(server.url ? { url: expandMcpString(server.url, missingVars) } : {}),
    ...(server.headers
      ? { headers: expandStringRecord(server.headers, missingVars) }
      : {}),
    ...(server.env
      ? { env: expandStringRecord(server.env, missingVars) }
      : {}),
  };
  return {
    server: expanded as T,
    missingVars: [...missingVars].sort(),
  };
}
