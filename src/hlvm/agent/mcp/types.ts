/**
 * MCP Types — All type definitions for MCP protocol integration.
 *
 * Covers: config, tools, resources, prompts, sampling,
 * elicitation, and handler interfaces.
 *
 * JSON-RPC and transport types are handled by @modelcontextprotocol/sdk.
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
  /** Transport type: "stdio" (default), "http", or "sse" */
  transport?: "stdio" | "http" | "sse";
  /** Additional headers for remote HTTP/SSE transports */
  headers?: Record<string, string>;
  /** Raw MCP tool names to skip (not registered) */
  disabled_tools?: string[];
  /** Per-server connection timeout in ms (default: 5000) */
  connection_timeout_ms?: number;
}

export interface McpConfig {
  version: 1;
  servers: McpServerConfig[];
}

// ============================================================
// Tool Types
// ============================================================

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  /** MCP spec `_meta` — free-form record that survives SDK Zod validation. */
  _meta?: Record<string, unknown>;
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
    | { type: "audio"; data: string; mimeType: string }
    | { type: "resource"; resource: McpResourceContent };
}

export interface McpAttachmentRef {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  kind:
    | "image"
    | "audio"
    | "video"
    | "pdf"
    | "text"
    | "document"
    | "file";
  size: number;
  source:
    | "tool"
    | "prompt"
    | "resource";
  label: string;
  resourceUri?: string;
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

interface McpSamplingResponse {
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

interface McpElicitationResponse {
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
// Load Result
// ============================================================

export interface McpConnectedServer {
  name: string;
  toolCount: number;
}

export interface McpLoadResult {
  tools: string[];
  ownerId: string;
  /** Summary of successfully connected MCP servers */
  connectedServers: McpConnectedServer[];
  dispose: () => Promise<void>;
  /** Deferred handler registration — called after LLM and interaction callbacks are available */
  setHandlers: (handlers: McpHandlers) => void;
  /** Wire an AbortSignal to cancel all pending MCP requests */
  setSignal: (signal: AbortSignal) => void;
}
