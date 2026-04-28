import type { AgentExecutionMode } from "../execution-mode.ts";
import type { McpServerConfig } from "../mcp/types.ts";

export type AgentSource = "built-in" | "user";

/**
 * Per-agent MCP server specification.
 * - string: reference an existing configured server by name
 * - record: inline server definition keyed by server name
 */
export type AgentMcpServerSpec =
  | string
  | Record<string, Omit<McpServerConfig, "name">>;

export interface BaseAgentDefinition {
  agentType: string;
  /** Description shown to the brain for tool selection */
  whenToUse: string;
  /** Allowed tools. undefined or ["*"] = all tools */
  tools?: string[];
  disallowedTools?: string[];
  /** Model override. "inherit" = use parent's model */
  model?: string;
  maxTurns?: number;
  source: AgentSource;
  baseDir?: string;
  getSystemPrompt: () => string;
  /** Always run as background task when spawned */
  background?: boolean;
  isolation?: "worktree";
  permissionMode?: AgentExecutionMode;
  /** Sticky prompt prepended ahead of the invocation prompt */
  initialPrompt?: string;
  /** Agent-specific MCP servers (configured refs and/or inline defs) */
  mcpServers?: AgentMcpServerSpec[];
}

export interface BuiltInAgentDefinition extends BaseAgentDefinition {
  source: "built-in";
}

export interface CustomAgentDefinition extends BaseAgentDefinition {
  source: "user";
  /** Original filename without .md extension */
  filename?: string;
}

export type AgentDefinition = BuiltInAgentDefinition | CustomAgentDefinition;

export interface AgentToolInput {
  /** Short (3-5 word) task description */
  description: string;
  /** Full task prompt for the agent */
  prompt: string;
  /** Agent type to use (defaults to "general-purpose") */
  subagent_type?: string;
  /** Model override */
  model?: string;
  /** Run in background (fire-and-forget) */
  run_in_background?: boolean;
  /** Isolation mode */
  isolation?: "worktree";
  /** Absolute cwd override for the child agent */
  cwd?: string;
}

export interface AgentTextBlock {
  type: "text";
  text: string;
}

export interface AgentToolUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  server_tool_use:
    | { web_search_requests: number; web_fetch_requests: number }
    | null;
  service_tier: "standard" | "priority" | "batch" | null;
  cache_creation:
    | {
      ephemeral_1h_input_tokens: number;
      ephemeral_5m_input_tokens: number;
    }
    | null;
}

export interface AgentToolResult {
  status: "completed";
  agentId: string;
  agentType: string;
  prompt: string;
  content: AgentTextBlock[];
  totalDurationMs: number;
  totalToolUseCount: number;
  totalTokens: number;
  usage: AgentToolUsage;
  worktreePath?: string;
  worktreeBranch?: string;
}

export function getAgentToolResultText(result: AgentToolResult): string {
  return result.content.map((b) => b.text).join("");
}

export function makeAgentTextBlocks(text: string): AgentTextBlock[] {
  return text.length > 0 ? [{ type: "text", text }] : [];
}

export interface AgentAsyncResult {
  status: "async_launched";
  agentId: string;
  description: string;
  prompt: string;
  outputFile: string;
  canReadOutputFile?: boolean;
}

/** Union of all agent tool outputs */
export type AgentToolOutput = AgentToolResult | AgentAsyncResult;

// ============================================================
// Agent Definitions Result (CC: AgentDefinitionsResult)
// ============================================================

export interface AgentDefinitionsResult {
  activeAgents: AgentDefinition[];
  allAgents: AgentDefinition[];
  failedFiles?: Array<{ path: string; error: string }>;
}

// ============================================================
// Background Agent Tracking
// ============================================================

export interface BackgroundAgent {
  agentId: string;
  agentType: string;
  description: string;
  prompt: string;
  status: "running" | "completed" | "errored";
  startTime: number;
  promise: Promise<AgentToolResult>;
  result?: AgentToolResult;
  error?: string;
  toolUseCount?: number;
  tokenCount?: number;
  lastToolInfo?: string;
  transcriptTail?: string[];
  abortController: AbortController;
  cancelled?: boolean;
  onAgentEvent?: (event: unknown) => void;
}

export interface BackgroundAgentSnapshot {
  agentId: string;
  agentType: string;
  description: string;
  status: BackgroundAgent["status"];
  cancelled?: boolean;
  durationMs: number;
  toolUseCount?: number;
  tokenCount?: number;
  lastToolInfo?: string;
  previewLines: string[];
  resultPreview?: string;
  error?: string;
}

