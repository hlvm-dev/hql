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
import { setAgentLogger } from "./logger.ts";
import {
  ensureDefaultModelInstalled,
  getConfiguredModel,
} from "../../common/ai-default-model.ts";
import { getPlatform } from "../../platform/platform.ts";
import { type AgentSession, createAgentSession } from "./session.ts";
import { createAgentLLM } from "./llm-integration.ts";
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
  isFrontierProvider,
  MAX_SESSION_HISTORY,
} from "./constants.ts";
import { hashString } from "../../common/utils.ts";
import { UsageTracker } from "./usage.ts";
import { createCheckpoint } from "./checkpoint-service.ts";
import { ContextManager } from "./context.ts";
import type { ModelInfo } from "../providers/types.ts";

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

/** Get or create a cached session for a workspace:model pair. */
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
  const key = `${workspace}:${model}`;
  const existing = sessionCache.get(key);
  if (existing) return existing;

  const session = await createAgentSession({
    workspace,
    model,
    contextWindow: opts?.contextWindow,
    engineProfile: "normal",
    failOnContextOverflow: false,
    toolDenylist: opts?.toolDenylist,
    onToken: opts?.onToken,
    modelInfo: opts?.modelInfo,
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
function reuseSession(
  cached: AgentSession,
  onToken?: (text: string) => void,
): AgentSession {
  const context = new ContextManager(cached.context.getConfig());
  // Copy all system messages from cached session (not just first)
  const systemMessages = cached.context.getMessages().filter((m) =>
    m.role === "system"
  );
  for (const message of systemMessages) {
    context.addMessage({ role: "system", content: message.content });
  }

  // Rebuild LLM with caller's onToken to enable streaming in GUI mode
  let llm = cached.llm;
  if (onToken && cached.llmConfig) {
    llm = createAgentLLM({
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

function deriveDefaultSessionKey(workspace: string): string {
  const platform = getPlatform();
  const base = platform.path.basename(workspace) || "workspace";
  return `${base}-${hashString(workspace)}`;
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
  autoApprove?: boolean;
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
  const modelName = model.includes("/")
    ? model.split("/").slice(1).join("/")
    : model;
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
    autoApprove = false,
    noInput = false,
    toolDenylist = [...DEFAULT_TOOL_DENYLIST],
    skipSessionHistory = false,
  } = options;
  const model = options.model ?? getConfiguredModel();
  const workspace = options.workspace ?? getPlatform().process.cwd();
  const profile = ENGINE_PROFILES.normal;

  // Pre-read per-project instructions (.hlvm/prompt.md) — non-blocking
  let projectInstructions = "";
  try {
    projectInstructions = await getPlatform().fs.readTextFile(
      `${workspace}/.hlvm/prompt.md`,
    );
  } catch { /* file not found — skip */ }

  const isCached = !!options.cachedSession;
  const session: AgentSession = options.cachedSession
    ? reuseSession(options.cachedSession, callbacks.onToken)
    : await createAgentSession({
      workspace,
      model,
      contextWindow: options.contextWindow,
      engineProfile: "normal",
      failOnContextOverflow: false,
      toolDenylist,
      onToken: callbacks.onToken,
      modelInfo: options.modelInfo,
      projectInstructions,
    });

  const useExternalHistory = !!options.messageHistory;
  const sessionKey = (skipSessionHistory || useExternalHistory)
    ? null
    : deriveDefaultSessionKey(workspace);
  let sessionEntry: AgentSessionEntry | null = null;

  try {
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

    session.context.addMessage({
      role: "system",
      content: `Allowed file roots: ${
        DEFAULT_AGENT_PATH_ROOTS.join(", ")
      }. Use "~/Downloads" not "/Downloads".`,
    });

    let policy = session.policy;
    policy = mergePolicyPathRoots(policy, DEFAULT_AGENT_PATH_ROOTS);
    const delegate = createDelegateHandler(session.llm, {
      policy,
      autoApprove: false,
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

    // Checkpoint workspace before agent mutations (opt-in)
    try {
      const { config: cfgApi } = await import("../api/config.ts");
      if (cfgApi.snapshot.checkpointing === true) {
        await createCheckpoint(workspace, options.signal);
      }
    } catch {
      // Non-blocking: checkpoint failure must never break agent execution
    }

    const usageTracker = new UsageTracker();

    const text = await runReActLoop(
      query,
      {
        workspace,
        context: session.context,
        autoApprove,
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
        signal: options.signal,
        usage: usageTracker,
        l1Confirmations: session.l1Confirmations,
        toolOwnerId: session.toolOwnerId,
      },
      session.llm,
    );

    if (sessionEntry) {
      await appendSessionMessages(sessionEntry, session.context.getMessages());
    }

    const stats = session.context.getStats();
    const usageSnapshot = usageTracker.snapshot();
    return {
      text,
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
