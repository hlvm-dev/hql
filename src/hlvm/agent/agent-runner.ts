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
import { getCustomInstructionsPath } from "../../common/paths.ts";
import { ValidationError } from "../../common/error.ts";
import { getErrorMessage } from "../../common/utils.ts";
import {
  closeFactDb,
  extractSessionFacts,
  loadMemoryContext,
  MEMORY_TOOLS,
  persistConversationFacts,
  setMemoryModelTier,
} from "../memory/mod.ts";
import { setAgentLogger } from "./logger.ts";
import {
  ensureDefaultModelInstalled,
  getConfiguredModel,
  resolveCompatibleClaudeCodeModel,
} from "../../common/ai-default-model.ts";
import { getPlatform } from "../../platform/platform.ts";
import { deriveDefaultSessionKey } from "../runtime/session-key.ts";
import { type AgentSession, createAgentSession } from "./session.ts";
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
import { hasTool } from "./registry.ts";
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
import {
  type AgentOrchestratorFailureCode,
  classifyAgentFinalResponse,
} from "./model-compat.ts";
import {
  appendPersistedAgentToolResult,
  completePersistedAgentTurn,
  loadPersistedAgentHistory,
  loadPersistedAgentSessionMetadata,
  loadPersistedAgentTodos,
  persistAgentCheckpointSummary,
  persistAgentPlanState,
  persistAgentTeamRuntime,
  persistAgentTodos,
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
  restorePlanState,
} from "./planning.ts";
import { effectiveToolSurfaceIncludesMutation } from "./security/safety.ts";
import { createCheckpointRecorder } from "./checkpoints.ts";

const DEFAULT_AGENT_PATH_ROOTS = [
  "~",
  "~/Downloads",
  "~/Desktop",
  "~/Documents",
];

const reusableSessions = new Set<AgentSession>();

function resolveDefaultAgentRoots(): string[] {
  const home = getPlatform().env.get("HOME") ?? "";
  return DEFAULT_AGENT_PATH_ROOTS.map((root) =>
    `file://${root.startsWith("~") ? home + root.slice(1) : root}`
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
  const agentProfiles = await loadAgentProfiles(workspace, {
    toolValidator: hasTool,
  });
  const session = await createAgentSession({
    workspace,
    model,
    contextWindow: opts?.contextWindow,
    engineProfile: "normal",
    failOnContextOverflow: false,
    toolAllowlist: opts?.toolAllowlist,
    toolDenylist: opts?.toolDenylist,
    onToken: opts?.onToken,
    modelInfo: opts?.modelInfo,
    engine,
    agentProfiles,
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
 * Create a fresh context + l1Confirmations from a reusable session.
 * Reuses policy, toolOwnerId, profile, isFrontierModel, resolvedContextBudget.
 * When onToken is provided, rebuilds the LLM to enable streaming.
 */
/** @internal Exported for testing. Refreshes memory in a reusable session. */
export async function reuseSession(
  session: AgentSession,
  onToken?: (text: string) => void,
  options?: {
    disablePersistentMemory?: boolean;
  },
): Promise<AgentSession> {
  const context = new ContextManager(session.context.getConfig());
  // Copy system messages from the reusable session, excluding stale memory.
  // Memory messages are identified by the "# Your Memory" marker
  const systemMessages = session.context.getMessages().filter((m) =>
    m.role === "system" && !m.content.startsWith("# Your Memory")
  );
  for (const message of systemMessages) {
    context.addMessage({ role: "system", content: message.content });
  }

  // Inject FRESH memory context (replaces stale memory from cache)
  if (!options?.disablePersistentMemory) {
    try {
      const memoryContext = await loadMemoryContext(
        session.resolvedContextBudget.budget,
      );
      if (memoryContext) {
        context.addMessage({
          role: "system",
          content: `# Your Memory\n${memoryContext}`,
        });
      }
    } catch {
      // Memory loading is best-effort — don't block session reuse
    }
  }

  // Rebuild LLM with caller's onToken to enable streaming in GUI mode
  let llm = session.llm;
  if (onToken && session.llmConfig) {
    const engine = session.engine ?? getAgentEngine();
    llm = engine.createLLM({
      ...session.llmConfig,
      options: { temperature: session.llmConfig.temperature ?? 0.0 },
      onToken,
    });
  }

  return {
    ...session,
    llm,
    context,
    l1Confirmations: session.l1Confirmations,
  };
}

function mergePolicyPathRoots(
  policy: AgentPolicy | null,
  roots: string[],
): AgentPolicy | null {
  if (roots.length === 0) return policy;
  const base: AgentPolicy = policy ?? { version: 1 };
  const existing = base.pathRules?.roots ?? [];
  const merged = Array.from(new Set([...existing, ...roots]));
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

export interface AgentRunnerCallbacks {
  onToken?: (text: string) => void;
  onAgentEvent?: (event: AgentUIEvent) => void;
  onFinalResponseMeta?: (meta: FinalResponseMeta) => void;
  onTrace?: (event: TraceEvent) => void;
  onInteraction?: (
    event: InteractionRequestEvent,
  ) => Promise<InteractionResponse>;
}

export interface AgentRunnerOptions {
  query: string;
  model?: string;
  sessionId?: string | null;
  fixturePath?: string;
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
  /** Image/media attachments for vision-capable models */
  images?: Array<{ data: string; mimeType: string }>;
  /** Pre-fetched model info to avoid duplicate provider API calls */
  modelInfo?: ModelInfo | null;
  /** Reuse an existing session (skips policy/MCP/LLM setup) */
  reusableSession?: AgentSession;
  /** Disable persistent memory reads/writes for this run. */
  disablePersistentMemory?: boolean;
}

export interface AgentRunnerResult {
  text: string;
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
  } = options;
  const disablePersistentMemory = options.disablePersistentMemory ??
    skipSessionHistory;
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
  const profile = ENGINE_PROFILES.normal;
  const effectiveToolDenylist = disablePersistentMemory
    ? [...new Set([...toolDenylist, ...Object.keys(MEMORY_TOOLS)])]
    : [...toolDenylist];
  const toolAllowlist = resolveQueryToolAllowlist(query, options.toolAllowlist);
  const agentProfiles = await loadAgentProfiles(workspace, {
    toolValidator: hasTool,
  });

  // Pre-read custom instructions (~/.hlvm/HLVM.md) — non-blocking
  let customInstructions = "";
  try {
    customInstructions = await getPlatform().fs.readTextFile(
      getCustomInstructionsPath(),
    );
  } catch { /* file not found — skip */ }

  const matchingReusableSession = !disablePersistentMemory &&
      options.reusableSession &&
      toolListsMatch(
        options.reusableSession.llmConfig?.toolAllowlist,
        toolAllowlist,
      )
    ? options.reusableSession
    : undefined;
  const isReusableSession = !!matchingReusableSession;
  const engine = isReusableSession ? undefined : getAgentEngine();
  const session: AgentSession = matchingReusableSession
    ? await reuseSession(matchingReusableSession, callbacks.onToken, {
      disablePersistentMemory,
    })
    : await createAgentSession({
      workspace,
      model,
      fixturePath: options.fixturePath,
      contextWindow: options.contextWindow,
      engineProfile: "normal",
      failOnContextOverflow: false,
      toolAllowlist,
      toolDenylist: effectiveToolDenylist,
      onToken: callbacks.onToken,
      modelInfo: options.modelInfo,
      customInstructions,
      disablePersistentMemory,
      engine,
      agentProfiles,
    });

  const useExternalHistory = !!options.messageHistory;
  const shouldPersistSession = !skipSessionHistory;
  const sessionKey = shouldPersistSession
    ? (options.sessionId ?? deriveDefaultSessionKey())
    : null;
  const delegateOwnerId = crypto.randomUUID();
  const shouldRestorePersistedTodos = !!sessionKey;
  const persistedTurnSessionId = sessionKey;
  let persistedTurn: PersistedAgentTurn | null = null;

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

    const sessionMetadata = sessionKey
      ? loadPersistedAgentSessionMetadata(sessionKey)
      : {};
    if (sessionMetadata.delegateBatches?.length) {
      restoreBatchSnapshots(sessionMetadata.delegateBatches);
    }
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
    if (hasIncompleteRestoredPlan && activePlan) {
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
    let latestCheckpointSignature = "";
    const checkpointRecorder = sessionKey
      ? createCheckpointRecorder({
        sessionId: sessionKey,
        requestId: persistedTurn?.requestId ?? crypto.randomUUID(),
        onSummaryChanged: (summary) => {
          persistAgentCheckpointSummary(sessionKey, summary);
          const signature = `${summary.id}:${summary.fileCount}:${
            summary.restoredAt ?? 0
          }`;
          if (signature === latestCheckpointSignature) {
            return;
          }
          latestCheckpointSignature = signature;
          callbacks.onAgentEvent?.({
            type: "checkpoint_created",
            checkpoint: { ...summary },
          });
        },
      })
      : undefined;
    const planReview = {
      getCurrentPlan: (): typeof activePlan => activePlan,
      shouldGateMutatingTools: (): boolean =>
        permissionMode !== "yolo" &&
        effectiveToolSurfaceIncludesMutation({
          allowlist: session.toolFilterState?.allowlist ??
            session.llmConfig?.toolAllowlist,
          denylist: session.toolFilterState?.denylist ??
            session.llmConfig?.toolDenylist,
          ownerId: session.toolOwnerId,
        }),
      ensureApproved: async (
        plan: NonNullable<typeof activePlan>,
      ): Promise<"approved" | "cancelled"> => {
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
            toolArgs: formatPlanForContext(plan, {
              mode: "always",
              requireStepMarkers: false,
            }),
          });
          const approved = response.approved === true;
          resolvePendingPlanReview(sessionKey, {
            approved,
            planSignature: approved ? signature : undefined,
          });
          approvedPlanSignature = approved ? signature : undefined;
          callbacks.onAgentEvent?.({
            type: "plan_review_resolved",
            plan,
            approved,
          });
          return approved ? "approved" : "cancelled";
        } catch (error) {
          approvedPlanSignature = undefined;
          throw error;
        }
      },
    } satisfies NonNullable<
      NonNullable<Parameters<typeof runReActLoop>[1]>["planReview"]
    >;
    let teamRuntime: ReturnType<typeof createTeamRuntime> | undefined;
    const onAgentEvent = (() => {
      if (!persistedTurn && !sessionKey) return callbacks.onAgentEvent;
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
    let text: string;
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
      text = await runReActLoop(
        query,
        {
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
          planning: {
            mode: getPlanningModeForExecutionMode(permissionMode),
            requireStepMarkers: false,
          },
          skipModelCompensation: session.isFrontierModel,
          modelTier: session.modelTier,
          modelId: model,
          sessionId: sessionKey ?? undefined,
          signal: options.signal,
          autoMemoryRecall: !disablePersistentMemory,
          usage: usageTracker,
          l1Confirmations: session.l1Confirmations,
          todoState: session.todoState,
          initialPlanState: hasIncompleteRestoredPlan && activePlan
            ? restorePlanState(activePlan, completedPlanStepIds)
            : null,
          planReview,
          checkpointRecorder,
          toolAllowlist: session.toolFilterState?.allowlist ??
            session.llmConfig?.toolAllowlist,
          toolDenylist: session.toolFilterState?.denylist ??
            session.llmConfig?.toolDenylist,
          toolFilterState: session.toolFilterState,
          toolOwnerId: session.toolOwnerId,
          ensureMcpLoaded: session.ensureMcpLoaded,
        },
        session.llm,
        options.images,
      );
    } catch (error) {
      if (persistedTurn) {
        const message = getErrorMessage(error);
        completePersistedAgentTurn(persistedTurn, model, `Error: ${message}`);
      }
      throw error;
    } finally {
      // Cancel any still-active background delegates and wait for their promises
      // to settle so they don't emit on a closed stream controller. Scope this
      // to the current top-level run so concurrent requests do not cancel each
      // other's delegates.
      const active = getActiveThreadsForOwner(delegateOwnerId);
      if (active.length > 0) {
        cancelThreadsForOwner(delegateOwnerId);
        await Promise.allSettled(active.map((t) => t.promise));
      }
    }

    if (persistedTurn) {
      completePersistedAgentTurn(persistedTurn, model, text);
    }

    if (!disablePersistentMemory) {
      try {
        persistConversationFacts([{ role: "user", content: query }], {
          source: "extracted",
        });
      } catch {
        // Best-effort only; extraction should never block agent response.
      }

      if (session.modelTier === "frontier") {
        try {
          await extractSessionFacts(
            session.context.getMessages().map((message) => ({
              role: message.role,
              content: message.content,
            })),
            session.modelTier,
            model,
          );
        } catch {
          // Best-effort only; extraction should never block agent response.
        }
      }
    }

    const stats = session.context.getStats();
    const usageSnapshot = usageTracker.snapshot();
    const finalResponseState = classifyAgentFinalResponse(text);
    return {
      text,
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
