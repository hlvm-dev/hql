/**
 * Tool Call Types
 *
 * Shared types for native tool calling.
 */

import { generateUUID } from "../../common/utils.ts";

/** Tool call parsed from agent response */
export interface ToolCall {
  /** Provider-assigned call ID (used to correlate results with calls) */
  id?: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** Provider-reported token usage (SSOT for agent-layer usage shape) */
interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Provider-native source metadata surfaced by the model runtime. */
export interface LLMSource {
  id: string;
  sourceType: "url" | "document";
  url?: string;
  title?: string;
  mediaType?: string;
  filename?: string;
  providerMetadata?: Record<string, unknown>;
}

/** Structured LLM response for native tool calling */
export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  /** Provider-reported token usage (if available) */
  usage?: LLMUsage;
  /** Provider-native sources returned by the model runtime. */
  sources?: LLMSource[];
  /** Provider-native metadata returned by the model runtime. */
  providerMetadata?: Record<string, unknown>;
  /** Provider-native reasoning/thinking output (if model supports it). */
  reasoning?: string;
  /** SDK-native response messages preserving provider reasoning parts. */
  sdkResponseMessages?: unknown[];
}

/** Shared SSOT for native tool-call ids across agent + provider layers. */
export function generateToolCallId(): string {
  return `call_${generateUUID()}`;
}

/** Ensure every tool call has a stable id before execution/persistence. */
export function ensureToolCallIds(calls: ToolCall[]): ToolCall[] {
  return calls.map((call) => call.id ? call : { ...call, id: generateToolCallId() });
}
