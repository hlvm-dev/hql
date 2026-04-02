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
import { compileSystemPrompt } from "./llm-integration.ts";
import type { CompiledPrompt, InstructionHierarchy } from "../prompt/mod.ts";
import type { AgentProfile } from "./agent-registry.ts";
import { createFixtureLLM, loadLlmFixture } from "./llm-fixtures.ts";
import { ValidationError } from "../../common/error.ts";
import { type AgentPolicy, loadAgentPolicy } from "./policy.ts";
import {
  classifyModelTier,
  computeTierToolFilter,
  DEFAULT_TOOL_DENYLIST,
  ENGINE_PROFILES,
  extractModelSuffix,
  extractProviderName,
  isFrontierProvider,
  type ModelTier,
} from "./constants.ts";
import type { LLMFunction } from "./orchestrator.ts";
import { loadMcpTools, type McpHandlers } from "./mcp/mod.ts";
import { getAgentLogger } from "./logger.ts";
import { generateUUID } from "../../common/utils.ts";
import {
  resolveContextBudget,
  type ResolvedBudget,
} from "./context-resolver.ts";
import type { ModelInfo } from "../providers/types.ts";
import { createTodoState, type TodoState } from "./todo-state.ts";
import {
  type AgentLLMConfig,
  type AgentEngine,
  getAgentEngine,
  type ThinkingState,
  type ToolFilterState,
} from "./engine.ts";
import { supportsNativeThinking } from "./thinking-profile.ts";
import {
  createLspDiagnosticsRuntime,
  type LspDiagnosticsRuntime,
} from "./lsp-diagnostics.ts";
import {
  type ResolvedProviderExecutionPlan,
  type ResolvedWebCapabilityPlan,
} from "./tool-capabilities.ts";
import {
  buildExecutionSurface,
  executionSurfaceUsesMcp,
  type ExecutionSurface,
} from "./execution-surface.ts";
import {
  resolveExecutionSurfaceState,
  resolveProviderExecutionPlanForSession,
} from "./execution-surface-runtime.ts";
import {
  isMemorySystemMessage,
  isPersistentMemoryEnabled,
  loadMemorySystemMessage,
} from "../memory/mod.ts";
import { cloneToolList } from "./orchestrator-state.ts";
import { releaseToolOwner } from "./registry.ts";
import { DEFAULT_RUNTIME_MODE, type RuntimeMode } from "./runtime-mode.ts";
import { FileStateCache } from "./file-state-cache.ts";

interface AgentSessionOptions {
  workspace: string;
  model?: string;
  fixturePath?: string;
  /** Optional output-token cap for a single provider response. */
  maxOutputTokens?: number;
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
  /** Loaded instruction hierarchy (global + project). */
  instructions?: InstructionHierarchy;
  /** Override the LLM engine (defaults to getAgentEngine()) */
  engine?: AgentEngine;
  /** Preloaded agent profiles for delegation guidance. */
  agentProfiles?: readonly AgentProfile[];
  /** Disable persistent memory injection for this session. */
  disablePersistentMemory?: boolean;
  /** Session-scoped runtime mode for prompt/routing behavior. */
  runtimeMode?: RuntimeMode;
  /** Precomputed provider execution plan for the session. */
  providerExecutionPlan?: ResolvedProviderExecutionPlan;
  /** Precomputed execution surface for the session. */
  executionSurface?: ExecutionSurface;
}

interface RefreshAgentSessionOptions {
  /** Optional callback for streaming tokens to the terminal */
  onToken?: (text: string) => void;
  /** Disable persistent memory injection for this turn. */
  disablePersistentMemory?: boolean;
  /** Loaded instruction hierarchy (global + project). */
  instructions?: InstructionHierarchy;
  /** Preloaded agent profiles for delegation guidance. */
  agentProfiles?: readonly AgentProfile[];
  /** Session-scoped runtime mode for prompt/routing behavior. */
  runtimeMode?: RuntimeMode;
  /** Precomputed provider execution plan for the turn. */
  providerExecutionPlan?: ResolvedProviderExecutionPlan;
  /** Precomputed execution surface for the turn. */
  executionSurface?: ExecutionSurface;
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
  llmConfig?: AgentLLMConfig;
  /** Mutable reasoning state shared with orchestrator/engine and tests. */
  thinkingState?: ThinkingState;
  /** Whether the active model supports provider-native reasoning/thinking. */
  thinkingCapable?: boolean;
  /** The engine used for LLM creation (for rebuilding in reuseSession) */
  engine?: AgentEngine;
  /** Shared mutable tool filter state used by orchestrator + engine. */
  toolFilterState?: ToolFilterState;
  /** Reset runtime tool filters back to tier/user baseline. */
  resetToolFilter?: () => void;
  /** Session-resolved provider execution plan reused across prompt/tool execution. */
  providerExecutionPlan?: ResolvedProviderExecutionPlan;
  /** Session runtime mode for prompt/tool routing behavior. */
  runtimeMode: RuntimeMode;
  /** Session execution surface for generic capability routing/provenance. */
  executionSurface: ExecutionSurface;
  /** Session-resolved web capability plan reused across prompt/tool execution. */
  webCapabilityPlan?: ResolvedWebCapabilityPlan;
  /** Lazy MCP loader (connect/register only when first needed). */
  ensureMcpLoaded?: (signal?: AbortSignal) => Promise<void>;
  /** Deferred MCP handler registration (sampling, elicitation, roots) */
  mcpSetHandlers?: (handlers: McpHandlers) => void;
  /** Wire an AbortSignal to cancel all pending MCP requests */
  mcpSetSignal?: (signal: AbortSignal) => void;
  /** Session-scoped todo state used by todo tools. */
  todoState: TodoState;
  /** Per-session file integrity cache (read tracking, stale-edit detection, restoration hints). */
  fileStateCache: FileStateCache;
  /** Session-scoped LSP diagnostics runtime for post-write verification. */
  lspDiagnostics?: LspDiagnosticsRuntime;
  /** Metadata from prompt compilation (for observability/tracing). */
  compiledPromptMeta?: Pick<
    CompiledPrompt,
    | "sections"
    | "cacheSegments"
    | "stableCacheProfile"
    | "instructionSources"
    | "signatureHash"
    | "mode"
    | "tier"
  >;
  /** Resolved instruction hierarchy — passed to child agents (delegation/team). */
  instructions?: InstructionHierarchy;
  /** Preloaded agent profiles used for delegation/team prompt guidance. */
  agentProfiles?: readonly AgentProfile[];
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

function mergeMcpHandlers(
  current: McpHandlers,
  next: McpHandlers,
): McpHandlers {
  const roots = [...(current.roots ?? []), ...(next.roots ?? [])];
  return {
    onSampling: next.onSampling ?? current.onSampling,
    onElicitation: next.onElicitation ?? current.onElicitation,
    roots: roots.length > 0 ? [...new Set(roots)] : undefined,
  };
}

function buildCompiledPromptArtifacts(options: {
  toolAllowlist?: string[];
  toolDenylist?: string[];
  toolOwnerId: string;
  instructions?: InstructionHierarchy;
  modelTier: ModelTier;
  agentProfiles?: readonly AgentProfile[];
  runtimeMode: RuntimeMode;
  executionSurface: ExecutionSurface;
  providerExecutionPlan?: ResolvedProviderExecutionPlan;
}): {
  compiledPrompt: NonNullable<AgentLLMConfig["compiledPrompt"]>;
  compiledPromptMeta: AgentSession["compiledPromptMeta"];
  systemPromptText: string;
} {
  const compiled = compileSystemPrompt({
    toolAllowlist: options.toolAllowlist,
    toolDenylist: options.toolDenylist,
    toolOwnerId: options.toolOwnerId,
    instructions: options.instructions,
    modelTier: options.modelTier,
    agentProfiles: options.agentProfiles,
    runtimeMode: options.runtimeMode,
    executionSurface: options.executionSurface,
    providerExecutionPlan: options.providerExecutionPlan,
  });

  return {
    compiledPrompt: {
      text: compiled.text,
      cacheSegments: compiled.cacheSegments,
      signatureHash: compiled.signatureHash,
      stableCacheProfile: compiled.stableCacheProfile,
    },
    compiledPromptMeta: {
      sections: compiled.sections,
      cacheSegments: compiled.cacheSegments,
      stableCacheProfile: compiled.stableCacheProfile,
      instructionSources: compiled.instructionSources,
      signatureHash: compiled.signatureHash,
      mode: compiled.mode,
      tier: compiled.tier,
    },
    systemPromptText: compiled.text,
  };
}

async function injectPersistentMemoryContext(options: {
  context: ContextManager;
  maxContextTokens: number;
  disablePersistentMemory?: boolean;
}): Promise<void> {
  if (!isPersistentMemoryEnabled(options.disablePersistentMemory)) {
    return;
  }
  try {
    const memoryMessage = await loadMemorySystemMessage(options.maxContextTokens);
    if (memoryMessage) {
      options.context.addMessage(memoryMessage);
    }
  } catch {
    // Memory loading is best-effort — don't block session creation/reuse.
  }
}

export async function refreshReusableAgentSession(
  session: AgentSession,
  options: RefreshAgentSessionOptions = {},
): Promise<AgentSession> {
  const runtimeMode = options.runtimeMode ?? session.runtimeMode;
  const providerExecutionPlan = options.providerExecutionPlan ??
    session.providerExecutionPlan;
  const executionSurface = options.executionSurface ?? session.executionSurface;
  const instructions = options.instructions ?? session.instructions;
  const agentProfiles = options.agentProfiles ?? session.agentProfiles;
  const allowlist = session.toolFilterState?.allowlist ??
    session.llmConfig?.toolAllowlist;
  const denylist = session.toolFilterState?.denylist ??
    session.llmConfig?.toolDenylist;
  const promptArtifacts = buildCompiledPromptArtifacts({
    toolAllowlist: allowlist,
    toolDenylist: denylist,
    toolOwnerId: session.toolOwnerId,
    instructions,
    modelTier: session.modelTier,
    agentProfiles,
    runtimeMode,
    executionSurface,
    providerExecutionPlan,
  });

  const context = new ContextManager(session.context.getConfig());
  context.addMessage({
    role: "system",
    content: promptArtifacts.systemPromptText,
  });

  const previousPromptText = session.llmConfig?.compiledPrompt?.text;
  for (const message of session.context.getMessages()) {
    if (
      message.role !== "system" ||
      message.content === previousPromptText ||
      isMemorySystemMessage(message.content)
    ) {
      continue;
    }
    context.addMessage({ role: "system", content: message.content });
  }

  await injectPersistentMemoryContext({
    context,
    maxContextTokens: session.resolvedContextBudget.budget,
    disablePersistentMemory: options.disablePersistentMemory,
  });

  const llmConfig = session.llmConfig
    ? {
      ...session.llmConfig,
      onToken: options.onToken,
      runtimeMode,
      providerExecutionPlan,
      executionSurface,
      compiledPrompt: promptArtifacts.compiledPrompt,
    }
    : undefined;
  const llm = llmConfig
    ? (session.engine ?? getAgentEngine()).createLLM(llmConfig)
    : session.llm;

  return {
    ...session,
    llm,
    context,
    llmConfig,
    providerExecutionPlan,
    runtimeMode,
    executionSurface,
    webCapabilityPlan: providerExecutionPlan?.web,
    compiledPromptMeta: promptArtifacts.compiledPromptMeta,
    instructions,
    agentProfiles,
  };
}

export async function createAgentSession(
  options: AgentSessionOptions,
): Promise<AgentSession> {
  const profile = ENGINE_PROFILES[options.engineProfile ?? "normal"];
  const runtimeMode = options.runtimeMode ?? DEFAULT_RUNTIME_MODE;
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
  const effectiveToolDenylist = options.toolDenylist?.length
    ? [...options.toolDenylist]
    : [...DEFAULT_TOOL_DENYLIST];
  const tierFilter = computeTierToolFilter(
    modelTier,
    options.toolAllowlist,
    effectiveToolDenylist,
  );
  const baseToolFilter: ToolFilterState = {
    allowlist: cloneToolList(tierFilter.allowlist),
    denylist: cloneToolList(tierFilter.denylist),
  };
  const toolFilterState: ToolFilterState = {
    allowlist: cloneToolList(baseToolFilter.allowlist),
    denylist: cloneToolList(baseToolFilter.denylist),
  };
  const resetToolFilter = () => {
    toolFilterState.allowlist = cloneToolList(baseToolFilter.allowlist);
    toolFilterState.denylist = cloneToolList(baseToolFilter.denylist);
  };
  const thinkingState: ThinkingState = {};
  const lspDiagnostics = createLspDiagnosticsRuntime({
    workspace: options.workspace,
  });
  const fileStateCache = new FileStateCache();

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

  const ensureMcpLoaded = async (signal?: AbortSignal): Promise<void> => {
    if (modelTier === "weak") return;
    if (signal?.aborted) throw new Error("MCP load aborted");
    const waitForLoad = async (
      promise: Promise<Awaited<ReturnType<typeof loadMcpTools>>>,
    ): Promise<Awaited<ReturnType<typeof loadMcpTools>>> => {
      if (!signal) return await promise;
      if (signal.aborted) throw new Error("MCP load aborted");
      let removeAbortListener = () => {};
      try {
        const abortPromise = new Promise<never>((_, reject) => {
          const onAbort = () => reject(new Error("MCP load aborted"));
          signal.addEventListener("abort", onAbort, { once: true });
          removeAbortListener = () =>
            signal.removeEventListener("abort", onAbort);
        });
        return await Promise.race([promise, abortPromise]);
      } finally {
        removeAbortListener();
      }
    };
    if (loadedMcp) {
      applyMcpBindings(loadedMcp);
      return;
    }
    if (!loadingMcp) {
      loadingMcp = loadMcpTools(
        options.workspace,
        undefined,
        toolOwnerId,
        signal,
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
    const mcp = await waitForLoad(loadingMcp);
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
  contextConfig.buildRestorationHints = (maxContextTokens: number) =>
    fileStateCache.buildRestorationHints(maxContextTokens);

  const resolvedSurface = options.providerExecutionPlan && options.executionSurface
    ? {
      providerExecutionPlan: options.providerExecutionPlan,
      executionSurface: options.executionSurface,
    }
    : runtimeMode === "auto"
    ? await resolveExecutionSurfaceState({
      model: options.model,
      fixturePath: options.fixturePath,
      runtimeMode,
      toolAllowlist: toolFilterState.allowlist,
      toolDenylist: toolFilterState.denylist,
    })
    : await (async () => {
      const providerExecutionPlan = await resolveProviderExecutionPlanForSession({
        model: options.model,
        fixturePath: options.fixturePath,
        toolAllowlist: toolFilterState.allowlist,
        toolDenylist: toolFilterState.denylist,
      });
      return {
        providerExecutionPlan,
        executionSurface: buildExecutionSurface({
          runtimeMode,
          activeModelId: options.model,
          pinnedProviderName: extractProviderName(options.model),
          providerExecutionPlan,
        }),
      };
    })();
  const providerExecutionPlan = resolvedSurface.providerExecutionPlan;
  const executionSurface = resolvedSurface.executionSurface;
  const webCapabilityPlan = providerExecutionPlan.web;

  if (executionSurfaceUsesMcp(executionSurface)) {
    await ensureMcpLoaded();
  }

  const context = new ContextManager(contextConfig);

  const promptArtifacts = buildCompiledPromptArtifacts({
    toolAllowlist: toolFilterState.allowlist,
    toolDenylist: toolFilterState.denylist,
    toolOwnerId,
    modelTier,
    instructions: options.instructions,
    agentProfiles: options.agentProfiles,
    runtimeMode,
    executionSurface,
    providerExecutionPlan,
  });
  context.addMessage({
    role: "system",
    content: promptArtifacts.systemPromptText,
  });

  // Inject memory as a SEPARATE system message (not embedded in main prompt).
  // This allows reusable-session refresh to replace it without duplicating stale memory.
  await injectPersistentMemoryContext({
    context,
    maxContextTokens: resolved.budget,
    disablePersistentMemory: options.disablePersistentMemory,
  });

  const thinkingCapable = supportsNativeThinking({
    model: options.model,
    thinkingCapable: modelInfo?.capabilities?.includes("thinking") ?? false,
  });

  const llmConfig: AgentLLMConfig | undefined = options.fixturePath
    ? undefined
    : {
      model: options.model ?? (() => {
        throw new ValidationError(
          "Model is required when no fixture is provided",
          "agent_session",
        );
      })(),
      options: options.maxOutputTokens != null
        ? { maxTokens: options.maxOutputTokens }
        : {},
      contextBudget: resolved.budget,
      toolAllowlist: toolFilterState.allowlist,
      toolDenylist: toolFilterState.denylist,
      toolFilterState,
      thinkingState,
      toolOwnerId,
      onToken: options.onToken,
      thinkingCapable,
      runtimeMode,
      providerExecutionPlan,
      executionSurface,
      compiledPrompt: promptArtifacts.compiledPrompt,
    };
  const llm = options.fixturePath
    ? createFixtureLLM(await loadLlmFixture(options.fixturePath))
    : engine.createLLM(
      llmConfig ?? (() => {
        throw new ValidationError(
          "LLM config is required when no fixture is provided",
          "agent_session",
        );
      })(),
    );

  return {
    context,
    llm,
    policy,
    l1Confirmations: new Map<string, boolean>(),
    toolOwnerId,
    dispose: async () => {
      try {
        await Promise.allSettled([
          (async () => {
            if (!loadingMcp) return;
            const mcp = await loadingMcp;
            await mcp.dispose();
          })(),
          lspDiagnostics.dispose(),
        ]);
      } finally {
        releaseToolOwner(toolOwnerId);
      }
    },
    profile,
    isFrontierModel: isFrontier,
    modelTier,
    resolvedContextBudget: resolved,
    llmConfig,
    thinkingState,
    thinkingCapable,
    engine,
    toolFilterState,
    resetToolFilter,
    providerExecutionPlan,
    runtimeMode,
    executionSurface,
    webCapabilityPlan,
    ensureMcpLoaded,
    mcpSetHandlers,
    mcpSetSignal,
    todoState: createTodoState(),
    fileStateCache,
    lspDiagnostics,
    compiledPromptMeta: promptArtifacts.compiledPromptMeta,
    instructions: options.instructions,
    agentProfiles: options.agentProfiles,
  };
}
