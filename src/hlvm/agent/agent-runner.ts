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
import {
  extractSessionFacts,
  loadMemoryContext,
  setMemoryModelTier,
} from "../memory/mod.ts";
import { setAgentLogger } from "./logger.ts";
import {
  ensureDefaultModelInstalled,
  getConfiguredModel,
} from "../../common/ai-default-model.ts";
import { getPlatform } from "../../platform/platform.ts";
import { type AgentSession, createAgentSession } from "./session.ts";
import { getAgentEngine } from "./engine.ts";
import { createDelegateHandler } from "./delegation.ts";
import {
  type AgentUIEvent,
  type InteractionRequestEvent,
  type InteractionResponse,
  runReActLoop,
  type TraceEvent,
} from "./orchestrator.ts";
import {
  type AgentSessionEntry,
  appendSessionMessages,
  getOrCreateSession,
  loadSessionMessages,
} from "./session-store.ts";
import type { AgentPolicy } from "./policy.ts";
import {
  DEFAULT_TOOL_DENYLIST,
  ENGINE_PROFILES,
  extractModelSuffix,
  isFrontierProvider,
  MAX_SESSION_HISTORY,
} from "./constants.ts";
import type { PermissionMode } from "../../common/config/types.ts";
import { UsageTracker } from "./usage.ts";
import { ContextManager } from "./context.ts";
import type { ModelInfo } from "../providers/types.ts";
import {
  classifyAgentFinalResponse,
  type AgentOrchestratorFailureCode,
} from "./model-compat.ts";

const DEFAULT_AGENT_PATH_ROOTS = [
  "~",
  "~/Downloads",
  "~/Desktop",
  "~/Documents",
];

// ============================================================
// Session Cache — avoids re-creating policy/MCP/LLM per query
// ============================================================
const sessionCache = new Map<string, AgentSession>();

/** Get or create a cached session for a global:model pair. */
export async function getOrCreateCachedSession(
  workspace: string,
  model: string,
  opts?: {
    contextWindow?: number;
    toolDenylist?: string[];
    onToken?: (text: string) => void;
    modelInfo?: ModelInfo | null;
  },
): Promise<AgentSession> {
  const key = `global:${model}`;
  const existing = sessionCache.get(key);
  if (existing) return existing;

  const engine = getAgentEngine();
  const session = await createAgentSession({
    workspace,
    model,
    contextWindow: opts?.contextWindow,
    engineProfile: "normal",
    failOnContextOverflow: false,
    toolDenylist: opts?.toolDenylist,
    onToken: opts?.onToken,
    modelInfo: opts?.modelInfo,
    engine,
  });
  sessionCache.set(key, session);
  return session;
}

/** Dispose all cached sessions (call on server shutdown). */
export async function disposeAllSessions(): Promise<void> {
  const sessions = [...sessionCache.values()];
  sessionCache.clear();
  await Promise.allSettled(sessions.map((s) => s.dispose()));
}

/**
 * Create a fresh context + l1Confirmations from a cached session.
 * Reuses policy, toolOwnerId, profile, isFrontierModel, resolvedContextBudget.
 * When onToken is provided, rebuilds the LLM to enable streaming.
 */
/** @internal Exported for testing. Refreshes memory in a cached session. */
export async function reuseSession(
  cached: AgentSession,
  onToken?: (text: string) => void,
): Promise<AgentSession> {
  const context = new ContextManager(cached.context.getConfig());
  // Copy system messages from cached session, EXCLUDING stale memory
  // Memory messages are identified by the "# Your Memory" marker
  const systemMessages = cached.context.getMessages().filter((m) =>
    m.role === "system" && !m.content.startsWith("# Your Memory")
  );
  for (const message of systemMessages) {
    context.addMessage({ role: "system", content: message.content });
  }

  // Inject FRESH memory context (replaces stale memory from cache)
  try {
    const memoryContext = await loadMemoryContext(
      cached.resolvedContextBudget.budget,
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

  // Rebuild LLM with caller's onToken to enable streaming in GUI mode
  let llm = cached.llm;
  if (onToken && cached.llmConfig) {
    const engine = cached.engine ?? getAgentEngine();
    llm = engine.createLLM({
      ...cached.llmConfig,
      options: { temperature: cached.llmConfig.temperature ?? 0.0 },
      onToken,
    });
  }

  return {
    ...cached,
    llm,
    context,
    l1Confirmations: cached.l1Confirmations,
  };
}

function deriveDefaultSessionKey(_workspace: string): string {
  return "default";
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

export interface AgentRunnerCallbacks {
  onToken?: (text: string) => void;
  onAgentEvent?: (event: AgentUIEvent) => void;
  onTrace?: (event: TraceEvent) => void;
  onInteraction?: (
    event: InteractionRequestEvent,
  ) => Promise<InteractionResponse>;
}

export interface AgentRunnerOptions {
  query: string;
  model?: string;
  /** Optional context window override (in tokens). */
  contextWindow?: number;
  workspace?: string;
  callbacks: AgentRunnerCallbacks;
  permissionMode?: PermissionMode;
  noInput?: boolean;
  toolDenylist?: string[];
  skipSessionHistory?: boolean;
  signal?: AbortSignal;
  messageHistory?: import("./context.ts").Message[];
  /** Pre-fetched model info to avoid duplicate provider API calls */
  modelInfo?: ModelInfo | null;
  /** Reuse an existing session (skips policy/MCP/LLM setup) */
  cachedSession?: AgentSession;
}

export interface AgentRunnerResult {
  text: string;
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
  const permissionMode: PermissionMode = options.permissionMode ?? "default";
  const model = options.model ?? getConfiguredModel();
  const workspace = options.workspace ?? getPlatform().process.cwd();
  const profile = ENGINE_PROFILES.normal;

  // Pre-read custom instructions (~/.hlvm/prompt.md) — non-blocking
  let customInstructions = "";
  try {
    customInstructions = await getPlatform().fs.readTextFile(
      getCustomInstructionsPath(),
    );
  } catch { /* file not found — skip */ }

  const isCached = !!options.cachedSession;
  const engine = isCached ? undefined : getAgentEngine();
  const session: AgentSession = options.cachedSession
    ? await reuseSession(options.cachedSession, callbacks.onToken)
    : await createAgentSession({
      workspace,
      model,
      contextWindow: options.contextWindow,
      engineProfile: "normal",
      failOnContextOverflow: false,
      toolDenylist,
      onToken: callbacks.onToken,
      modelInfo: options.modelInfo,
      customInstructions,
      engine,
    });

  const useExternalHistory = !!options.messageHistory;
  const sessionKey = (skipSessionHistory || useExternalHistory)
    ? null
    : deriveDefaultSessionKey(workspace);
  let sessionEntry: AgentSessionEntry | null = null;

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
      sessionEntry = await getOrCreateSession(sessionKey);
      const historyMessages = await loadSessionMessages(sessionEntry);
      const recentHistory = historyMessages.slice(-MAX_SESSION_HISTORY);
      for (const message of recentHistory) {
        session.context.addMessage({ ...message, fromSession: true });
      }
    }

    let policy = session.policy;
    policy = mergePolicyPathRoots(policy, DEFAULT_AGENT_PATH_ROOTS);
    const delegate = createDelegateHandler(session.llm, {
      policy,
    });

    // Wire MCP server-initiated request handlers (sampling, elicitation, roots)
    if (session.mcpSetHandlers) {
      session.mcpSetHandlers({
        roots: [
          `file://${workspace}`,
          ...DEFAULT_AGENT_PATH_ROOTS.map((r) =>
            `file://${r.startsWith("~") ? (getPlatform().env.get("HOME") ?? "") + r.slice(1) : r}`
          ),
        ],
      });
    }

    // Wire cancellation signal to MCP clients
    if (session.mcpSetSignal && options.signal) {
      session.mcpSetSignal(options.signal);
    }

    const usageTracker = new UsageTracker();
    setMemoryModelTier(session.modelTier);

    const text = await runReActLoop(
      query,
      {
        workspace,
        context: session.context,
        permissionMode,
        maxToolCalls: profile.maxToolCalls,
        groundingMode: profile.groundingMode,
        policy,
        onTrace: callbacks.onTrace,
        onAgentEvent: callbacks.onAgentEvent,
        onInteraction: callbacks.onInteraction,
        noInput,
        delegate,
        planning: { mode: "off", requireStepMarkers: false },
        skipModelCompensation: session.isFrontierModel,
        modelTier: session.modelTier,
        modelId: model,
        signal: options.signal,
        autoMemoryRecall: true,
        usage: usageTracker,
        l1Confirmations: session.l1Confirmations,
        toolAllowlist: session.toolFilterState?.allowlist ??
          session.llmConfig?.toolAllowlist,
        toolDenylist: session.toolFilterState?.denylist ??
          session.llmConfig?.toolDenylist,
        toolFilterState: session.toolFilterState,
        toolOwnerId: session.toolOwnerId,
        ensureMcpLoaded: session.ensureMcpLoaded,
      },
      session.llm,
    );

    if (sessionEntry) {
      await appendSessionMessages(sessionEntry, session.context.getMessages());
    }

    if (session.modelTier === "frontier") {
      try {
        await extractSessionFacts(
          session.context.getMessages().map((message) => ({
            role: message.role,
            content: message.content,
          })),
          session.modelTier,
        );
      } catch {
        // Best-effort only; extraction should never block agent response.
      }
    }

    const stats = session.context.getStats();
    const usageSnapshot = usageTracker.snapshot();
    const finalResponseState = classifyAgentFinalResponse(text);
    return {
      text,
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
    // Only dispose non-cached sessions; cached sessions are managed by the cache
    if (!isCached) {
      await session.dispose();
    }
  }
}
