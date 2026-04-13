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
  type AgentEngine,
  type AgentLLMConfig,
  getAgentEngine,
  type ThinkingState,
} from "./engine.ts";
import { supportsNativeThinking } from "./thinking-profile.ts";
import {
  createLspDiagnosticsRuntime,
  type LspDiagnosticsRuntime,
} from "./lsp-diagnostics.ts";
import {
  isMemorySystemMessage,
  isPersistentMemoryEnabled,
  loadMemorySystemMessage,
} from "../memory/mod.ts";
import { cloneToolList } from "./orchestrator-state.ts";
import { releaseToolOwner } from "./registry.ts";
import { COMPUTER_USE_TOOLS } from "./computer-use/mod.ts";
import { FileStateCache } from "./file-state-cache.ts";
import { clearToolResultSidecars } from "./tool-result-storage.ts";
import {
  REPL_MAIN_THREAD_QUERY_SOURCE,
  resolveMainThreadBaselineToolAllowlist,
} from "./query-tool-routing.ts";
import {
  clearToolProfileLayer,
  createToolProfileState,
  resolveEffectiveToolFilterCached,
  resolvePersistentToolFilter,
  setToolProfileLayer,
  type ToolProfileState,
} from "./tool-profiles.ts";

interface AgentSessionOptions {
  workspace: string;
  model?: string;
  fixturePath?: string;
  sessionId?: string | null;
  querySource?: string;
  temperature?: number;
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
  /** Persistent deferred-tool discoveries carried across turns. */
  discoveredDeferredTools?: Iterable<string>;
  /** Loaded skill catalog for prompt rendering. */
  skills?: ReadonlyMap<string, import("../skills/types.ts").SkillDefinition>;
}

interface RefreshAgentSessionOptions {
  /** Optional callback for streaming tokens to the terminal */
  onToken?: (text: string) => void;
  querySource?: string;
  temperature?: number;
  /** Preserve prior user/assistant/tool context already held in memory. */
  preserveConversationContext?: boolean;
  /** Disable persistent memory injection for this turn. */
  disablePersistentMemory?: boolean;
  /** Loaded instruction hierarchy (global + project). */
  instructions?: InstructionHierarchy;
  /** Preloaded agent profiles for delegation guidance. */
  agentProfiles?: readonly AgentProfile[];
}

export interface AgentSession {
  context: ContextManager;
  llm: LLMFunction;
  policy: AgentPolicy | null;
  l1Confirmations: Map<string, boolean>;
  sessionId?: string | null;
  toolOwnerId: string;
  querySource?: string;
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
  /** Whether the active model supports vision (image) inputs. */
  visionCapable?: boolean;
  /** The engine used for LLM creation (for rebuilding in reuseSession) */
  engine?: AgentEngine;
  /** Canonical persistent baseline before domain-specific widening. */
  baseToolAllowlist?: string[];
  /** Canonical caller-provided deny baseline before domain/runtime widening. */
  baseToolDenylist?: string[];
  /** First-class layered tool profile state backing the live tool filter. */
  toolProfileState?: ToolProfileState;
  /** Reset runtime tool filters back to tier/user baseline. */
  resetToolFilter?: () => void;
  /** Deferred specialized tools discovered via tool_search and kept across turns. */
  discoveredDeferredTools: Set<string>;
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
    | "querySource"
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
  querySource?: string;
  instructions?: InstructionHierarchy;
  modelTier: ModelTier;
  agentProfiles?: readonly AgentProfile[];
  visionCapable?: boolean;
  skills?: ReadonlyMap<string, import("../skills/types.ts").SkillDefinition>;
}): {
  compiledPrompt: NonNullable<AgentLLMConfig["compiledPrompt"]>;
  compiledPromptMeta: AgentSession["compiledPromptMeta"];
  systemPromptText: string;
} {
  const compiled = compileSystemPrompt({
    toolAllowlist: options.toolAllowlist,
    toolDenylist: options.toolDenylist,
    toolOwnerId: options.toolOwnerId,
    querySource: options.querySource,
    instructions: options.instructions,
    modelTier: options.modelTier,
    agentProfiles: options.agentProfiles,
    visionCapable: options.visionCapable,
    skills: options.skills,
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
      querySource: compiled.querySource,
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
    const memoryMessage = await loadMemorySystemMessage(
      options.maxContextTokens,
    );
    if (memoryMessage) {
      options.context.addMessage(memoryMessage);
    }
  } catch {
    // Memory loading is best-effort — don't block session creation/reuse.
  }
}

function isTransientReusableSystemMessage(content: string): boolean {
  return content.startsWith("Allowed file roots:");
}

export async function refreshReusableAgentSession(
  session: AgentSession,
  options: RefreshAgentSessionOptions = {},
): Promise<AgentSession> {
  const instructions = options.instructions ?? session.instructions;
  const agentProfiles = options.agentProfiles ?? session.agentProfiles;
  const persistentFilter = session.toolProfileState
    ? resolvePersistentToolFilter(session.toolProfileState)
    : undefined;
  const allowlist = persistentFilter?.allowlist ??
    session.baseToolAllowlist;
  const denylist = persistentFilter?.denylist ??
    session.baseToolDenylist;
  const promptArtifacts = buildCompiledPromptArtifacts({
    toolAllowlist: allowlist,
    toolDenylist: denylist,
    toolOwnerId: session.toolOwnerId,
    querySource: options.querySource ?? session.querySource,
    instructions,
    modelTier: session.modelTier,
    agentProfiles,
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
      isMemorySystemMessage(message.content) ||
      isTransientReusableSystemMessage(message.content)
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

  if (options.preserveConversationContext) {
    for (const message of session.context.getMessages()) {
      if (message.role === "system") {
        continue;
      }
      context.addMessage({ ...message });
    }
  }

  const llmConfig = session.llmConfig
    ? {
      ...session.llmConfig,
      options: {
        ...(session.llmConfig.options ?? {}),
        ...(typeof options.temperature === "number"
          ? { temperature: options.temperature }
          : {}),
      },
      onToken: options.onToken,
      querySource: options.querySource ?? session.querySource,
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
    querySource: options.querySource ?? session.querySource,
    compiledPromptMeta: promptArtifacts.compiledPromptMeta,
    instructions,
    agentProfiles,
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
  const modelTier = classifyModelTier(modelInfo, options.model);
  const effectiveToolDenylist = options.toolDenylist?.length
    ? [...options.toolDenylist]
    : [...DEFAULT_TOOL_DENYLIST];
  const visionCapable = modelInfo?.capabilities?.includes("vision") ??
    isFrontier;
  // Deny CU tools for non-vision models (they can't process screenshots)
  if (!visionCapable) {
    for (const name of Object.keys(COMPUTER_USE_TOOLS)) {
      if (!effectiveToolDenylist.includes(name)) {
        effectiveToolDenylist.push(name);
      }
    }
  }
  // PW tools are NOT denied at session creation — Chromium availability is
  // checked lazily at first tool use. If missing, the orchestrator's
  // structured-failure handler detects pw_browser_unavailable and triggers
  // on-demand install via ensurePlaywrightChromium().
  const discoveredDeferredTools = new Set(
    options.discoveredDeferredTools ?? [],
  );
  const baselineToolAllowlist = resolveMainThreadBaselineToolAllowlist({
    querySource: options.querySource,
    toolAllowlist: options.toolAllowlist,
    discoveredDeferredTools,
  });
  const tierFilter = computeTierToolFilter(
    modelTier,
    baselineToolAllowlist,
    effectiveToolDenylist,
  );
  const toolProfileState = createToolProfileState();
  setToolProfileLayer(toolProfileState, "baseline", {
    allowlist: cloneToolList(tierFilter.allowlist),
    denylist: cloneToolList(tierFilter.denylist),
  });
  const initialEffectiveFilter = resolveEffectiveToolFilterCached(
    toolProfileState,
  );
  const initialPersistentFilter = resolvePersistentToolFilter(toolProfileState);
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
    if (modelTier === "constrained") return;
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

  if (modelTier === "constrained") {
    getAgentLogger().info("MCP: skipped (constrained model tier)");
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

  const context = new ContextManager(contextConfig);

  const promptArtifacts = buildCompiledPromptArtifacts({
    toolAllowlist: initialEffectiveFilter.allowlist,
    toolDenylist: initialEffectiveFilter.denylist,
    toolOwnerId,
    querySource: options.querySource,
    modelTier,
    instructions: options.instructions,
    agentProfiles: options.agentProfiles,
    visionCapable,
    skills: options.skills,
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
      options: {
        ...(options.maxOutputTokens != null
          ? { maxTokens: options.maxOutputTokens }
          : {}),
        ...(typeof options.temperature === "number"
          ? { temperature: options.temperature }
          : {}),
      },
      contextBudget: resolved.budget,
      toolAllowlist: cloneToolList(tierFilter.allowlist),
      toolDenylist: cloneToolList(tierFilter.denylist),
      toolProfileState,
      eagerToolCount: initialPersistentFilter.allowlist?.length,
      discoveredDeferredToolCount: discoveredDeferredTools.size,
      thinkingState,
      toolOwnerId,
      onToken: options.onToken,
      querySource: options.querySource,
      thinkingCapable,
      compiledPrompt: promptArtifacts.compiledPrompt,
    };
  const syncSessionToolProfileState = (): void => {
    if (llmConfig) {
      llmConfig.toolProfileState = toolProfileState;
      llmConfig.eagerToolCount = resolvePersistentToolFilter(toolProfileState)
        .allowlist?.length;
      llmConfig.discoveredDeferredToolCount = discoveredDeferredTools.size;
    }
  };
  syncSessionToolProfileState();
  const resetToolFilter = () => {
    clearToolProfileLayer(toolProfileState, "discovery");
    clearToolProfileLayer(toolProfileState, "runtime");
    syncSessionToolProfileState();
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
  const sessionId = options.sessionId ?? null;

  return {
    context,
    llm,
    policy,
    l1Confirmations: new Map<string, boolean>(),
    sessionId,
    toolOwnerId,
    querySource: options.querySource,
    dispose: async () => {
      try {
        await Promise.allSettled([
          (async () => {
            if (!sessionId) return;
            const { closeBrowser } = await import("./playwright/mod.ts");
            await closeBrowser(sessionId);
          })(),
          (async () => {
            if (!loadingMcp) return;
            const mcp = await loadingMcp;
            await mcp.dispose();
          })(),
          lspDiagnostics.dispose(),
          clearToolResultSidecars(sessionId),
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
    visionCapable,
    engine,
    toolProfileState,
    baseToolAllowlist: cloneToolList(tierFilter.allowlist),
    baseToolDenylist: cloneToolList(tierFilter.denylist),
    resetToolFilter,
    discoveredDeferredTools,
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
