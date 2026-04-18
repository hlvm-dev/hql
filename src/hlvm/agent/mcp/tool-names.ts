export const MCP_TOOL_PREFIX = "mcp_";

export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX);
}
