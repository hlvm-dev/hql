import type { McpScope } from "../agent/mcp/config.ts";

export interface RuntimeMcpServerDescriptor {
  name: string;
  command?: string[];
  cwd?: string;
  headers?: Record<string, string>;
  url?: string;
  env?: Record<string, string>;
  oauth?: {
    clientId?: string;
    callbackPort?: number;
    authServerMetadataUrl?: string;
    xaa?: boolean;
    clientSecretConfigured?: boolean;
  };
  scope: McpScope;
  transport: "http" | "sse" | "stdio";
  target: string;
  status: string;
  /** Short scope label, used in list output (e.g. "Cursor", "user"). */
  scopeLabel: string;
  /**
   * Full-sentence scope description, used in get output
   * (e.g. "User config (available in all your projects)").
   */
  scopeDescription: string;
}

export interface RuntimeMcpListResponse {
  servers: RuntimeMcpServerDescriptor[];
}

export interface RuntimeMcpServerInput {
  name: string;
  command?: string[];
  cwd?: string;
  headers?: Record<string, string>;
  url?: string;
  env?: Record<string, string>;
  transport?: "http" | "sse" | "stdio";
  disabled_tools?: string[];
  connection_timeout_ms?: number;
  oauth?: {
    clientId?: string;
    clientSecret?: string;
    callbackPort?: number;
    authServerMetadataUrl?: string;
    xaa?: boolean;
  };
}

export interface RuntimeMcpAddRequest {
  server: RuntimeMcpServerInput;
}

export interface RuntimeMcpRemoveRequest {
  name: string;
}

export interface RuntimeMcpRemoveResponse {
  removed: boolean;
}

export interface RuntimeMcpOauthRequest {
  name: string;
}

export interface RuntimeMcpOauthResponse {
  serverName: string;
  messages: string[];
  removed?: boolean;
}
