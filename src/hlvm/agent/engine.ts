/**
 * AgentEngine — Abstraction layer for LLM backends.
 *
 * Decouples session/orchestrator from the concrete LLM plumbing.
 * Default implementation:
 *   - SdkAgentEngine (engine-sdk.ts): powered by Vercel AI SDK
 */

import type { LLMFunction } from "./orchestrator.ts";
import type { Message as AgentMessage } from "./context.ts";

/** Mutable tool filter state shared between orchestrator and engine. */
export interface ToolFilterState {
  allowlist?: string[];
  denylist?: string[];
}

/** Configuration passed to AgentEngine.createLLM */
export interface AgentLLMConfig {
  model?: string;
  contextBudget?: number;
  options?: { temperature?: number; maxTokens?: number };
  toolAllowlist?: string[];
  toolDenylist?: string[];
  /** Runtime-overridable tool filters (e.g., tool_search narrowing). */
  toolFilterState?: ToolFilterState;
  toolOwnerId?: string;
  onToken?: (text: string) => void;
}

/** Abstract engine interface for creating LLM functions */
export interface AgentEngine {
  createLLM(config: AgentLLMConfig): LLMFunction;
  createSummarizer(model?: string): (messages: AgentMessage[]) => Promise<string>;
}

import { SdkAgentEngine } from "./engine-sdk.ts";

// --- Global engine singleton ---

let _engine: AgentEngine | null = null;

/** Get the active engine (defaults to SdkAgentEngine). */
export function getAgentEngine(): AgentEngine {
  return _engine ?? new SdkAgentEngine();
}

/** Override the active engine (for tests or custom integrations). */
export function setAgentEngine(engine: AgentEngine): void {
  _engine = engine;
}

/** Reset to default (for testing). */
export function resetAgentEngine(): void {
  _engine = null;
}
