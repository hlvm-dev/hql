/**
 * Ask Command - Interactive AI Agent
 *
 * Allows users to ask questions and execute tasks using the agent system.
 * Entry point to the agent orchestrator pipeline.
 */

import { log } from "../../api/log.ts";
import { initializeRuntime } from "../../../common/runtime-initializer.ts";
import { ValidationError } from "../../../common/error.ts";
import { ContextManager } from "../../agent/context.ts";
import { runReActLoop, type TraceEvent } from "../../agent/orchestrator.ts";
import { createAgentLLM, generateSystemPrompt } from "../../agent/llm-integration.ts";
import { createFixtureLLM, loadLlmFixture } from "../../agent/llm-fixtures.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { DEFAULT_MAX_TOOL_CALLS, ENGINE_PROFILES } from "../../agent/constants.ts";
import { loadAgentPolicy } from "../../agent/policy.ts";
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
`);
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
  let fixturePath: string | undefined;

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

  // Use default model if no model specified (unless fixture is used)
  if (!fixturePath) {
    if (!model) {
      model = DEFAULT_MODEL_ID;
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
    }
  } else if (model) {
    log.warn("Ignoring --model because --llm-fixture is set");
  }

  const profile = ENGINE_PROFILES[engineStrict ? "strict" : "normal"];
  if (!maxCallsProvided) {
    maxCalls = profile.maxToolCalls;
  }

  // Setup context with system prompt
  const contextConfig = {
    ...profile.context,
  };
  if (failOnContextOverflow) {
    contextConfig.overflowStrategy = "fail";
  }
  const context = new ContextManager(contextConfig);
  context.addMessage({
    role: "system",
    content: generateSystemPrompt(),
  });

  // Create LLM function (fixture or live model)
  const llm = fixturePath
    ? createFixtureLLM(await loadLlmFixture(fixturePath))
    : createAgentLLM({ model });

  // Get workspace
  const workspace = getPlatform().process.cwd();
  const policy = await loadAgentPolicy(workspace);

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

  // Show what we're doing
  log.raw.log(`\nAgent: ${query}\n`);

  try {
    // Run agent loop
    const result = await runReActLoop(
      query,
      {
        workspace,
        context,
        autoApprove: false, // Safety layer auto-approves L0; prompts for L1/L2
        maxToolCalls: maxCalls,
        groundingMode: profile.groundingMode,
        policy,
        onTrace, // Pass trace callback
      },
      llm,
    );

    // Display result
    log.raw.log(`\nResult:\n${result}\n`);

    // Show stats
    const stats = context.getStats();
    log.raw.log(
      `[Stats: ${stats.messageCount} messages, ${stats.estimatedTokens} tokens, ${stats.toolMessages} tool messages]`,
    );
  } catch (error) {
    if (error instanceof Error) {
      log.error(`Agent error: ${error.message}`);
      throw error;
    }
    throw error;
  }
}
