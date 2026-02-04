/**
 * Tool Call Types
 *
 * Shared types for native tool calling.
 */

/** Tool call parsed from agent response */
export interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

/** Structured LLM response for native tool calling */
export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
}
