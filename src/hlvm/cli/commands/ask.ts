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
  type TraceEvent,
} from "../../agent/orchestrator.ts";
import { createAgentSession } from "../../agent/session.ts";
import type { AgentPolicy } from "../../agent/policy.ts";
import {
  formatAnswer,
  getFormatInstruction,
  type OutputFormat,
} from "../../agent/answer-format.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { DEFAULT_MAX_TOOL_CALLS, ENGINE_PROFILES } from "../../agent/constants.ts";
import {
  ensureDefaultModelInstalled,
} from "../../../common/ai-default-model.ts";
import { DEFAULT_MODEL_ID } from "../../../common/config/types.ts";

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
  --fail-on-context-overflow   Fail instead of trimming when context exceeds max tokens
  --engine-strict              Deterministic profile (strict grounding, fail on overflow, lower context budget)
  --no-auto-web                Disable automatic web tool routing (default: enabled)
  --no-input                   Non-interactive: auto-approve tools, disallow ask_user prompts
  --format <text|raw|json>     Output format (default: text)
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
  let failOnContextOverflow = false;
  let engineStrict = false;
  let noInput = false;
  let outputFormat: OutputFormat = "text";
  let fixturePath: string | undefined;
  let autoWeb = true;

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
    } else if (arg === "--fail-on-context-overflow") {
      failOnContextOverflow = true;
    } else if (arg === "--engine-strict") {
      engineStrict = true;
    } else if (arg === "--no-auto-web") {
      autoWeb = false;
    } else if (arg === "--no-input") {
      noInput = true;
    } else if (arg === "--format") {
      const value = args[++i];
      if (!value) {
        throw new ValidationError("Missing format value. Usage: --format <text|raw|json>");
      }
      if (value !== "text" && value !== "raw" && value !== "json") {
        throw new ValidationError("Invalid format. Use: text, raw, or json.");
      }
      outputFormat = value;
    } else if (!arg.startsWith("--")) {
      // Accumulate query parts (in case user forgets quotes)
      query += (query ? " " : "") + arg;
    }
  }

  if (!query) {
    throw new ValidationError("Missing query. Usage: hlvm ask \"<query>\"");
  }

  // Initialize runtime with AI
  await initializeRuntime({ stdlib: false, cache: false });

  const autoWebAnswer = autoWeb && shouldAutoAnswerWebRequest(query);

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

  // Get workspace
  const workspace = getPlatform().process.cwd();

  const session = await createAgentSession({
    workspace,
    model,
    fixturePath,
    engineProfile: engineStrict ? "strict" : "normal",
    failOnContextOverflow,
    autoWeb,
  });

  if (noInput) {
    session.context.addMessage({
      role: "system",
      content:
        "NO-INPUT MODE: Do not request user input or call ask_user. Proceed autonomously and use tools directly when needed.",
    });
  }

  const formatInstruction = getFormatInstruction(outputFormat);
  if (formatInstruction) {
    session.context.addMessage({
      role: "system",
      content: formatInstruction,
    });
  }

  const policy = noInput ? buildNoInputPolicy(session.policy) : session.policy;

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
            const resultStr = typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result);
            const truncated = resultStr.length > 200
              ? resultStr.substring(0, 200) + "..."
              : resultStr;
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
        case "context_overflow":
          log.raw.log(
            `[TRACE] Context overflow: ${event.estimatedTokens} > ${event.maxTokens}`,
          );
          break;
      }
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
        autoApprove: noInput, // Safety layer auto-approves L0; prompts for L1/L2
        maxToolCalls: maxCalls,
        groundingMode: profile.groundingMode,
        policy,
        onTrace, // Pass trace callback
        autoWeb,
      },
      session.llm,
    );

    const formatted = await formatAnswer(result, {
      format: outputFormat,
      model,
      useModel: !fixturePath,
    });
    if (verboseOutput) {
      // Display result
      log.raw.log(`\nResult:\n${formatted}\n`);

      // Show stats
      const stats = session.context.getStats();
      log.raw.log(
        `[Stats: ${stats.messageCount} messages, ${stats.estimatedTokens} tokens, ${stats.toolMessages} tool messages]`,
      );
    } else {
      log.raw.log(`${formatted}\n`);
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
