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
  shouldAutoAnswerWebRequest,
  shouldAutoResearchWebRequest,
  shouldSuppressFinalResponse,
  extractUrlFromText,
  type TraceEvent,
  type ToolDisplay,
} from "../../agent/orchestrator.ts";
import { createAgentSession } from "../../agent/session.ts";
import { createDelegateHandler } from "../../agent/delegation.ts";
import {
  appendSessionMessages,
  createSession,
  getOrCreateSession,
  listSessions,
  loadSessionMessages,
  type AgentSessionEntry,
} from "../../agent/session-store.ts";
import type { AgentPolicy } from "../../agent/policy.ts";
import {
  formatAnswer,
  getFormatInstruction,
  type OutputFormat,
} from "../../agent/answer-format.ts";
import {
  selectToolAllowlist,
  shouldRequireToolCalls,
} from "../../agent/tool-selection.ts";
import { inferRequestHints } from "../../agent/request-hints.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { DEFAULT_MAX_TOOL_CALLS, ENGINE_PROFILES } from "../../agent/constants.ts";
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
  hlvm ask --trace "count test files"  # Debug mode with detailed output

OPTIONS:
  --help, -h                   Show this help message
  --model <model>              Specify model (default: ollama/llama3.1:8b)
  --llm-fixture <path>         Use deterministic LLM fixture (no live model)
  --max-calls <n>              Maximum tool calls (default: 10)
  --trace                      Enable trace mode (show tool calls and results)
  --trace-full                 Show full trace outputs (no truncation)
  --fail-on-context-overflow   Fail instead of trimming when context exceeds max tokens
  --engine-strict              Deterministic profile (strict grounding, fail on overflow, lower context budget)
  --plan                       Enable explicit planning (always)
  --plan-auto                  Enable heuristic planning (auto)
  --no-plan                    Disable planning
  --plan-steps <n>             Max plan steps (default: 6)
  --session <id|key>           Load or create a persistent session
  --new-session [key]          Create a new session (optional key)
  --list-sessions              List saved sessions and exit
  --no-session                 Disable session persistence
  --auto-web                   Enable automatic web tool routing (default: disabled)
  --no-input                   Non-interactive: auto-approve tools, disallow ask_user prompts
  --allow-path <path>          Allow file access under an absolute path root (can repeat)
  --format <text|raw|json|tool>  Output format (default: text)
`);
}

function buildNoInputPolicy(base: AgentPolicy | null): AgentPolicy {
  const policy: AgentPolicy = base ?? { version: 1 };
  return {
    ...policy,
    version: 1,
    toolRules: {
      ...(policy.toolRules ?? {}),
      ask_user: "deny",
    },
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

export async function askCommand(args: string[]): Promise<void> {
  // Check for help flag
  if (args.includes("--help") || args.includes("-h")) {
    showAskHelp();
    return;
  }

  // Parse arguments
  let query = "";
  let model: string | undefined;
  let maxCalls = DEFAULT_MAX_TOOL_CALLS;
  let maxCallsProvided = false;
  let traceMode = false;
  let traceFull = false;
  let failOnContextOverflow = false;
  let engineStrict = false;
  let noInput = false;
  let outputFormat: OutputFormat = "text";
  let fixturePath: string | undefined;
  let autoWeb = false;
  const pathRoots: string[] = [];
  let planningMode: "off" | "auto" | "always" = "auto";
  let planningMaxSteps: number | undefined;
  let requireStepMarkers = true;
  let sessionKey: string | undefined;
  let forceNewSession = false;
  let listSessionsOnly = false;
  let disableSession = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--model") {
      model = args[++i];
      if (!model) {
        throw new ValidationError("Missing model value. Usage: --model <model>");
      }
    } else if (arg === "--llm-fixture") {
      fixturePath = args[++i];
      if (!fixturePath) {
        throw new ValidationError("Missing fixture path. Usage: --llm-fixture <path>");
      }
    } else if (arg === "--max-calls") {
      const value = args[++i];
      if (!value) {
        throw new ValidationError("Missing max-calls value. Usage: --max-calls <n>");
      }
      maxCalls = parseInt(value, 10);
      maxCallsProvided = true;
      if (isNaN(maxCalls) || maxCalls < 1) {
        throw new ValidationError("max-calls must be a positive number");
      }
    } else if (arg === "--trace") {
      traceMode = true;
    } else if (arg === "--trace-full") {
      traceMode = true;
      traceFull = true;
    } else if (arg === "--fail-on-context-overflow") {
      failOnContextOverflow = true;
    } else if (arg === "--engine-strict") {
      engineStrict = true;
    } else if (arg === "--plan") {
      planningMode = "always";
      requireStepMarkers = true;
    } else if (arg === "--plan-auto") {
      planningMode = "auto";
      requireStepMarkers = true;
    } else if (arg === "--no-plan") {
      planningMode = "off";
      requireStepMarkers = false;
    } else if (arg === "--plan-steps") {
      const value = args[++i];
      if (!value) {
        throw new ValidationError("Missing plan-steps value. Usage: --plan-steps <n>");
      }
      planningMaxSteps = parseInt(value, 10);
      if (isNaN(planningMaxSteps) || planningMaxSteps < 1) {
        throw new ValidationError("plan-steps must be a positive number");
      }
    } else if (arg === "--session") {
      const value = args[++i];
      if (!value) {
        throw new ValidationError("Missing session value. Usage: --session <id|key>");
      }
      sessionKey = value;
    } else if (arg === "--new-session") {
      forceNewSession = true;
      const value = args[i + 1];
      if (value && !value.startsWith("--")) {
        sessionKey = value;
        i += 1;
      }
    } else if (arg === "--list-sessions") {
      listSessionsOnly = true;
    } else if (arg === "--no-session") {
      disableSession = true;
    } else if (arg === "--auto-web") {
      autoWeb = true;
    } else if (arg === "--no-auto-web") {
      autoWeb = false;
    } else if (arg === "--allow-path") {
      const value = args[++i];
      if (!value) {
        throw new ValidationError("Missing allow-path value. Usage: --allow-path <path>");
      }
      pathRoots.push(value);
    } else if (arg === "--no-input") {
      noInput = true;
    } else if (arg === "--format") {
      const value = args[++i];
      if (!value) {
        throw new ValidationError("Missing format value. Usage: --format <text|raw|json|tool>");
      }
      if (value !== "text" && value !== "raw" && value !== "json" && value !== "tool") {
        throw new ValidationError("Invalid format. Use: text, raw, json, or tool.");
      }
      outputFormat = value;
    } else if (!arg.startsWith("--")) {
      // Accumulate query parts (in case user forgets quotes)
      query += (query ? " " : "") + arg;
    }
  }

  if (listSessionsOnly) {
    const sessions = await listSessions();
    if (sessions.length === 0) {
      log.raw.log("No saved sessions.");
      return;
    }
    log.raw.log("Sessions:");
    for (const session of sessions) {
      log.raw.log(
        `- ${session.id} (${session.key}) messages=${session.messageCount} updated=${session.updatedAt}`,
      );
    }
    return;
  }

  if (!query) {
    throw new ValidationError("Missing query. Usage: hlvm ask \"<query>\"");
  }

  // Initialize runtime with AI
  await initializeRuntime({ stdlib: false, cache: false });

  const autoWebAnswer = autoWeb && shouldAutoAnswerWebRequest(query);
  const autoWebIntent = autoWeb &&
    (autoWebAnswer ||
      shouldAutoResearchWebRequest(query) ||
      Boolean(extractUrlFromText(query)));

  // Use default model if no model specified (unless fixture is used)
  if (!fixturePath) {
    if (!model) {
      model = DEFAULT_MODEL_ID;
      if (!autoWebAnswer) {
        try {
          await ensureDefaultModelInstalled({
            log: (message) => log.raw.log(message),
          });
        } catch (error) {
          if (error instanceof Error) {
            log.error(`Failed to setup default model: ${error.message}`);
            log.raw.log("\nTip: Make sure Ollama is running, or specify a model:");
            log.raw.log("  hlvm ask --model ollama/llama3.1:8b \"your query\"");
          }
          throw error;
        }
      } else {
        log.warn(
          "Skipping model setup for web-only request (auto-web summary mode).",
        );
      }
    }
  } else if (model) {
    log.warn("Ignoring --model because --llm-fixture is set");
  }

  const profile = ENGINE_PROFILES[engineStrict ? "strict" : "normal"];
  if (!maxCallsProvided) {
    maxCalls = profile.maxToolCalls;
  }

  if (engineStrict && planningMode === "off") {
    planningMode = "auto";
    requireStepMarkers = true;
  }

  // Get workspace
  const workspace = getPlatform().process.cwd();

  const toolAllowlist = selectToolAllowlist(query, { autoWeb: autoWebIntent });
  const requireToolCalls = shouldRequireToolCalls(toolAllowlist);

  const session = await createAgentSession({
    workspace,
    model,
    fixturePath,
    engineProfile: engineStrict ? "strict" : "normal",
    failOnContextOverflow,
    autoWeb,
    toolAllowlist,
  });

  let sessionEntry: AgentSessionEntry | null = null;
  if (!disableSession) {
    if (!sessionKey && !forceNewSession) {
      sessionKey = deriveDefaultSessionKey(workspace);
    }
    if (sessionKey || forceNewSession) {
      sessionEntry = forceNewSession
        ? await createSession(sessionKey)
        : await getOrCreateSession(sessionKey);
      const historyMessages = await loadSessionMessages(sessionEntry);
      for (const message of historyMessages) {
        session.context.addMessage({ ...message, fromSession: true });
      }
    }
  }

  const noInputMode = noInput || autoWebIntent;

  if (noInputMode) {
    session.context.addMessage({
      role: "system",
      content:
        "NO-INPUT MODE: Do not request user input or call ask_user. Do not ask follow-up questions; make reasonable assumptions and proceed autonomously using tools.",
    });
  }

  const formatInstruction = getFormatInstruction(outputFormat);
  if (formatInstruction) {
    session.context.addMessage({
      role: "system",
      content: formatInstruction,
    });
  }

  let policy = noInputMode ? buildNoInputPolicy(session.policy) : session.policy;
  const requestHints = inferRequestHints(query);
  policy = mergePolicyPathRoots(policy, pathRoots);
  policy = mergePolicyPathRoots(policy, requestHints.file?.pathRoots ?? []);
  const delegate = createDelegateHandler(session.llm, {
    policy,
    autoApprove: noInputMode,
    autoWeb,
  });

  // Create trace callback if trace mode enabled
  const onTrace = traceMode
    ? (event: TraceEvent) => {
      switch (event.type) {
        case "iteration":
          log.raw.log(`\n[TRACE] Iteration ${event.current}/${event.max}`);
          break;
        case "llm_call":
          log.raw.log(`[TRACE] Calling LLM with ${event.messageCount} messages`);
          break;
        case "llm_response":
          if (traceFull && event.content !== undefined) {
            log.raw.log(
              `[TRACE] LLM responded (${event.length} chars):\n${event.content}`
            );
          } else {
            log.raw.log(
              `[TRACE] LLM responded (${event.length} chars): "${event.truncated}..."`
            );
          }
          break;
        case "tool_call":
          log.raw.log(`[TRACE] Tool call: ${event.toolName}`);
          log.raw.log(`[TRACE] Args: ${JSON.stringify(event.args, null, 2)}`);
          break;
        case "tool_result":
          if (event.success) {
            const raw = traceFull && event.display !== undefined
              ? event.display
              : typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result);
            const truncated = traceFull
              ? raw
              : raw.length > 200
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

  const toolJsonOutput = outputFormat === "tool";
  const onToolDisplay = !traceMode && outputFormat === "text"
    ? (event: ToolDisplay) => {
      if (event.toolName === "ask_user") return;
      const label = event.success ? "Tool Result" : "Tool Error";
      log.raw.log(`\n[${label}] ${event.toolName}\n${event.content}\n`);
    }
    : toolJsonOutput
    ? (event: ToolDisplay) => {
      log.raw.log(
        JSON.stringify({
          type: "tool_result",
          toolName: event.toolName,
          success: event.success,
          content: event.content,
        }),
      );
    }
    : undefined;

  const verboseOutput = outputFormat === "text";
  if (verboseOutput) {
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
        autoApprove: noInputMode, // Safety layer auto-approves L0; prompts for L1/L2
        maxToolCalls: maxCalls,
        groundingMode: profile.groundingMode,
        policy,
        onTrace, // Pass trace callback
        onToolDisplay,
        autoWeb,
        noInput: noInputMode,
        delegate,
        toolAllowlist,
        requireToolCalls,
        requestHints,
        planning: planningMode === "off"
          ? undefined
          : {
            mode: planningMode,
            maxSteps: planningMaxSteps,
            requireStepMarkers,
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

    if (toolJsonOutput) {
      log.raw.log(JSON.stringify({ type: "final", content: result }));
    } else {
      const formatted = await formatAnswer(result, {
        format: outputFormat,
        model,
        useModel: !fixturePath,
      });
      if (verboseOutput) {
        const stats = session.context.getStats();
        const suppressFinal = stats.toolMessages > 0 &&
          shouldSuppressFinalResponse(formatted);
        if (!suppressFinal) {
          // Display result
          log.raw.log(`\nResult:\n${formatted}\n`);
          // Show stats
          log.raw.log(
            `[Stats: ${stats.messageCount} messages, ${stats.estimatedTokens} tokens, ${stats.toolMessages} tool messages]`,
          );
        }
      } else {
        log.raw.log(`${formatted}\n`);
      }
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
