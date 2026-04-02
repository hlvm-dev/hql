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
import { getErrorMessage } from "../../common/utils.ts";
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
import { getPlatform } from "../../platform/platform.ts";
import { loadInstructionHierarchy } from "../prompt/mod.ts";
import { deriveDefaultSessionKey } from "../runtime/session-key.ts";
import {
  type AgentSession,
  createAgentSession,
  refreshReusableAgentSession,
} from "./session.ts";
import { getAgentEngine } from "./engine.ts";
import { createDelegateHandler } from "./delegation.ts";
import {
  cancelAllThreads,
  cancelThreadsForOwner,
  getActiveThreadsForOwner,
} from "./delegate-threads.ts";
import { setDelegateLimiterMax } from "./concurrency.ts";
import { createDelegateInbox } from "./delegate-inbox.ts";
import { createDelegateCoordinationBoard } from "./delegate-coordination.ts";
import { restoreBatchSnapshots } from "./delegate-batches.ts";
import { createTeamRuntime } from "./team-runtime.ts";
import { loadAgentProfiles } from "./agent-registry.ts";
import { resolveExistingMentionedFiles } from "./request-paths.ts";
import { hasTool, resolveTools } from "./registry.ts";
import {
  type AgentUIEvent,
  type FinalResponseMeta,
  type InteractionRequestEvent,
  type InteractionResponse,
  runReActLoop,
  type TraceEvent,
} from "./orchestrator.ts";
import type { AgentPolicy } from "./policy.ts";
import {
  DEFAULT_TOOL_DENYLIST,
  ENGINE_PROFILES,
  extractModelSuffix,
  isFrontierProvider,
  MAX_SESSION_HISTORY,
  supportsAgentExecution,
} from "./constants.ts";
import { resolveQueryToolAllowlist } from "./query-tool-routing.ts";
import {
  type AgentExecutionMode,
  getPlanningModeForExecutionMode,
} from "./execution-mode.ts";
import { UsageTracker } from "./usage.ts";
import { ContextManager, takeLastMessageGroups } from "./context.ts";
import type { ModelInfo } from "../providers/types.ts";
import type { ConversationAttachmentPayload } from "../attachments/types.ts";
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
  persistAgentRuntimeMode,
  persistAgentTeamRuntime,
  persistAgentTodos,
  type PersistedAgentTurn,
  persistLastAppliedExecutionFallbackState,
  persistLastAppliedResponseShapeContext,
  persistLastAppliedRoutingConstraints,
  persistLastAppliedTaskCapabilityContext,
  persistLastAppliedTurnContext,
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
import {
  effectiveToolSurfaceIncludesMutation,
  isMutatingTool,
} from "./security/safety.ts";
import { type AgentHookRuntime, loadAgentHookRuntime } from "./hooks.ts";
import { cloneToolList } from "./orchestrator-state.ts";
import {
  appendExecutionFallbackSuppression,
  buildRoutedCapabilityEventKey,
  buildRoutedCapabilityProvenance,
  EMPTY_EXECUTION_FALLBACK_STATE,
  type ExecutionSurface,
  executionSurfaceUsesMcp,
  formatRoutedCapabilityEventSummary,
  getExecutionSurfaceSignature,
  getSelectedExecutionPathCandidate,
  resolveRoutedCapabilityForToolName,
  type RoutedCapabilityEventPhase,
  type RoutedCapabilityId,
} from "./execution-surface.ts";
import { resolveExecutionSurfaceState } from "./execution-surface-runtime.ts";
import { extractRoutingConstraintsFromTaskText } from "./routing-constraints.ts";
import { deriveExecutionResponseShapeContextFromSchema } from "./response-shape-context.ts";
import {
  DEFAULT_RUNTIME_MODE,
  resolveRuntimeMode,
  type RuntimeMode,
} from "./runtime-mode.ts";
import { formatStructuredResultText } from "./structured-output.ts";
import { extractTaskCapabilityContextFromTaskText } from "./task-capability-context.ts";
import {
  deriveExecutionTurnContextFromAttachments,
  hasAudioRelevantTurnContext,
  hasVisionRelevantTurnContext,
} from "./turn-context.ts";
import {
  generateStructuredWithSdk,
  type SdkConvertibleMessage,
} from "../providers/sdk-runtime.ts";
import { resolveSdkModelSpec, toSdkRuntimeModelSpec } from "./engine-sdk.ts";

const DEFAULT_AGENT_PATH_ROOTS = [
  "~",
  "~/Downloads",
  "~/Desktop",
  "~/Documents",
];

const reusableSessions = new Set<AgentSession>();

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

function hasProviderGroundedCitations(
  meta: FinalResponseMeta | undefined,
): boolean {
  return meta?.citationSpans.some((citation) =>
    citation.provenance === "provider"
  ) ?? false;
}

function resolveProviderNativeWebCapabilityFromFinalResponse(
  executionSurface: ExecutionSurface,
  finalResponseMeta: FinalResponseMeta | undefined,
): "web.search" | "web.read" | null {
  if (!hasProviderGroundedCitations(finalResponseMeta)) {
    return null;
  }

  const selectedProviderNativeCapabilities = (
    ["web.search", "web.read"] as const
  ).filter((capabilityId) =>
    executionSurface.capabilities[capabilityId].selectedBackendKind ===
      "provider-native"
  );

  return selectedProviderNativeCapabilities.length === 1
    ? selectedProviderNativeCapabilities[0]
    : null;
}

function shouldSkipModelCompensationForTurn(options: {
  runtimeMode: RuntimeMode;
  isFrontierModel: boolean;
  executionSurface: ExecutionSurface;
}): boolean {
  if (!options.isFrontierModel) {
    return false;
  }
  if (options.runtimeMode !== "auto") {
    return true;
  }

  return !(
    options.executionSurface.capabilities["web.search"].selectedBackendKind ===
      "provider-native" ||
    options.executionSurface.capabilities["web.read"].selectedBackendKind ===
      "provider-native" ||
    options.executionSurface.capabilities["code.exec"].selectedBackendKind ===
      "provider-native"
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

/** Create a reusable agent session without any global/workspace cache key. */
export async function createReusableSession(
  workspace: string,
  model: string,
  opts?: {
    contextWindow?: number;
    toolAllowlist?: string[];
    toolDenylist?: string[];
    onToken?: (text: string) => void;
    modelInfo?: ModelInfo | null;
  },
): Promise<AgentSession> {
  const engine = getAgentEngine();
  const [agentProfiles, instructions] = await Promise.all([
    loadAgentProfiles(workspace, { toolValidator: hasTool }),
    loadInstructionHierarchy(workspace),
  ]);
  const toolDenylist = opts?.toolDenylist
    ? [...opts.toolDenylist]
    : [...DEFAULT_TOOL_DENYLIST];
  const session = await createAgentSession({
    workspace,
    model,
    contextWindow: opts?.contextWindow,
    engineProfile: "normal",
    failOnContextOverflow: false,
    toolAllowlist: opts?.toolAllowlist,
    toolDenylist,
    onToken: opts?.onToken,
    modelInfo: opts?.modelInfo,
    engine,
    agentProfiles,
    instructions,
  });
  reusableSessions.add(session);
  return session;
}

/** Dispose all reusable sessions created via createReusableSession(). */
export async function disposeAllSessions(): Promise<void> {
  cancelAllThreads();
  const sessions = [...reusableSessions.values()];
  reusableSessions.clear();
  await Promise.allSettled(sessions.map((s) => s.dispose()));
  closeFactDb();
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
    instructions?: typeof session.instructions;
    agentProfiles?: typeof session.agentProfiles;
    runtimeMode?: RuntimeMode;
    providerExecutionPlan?: typeof session.providerExecutionPlan;
    executionSurface?: typeof session.executionSurface;
  },
): Promise<AgentSession> {
  return await refreshReusableAgentSession(session, {
    onToken,
    disablePersistentMemory: options?.disablePersistentMemory,
    instructions: options?.instructions,
    agentProfiles: options?.agentProfiles,
    runtimeMode: options?.runtimeMode,
    providerExecutionPlan: options?.providerExecutionPlan,
    executionSurface: options?.executionSurface,
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
    toolAllowlist?: string[];
    toolDenylist?: string[];
    runtimeMode?: RuntimeMode;
    executionSurfaceSignature?: string;
  },
): boolean {
  if (!session) return false;
  if ((session.llmConfig?.model ?? "") !== (options.model ?? "")) {
    return false;
  }
  if (
    (session.llmConfig?.runtimeMode ?? DEFAULT_RUNTIME_MODE) !==
      (options.runtimeMode ?? DEFAULT_RUNTIME_MODE)
  ) {
    return false;
  }
  if (
    options.executionSurfaceSignature &&
    getExecutionSurfaceSignature(session.executionSurface) !==
      options.executionSurfaceSignature
  ) {
    return false;
  }
  return toolListsMatch(
    session.llmConfig?.toolAllowlist,
    options.toolAllowlist,
  ) &&
    toolListsMatch(
      session.llmConfig?.toolDenylist,
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
    case "delegate_start":
      hookRuntime.dispatchDetached("delegate_start", {
        modelId: context.modelId,
        sessionId: context.sessionId,
        agent: event.agent,
        task: event.task,
        childSessionId: event.childSessionId,
        threadId: event.threadId,
        nickname: event.nickname,
      });
      return;
    case "delegate_end":
      hookRuntime.dispatchDetached("delegate_end", {
        modelId: context.modelId,
        sessionId: context.sessionId,
        agent: event.agent,
        task: event.task,
        success: event.success,
        summary: event.summary,
        error: event.error,
        durationMs: event.durationMs,
        childSessionId: event.childSessionId,
        threadId: event.threadId,
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

interface AgentRunnerOptions {
  query: string;
  model?: string;
  sessionId?: string | null;
  transcriptPersistenceMode?: "runner" | "caller";
  fixturePath?: string;
  /** Optional output-token cap for a single provider response. */
  maxOutputTokens?: number;
  /** Optional context window override (in tokens). */
  contextWindow?: number;
  workspace?: string;
  callbacks: AgentRunnerCallbacks;
  permissionMode?: AgentExecutionMode;
  runtimeMode?: RuntimeMode;
  restorePersistedRuntimeMode?: boolean;
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
  /** Disable persistent memory reads/writes for this run. */
  disablePersistentMemory?: boolean;
}

interface AgentRunnerResult {
  text: string;
  structuredResult?: unknown;
  finalResponseMeta?: FinalResponseMeta;
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
  if (!supportsAgentExecution(model, options.modelInfo)) {
    throw new ValidationError(
      "Weak models do not support agent mode. Use direct chat mode instead.",
      "agent_runner",
    );
  }
  const workspace = options.workspace ?? getPlatform().process.cwd();
  const hookRuntime = await loadAgentHookRuntime(workspace);
  const profile = ENGINE_PROFILES.normal;
  const turnId = crypto.randomUUID();
  const useExternalHistory = !!options.messageHistory;
  const shouldPersistSession = !skipSessionHistory;
  const sessionKey = shouldPersistSession
    ? (options.sessionId ?? deriveDefaultSessionKey())
    : null;
  const shouldRestorePersistedTodos = !!sessionKey;
  const persistedTurnSessionId = transcriptPersistenceMode === "runner"
    ? sessionKey
    : null;
  const restoredSessionMetadata = sessionKey
    ? loadPersistedAgentSessionMetadata(sessionKey)
    : {};
  const runtimeMode = options.restorePersistedRuntimeMode
    ? resolveRuntimeMode(
      options.runtimeMode ?? restoredSessionMetadata.runtimeMode,
    )
    : resolveRuntimeMode(options.runtimeMode);
  const persistentMemoryEnabled = isPersistentMemoryEnabled(
    disablePersistentMemory,
  );
  const effectiveToolDenylist = !persistentMemoryEnabled
    ? [...new Set([...toolDenylist, ...Object.keys(MEMORY_TOOLS)])]
    : [...toolDenylist];
  const toolAllowlist = resolveQueryToolAllowlist(options.toolAllowlist);
  const routingConstraints = extractRoutingConstraintsFromTaskText(query);
  const taskCapabilityContext = extractTaskCapabilityContextFromTaskText(query);
  const responseShapeContext = deriveExecutionResponseShapeContextFromSchema(
    options.responseSchema,
  );
  const turnContext = deriveExecutionTurnContextFromAttachments(
    options.attachments,
  );
  let executionSurfaceState = await resolveExecutionSurfaceState({
    model,
    fixturePath: options.fixturePath,
    runtimeMode,
    routingConstraints,
    taskCapabilityContext,
    responseShapeContext,
    turnContext,
    toolAllowlist,
    toolDenylist: effectiveToolDenylist,
    computerUseRequested: options.computerUse,
  });

  // GAP 1: If reasoning selector switched from pinned model, apply the switch
  // to the live model and re-resolve the surface with the new model (skip
  // reasoning selection on the re-resolve to prevent infinite recursion).
  if (
    executionSurfaceState.executionSurface.reasoningSelection
      ?.switchedFromPinned
  ) {
    const sel = executionSurfaceState.executionSurface.reasoningSelection;
    model = sel.selectedModelId;
    executionSurfaceState = await resolveExecutionSurfaceState({
      model,
      fixturePath: options.fixturePath,
      runtimeMode,
      routingConstraints,
      taskCapabilityContext,
      responseShapeContext,
      turnContext,
      toolAllowlist,
      toolDenylist: effectiveToolDenylist,
      computerUseRequested: options.computerUse,
      skipReasoningSelection: true,
    });
    // Preserve the original reasoning selection on the re-resolved surface
    executionSurfaceState.executionSurface.reasoningSelection = sel;
  }

  const structuredOutputRoute =
    executionSurfaceState.executionSurface.capabilities["structured.output"];
  const structuredOutputRequested = responseShapeContext.requested;
  const structuredOutputActive = structuredOutputRequested &&
    structuredOutputRoute?.selectedBackendKind === "provider-native";
  const effectiveOnToken = structuredOutputActive
    ? undefined
    : callbacks.onToken;
  const agentProfiles = await loadAgentProfiles(workspace, {
    toolValidator: hasTool,
  });

  // Load instruction hierarchy (global + project) — non-blocking
  const instructions = await loadInstructionHierarchy(workspace);

  const matchingReusableSession = persistentMemoryEnabled &&
      shouldReuseAgentSession(options.reusableSession, {
        model,
        toolAllowlist,
        toolDenylist: effectiveToolDenylist,
        runtimeMode,
        executionSurfaceSignature: undefined,
      })
    ? options.reusableSession
    : undefined;
  const isReusableSession = !!matchingReusableSession;
  const engine = isReusableSession ? undefined : getAgentEngine();
  if (
    matchingReusableSession?.ensureMcpLoaded &&
    executionSurfaceUsesMcp(executionSurfaceState.executionSurface)
  ) {
    await matchingReusableSession.ensureMcpLoaded();
  }
  const session: AgentSession = matchingReusableSession
    ? await reuseSession(matchingReusableSession, effectiveOnToken, {
      disablePersistentMemory,
      instructions,
      agentProfiles,
      runtimeMode,
      providerExecutionPlan: executionSurfaceState.providerExecutionPlan,
      executionSurface: executionSurfaceState.executionSurface,
    })
    : await createAgentSession({
      workspace,
      model,
      fixturePath: options.fixturePath,
      maxOutputTokens: options.maxOutputTokens,
      contextWindow: options.contextWindow,
      engineProfile: "normal",
      failOnContextOverflow: false,
      toolAllowlist,
      toolDenylist: effectiveToolDenylist,
      onToken: effectiveOnToken,
      modelInfo: options.modelInfo,
      instructions,
      disablePersistentMemory,
      runtimeMode,
      providerExecutionPlan: executionSurfaceState.providerExecutionPlan,
      executionSurface: executionSurfaceState.executionSurface,
      engine,
      agentProfiles,
    });

  session.providerExecutionPlan = executionSurfaceState.providerExecutionPlan;
  session.executionSurface = executionSurfaceState.executionSurface;
  if (session.llmConfig) {
    session.llmConfig.providerExecutionPlan =
      executionSurfaceState.providerExecutionPlan;
    session.llmConfig.executionSurface = executionSurfaceState.executionSurface;
  }
  if (
    session.ensureMcpLoaded &&
    executionSurfaceUsesMcp(executionSurfaceState.executionSurface)
  ) {
    await session.ensureMcpLoaded();
  }

  // Emit prompt_compiled trace event (only when instruction hierarchy was compiled)
  if (callbacks.onTrace && session.compiledPromptMeta) {
    callbacks.onTrace({
      type: "prompt_compiled",
      ...session.compiledPromptMeta,
    });
  }

  const delegateOwnerId = crypto.randomUUID();
  let persistedTurn: PersistedAgentTurn | null = null;

  try {
    // Reset any prior dynamic tool narrowing (tool_search) for this new turn.
    session.resetToolFilter?.();
    if (sessionKey) {
      persistLastAppliedRoutingConstraints(sessionKey, routingConstraints);
      persistLastAppliedTaskCapabilityContext(
        sessionKey,
        taskCapabilityContext,
      );
      persistLastAppliedResponseShapeContext(sessionKey, responseShapeContext);
      persistLastAppliedTurnContext(sessionKey, turnContext);
      persistLastAppliedExecutionFallbackState(
        sessionKey,
        EMPTY_EXECUTION_FALLBACK_STATE,
      );
    }

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
    } else if (sessionKey) {
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
    if (sessionKey) {
      persistAgentRuntimeMode(sessionKey, runtimeMode);
    }
    if (sessionMetadata.delegateBatches?.length) {
      restoreBatchSnapshots(sessionMetadata.delegateBatches);
    }
    if (shouldRestorePersistedTodos && sessionKey) {
      session.todoState.items = loadPersistedAgentTodos(sessionKey);
    } else {
      session.todoState.items = [];
    }

    session.resetToolFilter?.();

    if (persistedTurnSessionId) {
      persistedTurn = startPersistedAgentTurn(persistedTurnSessionId, query);
    }

    let policy = session.policy;
    policy = mergePolicyPathRoots(policy, DEFAULT_AGENT_PATH_ROOTS);
    // Apply config-driven concurrency and depth limits for background delegates
    const configApi = (globalThis as Record<string, unknown>).config as
      | { snapshot?: Record<string, unknown> }
      | undefined;
    let agentMaxDepth = 1;
    if (configApi?.snapshot) {
      const { getAgentMaxThreads, getAgentMaxDepth } = await import(
        "../../common/config/selectors.ts"
      );
      setDelegateLimiterMax(getAgentMaxThreads(configApi.snapshot));
      agentMaxDepth = getAgentMaxDepth(configApi.snapshot);
    }

    const delegate = createDelegateHandler(session.llm, {
      ownerId: delegateOwnerId,
      policy,
      sessionId: sessionKey,
      modelId: model,
      fixturePath: options.fixturePath,
      currentDepth: 0,
      maxDepth: agentMaxDepth,
      agentProfiles,
    });

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
        persistExplicitMemoryRequest(query);
      } catch {
        // Best-effort only; memory capture must not block agent execution.
      }
    }

    let finalResponseMeta: FinalResponseMeta | undefined;
    let latestTurnStats: Extract<AgentUIEvent, { type: "turn_stats" }> | undefined;
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
    const baseExecutionAllowlist = cloneToolList(
      session.toolFilterState?.allowlist ?? session.llmConfig?.toolAllowlist,
    );
    const baseExecutionDenylist = cloneToolList(
      session.toolFilterState?.denylist ?? session.llmConfig?.toolDenylist,
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
    const runtimeToolFilterBaseline = {
      allowlist: cloneToolList(baseExecutionAllowlist),
      denylist: cloneToolList(baseExecutionDenylist),
    };
    if (planModeState && session.toolFilterState) {
      session.toolFilterState.allowlist = cloneToolList(
        planModeState.planningAllowlist,
      );
    }
    if (hasIncompleteRestoredPlan && activePlan && permissionMode !== "plan") {
      session.context.addMessage({
        role: "user",
        content: `[System Reminder] ${
          formatPlanForContext(activePlan, {
            mode: "always",
            requireStepMarkers: false,
          })
        }`,
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
          allowlist: session.toolFilterState?.allowlist ??
            session.llmConfig?.toolAllowlist,
          denylist: session.toolFilterState?.denylist ??
            session.llmConfig?.toolDenylist,
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
      NonNullable<Parameters<typeof runReActLoop>[1]>["planReview"]
    >;
    let teamRuntime: ReturnType<typeof createTeamRuntime> | undefined;
    const emittedCapabilityRouteKeys = new Set<string>();
    let deliverAgentUiEvent: ((event: AgentUIEvent) => void) | undefined =
      callbacks.onAgentEvent;
    const emitCapabilityRoute = (
      routedCapability: ReturnType<typeof buildRoutedCapabilityProvenance>,
      routePhase: RoutedCapabilityEventPhase,
    ): void => {
      if (!routedCapability) return;
      const eventKey = buildRoutedCapabilityEventKey(routedCapability);
      if (emittedCapabilityRouteKeys.has(eventKey)) {
        return;
      }
      emittedCapabilityRouteKeys.add(eventKey);
      const summary = formatRoutedCapabilityEventSummary(
        routedCapability,
        routePhase,
      );
      callbacks.onTrace?.({
        type: "capability_routed",
        routePhase,
        runtimeMode,
        familyId: routedCapability.familyId,
        capabilityId: routedCapability.capabilityId,
        strategy: routedCapability.strategy,
        selectedBackendKind: routedCapability.selectedBackendKind,
        selectedToolName: routedCapability.selectedToolName,
        selectedServerName: routedCapability.selectedServerName,
        providerName: routedCapability.providerName,
        fallbackReason: routedCapability.fallbackReason,
        routeChangedByFailure: routedCapability.routeChangedByFailure,
        failedBackendKind: routedCapability.failedBackendKind,
        failedToolName: routedCapability.failedToolName,
        failedServerName: routedCapability.failedServerName,
        failureReason: routedCapability.failureReason,
      });
      deliverAgentUiEvent?.({
        type: "capability_routed",
        routePhase,
        runtimeMode,
        familyId: routedCapability.familyId,
        capabilityId: routedCapability.capabilityId,
        strategy: routedCapability.strategy,
        selectedBackendKind: routedCapability.selectedBackendKind,
        selectedToolName: routedCapability.selectedToolName,
        selectedServerName: routedCapability.selectedServerName,
        providerName: routedCapability.providerName,
        fallbackReason: routedCapability.fallbackReason,
        routeChangedByFailure: routedCapability.routeChangedByFailure,
        failedBackendKind: routedCapability.failedBackendKind,
        failedToolName: routedCapability.failedToolName,
        failedServerName: routedCapability.failedServerName,
        failureReason: routedCapability.failureReason,
        candidates: routedCapability.candidates,
        summary,
      });
    };
    let pendingFallbackWork: Promise<void> | null = null;
    let reactLoopConfig:
      | Parameters<typeof runReActLoop>[1]
      | undefined;
    const queueFallbackWork = (work: () => Promise<void>): void => {
      const next = (pendingFallbackWork ?? Promise.resolve())
        .then(work)
        .catch(() => {});
      pendingFallbackWork = next.finally(() => {
        if (pendingFallbackWork === next) {
          pendingFallbackWork = null;
        }
      });
    };
    const awaitPendingFallbackWork = async (): Promise<void> => {
      if (!pendingFallbackWork) return;
      await pendingFallbackWork;
    };
    const updateExecutionSurfaceForFallback = async (failure: {
      capabilityId: RoutedCapabilityId;
      routePhase: Exclude<RoutedCapabilityEventPhase, "fallback">;
      failureReason: string;
      failedToolName?: string;
      failedServerName?: string;
      failedBackendKind?: "provider-native" | "mcp" | "hlvm-local";
    }): Promise<
      { handled: boolean; retryNotice?: { role: "user"; content: string } }
    > => {
      if (runtimeMode !== "auto") return { handled: false };
      const currentRoute =
        session.executionSurface.capabilities[failure.capabilityId];
      const selectedCandidate = getSelectedExecutionPathCandidate(currentRoute);
      if (!selectedCandidate) return { handled: false };
      if (
        failure.failedBackendKind &&
        selectedCandidate.backendKind !== failure.failedBackendKind
      ) {
        return { handled: false };
      }
      if (
        failure.failedToolName &&
        selectedCandidate.toolName !== failure.failedToolName
      ) {
        return { handled: false };
      }
      if (
        failure.failedServerName &&
        selectedCandidate.serverName !== failure.failedServerName
      ) {
        return { handled: false };
      }

      const failedCandidate = {
        capabilityId: failure.capabilityId,
        backendKind: selectedCandidate.backendKind,
        ...(selectedCandidate.toolName
          ? { toolName: selectedCandidate.toolName }
          : {}),
        ...(selectedCandidate.serverName
          ? { serverName: selectedCandidate.serverName }
          : {}),
        routePhase: failure.routePhase,
        failureReason: failure.failureReason,
      } as const;
      const nextFallbackState = appendExecutionFallbackSuppression(
        session.executionSurface.fallbackState,
        failedCandidate,
      );
      if (
        nextFallbackState.suppressedCandidates.length ===
          session.executionSurface.fallbackState.suppressedCandidates.length
      ) {
        return { handled: false };
      }

      const previousSurface = session.executionSurface;
      const nextState = await resolveExecutionSurfaceState({
        model,
        fixturePath: options.fixturePath,
        runtimeMode,
        routingConstraints,
        taskCapabilityContext,
        responseShapeContext,
        turnContext,
        fallbackState: nextFallbackState,
        toolAllowlist,
        toolDenylist: effectiveToolDenylist,
        computerUseRequested: options.computerUse,
      });
      session.providerExecutionPlan = nextState.providerExecutionPlan;
      session.executionSurface = nextState.executionSurface;
      if (session.llmConfig) {
        session.llmConfig.providerExecutionPlan =
          nextState.providerExecutionPlan;
        session.llmConfig.executionSurface = nextState.executionSurface;
      }
      if (reactLoopConfig) {
        reactLoopConfig.providerExecutionPlan = nextState.providerExecutionPlan;
        reactLoopConfig.executionSurface = nextState.executionSurface;
      }
      if (
        session.ensureMcpLoaded &&
        executionSurfaceUsesMcp(nextState.executionSurface) &&
        !executionSurfaceUsesMcp(previousSurface)
      ) {
        await session.ensureMcpLoaded();
      }
      if (sessionKey) {
        persistLastAppliedExecutionFallbackState(
          sessionKey,
          nextState.executionSurface.fallbackState,
        );
      }

      emitCapabilityRoute(
        buildRoutedCapabilityProvenance(
          nextState.executionSurface,
          failure.capabilityId,
          {
            routeChangedByFailure: true,
            failedCandidate,
          },
        ),
        "fallback",
      );
      const nextRoute =
        nextState.executionSurface.capabilities[failure.capabilityId];
      const nextSelection = getSelectedExecutionPathCandidate(nextRoute);
      const nextRouteLabel = nextSelection?.backendKind === "provider-native"
        ? `provider-native via ${
          nextSelection.toolName ??
            nextState.executionSurface.pinnedProviderName
        }`
        : nextSelection?.backendKind === "mcp"
        ? `MCP via ${nextSelection.serverName ?? "unknown"} / ${
          nextSelection.toolName ?? "unknown"
        }`
        : nextSelection?.backendKind === "hlvm-local"
        ? `HLVM local via ${nextSelection.toolName ?? "unknown"}`
        : "unavailable for the rest of this turn";
      const systemNotice = {
        role: "user",
        content: nextSelection
          ? `[System Notice] The routed backend for ${failure.capabilityId} changed during this turn because ${selectedCandidate.backendKind}${
            selectedCandidate.toolName ? ` ${selectedCandidate.toolName}` : ""
          } failed: ${failure.failureReason}. The active route is now ${nextRouteLabel}. Do not retry the failed backend.`
          : `[System Notice] The routed backend for ${failure.capabilityId} failed during this turn: ${failure.failureReason}. ${failure.capabilityId} is now unavailable for the remainder of this turn. Do not pretend that capability is still available.`,
      } as const;
      session.context.addMessage(systemNotice);
      return {
        handled: true,
        retryNotice: systemNotice,
      };
    };
    if (session.llmConfig) {
      session.llmConfig.onToken = effectiveOnToken;
      session.llmConfig.onProviderNativeRouteFailure = async (routeFailure) =>
        await updateExecutionSurfaceForFallback({
          capabilityId: routeFailure.capabilityId,
          routePhase: routeFailure.routePhase,
          failureReason: routeFailure.failureReason,
          failedToolName: routeFailure.toolName,
          failedServerName: routeFailure.serverName,
          failedBackendKind: routeFailure.backendKind,
        });
      session.llm = (session.engine ?? getAgentEngine()).createLLM(
        session.llmConfig,
      );
    }
    const baseSessionLlm = session.llm;
    session.llm = async (messages, signal, callOptions) => {
      await awaitPendingFallbackWork();
      return await baseSessionLlm(messages, signal, callOptions);
    };
    const onAgentEvent = (() => {
      if (!persistedTurn && !sessionKey && !hookRuntime) {
        return callbacks.onAgentEvent;
      }
      const activePersistedTurn = persistedTurn;
      const syncTeamTodoState = (): void => {
        if (!teamRuntime) return;
        session.todoState.items = teamRuntime.deriveTodoState().items.map((
          item,
        ) => ({
          ...item,
        }));
        if (sessionKey) {
          persistAgentTodos(sessionKey, session.todoState.items, "team");
        }
        callbacks.onAgentEvent?.({
          type: "todo_updated",
          todoState: {
            items: session.todoState.items.map((item) => ({ ...item })),
          },
          source: "team",
        });
      };
      return (event: AgentUIEvent) => {
        dispatchLifecycleHookForEvent(hookRuntime, event, {
          modelId: model,
          sessionId: sessionKey ?? undefined,
        });
        if (runtimeMode === "auto" && event.type === "tool_start") {
          const routedCapability = resolveRoutedCapabilityForToolName(
            session.executionSurface,
            event.name,
          );
          emitCapabilityRoute(routedCapability, "tool-start");
        }
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
          if (!event.success && runtimeMode === "auto") {
            const routedCapability = resolveRoutedCapabilityForToolName(
              session.executionSurface,
              event.name,
            );
            if (routedCapability) {
              queueFallbackWork(async () => {
                await updateExecutionSurfaceForFallback({
                  capabilityId: routedCapability.capabilityId,
                  routePhase: routedCapability.familyId === "web"
                    ? "tool-start"
                    : "turn-start",
                  failureReason: event.summary ?? event.content ??
                    "tool failed",
                  failedToolName: event.name,
                  failedBackendKind: routedCapability.selectedBackendKind,
                  failedServerName: routedCapability.selectedServerName,
                });
              });
            }
          }
        }
        if (event.type === "turn_stats") {
          latestTurnStats = event;
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
        if (event.type === "team_task_updated") {
          syncTeamTodoState();
        }
        if (event.type === "plan_review_resolved" && sessionKey) {
          approvedPlanSignature = event.approved
            ? getPlanSignature(event.plan)
            : undefined;
        }
        callbacks.onAgentEvent?.(event);
      };
    })();
    deliverAgentUiEvent = onAgentEvent;
    if (planModeState) {
      onAgentEvent?.({
        type: "plan_phase_changed",
        phase: planModeState.phase,
      });
    }
    if (runtimeMode === "auto" && hasVisionRelevantTurnContext(turnContext)) {
      emitCapabilityRoute(
        buildRoutedCapabilityProvenance(
          session.executionSurface,
          "vision.analyze",
        ),
        "turn-start",
      );
    }
    if (runtimeMode === "auto" && hasAudioRelevantTurnContext(turnContext)) {
      emitCapabilityRoute(
        buildRoutedCapabilityProvenance(
          session.executionSurface,
          "audio.analyze",
        ),
        "turn-start",
      );
    }
    if (runtimeMode === "auto" && options.computerUse) {
      emitCapabilityRoute(
        buildRoutedCapabilityProvenance(
          session.executionSurface,
          "computer.use",
        ),
        "turn-start",
      );
    }
    if (
      runtimeMode === "auto" &&
      taskCapabilityContext.requestedCapabilities.includes("code.exec")
    ) {
      emitCapabilityRoute(
        buildRoutedCapabilityProvenance(
          session.executionSurface,
          "code.exec",
        ),
        "turn-start",
      );
    }
    if (structuredOutputRequested) {
      emitCapabilityRoute(
        buildRoutedCapabilityProvenance(
          session.executionSurface,
          "structured.output",
        ),
        "turn-start",
      );
    }
    // Emit reasoning_routed if auto-selection switched from pinned model
    const reasoningSelection = session.executionSurface?.reasoningSelection;
    if (reasoningSelection?.switchedFromPinned) {
      deliverAgentUiEvent?.({
        type: "reasoning_routed",
        pinnedModelId: session.executionSurface?.activeModelId ?? "unknown",
        pinnedProviderName: session.executionSurface?.pinnedProviderName ??
          "unknown",
        selectedModelId: reasoningSelection.selectedModelId,
        selectedProviderName: reasoningSelection.selectedProviderName,
        reason: reasoningSelection.reason,
        unsatisfiedCapabilities: reasoningSelection.unsatisfiedCapabilities,
        switchedFromPinned: reasoningSelection.switchedFromPinned,
      });
    }
    if (structuredOutputRequested && !structuredOutputActive) {
      const error = new ValidationError(
        structuredOutputRoute?.fallbackReason ??
          "structured.output requested but no valid provider-native route exists for this turn",
        "agent_runner",
      );
      if (persistedTurn) {
        completePersistedAgentTurn(
          persistedTurn,
          model,
          `Error: ${error.message}`,
        );
      }
      throw error;
    }
    let text: string;
    let structuredResult: unknown;
    const compactionRevisionBefore = session.context.getCompactionRevision();
    try {
      const delegateInbox = createDelegateInbox();
      const coordinationBoard = createDelegateCoordinationBoard();
      teamRuntime = createTeamRuntime("lead", "lead", {
        snapshot: sessionMetadata.teamRuntime,
        reconcileStaleWorkers: true,
        onChange: (snapshot) => {
          if (sessionKey) {
            persistAgentTeamRuntime(sessionKey, snapshot);
          }
        },
      });
      if (sessionMetadata.teamRuntime) {
        session.todoState.items = teamRuntime.deriveTodoState().items.map((
          item,
        ) => ({
          ...item,
        }));
        // If stale workers were cleaned up, inject a notice so the model
        // doesn't trust stale team state from conversation history.
        const hasStaleWorkers = teamRuntime.listMembers().some(
          (m) => m.role !== "lead" && m.status === "terminated",
        );
        if (hasStaleWorkers) {
          session.context.addMessage({
            role: "user",
            content:
              "[System Notice] Previous team session has been reset. All prior delegate workers and their tasks have been terminated/cancelled. Start fresh — create new tasks and spawn new delegates as needed. Ignore any team state from earlier messages.",
          });
        }
      }
      reactLoopConfig = {
        workspace,
        context: session.context,
        permissionMode,
        maxToolCalls: profile.maxToolCalls,
        groundingMode: profile.groundingMode,
        policy,
        onTrace: callbacks.onTrace,
        onAgentEvent,
        onFinalResponseMeta: (meta) => {
          finalResponseMeta = meta;
          if (runtimeMode === "auto") {
            const providerNativeWebCapability =
              resolveProviderNativeWebCapabilityFromFinalResponse(
                session.executionSurface,
                meta,
              );
            if (providerNativeWebCapability) {
              emitCapabilityRoute(
                buildRoutedCapabilityProvenance(
                  session.executionSurface,
                  providerNativeWebCapability,
                ),
                "tool-start",
              );
            }
          }
          callbacks.onFinalResponseMeta?.(meta);
        },
        onInteraction: callbacks.onInteraction,
        noInput,
        delegate,
        delegateInbox,
        coordinationBoard,
        teamRuntime,
        teamMemberId: teamRuntime.leadMemberId,
        teamLeadMemberId: teamRuntime.leadMemberId,
        agentProfiles,
        instructions: session.instructions,
        planning: {
          mode: getPlanningModeForExecutionMode(permissionMode),
          requireStepMarkers: false,
        },
        skipModelCompensation: shouldSkipModelCompensationForTurn({
          runtimeMode,
          isFrontierModel: session.isFrontierModel,
          executionSurface: session.executionSurface,
        }),
        modelTier: session.modelTier,
        modelId: model,
        sessionId: sessionKey ?? undefined,
        turnId,
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
        toolAllowlist: session.toolFilterState?.allowlist ??
          session.llmConfig?.toolAllowlist,
        toolDenylist: session.toolFilterState?.denylist ??
          session.llmConfig?.toolDenylist,
        toolFilterState: session.toolFilterState,
        toolFilterBaseline: runtimeToolFilterBaseline,
        thinkingState: session.thinkingState,
        thinkingCapable: session.thinkingCapable,
        planModeState,
        toolOwnerId: session.toolOwnerId,
        delegateOwnerId,
        ensureMcpLoaded: session.ensureMcpLoaded,
        providerExecutionPlan: session.providerExecutionPlan,
        executionSurface: session.executionSurface,
      };
      text = await runReActLoop(
        query,
        reactLoopConfig,
        session.llm,
        options.attachments,
      );
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
      if (planModeState && session.toolFilterState) {
        session.toolFilterState.allowlist = cloneToolList(
          baseExecutionAllowlist,
        );
        session.toolFilterState.denylist = cloneToolList(
          baseExecutionDenylist,
        );
      }
      // Cancel any still-active background delegates and wait for their promises
      // to settle so they don't emit on a closed stream controller. Scope this
      // to the current top-level run so concurrent requests do not cancel each
      // other's delegates.
      const active = getActiveThreadsForOwner(delegateOwnerId);
      if (active.length > 0) {
        cancelThreadsForOwner(delegateOwnerId);
        await Promise.allSettled(active.map((t) => t.promise));
      }
      await hookRuntime?.waitForIdle();
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
    const usageSnapshot = usageTracker.snapshot(model);
    const compactedThisTurn = session.context.getCompactionRevision() >
      compactionRevisionBefore;

    await hookRuntime?.dispatch("final_response", {
      workspace,
      modelId: model,
      sessionId: sessionKey ?? undefined,
      turnId,
      text,
      meta: finalResponseMeta,
      compactedThisTurn,
      continuedThisTurn: latestTurnStats?.continuedThisTurn,
      continuationCount: latestTurnStats?.continuationCount,
      compactionReason: latestTurnStats?.compactionReason,
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
        persistConversationFacts({
          userMessage: query,
          assistantMessage: text,
        });
      } catch {
        // Best-effort only; memory capture must not block agent execution.
      }
    }

    const finalResponseState = classifyAgentFinalResponse(text);
    return {
      text,
      structuredResult,
      finalResponseMeta,
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
    // Only dispose ad-hoc sessions here; reusable sessions are cleaned up by disposeAllSessions().
    if (!isReusableSession) {
      await session.dispose();
    }
  }
}
