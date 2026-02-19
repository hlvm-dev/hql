/**
 * MCP Handlers — Server-initiated request handler wiring.
 *
 * Provides factory functions for sampling, elicitation, and roots handlers
 * that adapt HLVM's LLM and interaction systems to MCP's protocol.
 */

export {
  type McpHandlers,
  type McpSamplingRequest,
  type McpSamplingResponse,
  type McpElicitationRequest,
  type McpElicitationResponse,
} from "./types.ts";
