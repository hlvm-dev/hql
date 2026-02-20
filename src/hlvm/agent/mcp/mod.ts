/**
 * MCP Module — Barrel re-export for MCP integration.
 *
 * This module re-exports the exact same public API that was previously
 * in the single `mcp.ts` file. All importers should use this barrel.
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
  McpTransport,
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

// Client (for advanced usage)
export { McpClient } from "./client.ts";

// Transport
export { createTransport, HttpTransport, StdioTransport } from "./transport.ts";
