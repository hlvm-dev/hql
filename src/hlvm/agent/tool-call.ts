/**
 * Tool Call Types
 *
 * Shared types for native tool calling.
 */

/** Tool call parsed from agent response */
export interface ToolCall {
  /** Provider-assigned call ID (used to correlate results with calls) */
  id?: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** Provider-reported token usage (SSOT for agent-layer usage shape) */
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Structured LLM response for native tool calling */
export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  /** Provider-reported token usage (if available) */
  usage?: LLMUsage;
}
