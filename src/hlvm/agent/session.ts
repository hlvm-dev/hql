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
import { generateSystemPrompt } from "./llm-integration.ts";
import type { AgentProfile } from "./agent-registry.ts";
import { createFixtureLLM, loadLlmFixture } from "./llm-fixtures.ts";
import { type AgentPolicy, loadAgentPolicy } from "./policy.ts";
import {
  classifyModelTier,
  computeTierToolFilter,
  ENGINE_PROFILES,
  extractModelSuffix,
  extractProviderName,
  isFrontierProvider,
  type ModelTier,
} from "./constants.ts";
import type { LLMFunction } from "./orchestrator.ts";
import { loadMcpTools, type McpHandlers } from "./mcp/mod.ts";
import { getAgentLogger } from "./logger.ts";
import { ValidationError } from "../../common/error.ts";
import { generateUUID } from "../../common/utils.ts";
import {
  resolveContextBudget,
  type ResolvedBudget,
} from "./context-resolver.ts";
import type { ModelInfo } from "../providers/types.ts";
import { createTodoState, type TodoState } from "./todo-state.ts";
import {
  type AgentEngine,
  getAgentEngine,
  type ToolFilterState,
} from "./engine.ts";
import { loadMemoryContext } from "../memory/mod.ts";

export interface AgentSessionOptions {
  workspace: string;
  model?: string;
  fixturePath?: string;
  engineProfile?: keyof typeof ENGINE_PROFILES;
  failOnContextOverflow?: boolean;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  /** Optional callback for streaming tokens to the terminal */
  onToken?: (text: string) => void;
  /** User-specified context window override (in tokens) */
  contextWindow?: number;
  /** Pre-fetched model info to avoid duplicate provider API calls */
  modelInfo?: ModelInfo | null;
  /** Custom instructions from ~/.hlvm/HLVM.md */
  customInstructions?: string;
  /** Override the LLM engine (defaults to getAgentEngine()) */
  engine?: AgentEngine;
  /** Preloaded agent profiles for delegation guidance. */
  agentProfiles?: readonly AgentProfile[];
  /** Disable persistent memory injection for this session. */
  disablePersistentMemory?: boolean;
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
  /** Classified model tier for prompt depth control */
  modelTier: ModelTier;
  /** Resolved context budget (budget, rawLimit, source) */
  resolvedContextBudget: ResolvedBudget;
  /** LLM config for rebuilding with different onToken (GUI streaming) */
  llmConfig?: {
    model: string;
    contextBudget: number;
    toolAllowlist?: string[];
    toolDenylist?: string[];
    toolFilterState?: ToolFilterState;
    toolOwnerId?: string;
    temperature?: number;
  };
  /** The engine used for LLM creation (for rebuilding in reuseSession) */
  engine?: AgentEngine;
  /** Shared mutable tool filter state used by orchestrator + engine. */
  toolFilterState?: ToolFilterState;
  /** Reset runtime tool filters back to tier/user baseline. */
  resetToolFilter?: () => void;
  /** Lazy MCP loader (connect/register only when first needed). */
  ensureMcpLoaded?: () => Promise<void>;
  /** Deferred MCP handler registration (sampling, elicitation, roots) */
  mcpSetHandlers?: (handlers: McpHandlers) => void;
  /** Wire an AbortSignal to cancel all pending MCP requests */
  mcpSetSignal?: (signal: AbortSignal) => void;
  /** Session-scoped todo state used by todo tools. */
  todoState: TodoState;
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

function cloneStringList(list?: string[]): string[] | undefined {
  return list?.length ? [...list] : undefined;
}

function mergeMcpHandlers(
  current: McpHandlers,
  next: McpHandlers,
): McpHandlers {
  const roots = [...(current.roots ?? []), ...(next.roots ?? [])];
  return {
    onSampling: next.onSampling ?? current.onSampling,
    onElicitation: next.onElicitation ?? current.onElicitation,
    roots: roots.length > 0 ? Array.from(new Set(roots)) : undefined,
  };
}

export async function createAgentSession(
  options: AgentSessionOptions,
): Promise<AgentSession> {
  const profile = ENGINE_PROFILES[options.engineProfile ?? "normal"];
  const toolOwnerId = `session:${generateUUID()}`;

  // Parallelize independent I/O: policy, MCP server discovery, and model info
  const providerName = extractProviderName(options.model);
  const modelName = extractModelSuffix(options.model);
  const [policy, modelInfo] = await Promise.all([
    loadAgentPolicy(),
    options.modelInfo !== undefined
      ? Promise.resolve(options.modelInfo)
      : (options.model && !options.fixturePath
        ? tryGetModelInfo(providerName, modelName)
        : Promise.resolve(null)),
  ]);

  // Compute model tier BEFORE MCP loading (weak models skip MCP entirely)
  const isFrontier = isFrontierProvider(options.model);
  const modelTier = classifyModelTier(modelInfo, isFrontier);
  const tierFilter = computeTierToolFilter(
    modelTier,
    options.toolAllowlist,
    options.toolDenylist,
  );
  const baseToolFilter: ToolFilterState = {
    allowlist: cloneStringList(tierFilter.allowlist),
    denylist: cloneStringList(tierFilter.denylist),
  };
  const toolFilterState: ToolFilterState = {
    allowlist: cloneStringList(baseToolFilter.allowlist),
    denylist: cloneStringList(baseToolFilter.denylist),
  };
  const resetToolFilter = () => {
    toolFilterState.allowlist = cloneStringList(baseToolFilter.allowlist);
    toolFilterState.denylist = cloneStringList(baseToolFilter.denylist);
  };

  // Lazy MCP loading: defer connection/registration until first MCP use.
  let loadedMcp: Awaited<ReturnType<typeof loadMcpTools>> | null = null;
  let loadingMcp: Promise<Awaited<ReturnType<typeof loadMcpTools>>> | null =
    null;
  let pendingHandlers: McpHandlers = {};
  let pendingSignal: AbortSignal | null = null;

  const applyMcpBindings = (
    mcp: Awaited<ReturnType<typeof loadMcpTools>>,
  ): void => {
    if (
      pendingHandlers.onSampling ||
      pendingHandlers.onElicitation ||
      (pendingHandlers.roots?.length ?? 0) > 0
    ) {
      mcp.setHandlers(pendingHandlers);
    }
    if (pendingSignal) {
      mcp.setSignal(pendingSignal);
    }
  };

  const ensureMcpLoaded = async (): Promise<void> => {
    if (modelTier === "weak") return;
    if (loadedMcp) {
      applyMcpBindings(loadedMcp);
      return;
    }
    if (!loadingMcp) {
      loadingMcp = loadMcpTools(
        options.workspace,
        undefined,
        toolOwnerId,
      ).then((mcp) => {
        loadedMcp = mcp;
        applyMcpBindings(mcp);
        if (mcp.connectedServers.length > 0) {
          const logger = getAgentLogger();
          for (const s of mcp.connectedServers) {
            logger.info(`MCP: ${s.name} — ${s.toolCount} tools`);
          }
        }
        return mcp;
      }).catch((error) => {
        loadingMcp = null;
        throw error;
      });
    }
    const mcp = await loadingMcp;
    applyMcpBindings(mcp);
  };

  const mcpSetHandlers = (handlers: McpHandlers): void => {
    pendingHandlers = mergeMcpHandlers(pendingHandlers, handlers);
    if (loadedMcp) {
      loadedMcp.setHandlers(pendingHandlers);
    }
  };

  const mcpSetSignal = (signal: AbortSignal): void => {
    pendingSignal = signal;
    if (loadedMcp) {
      loadedMcp.setSignal(signal);
    }
  };

  if (modelTier === "weak") {
    getAgentLogger().info("MCP: skipped (weak model tier)");
  } else {
    getAgentLogger().debug("MCP: lazy load enabled");
  }

  const resolved = resolveContextBudget({
    modelInfo: modelInfo ?? undefined,
    userOverride: options.contextWindow,
  });

  const contextConfig: Record<string, unknown> = { ...profile.context };
  contextConfig.maxTokens = resolved.budget;
  if (options.model) {
    contextConfig.modelKey = options.model;
  }
  if (options.failOnContextOverflow) {
    contextConfig.overflowStrategy = "fail";
  }
  // Wire LLM-powered summarization for context compaction (only for live models)
  const engine = options.engine ?? getAgentEngine();
  if (!options.fixturePath && options.model) {
    contextConfig.llmSummarize = engine.createSummarizer(options.model);
  }

  const context = new ContextManager(contextConfig);
  context.addMessage({
    role: "system",
    content: generateSystemPrompt({
      toolAllowlist: toolFilterState.allowlist,
      toolDenylist: toolFilterState.denylist,
      toolOwnerId,
      customInstructions: options.customInstructions,
      modelTier,
      agentProfiles: options.agentProfiles,
    }),
  });

  // Inject memory as a SEPARATE system message (not embedded in main prompt).
  // This allows reuseSession() to refresh memory without duplicating it.
  if (!options.disablePersistentMemory) {
    try {
      const memoryContext = await loadMemoryContext(resolved.budget);
      if (memoryContext) {
        context.addMessage({
          role: "system",
          content: `# Your Memory\n${memoryContext}`,
        });
      }
    } catch {
      // Memory loading is best-effort — don't block session creation
    }
  }

  const llm = options.fixturePath
    ? createFixtureLLM(await loadLlmFixture(options.fixturePath))
    : engine.createLLM({
      model: options.model ?? (() => {
        throw new ValidationError(
          "Model is required when no fixture is provided",
          "agent_session",
        );
      })(),
      options: { temperature: 0.0 },
      contextBudget: resolved.budget,
      toolAllowlist: toolFilterState.allowlist,
      toolDenylist: toolFilterState.denylist,
      toolFilterState,
      toolOwnerId,
      onToken: options.onToken,
    });

  const llmConfig = options.fixturePath ? undefined : {
    model: options.model!,
    contextBudget: resolved.budget,
    toolAllowlist: toolFilterState.allowlist,
    toolDenylist: toolFilterState.denylist,
    toolFilterState,
    toolOwnerId,
    temperature: 0.0,
  };

  return {
    context,
    llm,
    policy,
    l1Confirmations: new Map<string, boolean>(),
    toolOwnerId,
    dispose: async () => {
      if (!loadingMcp) return;
      const mcp = await loadingMcp;
      await mcp.dispose();
    },
    profile,
    isFrontierModel: isFrontier,
    modelTier,
    resolvedContextBudget: resolved,
    llmConfig,
    engine,
    toolFilterState,
    resetToolFilter,
    ensureMcpLoaded,
    mcpSetHandlers,
    mcpSetSignal,
    todoState: createTodoState(),
  };
}
