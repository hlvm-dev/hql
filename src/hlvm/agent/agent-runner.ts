/**
 * Agent Runner — Shared core for running agent queries.
 *
 * SSOT for agent execution logic used by both CLI (ask command) and
 * HTTP (/api/ask endpoint). Eliminates duplication between entry points.
 *
 * Consumers provide transport-specific callbacks; this module handles
 * session setup, policy, history, and the ReAct loop.
 */

import { initializeRuntime } from "../../common/runtime-initializer.ts";
import {
  ensureDefaultModelInstalled,
  getConfiguredModel,
} from "../../common/ai-default-model.ts";
import { getPlatform } from "../../platform/platform.ts";
import { createAgentSession, type AgentSession } from "./session.ts";
import { createDelegateHandler } from "./delegation.ts";
import {
  runReActLoop,
  type TraceEvent,
  type ToolDisplay,
} from "./orchestrator.ts";
import {
  appendSessionMessages,
  getOrCreateSession,
  loadSessionMessages,
  type AgentSessionEntry,
} from "./session-store.ts";
import type { AgentPolicy } from "./policy.ts";
import { ENGINE_PROFILES, DEFAULT_TOOL_DENYLIST, MAX_SESSION_HISTORY } from "./constants.ts";

const DEFAULT_AGENT_PATH_ROOTS = [
  "~",
  "~/Downloads",
  "~/Desktop",
  "~/Documents",
];

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function deriveDefaultSessionKey(workspace: string): string {
  const platform = getPlatform();
  const base = platform.path.basename(workspace) || "workspace";
  const hash = hashString(workspace).slice(0, 8);
  return `${base}-${hash}`;
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
  workspace?: string;
  callbacks: AgentRunnerCallbacks;
  autoApprove?: boolean;
  noInput?: boolean;
  toolDenylist?: string[];
  skipSessionHistory?: boolean;
}

export interface AgentRunnerResult {
  text: string;
  stats: {
    messageCount: number;
    estimatedTokens: number;
    toolMessages: number;
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

  const isLocalModel = !model.startsWith("openai/") &&
    !model.startsWith("anthropic/") &&
    !model.startsWith("google/");

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
    engineProfile: "normal",
    failOnContextOverflow: false,
    toolDenylist,
    onToken: callbacks.onToken,
  });

  const sessionKey = skipSessionHistory ? null : deriveDefaultSessionKey(workspace);
  let sessionEntry: AgentSessionEntry | null = null;

  try {
    if (sessionKey) {
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
      content:
        `Allowed file roots: ${DEFAULT_AGENT_PATH_ROOTS.join(", ")}${homeNote}. Use list_files for user folders. Avoid placeholders like "/home/user" or "/Downloads" - use "~/Downloads" instead.`,
    });

    let policy = session.policy;
    policy = mergePolicyPathRoots(policy, DEFAULT_AGENT_PATH_ROOTS);
    const delegate = createDelegateHandler(session.llm, {
      policy,
      autoApprove: false,
    });

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
      },
      session.llm,
    );

    if (sessionEntry) {
      await appendSessionMessages(sessionEntry, session.context.getMessages());
    }

    const stats = session.context.getStats();
    return {
      text,
      stats: {
        messageCount: stats.messageCount,
        estimatedTokens: stats.estimatedTokens,
        toolMessages: stats.toolMessages,
      },
    };
  } finally {
    await session.dispose();
  }
}
