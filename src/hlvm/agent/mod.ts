/**
 * Agent Module — Public API Surface
 *
 * This barrel file defines the agent module's public interface.
 * External consumers should import from here rather than reaching
 * into individual files.
 */

// Logger facade (SDK-safe, configurable)
export { setAgentLogger, getAgentLogger, type AgentLogger } from "./logger.ts";

// Core orchestrator
export {
  runReActLoop,
  executeToolCall,
  executeToolCalls,
  processAgentResponse,
} from "./orchestrator.ts";
export type {
  LLMFunction,
  LLMResponse,
  ToolCall,
  TraceEvent,
  ToolDisplay,
  OrchestratorConfig,
} from "./orchestrator.ts";

// Context management
export { ContextManager, ContextOverflowError } from "./context.ts";
export type { Message, MessageRole, ContextConfig } from "./context.ts";

// Tool registry
export {
  getTool,
  getAllTools,
  resolveTools,
  hasTool,
  registerTool,
  registerTools,
  unregisterTool,
  normalizeToolName,
  suggestToolNames,
  validateToolArgs,
  prepareToolArgsForExecution,
} from "./registry.ts";
export type { ToolMetadata, ToolFunction } from "./registry.ts";

// Session
export { createAgentSession } from "./session.ts";
export type { AgentSession, AgentSessionOptions } from "./session.ts";

// Agent runner (SSOT entry point)
export { runAgentQuery, ensureAgentReady } from "./agent-runner.ts";
export type {
  AgentRunnerCallbacks,
  AgentRunnerOptions,
  AgentRunnerResult,
} from "./agent-runner.ts";

// LLM bridge
export {
  createAgentLLM,
  generateSystemPrompt,
  convertAgentMessagesToProvider,
  convertProviderMessagesToAgent,
  clearToolDefCache,
  createSummarizationFn,
} from "./llm-integration.ts";
export type {
  ProviderMessage,
  ProviderToolCall,
  ToolDefinition,
  SystemPromptOptions,
} from "./llm-integration.ts";

// Constants
export {
  DEFAULT_TIMEOUTS,
  MAX_ITERATIONS,
  MAX_RETRIES,
  DEFAULT_MAX_TOOL_CALLS,
  RESOURCE_LIMITS,
  RATE_LIMITS,
  COMPACTION_THRESHOLD,
  DEFAULT_CONTEXT_CONFIG,
  ENGINE_PROFILES,
  MAX_SESSION_HISTORY,
  DEFAULT_TOOL_DENYLIST,
} from "./constants.ts";
