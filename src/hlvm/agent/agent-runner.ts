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
import { createDelegateHandler } from "./delegation.ts";
import {
  type LLMFunction,
  runReActLoop,
  type ToolDisplay,
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
  MAX_SESSION_HISTORY,
} from "./constants.ts";
import { hashString } from "../../common/utils.ts";
import { RuntimeError } from "../../common/error.ts";
import { UsageTracker } from "./usage.ts";
import { getOverflowParser } from "./context-resolver.ts";

const DEFAULT_AGENT_PATH_ROOTS = [
  "~",
  "~/Downloads",
  "~/Desktop",
  "~/Documents",
];

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
  onToolDisplay?: (event: ToolDisplay) => void;
  onTrace?: (event: TraceEvent) => void;
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
  const isLocalModel = !model.startsWith("openai/") &&
    !model.startsWith("anthropic/") &&
    !model.startsWith("google/") &&
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

  const session: AgentSession = await createAgentSession({
    workspace,
    model,
    contextWindow: options.contextWindow,
    engineProfile: "normal",
    failOnContextOverflow: false,
    toolDenylist,
    onToken: callbacks.onToken,
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

    const homePath = getPlatform().env.get("HOME");
    const homeNote = homePath ? ` (HOME=${homePath})` : "";
    session.context.addMessage({
      role: "system",
      content: `Allowed file roots: ${
        DEFAULT_AGENT_PATH_ROOTS.join(", ")
      }${homeNote}. Use list_files for user folders. Avoid placeholders like "/home/user" or "/Downloads" - use "~/Downloads" instead.`,
    });

    let policy = session.policy;
    policy = mergePolicyPathRoots(policy, DEFAULT_AGENT_PATH_ROOTS);
    const delegate = createDelegateHandler(session.llm, {
      policy,
      autoApprove: false,
    });

    let llm: LLMFunction = session.llm;
    if (options.signal) {
      const outerSignal = options.signal;
      const innerLlm = session.llm;
      llm = (messages, signal) => {
        if (outerSignal.aborted) throw new RuntimeError("Request cancelled");
        return innerLlm(messages, signal);
      };
    }

    const usageTracker = new UsageTracker();

    // Resolve provider-specific overflow parser for dynamic context budget
    const providerName = model.indexOf("/") > 0
      ? model.slice(0, model.indexOf("/")).toLowerCase()
      : "ollama";
    const modelName = model.indexOf("/") > 0
      ? model.slice(model.indexOf("/") + 1)
      : model;
    const overflowParser = await getOverflowParser(providerName);

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
        onToolDisplay: callbacks.onToolDisplay,
        noInput,
        delegate,
        planning: { mode: "off", requireStepMarkers: false },
        skipModelCompensation: session.isFrontierModel,
        signal: options.signal,
        usage: usageTracker,
        l1Confirmations: session.l1Confirmations,
        toolOwnerId: session.toolOwnerId,
        parseOverflowError: overflowParser ?? undefined,
        providerName,
        modelName,
      },
      llm,
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
    await session.dispose();
  }
}
