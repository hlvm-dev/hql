/**
 * Ask Command - Interactive AI Agent (CLI entry point)
 *
 * Thin CLI wrapper over the shared agent runner.
 * All agent logic lives in agent-runner.ts (SSOT).
 */

import { log } from "../../api/log.ts";
import { config } from "../../api/config.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";
import { ValidationError } from "../../../common/error.ts";
import { truncate } from "../../../common/utils.ts";
import { shouldSuppressFinalResponse } from "../../agent/model-compat.ts";
import { ensureAgentReady, runAgentQuery } from "../../agent/agent-runner.ts";
import { DEFAULT_TOOL_DENYLIST } from "../../agent/constants.ts";
import { getPlatform } from "../../../platform/platform.ts";
import type { TraceEvent, ToolDisplay } from "../../agent/orchestrator.ts";

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
  hlvm ask --model openai/gpt-4o "summarize this project"
  hlvm ask --model anthropic/claude-sonnet-4-5-20250929 "list files"

OPTIONS:
  --help, -h                   Show this help message
  --verbose                    Show agent header, tool labels, stats, and trace output
  --model <provider/model>     Use a specific AI model (e.g., openai/gpt-4o, anthropic/claude-sonnet-4-5-20250929)
`);
}

function createTraceCallback(verbose: boolean): ((event: TraceEvent) => void) | undefined {
  if (!verbose) return undefined;
  return (event: TraceEvent) => {
    switch (event.type) {
      case "iteration":
        log.raw.log(`\n[TRACE] Iteration ${event.current}/${event.max}`);
        break;
      case "llm_call":
        log.raw.log(`[TRACE] Calling LLM with ${event.messageCount} messages`);
        break;
      case "llm_response":
        log.raw.log(`[TRACE] LLM responded (${event.length} chars): "${event.truncated}..."`);
        break;
      case "tool_call":
        log.raw.log(`[TRACE] Tool call: ${event.toolName}`);
        log.raw.log(`[TRACE] Args: ${JSON.stringify(event.args, null, 2)}`);
        break;
      case "tool_result":
        if (event.success) {
          const raw = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
          log.raw.log(`[TRACE] Result: SUCCESS`);
          log.raw.log(`[TRACE] ${truncate(raw, 200)}`);
        } else {
          log.raw.log(`[TRACE] Result: FAILED - ${event.error}`);
        }
        break;
      case "llm_retry":
        log.raw.log(
          `[TRACE] LLM retry ${event.attempt}/${event.max} (${event.class})${event.retryable ? "" : " [non-retryable]"}: ${event.error}`,
        );
        break;
      case "grounding_check":
        log.raw.log(`[TRACE] Grounding ${event.grounded ? "ok" : "warn"} mode=${event.mode} retry=${event.retry}/${event.maxRetry}`);
        if (event.warnings.length > 0) {
          for (const warning of event.warnings) {
            log.raw.log(`[TRACE] Grounding warning: ${warning}`);
          }
        }
        break;
      case "rate_limit":
        log.raw.log(`[TRACE] Rate limit (${event.target}): ${event.used}/${event.maxCalls} per ${event.windowMs}ms (reset ${event.resetMs}ms)`);
        break;
      case "resource_limit":
        log.raw.log(`[TRACE] Resource limit (${event.kind}): ${event.used} > ${event.limit}`);
        break;
      case "llm_usage":
        log.raw.log(`[TRACE] LLM usage: ${event.usage.totalTokens} tokens (${event.usage.source})`);
        break;
      case "plan_created":
        log.raw.log(`[TRACE] Plan created with ${event.plan.steps.length} steps`);
        break;
      case "plan_step":
        log.raw.log(`[TRACE] Plan step complete: ${event.stepId} (index ${event.index})`);
        break;
      case "context_overflow":
        log.raw.log(`[TRACE] Context overflow: ${event.estimatedTokens} > ${event.maxTokens}`);
        break;
    }
  };
}

export async function askCommand(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    showAskHelp();
    return;
  }

  let query = "";
  let verbose = false;
  let modelOverride: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--model") {
      i++;
      if (i >= args.length) {
        throw new ValidationError("--model requires a value (e.g., openai/gpt-4o)", "ask");
      }
      modelOverride = args[i];
    } else if (!arg.startsWith("--")) {
      query += (query ? " " : "") + arg;
    } else {
      throw new ValidationError(`Unknown option: ${arg}`, "ask");
    }
  }

  if (!query) {
    throw new ValidationError("Missing query. Usage: hlvm ask \"<query>\"", "ask");
  }

  // First-run gate: no model explicitly chosen + not yet configured + interactive terminal
  // HLVM_FORCE_SETUP=1 bypasses the terminal check (for E2E testing)
  const forceSetup = getPlatform().env.get("HLVM_FORCE_SETUP") === "1";
  if (
    !modelOverride &&
    !config.snapshot.modelConfigured &&
    (getPlatform().terminal.stdin.isTerminal() || forceSetup)
  ) {
    const { runFirstTimeSetup } = await import("./first-run-setup.ts");
    const result = await runFirstTimeSetup();
    if (result) {
      modelOverride = result;
    }
  }

  const model = modelOverride ?? undefined;
  try {
    await ensureAgentReady(
      model ?? (await import("../../../common/ai-default-model.ts")).getConfiguredModel(),
      (message) => log.raw.log(message),
    );
  } catch (error) {
    if (error instanceof Error) {
      log.error(`Failed to setup default model: ${error.message}`);
      log.raw.log("\nTip: Make sure Ollama is running.");
    }
    throw error;
  }

  let streamedTokens = false;

  const onToken = (text: string) => {
    streamedTokens = true;
    log.raw.write(text);
  };

  const onToolDisplay = (event: ToolDisplay) => {
    if (event.toolName === "ask_user") return;
    if (streamedTokens) {
      log.raw.write("\n");
      streamedTokens = false;
    }
    if (verbose) {
      const label = event.success ? "Tool Result" : "Tool Error";
      log.raw.log(`\n[${label}] ${event.toolName}\n${event.content}\n`);
    } else {
      log.raw.log(`${event.content}\n`);
    }
  };

  if (verbose) {
    log.raw.log(`\nAgent: ${query}\n`);
  }

  try {
    const result = await runAgentQuery({
      query,
      model,
      callbacks: {
        onToken,
        onToolDisplay,
        onTrace: createTraceCallback(verbose),
      },
      toolDenylist: [...DEFAULT_TOOL_DENYLIST],
    });

    if (streamedTokens) {
      log.raw.write("\n");
    }

    if (verbose) {
      if (!shouldSuppressFinalResponse(result.text)) {
        log.raw.log(`\nResult:\n${result.text}\n`);
      }
    } else if (!streamedTokens && result.stats.toolMessages === 0 && result.text.trim()) {
      log.raw.log(`${result.text}\n`);
    }

    if (verbose) {
      log.raw.log(
        `[Stats: ${result.stats.messageCount} messages, ${result.stats.estimatedTokens} tokens, ${result.stats.toolMessages} tool messages]`,
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      log.error(`Agent error: ${error.message}`);
      throw error;
    }
    throw error;
  }
}
