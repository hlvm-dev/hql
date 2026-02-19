/**
 * Agent Session - Shared setup for CLI agent commands
 *
 * Centralizes:
 * - Policy loading
 * - MCP tool registration
 * - Context + system prompt
 * - LLM creation (fixture or live)
 *
 * SSOT: Avoids duplicated setup logic across entry points.
 */

import { ContextManager } from "./context.ts";
import {
  createAgentLLM,
  createSummarizationFn,
  generateSystemPrompt,
} from "./llm-integration.ts";
import { createFixtureLLM, loadLlmFixture } from "./llm-fixtures.ts";
import { type AgentPolicy, loadAgentPolicy } from "./policy.ts";
import { ENGINE_PROFILES, isFrontierProvider } from "./constants.ts";
import type { LLMFunction } from "./orchestrator.ts";
import {
  loadMcpTools,
  type McpHandlers,
  resolveBuiltinMcpServers,
} from "./mcp.ts";
import { ValidationError } from "../../common/error.ts";
import { generateUUID } from "../../common/utils.ts";
import { resolveContextBudget, type ResolvedBudget } from "./context-resolver.ts";
import type { ModelInfo } from "../providers/types.ts";

export interface AgentSessionOptions {
  workspace: string;
  model?: string;
  fixturePath?: string;
  engineProfile?: keyof typeof ENGINE_PROFILES;
  failOnContextOverflow?: boolean;
  policyPath?: string;
  mcpConfigPath?: string;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  /** Optional callback for streaming tokens to the terminal */
  onToken?: (text: string) => void;
  /** User-specified context window override (in tokens) */
  contextWindow?: number;
  /** Pre-fetched model info to avoid duplicate provider API calls */
  modelInfo?: ModelInfo | null;
  /** Per-project instructions from .hlvm/prompt.md */
  projectInstructions?: string;
}

export interface AgentSession {
  context: ContextManager;
  llm: LLMFunction;
  policy: AgentPolicy | null;
  l1Confirmations: Map<string, boolean>;
  toolOwnerId: string;
  dispose: () => Promise<void>;
  profile: typeof ENGINE_PROFILES[keyof typeof ENGINE_PROFILES];
  /** True if the model is a frontier model (API provider, not local) */
  isFrontierModel: boolean;
  /** Resolved context budget (budget, rawLimit, source) */
  resolvedContextBudget: ResolvedBudget;
  /** LLM config for rebuilding with different onToken (GUI streaming) */
  llmConfig?: {
    model: string;
    contextBudget: number;
    toolAllowlist?: string[];
    toolDenylist?: string[];
    toolOwnerId?: string;
    temperature?: number;
  };
  /** Deferred MCP handler registration (sampling, elicitation, roots) */
  mcpSetHandlers?: (handlers: McpHandlers) => void;
  /** Wire an AbortSignal to cancel all pending MCP requests */
  mcpSetSignal?: (signal: AbortSignal) => void;
}


/** Extract provider prefix from "provider/model" string */
function extractProviderName(model?: string): string {
  if (!model) return "unknown";
  const slashIdx = model.indexOf("/");
  return slashIdx > 0 ? model.slice(0, slashIdx).toLowerCase() : "ollama";
}

/** Extract model name from "provider/model" string */
function extractModelSuffix(model?: string): string {
  if (!model) return "unknown";
  const slashIdx = model.indexOf("/");
  return slashIdx > 0 ? model.slice(slashIdx + 1) : model;
}

/** Try to get ModelInfo from the provider (best-effort, non-blocking) */
async function tryGetModelInfo(
  providerName: string,
  modelName: string,
): Promise<ModelInfo | null> {
  try {
    const { ai } = await import("../api/ai.ts");
    if (ai?.models?.get) {
      return await ai.models.get(modelName, providerName) ?? null;
    }
  } catch {
    // Provider not available — fall through to defaults
  }
  return null;
}

export async function createAgentSession(
  options: AgentSessionOptions,
): Promise<AgentSession> {
  const profile = ENGINE_PROFILES[options.engineProfile ?? "normal"];
  const toolOwnerId = `session:${generateUUID()}`;

  // Parallelize independent I/O: policy, MCP server discovery, and model info
  const providerName = extractProviderName(options.model);
  const modelName = extractModelSuffix(options.model);
  const [policy, builtinMcpServers, modelInfo] = await Promise.all([
    loadAgentPolicy(options.workspace, options.policyPath),
    resolveBuiltinMcpServers(options.workspace),
    options.modelInfo !== undefined
      ? Promise.resolve(options.modelInfo)
      : (options.model && !options.fixturePath
        ? tryGetModelInfo(providerName, modelName)
        : Promise.resolve(null)),
  ]);

  // Load MCP tools (depends on builtinMcpServers above)
  const mcp = await loadMcpTools(
    options.workspace,
    options.mcpConfigPath,
    builtinMcpServers,
    toolOwnerId,
  );

  const resolved = resolveContextBudget({
    modelInfo: modelInfo ?? undefined,
    userOverride: options.contextWindow,
  });

  const contextConfig: Record<string, unknown> = { ...profile.context };
  contextConfig.maxTokens = resolved.budget;
  if (options.failOnContextOverflow) {
    contextConfig.overflowStrategy = "fail";
  }
  // Wire LLM-powered summarization for context compaction (only for live models)
  if (!options.fixturePath && options.model) {
    contextConfig.llmSummarize = createSummarizationFn(options.model);
  }

  const context = new ContextManager(contextConfig);
  context.addMessage({
    role: "system",
    content: generateSystemPrompt({
      toolAllowlist: options.toolAllowlist,
      toolDenylist: options.toolDenylist,
      toolOwnerId: mcp.ownerId,
      projectInstructions: options.projectInstructions,
    }),
  });

  const llm = options.fixturePath
    ? createFixtureLLM(await loadLlmFixture(options.fixturePath))
    : createAgentLLM({
      model: options.model ?? (() => {
        throw new ValidationError(
          "Model is required when no fixture is provided",
          "agent_session",
        );
      })(),
      options: { temperature: 0.0 },
      contextBudget: resolved.budget,
      toolAllowlist: options.toolAllowlist,
      toolDenylist: options.toolDenylist,
      toolOwnerId: mcp.ownerId,
      onToken: options.onToken,
    });

  const llmConfig = options.fixturePath ? undefined : {
    model: options.model!,
    contextBudget: resolved.budget,
    toolAllowlist: options.toolAllowlist,
    toolDenylist: options.toolDenylist,
    toolOwnerId: mcp.ownerId,
    temperature: 0.0,
  };

  return {
    context,
    llm,
    policy,
    l1Confirmations: new Map<string, boolean>(),
    toolOwnerId: mcp.ownerId,
    dispose: mcp.dispose,
    profile,
    isFrontierModel: isFrontierProvider(options.model),
    resolvedContextBudget: resolved,
    llmConfig,
    mcpSetHandlers: mcp.setHandlers,
    mcpSetSignal: mcp.setSignal,
  };
}
