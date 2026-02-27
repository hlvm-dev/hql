/**
 * MCP Module — Barrel re-export for MCP integration.
 *
 * This module re-exports the public API for MCP server connections.
 * Uses @modelcontextprotocol/sdk for protocol handling.
 */

// Types — only re-export what external consumers need
export type { McpHandlers } from "./types.ts";

// Config loading & management
export {
  addServerToConfig,
  formatServerEntry,
  loadClaudeCodeMcpServers,
  loadMcpConfig,
  loadMcpConfigMultiScope,
  normalizeServerName,
  parseClaudeCodeMcpJson,
  removeServerFromConfig,
  resolveBuiltinMcpServers,
} from "./config.ts";

export type { McpScope, McpServerWithScope } from "./config.ts";

// Tool registration
export { inferMcpSafetyLevel, loadMcpTools } from "./tools.ts";
