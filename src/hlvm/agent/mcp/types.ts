/**
 * MCP Types — All type definitions for MCP protocol integration.
 *
 * Covers: config, JSON-RPC, tools, resources, prompts, sampling,
 * elicitation, completion, transport, and handler interfaces.
 */

// ============================================================
// Config Types
// ============================================================

export interface McpServerConfig {
  name: string;
  command?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** HTTP transport URL (mutually exclusive with command for stdio) */
  url?: string;
  /** Transport type: "stdio" (default) or "http" */
  transport?: "stdio" | "http";
  /** Additional headers for HTTP transport */
  headers?: Record<string, string>;
}

export interface McpConfig {
  version: 1;
  servers: McpServerConfig[];
}

// ============================================================
// JSON-RPC Types
// ============================================================

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ============================================================
// Tool Types
// ============================================================

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

// ============================================================
// Resource Types
// ============================================================

export interface McpResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

// ============================================================
// Prompt Types
// ============================================================

export interface McpPromptInfo {
  name: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
}

export interface McpPromptMessage {
  role: "user" | "assistant";
  content:
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; resource: McpResourceContent };
}

// ============================================================
// Sampling Types
// ============================================================

export interface McpSamplingRequest {
  messages: Array<{
    role: "user" | "assistant";
    content:
      | { type: "text"; text: string }
      | { type: "image"; data: string; mimeType: string };
  }>;
  modelPreferences?: {
    hints?: Array<{ name?: string }>;
    costPriority?: number;
    speedPriority?: number;
    intelligencePriority?: number;
  };
  systemPrompt?: string;
  includeContext?: "none" | "thisServer" | "allServers";
  temperature?: number;
  maxTokens: number;
  stopSequences?: string[];
  metadata?: Record<string, unknown>;
}

export interface McpSamplingResponse {
  role: "user" | "assistant";
  content:
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string };
  model: string;
  stopReason?: "endTurn" | "stopSequence" | "maxTokens";
}

// ============================================================
// Elicitation Types
// ============================================================

export interface McpElicitationRequest {
  /** Elicitation mode: "form" (default if omitted) or "url" */
  mode?: "form" | "url";
  message: string;
  requestedSchema?: Record<string, unknown>;
  /** URL for url-mode elicitation */
  url?: string;
  /** Unique ID for url-mode elicitation */
  elicitationId?: string;
}

export interface McpElicitationResponse {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}

// ============================================================
// Handler Types
// ============================================================

/** Handlers for server-initiated requests (sampling, elicitation, roots) */
export interface McpHandlers {
  onSampling?: (request: McpSamplingRequest) => Promise<McpSamplingResponse>;
  onElicitation?: (
    request: McpElicitationRequest,
  ) => Promise<McpElicitationResponse>;
  roots?: string[];
}

// ============================================================
// Transport Types
// ============================================================

/** Abstract transport interface — used by McpClient */
export interface McpTransport {
  start(): Promise<void>;
  send(message: JsonRpcMessage): Promise<void>;
  setMessageHandler(
    handler: (message: JsonRpcMessage) => void,
  ): void;
  close(): Promise<void>;
  /** Optional: set the negotiated protocol version (used by HTTP transport for headers) */
  setProtocolVersion?(version: string): void;
}

// ============================================================
// Load Result
// ============================================================

export interface McpLoadResult {
  tools: string[];
  ownerId: string;
  dispose: () => Promise<void>;
  /** Deferred handler registration — called after LLM and interaction callbacks are available */
  setHandlers: (handlers: McpHandlers) => void;
  /** Wire an AbortSignal to cancel all pending MCP requests */
  setSignal: (signal: AbortSignal) => void;
}
