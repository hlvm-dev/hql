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
import type { CompiledPrompt } from "../prompt/mod.ts";
import type { AgentProfile } from "./agent-registry.ts";
import { createFixtureLLM, loadLlmFixture } from "./llm-fixtures.ts";
import { ValidationError } from "../../common/error.ts";
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
import {
  findMcpServersForExactToolName,
  loadMcpConfigMultiScope,
  loadMcpToolsForServers,
  normalizeServerName,
  rankMcpServersForQuery,
  type McpHandlers,
} from "./mcp/mod.ts";
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
  setCanonicalToolProfileBaseline,
  setToolProfileLayer,
  type ToolProfileState,
} from "./tool-profiles.ts";
import type { McpDiscoveryRequest, McpServerConfig } from "./mcp/types.ts";

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
  /** Override the LLM engine (defaults to getAgentEngine()) */
  engine?: AgentEngine;
  /** Preloaded agent profiles for child agent guidance. */
  agentProfiles?: readonly AgentProfile[];
  /** Disable persistent memory injection for this session. */
  disablePersistentMemory?: boolean;
  /** Persistent deferred-tool discoveries carried across turns. */
  discoveredDeferredTools?: Iterable<string>;
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
  /** Preloaded agent profiles for child agent guidance. */
  agentProfiles?: readonly AgentProfile[];
}

export interface AgentSession {
  context: ContextManager;
  llm: LLMFunction;
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
  ensureMcpLoaded?: (
    signal?: AbortSignal,
    request?: McpDiscoveryRequest,
  ) => Promise<boolean>;
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
    | "signatureHash"
    | "mode"
    | "tier"
    | "querySource"
  >;
  /** Preloaded agent profiles used for child agent prompt guidance. */
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
  modelTier: ModelTier;
  agentProfiles?: readonly AgentProfile[];
  visionCapable?: boolean;
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
    modelTier: options.modelTier,
    agentProfiles: options.agentProfiles,
    visionCapable: options.visionCapable,
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
    agentProfiles,
  };
}

export async function createAgentSession(
  options: AgentSessionOptions,
): Promise<AgentSession> {
  const profile = ENGINE_PROFILES[options.engineProfile ?? "normal"];
  const toolOwnerId = `session:${generateUUID()}`;

  const providerName = extractProviderName(options.model);
  const modelName = extractModelSuffix(options.model);
  const modelInfo = options.modelInfo !== undefined
    ? options.modelInfo
    : (options.model && !options.fixturePath
      ? await tryGetModelInfo(providerName, modelName)
      : null);

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
  const MCP_DISCOVERY_BATCH_SIZE = 3;
  type SessionMcpLoad = Awaited<ReturnType<typeof loadMcpToolsForServers>>;
  let cachedMcpCatalog: Promise<McpServerConfig[]> | null = null;
  const loadedMcpBatches: SessionMcpLoad[] = [];
  const attemptedMcpServers = new Set<string>();
  let loadingMcp: Promise<boolean> | null = null;
  let pendingHandlers: McpHandlers = {};
  let pendingSignal: AbortSignal | null = null;

  const applyMcpBindings = (mcp: SessionMcpLoad): void => {
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

  const waitForMcpLoad = async <T>(
    promise: Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    if (!signal) return await promise;
    if (signal.aborted) throw new Error("MCP load aborted");
    let removeAbortListener = () => {};
    try {
      const abortPromise = new Promise<never>((_, reject) => {
        const onAbort = () => reject(new Error("MCP load aborted"));
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", onAbort);
      });
      return await Promise.race([promise, abortPromise]);
    } finally {
      removeAbortListener();
    }
  };

  const getMcpCatalog = async (): Promise<McpServerConfig[]> => {
    if (!cachedMcpCatalog) {
      cachedMcpCatalog = loadMcpConfigMultiScope();
    }
    return await cachedMcpCatalog;
  };

  const selectMcpBatch = async (
    request?: McpDiscoveryRequest,
  ): Promise<McpServerConfig[]> => {
    const catalog = await getMcpCatalog();
    const pendingServers = catalog.filter((server) =>
      !attemptedMcpServers.has(normalizeServerName(server.name))
    );
    if (pendingServers.length === 0) return [];

    if (request?.exactToolName) {
      const exactMatches = findMcpServersForExactToolName(
        pendingServers,
        request.exactToolName,
      );
      if (exactMatches.length > 0) {
        return exactMatches.slice(0, MCP_DISCOVERY_BATCH_SIZE);
      }
      return [];
    }

    if (request?.query?.trim()) {
      const ranked = rankMcpServersForQuery(pendingServers, request.query);
      if (ranked.length > 0) {
        return ranked.slice(0, MCP_DISCOVERY_BATCH_SIZE);
      }
      return pendingServers.slice(0, MCP_DISCOVERY_BATCH_SIZE);
    }

    return pendingServers;
  };

  const ensureMcpLoaded = async (
    signal?: AbortSignal,
    request?: McpDiscoveryRequest,
  ): Promise<boolean> => {
    if (modelTier === "constrained") return false;
    if (signal?.aborted) throw new Error("MCP load aborted");

    while (true) {
      if (loadingMcp) {
        await waitForMcpLoad(loadingMcp, signal);
        continue;
      }

      const batch = await selectMcpBatch(request);
      if (batch.length === 0) return false;

      const attemptedNames = batch.map((server) =>
        normalizeServerName(server.name)
      );
      loadingMcp = loadMcpToolsForServers(
        batch,
        toolOwnerId,
        undefined,
      ).then((mcp) => {
        for (const name of attemptedNames) {
          attemptedMcpServers.add(name);
        }
        loadedMcpBatches.push(mcp);
        applyMcpBindings(mcp);
        if (mcp.connectedServers.length > 0) {
          const logger = getAgentLogger();
          for (const s of mcp.connectedServers) {
            logger.info(`MCP: ${s.name} — ${s.toolCount} tools`);
          }
        }
        return true;
      }).finally(() => {
        loadingMcp = null;
      });

      return await waitForMcpLoad(loadingMcp, signal);
    }
  };

  const mcpSetHandlers = (handlers: McpHandlers): void => {
    pendingHandlers = mergeMcpHandlers(pendingHandlers, handlers);
    for (const mcp of loadedMcpBatches) {
      mcp.setHandlers(pendingHandlers);
    }
  };

  const mcpSetSignal = (signal: AbortSignal): void => {
    pendingSignal = signal;
    for (const mcp of loadedMcpBatches) {
      mcp.setSignal(signal);
    }
  };

  if (modelTier === "constrained") {
    getAgentLogger().info("MCP: skipped (constrained model tier)");
  } else {
    getAgentLogger().debug("MCP: incremental lazy load enabled");
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
    agentProfiles: options.agentProfiles,
    visionCapable,
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
      workspace: options.workspace,
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
    setCanonicalToolProfileBaseline(toolProfileState, {
      querySource: options.querySource,
      baseAllowlist: tierFilter.allowlist,
      discoveredDeferredTools,
      ownerId: toolOwnerId,
    });
    clearToolProfileLayer(toolProfileState, "domain");
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
            if (loadingMcp) {
              await loadingMcp.catch(() => undefined);
            }
            await Promise.allSettled(
              loadedMcpBatches.map((mcp) => mcp.dispose()),
            );
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
    agentProfiles: options.agentProfiles,
  };
}
