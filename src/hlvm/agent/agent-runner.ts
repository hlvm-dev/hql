/**
 * Agent Runner — Shared core for running agent queries.
 *
 * SSOT for agent execution logic used by both CLI (ask command) and
 * HTTP (/api/chat mode:"agent"). Eliminates duplication between entry points.
 *
 * Consumers provide transport-specific callbacks; this module handles
 * session setup, policy, history, and the ReAct loop.
 */

import { initializeRuntime } from "../../common/runtime-initializer.ts";
import { ValidationError } from "../../common/error.ts";
import { generateUUID, getErrorMessage } from "../../common/utils.ts";
import {
  closeFactDb,
  isPersistentMemoryEnabled,
  MEMORY_TOOLS,
  persistConversationFacts,
  persistExplicitMemoryRequest,
  setMemoryModelTier,
} from "../memory/mod.ts";
import { setAgentLogger } from "./logger.ts";
import {
  ensureDefaultModelInstalled,
  getConfiguredModel,
  resolveCompatibleClaudeCodeModel,
} from "../../common/ai-default-model.ts";
import { AUTO_MODEL_ID, DEFAULT_MODEL_ID } from "../../common/config/types.ts";
import { getPlatform } from "../../platform/platform.ts";
import { loadInstructionHierarchy } from "../prompt/mod.ts";
import { deriveDefaultSessionKey } from "../runtime/session-key.ts";
import {
  type AgentSession,
  createAgentSession,
  refreshReusableAgentSession,
} from "./session.ts";
import { getAgentEngine } from "./engine.ts";
import { loadAgentProfiles } from "./agent-registry.ts";
import { runtimeDirective } from "./runtime-messages.ts";
import { resolveExistingMentionedFiles } from "./request-paths.ts";
import { hasTool, resolveTools } from "./registry.ts";
import {
  type AgentLoopResult,
  type AgentStopReason,
  type AgentUIEvent,
  type FinalResponseMeta,
  type InteractionRequestEvent,
  type InteractionResponse,
  type OrchestratorConfig,
  runReActLoop,
  type TraceEvent,
} from "./orchestrator.ts";
import type { AgentPolicy } from "./policy.ts";
import {
  classifyModelTier,
  computeTierToolFilter,
  DEFAULT_TOOL_DENYLIST,
  ENGINE_PROFILES,
  extractModelSuffix,
  isFrontierProvider,
  MAX_ITERATIONS,
  MAX_SESSION_HISTORY,
  supportsAgentExecution,
} from "./constants.ts";
import { compileSystemPrompt } from "./llm-integration.ts";
import {
  isMainThreadQuerySource,
  resolveMainThreadBaselineToolAllowlist,
  resolveQueryToolAllowlist,
} from "./query-tool-routing.ts";
import {
  BROWSER_SAFE_PROFILE_ID,
  clearToolProfileLayer,
  cloneToolList,
  createToolProfileState,
  ensureToolProfileState,
  resolveCanonicalBaselineAllowlist,
  resolveDeclaredToolProfileFilter,
  resolveEffectiveToolFilterCached,
  resolvePersistentToolFilter,
  setToolProfileLayer,
} from "./tool-profiles.ts";
import {
  type AgentExecutionMode,
  getPlanningModeForExecutionMode,
} from "./execution-mode.ts";
import { UsageTracker } from "./usage.ts";
import { takeLastMessageGroups } from "./context.ts";
import type { ModelInfo } from "../providers/types.ts";
import type { ConversationAttachmentPayload } from "../attachments/types.ts";
import {
  buildTraceTextPreview,
  traceReplMainThreadForSource,
} from "../repl-main-thread-trace.ts";
import {
  type AgentOrchestratorFailureCode,
  classifyAgentFinalResponse,
} from "./model-compat.ts";
import {
  appendPersistedAgentToolResult,
  clearPersistedAgentPlanningState,
  completePersistedAgentTurn,
  loadPersistedAgentHistory,
  loadPersistedAgentSessionMetadata,
  loadPersistedAgentTodos,
  persistAgentPlanState,
  persistAgentTodos,
  persistDiscoveredDeferredTools,
  type PersistedAgentTurn,
  persistPendingPlanReview,
  resetApprovedPlanSignature,
  resolvePendingPlanReview,
  startPersistedAgentTurn,
} from "./persisted-transcript.ts";
import {
  createTodoStateFromPlan,
  isTodoStateDerivedFromPlan,
} from "./todo-state.ts";
import {
  formatPlanForContext,
  getPlanSignature,
  type PlanningPhase,
  restorePlanState,
} from "./planning.ts";
import { computeRoutingResult, type TaskDomain } from "./request-routing.ts";
import type { AllClassification } from "../runtime/local-llm.ts";
import {
  effectiveToolSurfaceIncludesMutation,
  isMutatingTool,
} from "./security/safety.ts";
import { type AgentHookRuntime, loadAgentHookRuntime } from "./hooks.ts";
import { formatStructuredResultText } from "./structured-output.ts";
import {
  generateStructuredWithSdk,
  type SdkConvertibleMessage,
} from "../providers/sdk-runtime.ts";
import { resolveSdkModelSpec, toSdkRuntimeModelSpec } from "./engine-sdk.ts";
import {
  isLocalFallbackReady,
  LOCAL_FALLBACK_MODEL_ID,
} from "../runtime/local-fallback.ts";

const DEFAULT_AGENT_PATH_ROOTS = [
  "~",
  "~/Downloads",
  "~/Desktop",
  "~/Documents",
];

const reusableSessions = new Set<AgentSession>();
const BROWSER_REACT_MAX_ITERATIONS = Math.max(MAX_ITERATIONS, 28);

function isAbortLikeError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError") ||
    getErrorMessage(error).toLowerCase().includes("aborted");
}

function resolveDefaultAgentRoots(): string[] {
  const home = getPlatform().env.get("HOME") ?? "";
  return DEFAULT_AGENT_PATH_ROOTS.map((root) =>
    `file://${root.startsWith("~") ? home + root.slice(1) : root}`
  );
}

function buildPlanModeAllowlist(options: {
  allowlist?: string[];
  denylist?: string[];
  ownerId?: string;
  preferDirectFileWork?: boolean;
}): string[] {
  const tools = resolveTools(options);
  return Object.keys(tools).filter((toolName) =>
    !(
      options.preferDirectFileWork &&
      (toolName === "search_code" || toolName === "shell_exec")
    ) &&
    toolName !== "complete_task" &&
    (!isMutatingTool(toolName, options.ownerId) || toolName === "shell_exec")
  );
}

/** Load the skill catalog via dynamic import. */
async function tryLoadSkillCatalog(
  workspace?: string,
): Promise<
  ReadonlyMap<string, import("../skills/types.ts").SkillDefinition> | undefined
> {
  const { loadSkillCatalog } = await import("../skills/mod.ts");
  return await loadSkillCatalog(workspace);
}

/** Create a reusable agent session without any global/workspace cache key. */
export async function createReusableSession(
  workspace: string,
  model: string,
  opts?: {
    contextWindow?: number;
    sessionId?: string;
    temperature?: number;
    toolAllowlist?: string[];
    toolDenylist?: string[];
    onToken?: (text: string) => void;
    modelInfo?: ModelInfo | null;
  },
): Promise<AgentSession> {
  const engine = getAgentEngine();
  const instructions = await loadInstructionHierarchy(workspace);
  const agentProfiles = await loadAgentProfiles(workspace, {
    toolValidator: hasTool,
    trusted: instructions.trusted,
  });
  const skills = await tryLoadSkillCatalog(workspace);
  const toolDenylist = opts?.toolDenylist
    ? [...opts.toolDenylist]
    : [...DEFAULT_TOOL_DENYLIST];
  const session = await createAgentSession({
    workspace,
    model,
    sessionId: opts?.sessionId ?? `reusable-${generateUUID()}`,
    contextWindow: opts?.contextWindow,
    temperature: opts?.temperature,
    engineProfile: "normal",
    failOnContextOverflow: false,
    toolAllowlist: opts?.toolAllowlist,
    toolDenylist,
    onToken: opts?.onToken,
    modelInfo: opts?.modelInfo,
    engine,
    agentProfiles,
    instructions,
    skills,
  });
  reusableSessions.add(session);
  return session;
}

/** Dispose all reusable sessions created via createReusableSession(). */
export async function disposeAllSessions(): Promise<void> {
  const sessions = [...reusableSessions.values()];
  reusableSessions.clear();
  await Promise.allSettled(sessions.map((s) => s.dispose()));
  closeFactDb();
  // Reset cached skill catalog (may reference stale HLVM_DIR in test environments)
  try {
    const { resetSkillCatalogCache } = await import("../skills/mod.ts");
    resetSkillCatalogCache();
  } catch { /* skills module not available */ }
}

/**
 * Refresh the prompt/context/LLM for a reusable session while preserving
 * session-scoped state such as todoState, fileStateCache, and tool ownership.
 */
/** @internal Exported for testing. Refreshes memory in a reusable session. */
export async function reuseSession(
  session: AgentSession,
  onToken?: (text: string) => void,
  options?: {
    disablePersistentMemory?: boolean;
    querySource?: string;
    temperature?: number;
    preserveConversationContext?: boolean;
    instructions?: typeof session.instructions;
    agentProfiles?: typeof session.agentProfiles;
  },
): Promise<AgentSession> {
  return await refreshReusableAgentSession(session, {
    onToken,
    disablePersistentMemory: options?.disablePersistentMemory,
    querySource: options?.querySource,
    temperature: options?.temperature,
    preserveConversationContext: options?.preserveConversationContext,
    instructions: options?.instructions,
    agentProfiles: options?.agentProfiles,
  });
}

function mergePolicyPathRoots(
  policy: AgentPolicy | null,
  roots: string[],
): AgentPolicy | null {
  if (roots.length === 0) return policy;
  const base: AgentPolicy = policy ?? { version: 1 };
  const existing = base.pathRules?.roots ?? [];
  const merged = [...new Set([...existing, ...roots])];
  return {
    ...base,
    pathRules: {
      ...(base.pathRules ?? {}),
      roots: merged,
    },
  };
}

function normalizeToolList(list?: string[]): string[] {
  return list?.length ? [...new Set(list)].sort() : [];
}

function toolListsMatch(a?: string[], b?: string[]): boolean {
  const left = normalizeToolList(a);
  const right = normalizeToolList(b);
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function toolListContainsAll(
  container?: string[],
  required?: string[],
): boolean {
  const needed = normalizeToolList(required);
  if (needed.length === 0) return true;
  const available = new Set(normalizeToolList(container));
  return needed.every((value) => available.has(value));
}

async function synthesizeStructuredAgentResult(options: {
  model: string;
  query: string;
  responseSchema: Record<string, unknown>;
  finalDraft: string;
  signal?: AbortSignal;
}): Promise<unknown> {
  const spec = toSdkRuntimeModelSpec(resolveSdkModelSpec(options.model));
  const messages: SdkConvertibleMessage[] = [
    {
      role: "system",
      content:
        "Return only an object that satisfies the provided response schema for this turn. Do not add extra keys, narration, or markdown.",
    },
    {
      role: "user",
      content: options.query,
    },
    {
      role: "assistant",
      content: options.finalDraft,
    },
  ];
  return await generateStructuredWithSdk(
    spec,
    messages,
    options.responseSchema,
    { signal: options.signal },
  );
}

export function shouldReuseAgentSession(
  session: AgentSession | undefined,
  options: {
    model?: string;
    querySource?: string;
    toolAllowlist?: string[];
    toolDenylist?: string[];
  },
): boolean {
  if (!session) return false;
  if ((session.llmConfig?.model ?? "") !== (options.model ?? "")) {
    return false;
  }
  if (
    (session.llmConfig?.querySource ?? session.querySource) !==
      options.querySource
  ) {
    return false;
  }
  const requestedAllowlist = options.toolAllowlist ??
    resolveCanonicalBaselineAllowlist({
      querySource: options.querySource,
      baseAllowlist: session.baseToolAllowlist,
      discoveredDeferredTools: session.discoveredDeferredTools,
      ownerId: session.toolOwnerId,
    });
  const persistentFilter = resolveSessionPersistentToolFilter(session);
  const persistentAllowlist = persistentFilter.allowlist;
  const persistentDenylist = persistentFilter.denylist;
  return toolListsMatch(
    persistentAllowlist,
    requestedAllowlist,
  ) &&
    toolListContainsAll(
      persistentDenylist,
      options.toolDenylist,
    );
}

function dispatchLifecycleHookForEvent(
  hookRuntime: AgentHookRuntime | null,
  event: AgentUIEvent,
  context: {
    modelId: string;
    sessionId?: string;
  },
): void {
  if (!hookRuntime) return;
  switch (event.type) {
    case "plan_created":
      hookRuntime.dispatchDetached("plan_created", {
        modelId: context.modelId,
        sessionId: context.sessionId,
        plan: event.plan,
      });
      return;
    default:
      return;
  }
}

interface AgentRunnerCallbacks {
  onToken?: (text: string) => void;
  onAgentEvent?: (event: AgentUIEvent) => void;
  onFinalResponseMeta?: (meta: FinalResponseMeta) => void;
  onTrace?: (event: TraceEvent) => void;
  onInteraction?: (
    event: InteractionRequestEvent,
  ) => Promise<InteractionResponse>;
}

function resolveSessionPersistentToolFilter(
  session: AgentSession,
): { allowlist?: string[]; denylist?: string[] } {
  if (session.toolProfileState) {
    return resolvePersistentToolFilter(session.toolProfileState);
  }
  return {
    allowlist: cloneToolList(session.baseToolAllowlist),
    denylist: cloneToolList(session.baseToolDenylist),
  };
}

function resolveSessionEffectiveToolFilter(
  session: AgentSession,
): { allowlist?: string[]; denylist?: string[] } {
  if (session.toolProfileState) {
    return resolveEffectiveToolFilterCached(session.toolProfileState);
  }
  return resolveSessionPersistentToolFilter(session);
}

interface AgentRunnerOptions {
  query: string;
  model?: string;
  querySource?: string;
  requestId?: string;
  sessionId?: string | null;
  transcriptPersistenceMode?: "runner" | "caller";
  fixturePath?: string;
  temperature?: number;
  /** Optional output-token cap for a single provider response. */
  maxOutputTokens?: number;
  /** Optional context window override (in tokens). */
  contextWindow?: number;
  workspace?: string;
  callbacks: AgentRunnerCallbacks;
  permissionMode?: AgentExecutionMode;
  noInput?: boolean;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  skipSessionHistory?: boolean;
  signal?: AbortSignal;
  messageHistory?: import("./context.ts").Message[];
  /** Runtime-materialized attachments for the initial user turn. */
  attachments?: ConversationAttachmentPayload[];
  /** Explicit structured final-response schema for the current turn. */
  responseSchema?: Record<string, unknown>;
  /** Explicit request for Anthropic computer_use capability. */
  computerUse?: boolean;
  /** Pre-fetched model info to avoid duplicate provider API calls */
  modelInfo?: ModelInfo | null;
  /** Reuse an existing session (skips policy/MCP/LLM setup) */
  reusableSession?: AgentSession;
  /** Reuse the in-memory conversation context and skip persisted history replay. */
  skipPersistedHistoryReplay?: boolean;
  /** Keep a newly created session alive for future reuse instead of disposing it. */
  retainSessionForReuse?: boolean;
  /** Disable persistent memory reads/writes for this run. */
  disablePersistentMemory?: boolean;
  /** Override max ReAct loop iterations (headless safety bound). */
  maxIterations?: number;
  /** Maximum API cost in USD (headless safety bound). */
  maxBudgetUsd?: number;
}

function updateSessionBaselineAllowlist(
  session: AgentSession,
  toolAllowlist: string[] | undefined,
): string[] | undefined {
  const nextAllowlist = resolveCanonicalBaselineAllowlist({
    querySource: session.querySource,
    baseAllowlist: toolAllowlist ?? session.baseToolAllowlist,
    discoveredDeferredTools: session.discoveredDeferredTools,
    ownerId: session.toolOwnerId,
  });
  const profileState = ensureToolProfileState(session);
  const baselineLayer = profileState.layers.baseline;
  setToolProfileLayer(profileState, "baseline", {
    profileId: baselineLayer?.profileId,
    allowlist: cloneToolList(nextAllowlist),
    denylist: cloneToolList(baselineLayer?.denylist),
    reason: baselineLayer?.reason,
  });
  syncSessionToolProfileState(session);
  if (session.llmConfig) {
    session.llmConfig.discoveredDeferredToolCount =
      session.discoveredDeferredTools.size;
  }
  return nextAllowlist;
}

function applySessionDomainToolProfile(
  session: AgentSession,
  taskDomain: TaskDomain,
): void {
  const profileState = ensureToolProfileState(session);
  const baselineLayer = profileState.layers.baseline;
  const canonicalBaselineAllowlist = resolveCanonicalBaselineAllowlist({
    querySource: session.querySource,
    baseAllowlist: session.baseToolAllowlist,
    discoveredDeferredTools: session.discoveredDeferredTools,
    ownerId: session.toolOwnerId,
  });

  const nextBaselineAllowlist = cloneToolList(canonicalBaselineAllowlist);
  if (taskDomain === "browser" && nextBaselineAllowlist?.length) {
    const browserSafeAllowlist =
      resolveDeclaredToolProfileFilter(BROWSER_SAFE_PROFILE_ID).allowlist;
    if (browserSafeAllowlist?.length) {
      appendNewNames(nextBaselineAllowlist, browserSafeAllowlist);
    }
  }

  setToolProfileLayer(profileState, "baseline", {
    profileId: baselineLayer?.profileId,
    allowlist: cloneToolList(nextBaselineAllowlist),
    denylist: cloneToolList(baselineLayer?.denylist),
    reason: baselineLayer?.reason,
  });

  if (taskDomain === "browser") {
    // If the baseline already contains cu_* tools (e.g., explicit
    // toolAllowlist from caller), use browser_hybrid so the domain
    // layer doesn't mask CU tools via intersection.
    setToolProfileLayer(profileState, "domain", {
      profileId: BROWSER_SAFE_PROFILE_ID,
      reason: "browser_task_detected",
    });
  } else {
    clearToolProfileLayer(profileState, "domain");
  }

  syncSessionToolProfileState(session);
}

function syncSessionToolProfileState(session: AgentSession): void {
  const profileState = ensureToolProfileState(session);
  if (session.llmConfig) {
    session.llmConfig.toolProfileState = profileState;
    session.llmConfig.eagerToolCount = resolvePersistentToolFilter(profileState)
      .allowlist?.length;
    session.llmConfig.discoveredDeferredToolCount =
      session.discoveredDeferredTools.size;
  }
}

/** Append names from `source` into `target` (mutates), skipping duplicates. */
function appendNewNames(target: string[], source: Iterable<string>): void {
  const existing = new Set(target);
  for (const name of source) {
    if (!existing.has(name)) target.push(name);
  }
}

function persistDeferredToolDiscoveriesForSession(options: {
  session: AgentSession;
  discoveredToolNames: readonly string[];
  toolAllowlist?: string[];
  toolDenylist?: string[];
  sessionKey?: string | null;
}): string[] | undefined {
  const baseline = resolveSessionPersistentToolFilter(options.session);
  if (!baseline.allowlist) return undefined;

  if (isMainThreadQuerySource(options.session.querySource)) {
    // REPL path: merge via resolveMainThreadBaselineToolAllowlist (unchanged).
    const eagerOnly = new Set(
      resolveMainThreadBaselineToolAllowlist({
        querySource: options.session.querySource,
        toolAllowlist: options.toolAllowlist,
        ownerId: options.session.toolOwnerId,
      }) ?? [],
    );
    let changed = false;
    for (const name of options.discoveredToolNames) {
      if (eagerOnly.has(name)) continue;
      if (!options.session.discoveredDeferredTools.has(name)) {
        options.session.discoveredDeferredTools.add(name);
        changed = true;
      }
    }
    const nextBaseline = updateSessionBaselineAllowlist(
      options.session,
      options.toolAllowlist,
    );
    if (changed && options.sessionKey) {
      persistDiscoveredDeferredTools(
        options.sessionKey,
        options.session.discoveredDeferredTools,
      );
    }
    return nextBaseline;
  }

  // Non-REPL path (agent mode): directly add discovered tools to baseline allowlist.
  let changed = false;
  for (const name of options.discoveredToolNames) {
    if (!options.session.discoveredDeferredTools.has(name)) {
      options.session.discoveredDeferredTools.add(name);
      changed = true;
    }
  }
  if (changed) {
    const nextBaselineAllowlist = resolveCanonicalBaselineAllowlist({
      querySource: options.session.querySource,
      baseAllowlist: options.session.baseToolAllowlist ?? baseline.allowlist,
      discoveredDeferredTools: options.session.discoveredDeferredTools,
      ownerId: options.session.toolOwnerId,
    }) ?? [...new Set(options.session.discoveredDeferredTools)];
    const profileState = ensureToolProfileState(options.session);
    const baselineLayer = profileState.layers.baseline;
    setToolProfileLayer(profileState, "baseline", {
      profileId: baselineLayer?.profileId,
      allowlist: nextBaselineAllowlist,
      denylist: cloneToolList(baselineLayer?.denylist),
      reason: baselineLayer?.reason,
    });
    syncSessionToolProfileState(options.session);
    if (options.sessionKey) {
      persistDiscoveredDeferredTools(
        options.sessionKey,
        options.session.discoveredDeferredTools,
      );
    }
  }
  return resolveSessionPersistentToolFilter(options.session).allowlist ??
    baseline.allowlist;
}

interface AgentRunnerResult {
  text: string;
  stopReason: AgentStopReason;
  iterations: number;
  durationMs: number;
  toolUseCount: number;
  structuredResult?: unknown;
  finalResponseMeta?: FinalResponseMeta;
  liveSession?: AgentSession;
  finalResponseState: {
    suppressFinalResponse: boolean;
    orchestratorFailureCode: AgentOrchestratorFailureCode | null;
  };
  stats: {
    messageCount: number;
    estimatedTokens: number;
    toolMessages: number;
    /** Provider-reported token usage (when available) */
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      source: "provider" | "estimated";
    };
  };
}

/**
 * Ensure runtime and model are ready.
 * Idempotent — safe to call multiple times.
 */
export async function ensureAgentReady(
  model: string,
  onLog?: (message: string) => void,
): Promise<void> {
  await initializeRuntime({ stdlib: false, cache: false });

  // Wire HLVM's logger into the agent module (idempotent)
  const { log } = await import("../api/log.ts");
  setAgentLogger(log);

  // Strip provider prefix to get raw model name for cloud detection
  const modelName = extractModelSuffix(model);
  // Lazy import for SDK decoupling — avoids hard coupling to ../providers/ollama/
  const { isOllamaCloudModel } = await import("../providers/ollama/cloud.ts");
  const isLocalModel = !isFrontierProvider(model) &&
    !isOllamaCloudModel(modelName);

  if (isLocalModel) {
    await ensureDefaultModelInstalled({
      log: onLog ?? (() => {}),
    });
  }
}

/**
 * Run a single agent query through the ReAct loop.
 *
 * This is the SSOT for agent execution — both CLI and HTTP use this.
 */
export async function runAgentQuery(
  options: AgentRunnerOptions,
): Promise<AgentRunnerResult> {
  const {
    query,
    callbacks,
    noInput = false,
    toolDenylist = [...DEFAULT_TOOL_DENYLIST],
    skipSessionHistory = false,
    transcriptPersistenceMode = "runner",
  } = options;
  const disablePersistentMemory = options.disablePersistentMemory === true;
  const permissionMode: AgentExecutionMode = options.permissionMode ??
    "default";
  let model = options.model ?? getConfiguredModel();
  model = await resolveCompatibleClaudeCodeModel(model);

  // Auto model resolution — dynamic import to avoid loading provider listing when not needed
  let autoDecision: import("./auto-select.ts").AutoDecision | null = null;
  let allClassification: AllClassification | undefined;
  if (model === AUTO_MODEL_ID) {
    const [{ classifyAll }, { resolveAutoModel }] = await Promise.all([
      import("../runtime/local-llm.ts"),
      import("./auto-select.ts"),
    ]);
    const { loadConfig } = await import("../../common/config/storage.ts");
    const config = await loadConfig();
    const policy = config.autoSelect as
      | import("./auto-select.ts").AutoSelectPolicy
      | undefined;
    allClassification = await classifyAll(query);
    autoDecision = await resolveAutoModel(
      query,
      options.attachments,
      policy,
      allClassification.taskClassification,
    );
    model = autoDecision.model;
    traceReplMainThreadForSource(options.querySource, "agent.auto_select", {
      model: autoDecision.model,
      fallbacks: autoDecision.fallbacks,
      reason: autoDecision.reason,
    });
  }

  if (!supportsAgentExecution(model, options.modelInfo)) {
    // Configured model is constrained — fall back to guaranteed local default
    if (
      model !== DEFAULT_MODEL_ID && supportsAgentExecution(DEFAULT_MODEL_ID)
    ) {
      model = DEFAULT_MODEL_ID;
    } else {
      throw new ValidationError(
        "Constrained models do not support agent mode. Use direct chat mode instead.",
        "agent_runner",
      );
    }
  }
  const workspace = options.workspace ?? getPlatform().process.cwd();
  const hookRuntime = await loadAgentHookRuntime(workspace);
  hookRuntime?.dispatchDetached("session_start", { workspace, model });
  const profile = ENGINE_PROFILES.normal;
  const turnId = crypto.randomUUID();
  const runStartedAt = Date.now();
  const useExternalHistory = !!options.messageHistory;
  const shouldPersistSession = !skipSessionHistory;
  const sessionKey = shouldPersistSession
    ? (options.sessionId ?? deriveDefaultSessionKey())
    : null;
  // Even when we skip persisted session history, runtime subsystems such as
  // browser/CU need a stable per-run session id so they do not fall back to a
  // shared process-wide default and leak stale state across runs.
  const runtimeSessionId = options.sessionId ?? sessionKey ?? turnId;
  const shouldRestorePersistedTodos = !!sessionKey;
  const persistedTurnSessionId = transcriptPersistenceMode === "runner"
    ? sessionKey
    : null;
  const restoredSessionMetadata = sessionKey
    ? loadPersistedAgentSessionMetadata(sessionKey)
    : {};
  const querySource = options.querySource;
  traceReplMainThreadForSource(querySource, "agent.run.start", {
    requestId: options.requestId ?? null,
    sessionId: options.sessionId ?? null,
    turnId,
    model,
    permissionMode,
    reusableSession: !!options.reusableSession,
    messageHistoryCount: options.messageHistory?.length ?? 0,
    attachmentCount: options.attachments?.length ?? 0,
    queryPreview: buildTraceTextPreview(query),
  });
  const persistentMemoryEnabled = isPersistentMemoryEnabled(
    disablePersistentMemory,
  );
  const effectiveToolDenylist = !persistentMemoryEnabled
    ? [...new Set([...toolDenylist, ...Object.keys(MEMORY_TOOLS)])]
    : [...toolDenylist];
  const routingResult = await computeRoutingResult({
    query,
    tier: classifyModelTier(options.modelInfo, model),
    querySource,
    preComputedClassification: allClassification,
  });
  const taskDomain = routingResult.taskDomain;
  callbacks.onTrace?.({
    type: "routing_decision",
    tier: routingResult.tier,
    behavior: routingResult.behavior,
    provenance: routingResult.provenance,
    taskDomain: routingResult.taskDomain,
    needsPlan: routingResult.needsPlan,
    reason: routingResult.reason,
  });
  traceReplMainThreadForSource(querySource, "agent.routing", {
    tier: routingResult.tier,
    behavior: routingResult.behavior,
    provenance: routingResult.provenance,
    taskDomain: routingResult.taskDomain,
    needsPlan: routingResult.needsPlan,
    reason: routingResult.reason,
  });
  const requestedToolAllowlist = resolveQueryToolAllowlist(
    options.toolAllowlist,
  );
  const explicitPermissionToolAllowlist = requestedToolAllowlist;
  const explicitPermissionToolDenylist = options.toolDenylist?.length
    ? [...new Set(options.toolDenylist)]
    : undefined;
  const toolAllowlist = resolveMainThreadBaselineToolAllowlist({
    querySource,
    toolAllowlist: requestedToolAllowlist,
    discoveredDeferredTools: restoredSessionMetadata.discoveredDeferredTools,
  });
  const structuredOutputActive = !!options.responseSchema;
  const effectiveOnToken = structuredOutputActive
    ? undefined
    : callbacks.onToken;

  if (
    options.reusableSession &&
    restoredSessionMetadata.discoveredDeferredTools?.length
  ) {
    options.reusableSession.querySource = querySource;
    for (const name of restoredSessionMetadata.discoveredDeferredTools) {
      options.reusableSession.discoveredDeferredTools.add(name);
    }
    updateSessionBaselineAllowlist(
      options.reusableSession,
      options.reusableSession.baseToolAllowlist ?? requestedToolAllowlist,
    );
  }

  const matchingReusableSession =
    shouldReuseAgentSession(options.reusableSession, {
        model,
        querySource,
        toolAllowlist,
        toolDenylist: effectiveToolDenylist,
      })
      ? options.reusableSession
      : undefined;
  const instructions = matchingReusableSession?.instructions ??
    await loadInstructionHierarchy(workspace);
  const agentProfiles = matchingReusableSession?.agentProfiles ??
    await loadAgentProfiles(workspace, {
      toolValidator: hasTool,
      trusted: instructions.trusted,
    });
  const skills = matchingReusableSession
    ? undefined
    : await tryLoadSkillCatalog(workspace);
  const isReusableSession = !!matchingReusableSession;
  const engine = isReusableSession ? undefined : getAgentEngine();
  let session: AgentSession;
  if (matchingReusableSession) {
    if (!requestedToolAllowlist?.length) {
      applySessionDomainToolProfile(
        matchingReusableSession,
        taskDomain,
      );
    }
    session = await reuseSession(matchingReusableSession, effectiveOnToken, {
      disablePersistentMemory,
      querySource,
      temperature: options.temperature,
      preserveConversationContext: options.skipPersistedHistoryReplay === true,
      instructions,
      agentProfiles,
    });
  } else {
    session = await createAgentSession({
      workspace,
      model,
      fixturePath: options.fixturePath,
      sessionId: runtimeSessionId,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      contextWindow: options.contextWindow,
      engineProfile: "normal",
      failOnContextOverflow: false,
      querySource,
      toolAllowlist,
      toolDenylist: effectiveToolDenylist,
      onToken: effectiveOnToken,
      modelInfo: options.modelInfo,
      instructions,
      disablePersistentMemory,
      discoveredDeferredTools: restoredSessionMetadata.discoveredDeferredTools,
      engine,
      agentProfiles,
      skills,
    });
    // Skip domain profile AND browser session reuse when caller provided
    // an explicit allowlist — the caller's tool set is authoritative.
    // Domain profiling (browser_safe intersection) would mask tools the
    // caller intentionally included.
    if (requestedToolAllowlist?.length) {
      // Caller controls the tool set — no domain profiling.
    } else {
      applySessionDomainToolProfile(session, taskDomain);
      if (taskDomain === "browser") {
        session = await reuseSession(session, effectiveOnToken, {
          disablePersistentMemory,
          querySource,
          temperature: options.temperature,
          preserveConversationContext: true,
          instructions,
          agentProfiles,
        });
      }
    }
  }
  traceReplMainThreadForSource(querySource, "agent.session.ready", {
    requestId: options.requestId ?? null,
    sessionId: sessionKey,
    turnId,
    durationMs: Date.now() - runStartedAt,
    reusedSession: isReusableSession,
    retainedForReuse: options.retainSessionForReuse === true,
    discoveredDeferredToolCount: session.discoveredDeferredTools.size,
    contextMessages: session.context.getMessages().length,
    compiledPromptChars: session.llmConfig?.compiledPrompt?.text.length ?? null,
    toolAllowlistCount:
      resolveSessionPersistentToolFilter(session).allowlist?.length ?? null,
  });

  session.querySource = querySource;
  if (session.llmConfig) {
    session.llmConfig.querySource = querySource;
    session.llmConfig.eagerToolCount = resolveSessionPersistentToolFilter(
      session,
    ).allowlist?.length;
    session.llmConfig.discoveredDeferredToolCount =
      session.discoveredDeferredTools.size;
  }
  // Emit prompt_compiled trace event (only when instruction hierarchy was compiled)
  if (callbacks.onTrace && session.compiledPromptMeta) {
    callbacks.onTrace({
      type: "prompt_compiled",
      ...session.compiledPromptMeta,
    });
  }

  let persistedTurn: PersistedAgentTurn | null = null;
  let keepSessionAlive = false;

  try {
    // Reset any prior dynamic tool narrowing (tool_search) for this new turn.
    session.resetToolFilter?.();

    // Add file-roots system note BEFORE history so system messages stay contiguous
    session.context.addMessage({
      role: "system",
      content: `Allowed file roots: ${
        DEFAULT_AGENT_PATH_ROOTS.join(", ")
      }. Use "~/Downloads" not "/Downloads".`,
    });

    if (useExternalHistory) {
      for (const message of options.messageHistory!) {
        session.context.addMessage({ ...message, fromSession: true });
      }
    } else if (sessionKey && options.skipPersistedHistoryReplay !== true) {
      const { history } = await loadPersistedAgentHistory({
        sessionId: sessionKey,
        model,
        maxGroups: MAX_SESSION_HISTORY,
      });
      const recentHistory = takeLastMessageGroups(history, MAX_SESSION_HISTORY);
      for (const message of recentHistory) {
        session.context.addMessage({ ...message, fromSession: true });
      }
    }

    const sessionMetadata = restoredSessionMetadata;
    if (shouldRestorePersistedTodos && sessionKey) {
      session.todoState.items = loadPersistedAgentTodos(sessionKey);
    } else {
      session.todoState.items = [];
    }

    if (persistedTurnSessionId) {
      persistedTurn = startPersistedAgentTurn(persistedTurnSessionId, query);
    }

    let policy = session.policy;
    policy = mergePolicyPathRoots(policy, DEFAULT_AGENT_PATH_ROOTS);
    // Wire MCP server-initiated request handlers (sampling, elicitation, roots)
    if (session.mcpSetHandlers) {
      session.mcpSetHandlers({
        roots: resolveDefaultAgentRoots(),
      });
    }

    // Wire cancellation signal to MCP clients
    if (session.mcpSetSignal && options.signal) {
      session.mcpSetSignal(options.signal);
    }

    const usageTracker = new UsageTracker();
    setMemoryModelTier(session.modelTier);
    if (persistentMemoryEnabled) {
      try {
        await persistExplicitMemoryRequest(query);
      } catch {
        // Best-effort only; memory capture must not block agent execution.
      }
    }

    let finalResponseMeta: FinalResponseMeta | undefined;
    let activePlan:
      | Extract<AgentUIEvent, { type: "plan_created" }>["plan"]
      | undefined;
    const completedPlanStepIds = new Set<string>();
    activePlan = sessionMetadata.plan;
    let approvedPlanSignature = sessionMetadata.approvedPlanSignature;
    for (const stepId of sessionMetadata.completedPlanStepIds ?? []) {
      completedPlanStepIds.add(stepId);
    }
    const hasIncompleteRestoredPlan = !!activePlan &&
      completedPlanStepIds.size < activePlan.steps.length;
    const restoredPlanOwnsTodoState = activePlan
      ? isTodoStateDerivedFromPlan(
        session.todoState.items,
        activePlan.steps,
        completedPlanStepIds,
      )
      : false;
    let planOwnsTodoState = sessionMetadata.todoSource === "plan" ||
      (
        hasIncompleteRestoredPlan &&
        restoredPlanOwnsTodoState
      ) ||
      session.todoState.items.length === 0;
    const persistentToolFilter = resolveSessionPersistentToolFilter(session);
    const baseExecutionAllowlist = cloneToolList(
      persistentToolFilter.allowlist,
    );
    const baseExecutionDenylist = cloneToolList(
      persistentToolFilter.denylist,
    );
    const directFileTargets = permissionMode === "plan"
      ? await resolveExistingMentionedFiles(query, workspace)
      : [];
    const preferDirectFileWork = directFileTargets.length === 1;
    const planningAllowlist = permissionMode === "plan"
      ? buildPlanModeAllowlist({
        allowlist: baseExecutionAllowlist,
        denylist: baseExecutionDenylist,
        ownerId: session.toolOwnerId,
        preferDirectFileWork,
      })
      : undefined;
    const planModeState = permissionMode === "plan"
      ? {
        active: true,
        phase: "researching" as PlanningPhase,
        executionPermissionMode: "acceptEdits" as Exclude<
          AgentExecutionMode,
          "plan"
        >,
        executionAllowlist: cloneToolList(baseExecutionAllowlist),
        executionDenylist: cloneToolList(baseExecutionDenylist),
        planningAllowlist: cloneToolList(planningAllowlist),
        directFileTargets,
      }
      : undefined;
    if (planModeState) {
      const profileState = ensureToolProfileState(session);
      setToolProfileLayer(profileState, "plan", {
        allowlist: cloneToolList(planModeState.planningAllowlist),
        denylist: cloneToolList(planModeState.executionDenylist),
        reason: "plan_research",
      });
      syncSessionToolProfileState(session);
    }
    if (hasIncompleteRestoredPlan && activePlan && permissionMode !== "plan") {
      session.context.addMessage({
        role: "user",
        content: runtimeDirective(
          formatPlanForContext(activePlan, {
            mode: "always",
            requireStepMarkers: false,
          }),
        ),
      });
    }
    const emitSyncedTodoState = (): void => {
      if (!activePlan || !planOwnsTodoState) return;
      const currentIndex = completedPlanStepIds.size < activePlan.steps.length
        ? completedPlanStepIds.size
        : undefined;
      const nextState = createTodoStateFromPlan(
        activePlan.steps,
        completedPlanStepIds,
        currentIndex,
      );
      session.todoState.items = nextState.items.map((item) => ({ ...item }));
      if (sessionKey) {
        persistAgentTodos(sessionKey, session.todoState.items, "plan");
      }
      callbacks.onAgentEvent?.({
        type: "todo_updated",
        todoState: {
          items: session.todoState.items.map((item) => ({ ...item })),
        },
        source: "plan",
      });
    };
    const planReview = {
      getCurrentPlan: (): typeof activePlan => activePlan,
      shouldGateMutatingTools: (): boolean =>
        permissionMode !== "bypassPermissions" &&
        effectiveToolSurfaceIncludesMutation({
          ...resolveSessionEffectiveToolFilter(session),
          ownerId: session.toolOwnerId,
        }),
      ensureApproved: async (
        plan: NonNullable<typeof activePlan>,
      ): Promise<"approved" | "cancelled" | "revise"> => {
        const signature = getPlanSignature(plan);
        if (approvedPlanSignature === signature) {
          return "approved";
        }

        callbacks.onAgentEvent?.({
          type: "plan_review_required",
          plan,
        });

        if (!sessionKey || !callbacks.onInteraction) {
          callbacks.onAgentEvent?.({
            type: "plan_review_resolved",
            plan,
            approved: false,
            decision: "cancelled",
          });
          return "cancelled";
        }

        const requestId = crypto.randomUUID();
        persistPendingPlanReview(sessionKey, requestId, plan);

        try {
          const response = await callbacks.onInteraction({
            type: "interaction_request",
            requestId,
            mode: "permission",
            toolName: "plan_review",
            toolArgs: JSON.stringify(plan),
          });
          const choice = response.userInput?.trim().toLowerCase();
          const reviseRequested = choice === "revise";
          const autoApproved = choice === "approve:auto";
          const approved = autoApproved ||
            (!reviseRequested && response.approved === true);
          if (planModeState && approved) {
            planModeState.executionPermissionMode = "bypassPermissions";
          }
          resolvePendingPlanReview(sessionKey, {
            approved,
            planSignature: approved ? signature : undefined,
          });
          approvedPlanSignature = approved ? signature : undefined;
          callbacks.onAgentEvent?.({
            type: "plan_review_resolved",
            plan,
            approved,
            decision: approved
              ? "approved"
              : reviseRequested
              ? "revise"
              : "cancelled",
          });
          if (approved) return "approved";
          return reviseRequested ? "revise" : "cancelled";
        } catch (error) {
          approvedPlanSignature = undefined;
          throw error;
        }
      },
    } satisfies NonNullable<
      NonNullable<OrchestratorConfig["planReview"]>
    >;
    if (session.llmConfig) {
      session.llmConfig.onToken = effectiveOnToken;
      session.llm = (session.engine ?? getAgentEngine()).createLLM(
        session.llmConfig,
      );
    }
    const onAgentEvent = (() => {
      if (!persistedTurn && !sessionKey && !hookRuntime) {
        return callbacks.onAgentEvent;
      }
      const activePersistedTurn = persistedTurn;
      return (event: AgentUIEvent) => {
        dispatchLifecycleHookForEvent(hookRuntime, event, {
          modelId: model,
          sessionId: sessionKey ?? undefined,
        });
        if (event.type === "tool_end") {
          if (activePersistedTurn) {
            appendPersistedAgentToolResult(
              activePersistedTurn,
              event.name,
              event.content ?? "",
              {
                argsSummary: event.argsSummary,
                success: event.success,
              },
            );
          }
        }
        if (event.type === "plan_created") {
          activePlan = event.plan;
          completedPlanStepIds.clear();
          planOwnsTodoState = true;
          if (sessionKey) {
            resetApprovedPlanSignature(sessionKey);
            persistAgentPlanState(sessionKey, activePlan, completedPlanStepIds);
          }
          approvedPlanSignature = undefined;
          emitSyncedTodoState();
        }
        if (event.type === "plan_step") {
          completedPlanStepIds.add(event.stepId);
          if (sessionKey) {
            persistAgentPlanState(sessionKey, activePlan, completedPlanStepIds);
          }
          emitSyncedTodoState();
        }
        if (event.type === "todo_updated") {
          planOwnsTodoState = event.source === "plan"
            ? planOwnsTodoState
            : false;
          if (sessionKey) {
            persistAgentTodos(sessionKey, event.todoState.items, event.source);
          }
        }
        if (event.type === "plan_review_resolved" && sessionKey) {
          approvedPlanSignature = event.approved
            ? getPlanSignature(event.plan)
            : undefined;
        }
        callbacks.onAgentEvent?.(event);
      };
    })();
    if (planModeState) {
      onAgentEvent?.({
        type: "plan_phase_changed",
        phase: planModeState.phase,
      });
    }
    let text = "";
    let loopResult: AgentLoopResult | undefined;
    let structuredResult: unknown;
    const compactionRevisionBefore = session.context.getCompactionRevision();
    try {
      const reactLoopConfig = {
        workspace,
        context: session.context,
        permissionMode,
        maxToolCalls: profile.maxToolCalls,
        maxIterations: options.maxIterations ??
          (taskDomain === "browser" ? BROWSER_REACT_MAX_ITERATIONS : undefined),
        maxBudgetUsd: options.maxBudgetUsd,
        groundingMode: profile.groundingMode,
        policy,
        onTrace: callbacks.onTrace,
        onAgentEvent,
        onFinalResponseMeta: (meta: FinalResponseMeta) => {
          finalResponseMeta = meta;
          callbacks.onFinalResponseMeta?.(meta);
        },
        onInteraction: callbacks.onInteraction,
        noInput,
        agentProfiles,
        instructions: session.instructions,
        planning: {
          mode: getPlanningModeForExecutionMode(permissionMode),
          requireStepMarkers: false,
        },
        skipModelCompensation: false,
        modelTier: session.modelTier,
        routingResult,
        modelId: model,
        sessionId: runtimeSessionId,
        turnId,
        querySource,
        eagerToolCount: resolveSessionPersistentToolFilter(session).allowlist
          ?.length,
        discoveredDeferredToolCount: session.discoveredDeferredTools.size,
        currentUserRequest: query,
        signal: options.signal,
        autoMemoryRecall: persistentMemoryEnabled,
        usage: usageTracker,
        l1Confirmations: session.l1Confirmations,
        todoState: session.todoState,
        fileStateCache: session.fileStateCache,
        lspDiagnostics: session.lspDiagnostics,
        hookRuntime: hookRuntime ?? undefined,
        onToken: effectiveOnToken,
        initialPlanState: permissionMode !== "plan" &&
            hasIncompleteRestoredPlan && activePlan
          ? restorePlanState(activePlan, completedPlanStepIds)
          : null,
        planReview,
        permissionToolAllowlist: explicitPermissionToolAllowlist,
        permissionToolDenylist: explicitPermissionToolDenylist,
        baselineToolAllowlistSeed: session.baseToolAllowlist,
        discoveredDeferredTools: session.discoveredDeferredTools,
        toolProfileState: session.toolProfileState,
        toolDenylist: effectiveToolDenylist,
        toolSearchUniverseAllowlist: requestedToolAllowlist,
        toolSearchUniverseDenylist: effectiveToolDenylist,
        onToolSearchDiscovered: (toolNames: readonly string[]) =>
          persistDeferredToolDiscoveriesForSession({
            session,
            discoveredToolNames: toolNames,
            toolAllowlist: requestedToolAllowlist,
            toolDenylist: effectiveToolDenylist,
            sessionKey,
          }),
        thinkingState: session.thinkingState,
        thinkingCapable: session.thinkingCapable,
        visionCapable: session.visionCapable,
        planModeState,
        toolOwnerId: session.toolOwnerId,
        ensureMcpLoaded: session.ensureMcpLoaded,
        autoFallbacks: autoDecision?.fallbacks,
        createFallbackLLM: (fallbackModel: string) => {
          // Recalculate tier + system prompt for the fallback model.
          // The primary may be enhanced (bounded eager core) while
          // the fallback may be standard (leaner eager core).
          const fbTier = classifyModelTier(undefined, fallbackModel);
          const fbToolFilter = computeTierToolFilter(
            fbTier,
            requestedToolAllowlist,
            effectiveToolDenylist,
          );
          const fbPrompt = fbToolFilter.allowlist
            ? compileSystemPrompt({
              toolAllowlist: fbToolFilter.allowlist,
              toolDenylist: fbToolFilter.denylist,
              toolOwnerId: session.toolOwnerId,
              querySource: session.querySource,
              modelTier: fbTier,
              instructions: session.instructions,
              agentProfiles: session.agentProfiles,
              visionCapable: session.visionCapable,
            })
            : undefined;
          const fbConfig = {
            ...session.llmConfig!,
            model: fallbackModel,
            toolProfileState: fbToolFilter.allowlist
              ? createToolProfileState({
                baseline: {
                  slot: "baseline",
                  allowlist: fbToolFilter.allowlist,
                  denylist: fbToolFilter.denylist,
                },
              })
              : undefined,
            ...(fbPrompt ? { compiledPrompt: fbPrompt } : {}),
          };
          return (session.engine ?? getAgentEngine()).createLLM(fbConfig);
        },
        localLastResort: {
          model: LOCAL_FALLBACK_MODEL_ID,
          isAvailable: isLocalFallbackReady,
        },
      } satisfies OrchestratorConfig;
      hookRuntime?.dispatchDetached("user_prompt_submit", {
        workspace,
        query,
        model,
      });
      loopResult = await runReActLoop(
        query,
        reactLoopConfig,
        session.llm,
        options.attachments,
      );
      text = loopResult.text;
      traceReplMainThreadForSource(querySource, "agent.react.done", {
        requestId: options.requestId ?? null,
        sessionId: sessionKey,
        turnId,
        durationMs: Date.now() - runStartedAt,
      });
    } catch (error) {
      if (sessionKey && isAbortLikeError(error, options.signal)) {
        clearPersistedAgentPlanningState(sessionKey);
        activePlan = undefined;
        approvedPlanSignature = undefined;
        completedPlanStepIds.clear();
        planOwnsTodoState = false;
        session.todoState.items = [];
      }
      if (persistedTurn) {
        const message = getErrorMessage(error);
        completePersistedAgentTurn(persistedTurn, model, `Error: ${message}`);
      }
      throw error;
    } finally {
      const cleanupStartedAt = Date.now();
      if (planModeState) {
        clearToolProfileLayer(ensureToolProfileState(session), "plan");
        syncSessionToolProfileState(session);
      }
      await hookRuntime?.waitForIdle();
      // Release CU lock if this turn acquired it. Zero-syscall no-op on non-CU turns.
      const { cleanupComputerUseAfterTurn } = await import(
        "./computer-use/cleanup.ts"
      );
      await cleanupComputerUseAfterTurn();
      traceReplMainThreadForSource(querySource, "agent.cleanup.done", {
        requestId: options.requestId ?? null,
        sessionId: sessionKey,
        turnId,
        durationMs: Date.now() - cleanupStartedAt,
      });
    }

    try {
      if (structuredOutputActive) {
        structuredResult = await synthesizeStructuredAgentResult({
          model,
          query,
          responseSchema: options.responseSchema ?? {},
          finalDraft: text,
          signal: options.signal,
        });
        text = formatStructuredResultText(structuredResult);
      }
    } catch (error) {
      if (persistedTurn) {
        const message = getErrorMessage(error);
        completePersistedAgentTurn(persistedTurn, model, `Error: ${message}`);
      }
      throw error;
    }

    const stats = session.context.getStats();
    const completedLoopResult = loopResult!;
    const usageSnapshot = completedLoopResult.usage;
    const compactedThisTurn = session.context.getCompactionRevision() >
      compactionRevisionBefore;

    await hookRuntime?.dispatch("final_response", {
      workspace,
      modelId: model,
      sessionId: sessionKey ?? undefined,
      turnId,
      text,
      meta: finalResponseMeta ?? completedLoopResult.finalResponseMeta,
      compactedThisTurn,
      continuedThisTurn: completedLoopResult.continuedThisTurn,
      continuationCount: completedLoopResult.continuationCount,
      compactionReason: completedLoopResult.compactionReason,
      usage: usageSnapshot.calls > 0
        ? {
          inputTokens: usageSnapshot.totalPromptTokens,
          outputTokens: usageSnapshot.totalCompletionTokens,
          totalTokens: usageSnapshot.totalTokens,
          costUsd: usageSnapshot.totalCostUsd,
          costEstimated: usageSnapshot.costSource === "estimated",
          costSource: usageSnapshot.costSource,
          source: usageSnapshot.source,
        }
        : undefined,
    });
    await hookRuntime?.waitForIdle();

    if (persistedTurn) {
      completePersistedAgentTurn(persistedTurn, model, text);
    }

    if (persistentMemoryEnabled) {
      try {
        await persistConversationFacts({
          userMessage: query,
          assistantMessage: text,
        });
      } catch {
        // Best-effort only; memory capture must not block agent execution.
      }
    }

    const finalResponseState = await classifyAgentFinalResponse(text);
    keepSessionAlive = options.retainSessionForReuse === true ||
      isReusableSession;
    traceReplMainThreadForSource(querySource, "agent.run.done", {
      requestId: options.requestId ?? null,
      sessionId: sessionKey,
      turnId,
      durationMs: Date.now() - runStartedAt,
      textChars: text.length,
      discoveredDeferredToolCount: session.discoveredDeferredTools.size,
      totalPromptTokens: usageSnapshot.totalPromptTokens,
      totalCompletionTokens: usageSnapshot.totalCompletionTokens,
      totalTokens: usageSnapshot.totalTokens,
      usageSource: usageSnapshot.source,
    });
    return {
      text,
      stopReason: completedLoopResult.stopReason,
      iterations: completedLoopResult.iterations,
      durationMs: completedLoopResult.durationMs,
      toolUseCount: completedLoopResult.toolUseCount,
      structuredResult,
      finalResponseMeta: finalResponseMeta ??
        completedLoopResult.finalResponseMeta,
      liveSession: isReusableSession || options.retainSessionForReuse === true
        ? session
        : undefined,
      finalResponseState,
      stats: {
        messageCount: stats.messageCount,
        estimatedTokens: stats.estimatedTokens,
        toolMessages: stats.toolMessages,
        usage: usageSnapshot.calls > 0
          ? {
            inputTokens: usageSnapshot.totalPromptTokens,
            outputTokens: usageSnapshot.totalCompletionTokens,
            totalTokens: usageSnapshot.totalTokens,
            source: usageSnapshot.source,
          }
          : undefined,
      },
    };
  } finally {
    hookRuntime?.dispatchDetached("session_end", { workspace, model });
    // Only dispose ad-hoc sessions here; reusable sessions are cleaned up by disposeAllSessions().
    if (!isReusableSession && !keepSessionAlive) {
      const disposeStartedAt = Date.now();
      await session.dispose();
      traceReplMainThreadForSource(querySource, "agent.session.disposed", {
        requestId: options.requestId ?? null,
        sessionId: sessionKey,
        turnId,
        durationMs: Date.now() - disposeStartedAt,
      });
    }
  }
}
