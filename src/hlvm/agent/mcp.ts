/**
 * MCP Integration — Re-exports from mcp/ module directory.
 *
 * This file exists for backward compatibility with existing importers.
 * All implementation is in ./mcp/ subdirectory.
 */

export {
  inferMcpSafetyLevel,
  loadMcpConfig,
  loadMcpTools,
  McpClient,
  resolveBuiltinMcpServers,
} from "./mcp/mod.ts";

export type {
  McpConfig,
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
} from "./mcp/mod.ts";
