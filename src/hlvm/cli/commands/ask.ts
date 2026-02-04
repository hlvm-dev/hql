/**
 * Ask Command - Interactive AI Agent
 *
 * Allows users to ask questions and execute tasks using the agent system.
 * Entry point to the agent orchestrator pipeline.
 */

import { log } from "../../api/log.ts";
import { initializeRuntime } from "../../../common/runtime-initializer.ts";
import { ValidationError } from "../../../common/error.ts";
import {
  runReActLoop,
  shouldSuppressFinalResponse,
  type TraceEvent,
  type ToolDisplay,
} from "../../agent/orchestrator.ts";
import { createAgentSession } from "../../agent/session.ts";
import { createDelegateHandler } from "../../agent/delegation.ts";
import {
  appendSessionMessages,
  getOrCreateSession,
  loadSessionMessages,
  type AgentSessionEntry,
} from "../../agent/session-store.ts";
import type { AgentPolicy } from "../../agent/policy.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { ENGINE_PROFILES } from "../../agent/constants.ts";
import {
  ensureDefaultModelInstalled,
} from "../../../common/ai-default-model.ts";
import { DEFAULT_MODEL_ID } from "../../../common/config/types.ts";

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

export function showAskHelp(): void {
  log.raw.log(`
HLVM Ask - Interactive AI Agent

USAGE:
  hlvm ask "<query>"           Ask the agent to perform a task
  hlvm ask --help              Show this help message

EXAMPLES:
  hlvm ask "list files in src/"
  hlvm ask "count test files in tests/unit"
  hlvm ask "what are recent downloaded files?"
  hlvm ask --verbose "count test files"  # Debug mode with detailed output

OPTIONS:
  --help, -h                   Show this help message
  --verbose                    Show agent header, tool labels, stats, and trace output
`);
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

const DEFAULT_AGENT_PATH_ROOTS = [
  "~/Downloads",
  "~/Desktop",
  "~/Documents",
];

export async function askCommand(args: string[]): Promise<void> {
  // Check for help flag
  if (args.includes("--help") || args.includes("-h")) {
    showAskHelp();
    return;
  }

  // Parse arguments
  let query = "";
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--verbose") {
      verbose = true;
    } else if (!arg.startsWith("--")) {
      // Accumulate query parts (in case user forgets quotes)
      query += (query ? " " : "") + arg;
    } else {
      throw new ValidationError(`Unknown option: ${arg}`);
    }
  }

  if (!query) {
    throw new ValidationError("Missing query. Usage: hlvm ask \"<query>\"");
  }

  // Initialize runtime with AI
  await initializeRuntime({ stdlib: false, cache: false });

  const model = DEFAULT_MODEL_ID;
  try {
    await ensureDefaultModelInstalled({
      log: (message) => log.raw.log(message),
    });
  } catch (error) {
    if (error instanceof Error) {
      log.error(`Failed to setup default model: ${error.message}`);
      log.raw.log("\nTip: Make sure Ollama is running.");
    }
    throw error;
  }

  const profile = ENGINE_PROFILES.normal;
  const maxCalls = profile.maxToolCalls;

  // Get workspace
  const workspace = getPlatform().process.cwd();

  // No tool filtering - give LLM all tools and let schemas guide selection
  const toolAllowlist = undefined;
  const requireToolCalls = false;

  const session = await createAgentSession({
    workspace,
    model,
    engineProfile: "normal",
    failOnContextOverflow: false,
    toolAllowlist,
    toolDenylist: ["delegate_agent"],
  });

  let sessionEntry: AgentSessionEntry | null = null;
  const sessionKey = deriveDefaultSessionKey(workspace);
  sessionEntry = await getOrCreateSession(sessionKey);
  const historyMessages = await loadSessionMessages(sessionEntry);
  for (const message of historyMessages) {
    session.context.addMessage({ ...message, fromSession: true });
  }

  let policy = session.policy;
  policy = mergePolicyPathRoots(policy, DEFAULT_AGENT_PATH_ROOTS);
  const delegate = createDelegateHandler(session.llm, {
    policy,
    autoApprove: false,
  });

  // Create trace callback if verbose mode enabled
  const onTrace = verbose
    ? (event: TraceEvent) => {
      switch (event.type) {
        case "iteration":
          log.raw.log(`\n[TRACE] Iteration ${event.current}/${event.max}`);
          break;
        case "llm_call":
          log.raw.log(`[TRACE] Calling LLM with ${event.messageCount} messages`);
          break;
        case "llm_response":
          log.raw.log(
            `[TRACE] LLM responded (${event.length} chars): "${event.truncated}..."`
          );
          break;
        case "tool_call":
          log.raw.log(`[TRACE] Tool call: ${event.toolName}`);
          log.raw.log(`[TRACE] Args: ${JSON.stringify(event.args, null, 2)}`);
          break;
        case "tool_result":
          if (event.success) {
            const raw = typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result);
            const truncated = raw.length > 200
              ? raw.substring(0, 200) + "..."
              : raw;
            log.raw.log(`[TRACE] Result: SUCCESS`);
            log.raw.log(`[TRACE] ${truncated}`);
          } else {
            log.raw.log(`[TRACE] Result: FAILED - ${event.error}`);
          }
          break;
        case "llm_retry":
          log.raw.log(
            `[TRACE] LLM retry ${event.attempt}/${event.max} (${event.class})${
              event.retryable ? "" : " [non-retryable]"
            }: ${event.error}`,
          );
          break;
        case "grounding_check":
          log.raw.log(
            `[TRACE] Grounding ${event.grounded ? "ok" : "warn"} mode=${event.mode} retry=${event.retry}/${event.maxRetry}`,
          );
          if (event.warnings.length > 0) {
            for (const warning of event.warnings) {
              log.raw.log(`[TRACE] Grounding warning: ${warning}`);
            }
          }
          break;
        case "rate_limit":
          log.raw.log(
            `[TRACE] Rate limit (${event.target}): ${event.used}/${event.maxCalls} per ${event.windowMs}ms (reset ${event.resetMs}ms)`,
          );
          break;
        case "resource_limit":
          log.raw.log(
            `[TRACE] Resource limit (${event.kind}): ${event.used} > ${event.limit}`,
          );
          break;
        case "llm_usage":
          log.raw.log(
            `[TRACE] LLM usage: ${event.usage.totalTokens} tokens (${event.usage.source})`,
          );
          break;
        case "plan_created":
          log.raw.log(
            `[TRACE] Plan created with ${event.plan.steps.length} steps`,
          );
          break;
        case "plan_step":
          log.raw.log(
            `[TRACE] Plan step complete: ${event.stepId} (index ${event.index})`,
          );
          break;
        case "context_overflow":
          log.raw.log(
            `[TRACE] Context overflow: ${event.estimatedTokens} > ${event.maxTokens}`,
          );
          break;
      }
    }
    : undefined;

  const onToolDisplay = (event: ToolDisplay) => {
    if (event.toolName === "ask_user") return;
    if (verbose) {
      const label = event.success ? "Tool Result" : "Tool Error";
      log.raw.log(`\n[${label}] ${event.toolName}\n${event.content}\n`);
    } else {
      log.raw.log(`${event.content}\n`);
    }
  };

  if (verbose) {
    // Show what we're doing
    log.raw.log(`\nAgent: ${query}\n`);
  }

  try {
    // Run agent loop
    const result = await runReActLoop(
      query,
      {
        workspace,
        context: session.context,
        autoApprove: false, // Safety layer auto-approves L0; prompts for L1/L2
        maxToolCalls: maxCalls,
        groundingMode: profile.groundingMode,
        policy,
        onTrace, // Pass trace callback
        onToolDisplay,
        noInput: false,
        delegate,
        toolAllowlist,
        requireToolCalls,
        planning: {
          mode: "auto",
          requireStepMarkers: true,
        },
      },
      session.llm,
    );

    if (sessionEntry) {
      sessionEntry = await appendSessionMessages(
        sessionEntry,
        session.context.getMessages(),
      );
    }

    const stats = session.context.getStats();
    if (verbose) {
      if (!shouldSuppressFinalResponse(result)) {
        log.raw.log(`\nResult:\n${result}\n`);
      }
    } else if (stats.toolMessages === 0 && result.trim()) {
      log.raw.log(`${result}\n`);
    }
    if (verbose) {
      log.raw.log(
        `[Stats: ${stats.messageCount} messages, ${stats.estimatedTokens} tokens, ${stats.toolMessages} tool messages]`,
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      log.error(`Agent error: ${error.message}`);
      throw error;
    }
    throw error;
  } finally {
    await session.dispose();
  }
}
