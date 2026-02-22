/**
 * MCP Module — Barrel re-export for MCP integration.
 *
 * This module re-exports the public API for MCP server connections.
 * Uses @modelcontextprotocol/sdk for protocol handling.
 */

// Types
export type {
  McpConfig,
  McpConnectedServer,
  McpElicitationRequest,
  McpElicitationResponse,
  McpHandlers,
  McpLoadResult,
  McpPromptInfo,
  McpPromptMessage,
  McpResourceContent,
  McpResourceInfo,
  McpResourceTemplate,
  McpSamplingRequest,
  McpSamplingResponse,
  McpServerConfig,
  McpToolInfo,
} from "./types.ts";

// Config loading & management
export {
  addServerToConfig,
  formatServerEntry,
  loadMcpConfig,
  loadMcpConfigMultiScope,
  removeServerFromConfig,
  resolveBuiltinMcpServers,
} from "./config.ts";

export type { McpScope, McpServerWithScope } from "./config.ts";

// Tool registration
export { inferMcpSafetyLevel, loadMcpTools } from "./tools.ts";

// SDK Client (for direct usage)
export { createSdkMcpClient, SdkMcpClient } from "./sdk-client.ts";
