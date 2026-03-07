export type RuntimeMcpScope = "dotmcp" | "project" | "user" | "claude-code";
export type RuntimeMcpMutableScope = "project" | "user";

export interface RuntimeMcpServerDescriptor {
  name: string;
  command?: string[];
  url?: string;
  env?: Record<string, string>;
  scope: RuntimeMcpScope;
  transport: "http" | "stdio";
  target: string;
  scopeLabel: string;
}

export interface RuntimeMcpListResponse {
  servers: RuntimeMcpServerDescriptor[];
}

export interface RuntimeMcpServerInput {
  name: string;
  command?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface RuntimeMcpAddRequest {
  workspace: string;
  scope: RuntimeMcpMutableScope;
  server: RuntimeMcpServerInput;
}

export interface RuntimeMcpRemoveRequest {
  workspace: string;
  name: string;
  scope?: RuntimeMcpMutableScope;
}

export interface RuntimeMcpRemoveResponse {
  removed: boolean;
  scope: RuntimeMcpMutableScope | null;
}

export interface RuntimeMcpOauthRequest {
  workspace: string;
  name: string;
}

export interface RuntimeMcpOauthResponse {
  serverName: string;
  messages: string[];
  removed?: boolean;
}
