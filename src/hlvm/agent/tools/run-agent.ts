/**
 * Agent Execution Loop
 *
 * CC source: tools/AgentTool/runAgent.ts
 * Wraps HLVM's runReActLoop() to execute a sub-agent in isolation.
 *
 * Each sub-agent gets:
 * - Its own ContextManager (message history)
 * - Its own tool set (filtered by agent definition)
 * - Its own turn counter (maxTurns, default 200)
 * - Its own system prompt (from agent definition)
 *
 * The parent's loop blocks while the child runs (sync mode).
 */

import { ContextManager } from "../context.ts";
import {
  type AgentLoopResult,
  type OrchestratorConfig,
} from "../orchestrator.ts";
import type { LLMFunction } from "../orchestrator-llm.ts";
import type { ToolMetadata } from "../registry.ts";
import { getAgentEngine } from "../engine.ts";
import type { AgentDefinition } from "./agent-types.ts";
import { AGENT_MAX_TURNS } from "./agent-constants.ts";
import { resolveAgentTools } from "./agent-tool-utils.ts";
import { UsageTracker } from "../usage.ts";
import { getAgentLogger } from "../logger.ts";
import { createAgent } from "../agent.ts";

const log = getAgentLogger();

// ============================================================
// Types
// ============================================================

export interface InheritedAgentConfig {
  contextBudget?: number;
  modelTier?: OrchestratorConfig["modelTier"];
  onTrace?: OrchestratorConfig["onTrace"];
  llmTimeout?: OrchestratorConfig["llmTimeout"];
  toolTimeout?: OrchestratorConfig["toolTimeout"];
  totalTimeout?: OrchestratorConfig["totalTimeout"];
  permissionMode?: OrchestratorConfig["permissionMode"];
  agentProfiles?: OrchestratorConfig["agentProfiles"];
  querySource?: OrchestratorConfig["querySource"];
  thinkingCapable?: OrchestratorConfig["thinkingCapable"];
  toolOwnerId?: OrchestratorConfig["toolOwnerId"];
  ensureMcpLoaded?: OrchestratorConfig["ensureMcpLoaded"];
  modelId?: OrchestratorConfig["modelId"];
}

export interface RunAgentOptions {
  /** The agent definition to execute */
  agentDefinition: AgentDefinition;
  /** The task prompt for the agent */
  prompt: string;
  /** Parent's workspace path */
  workspace: string;
  /** LLM function for API calls */
  llmFunction: LLMFunction;
  /** All available tools (pre-filtered for the agent) */
  allTools: Record<string, ToolMetadata>;
  /** Whether this is an async (background) execution */
  isAsync?: boolean;
  /** Max turns override (defaults to agentDef.maxTurns or AGENT_MAX_TURNS) */
  maxTurns?: number;
  /** Abort signal from parent */
  signal?: AbortSignal;
  /** Explicit tool/agent model override. */
  modelOverride?: string;
  /** Parent orchestrator config for inheriting settings */
  inheritedConfig?: InheritedAgentConfig;
  /** Unique agent ID for tracking */
  agentId: string;
  /** Callback for agent events */
  onAgentEvent?: OrchestratorConfig["onAgentEvent"];
  /** Optional live transcript line sink for async task output */
  onTranscriptLine?: (line: string) => void | Promise<void>;
}

export interface RunAgentResult {
  /** Final response text from the agent */
  text: string;
  /** Agent type that ran */
  agentType: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Number of tool uses */
  toolUseCount: number;
  /** Total tokens used (input + output) */
  totalTokens: number;
  /** Core loop stop reason */
  stopReason?: AgentLoopResult["stopReason"];
  /** Core loop iteration count */
  iterations?: number;
  /** Collected transcript of child tool calls for expand/collapse display */
  transcript: string;
}

// ============================================================
// runAgent (CC: runAgent() async generator — adapted to HLVM)
// ============================================================

/**
 * Execute a sub-agent with isolated context and tools.
 *
 * CC pattern: runAgent() is an async generator that calls query() and yields messages.
 * HLVM adaptation: runReActLoop() returns a structured AgentLoopResult.
 *
 * Flow (same as CC):
 * 1. Build system prompt from agent definition
 * 2. Resolve tools for this agent
 * 3. Create isolated ContextManager
 * 4. Call runReActLoop with isolated config
 * 5. Return result
 */
export async function runAgent(
  options: RunAgentOptions,
): Promise<RunAgentResult> {
  const {
    agentDefinition,
    prompt,
    workspace,
    llmFunction,
    allTools,
    isAsync = false,
    maxTurns,
    signal,
    modelOverride,
    inheritedConfig,
    agentId,
    onAgentEvent,
    onTranscriptLine,
  } = options;

  const startTime = Date.now();

  // Step 1: Build system prompt (CC: getAgentSystemPrompt)
  let systemPrompt: string;
  try {
    systemPrompt = agentDefinition.getSystemPrompt();
  } catch (err) {
    log.debug(
      `Failed to get system prompt for ${agentDefinition.agentType}: ${err}`,
    );
    systemPrompt =
      "You are an agent. Complete the task fully and report your findings.";
  }

  // Step 2: Resolve tools (CC: resolveAgentTools)
  const { resolvedTools } = resolveAgentTools(
    agentDefinition,
    allTools,
    isAsync,
  );

  const effectiveModel = modelOverride ?? agentDefinition.model ??
    inheritedConfig?.modelId;
  let childLlmFunction = llmFunction;
  if (effectiveModel && effectiveModel !== "inherit") {
    try {
      childLlmFunction = getAgentEngine().createLLM({
        model: effectiveModel,
        workspace,
        contextBudget: inheritedConfig?.contextBudget,
        toolAllowlist: Array.from(resolvedTools.keys()),
        querySource: inheritedConfig?.querySource,
        toolOwnerId: inheritedConfig?.toolOwnerId,
        thinkingCapable: inheritedConfig?.thinkingCapable,
      });
    } catch (err) {
      const usedExplicitOverride = modelOverride != null ||
        (agentDefinition.model != null && agentDefinition.model !== "inherit");
      if (usedExplicitOverride) {
        throw err;
      }
      log.debug(
        `[Agent:${agentDefinition.agentType}] Failed to create child LLM from parent model '${effectiveModel}', falling back to parent LLM: ${err}`,
      );
    }
  }

  // Step 3: Create isolated context (CC: createSubagentContext)
  const context = new ContextManager({
    maxTokens: inheritedConfig?.contextBudget ?? 128_000,
  });

  // Add system prompt as first message
  context.addMessage({
    role: "system",
    content: systemPrompt,
  });

  // Step 4: Build isolated OrchestratorConfig (CC: agentOptions + query params)
  const effectiveMaxTurns = maxTurns ?? agentDefinition.maxTurns ??
    AGENT_MAX_TURNS;

  // CC: Track tool uses via onAgentEvent interception.
  // The child orchestrator emits tool_start/tool_end events — we count them
  // and emit agent_progress to the PARENT for TUI rendering.
  //
  // IMPORTANT: We do NOT forward child tool events to parent.
  // CC: child events stay inside the child. Parent only sees agent_spawn/progress/complete.
  // Forwarding would pollute the parent's TUI with child tool calls.
  // CC: Track tool uses and build transcript for expand/collapse.
  // Child events are NOT forwarded to parent TUI — only counted and recorded.
  let toolUseCount = 0;
  const transcriptLines: string[] = [];
  const pushTranscriptLine = (line: string): void => {
    transcriptLines.push(line);
    void onTranscriptLine?.(line);
  };
  const childOnAgentEvent: typeof onAgentEvent = (event) => {
    if (event.type === "tool_start") {
      pushTranscriptLine(`  ${event.name} ${event.argsSummary}`);
    }
    if (event.type === "tool_end") {
      toolUseCount++;
      const status = event.success ? "ok" : "ERROR";
      const summary = event.summary ? ` — ${event.summary.slice(0, 100)}` : "";
      pushTranscriptLine(`  ⎿ ${status} (${event.durationMs}ms)${summary}`);
      // Emit progress event to PARENT for TUI updates
      onAgentEvent?.({
        type: "agent_progress",
        agentId,
        agentType: agentDefinition.agentType,
        toolUseCount,
        durationMs: Date.now() - startTime,
      });
    }
    // Do NOT forward child tool events to parent — they would pollute the TUI.
  };

  // CC: track token usage via UsageTracker (for "N tokens" in TUI display)
  const usageTracker = new UsageTracker();

  const childConfig: OrchestratorConfig = {
    workspace,
    context,
    maxIterations: effectiveMaxTurns,
    signal,
    onAgentEvent: childOnAgentEvent,
    usage: usageTracker,
    // Inherit from parent where appropriate
    modelTier: inheritedConfig?.modelTier,
    onTrace: inheritedConfig?.onTrace,
    permissionMode: agentDefinition.permissionMode ??
      inheritedConfig?.permissionMode,
    agentProfiles: inheritedConfig?.agentProfiles,
    querySource: inheritedConfig?.querySource,
    thinkingCapable: inheritedConfig?.thinkingCapable,
    toolOwnerId: inheritedConfig?.toolOwnerId,
    ensureMcpLoaded: inheritedConfig?.ensureMcpLoaded,
    modelId: effectiveModel === "inherit"
      ? inheritedConfig?.modelId
      : effectiveModel,
    // Tool control: use resolved tools for this agent
    toolAllowlist: Array.from(resolvedTools.keys()),
    // Timeouts: use parent's or defaults
    llmTimeout: inheritedConfig?.llmTimeout,
    toolTimeout: inheritedConfig?.toolTimeout,
    totalTimeout: inheritedConfig?.totalTimeout,
  };

  // Step 5: Execute (CC: for await (const message of query(...)))
  log.debug(
    `[Agent:${agentDefinition.agentType}] Starting with ${resolvedTools.size} tools, max ${effectiveMaxTurns} turns`,
  );

  let loopResult: AgentLoopResult | undefined;
  try {
    loopResult = await createAgent({
      config: childConfig,
      llmFunction: childLlmFunction,
    }).run(prompt);
  } catch (err) {
    if (signal?.aborted) {
      throw err; // Propagate abort
    }
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[Agent:${agentDefinition.agentType}] Error: ${msg}`);
    loopResult = {
      text: `Agent encountered an error: ${msg}`,
      stopReason: "tool_failures",
      iterations: 0,
      durationMs: Date.now() - startTime,
      usage: usageTracker.snapshot(),
      toolUseCount,
    };
  }

  const durationMs = Date.now() - startTime;
  log.debug(
    `[Agent:${agentDefinition.agentType}] Completed in ${durationMs}ms`,
  );

  // Step 6: Return result (CC: finalizeAgentTool)
  const completedLoopResult = loopResult!;
  const usageSnapshot = completedLoopResult.usage;
  return {
    text: completedLoopResult.text,
    agentType: agentDefinition.agentType,
    durationMs,
    toolUseCount: completedLoopResult.toolUseCount || toolUseCount,
    totalTokens: usageSnapshot.totalTokens,
    stopReason: completedLoopResult.stopReason,
    iterations: completedLoopResult.iterations,
    transcript: transcriptLines.join("\n"),
  };
}
