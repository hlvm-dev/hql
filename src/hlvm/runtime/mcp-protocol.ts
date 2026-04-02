type RuntimeMcpScope = "user" | "claude-code";

export interface RuntimeMcpServerDescriptor {
  name: string;
  command?: string[];
  cwd?: string;
  headers?: Record<string, string>;
  url?: string;
  env?: Record<string, string>;
  scope: RuntimeMcpScope;
  transport: "http" | "sse" | "stdio";
  target: string;
  scopeLabel: string;
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
