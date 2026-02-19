/**
 * Ask Command - Interactive AI Agent (CLI entry point)
 *
 * Thin CLI wrapper over the shared agent runner.
 * All agent logic lives in agent-runner.ts (SSOT).
 */

import { log } from "../../api/log.ts";
import { config } from "../../api/config.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";
import { readSingleKey } from "../utils/input.ts";
import { ValidationError } from "../../../common/error.ts";
import { isObjectValue, truncate } from "../../../common/utils.ts";
import { shouldSuppressFinalResponse } from "../../agent/model-compat.ts";
import { ensureAgentReady, runAgentQuery } from "../../agent/agent-runner.ts";
import { DEFAULT_TOOL_DENYLIST } from "../../agent/constants.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { isOllamaCloudModel } from "../../providers/ollama/cloud.ts";
import { parseModelString } from "../../providers/registry.ts";
import type { AgentUIEvent, TraceEvent } from "../../agent/orchestrator.ts";

// MARK: - Paid Provider Consent

/** Providers that charge per API call — require explicit user consent */
const PAID_PROVIDERS = new Set(["openai", "anthropic", "google"]);

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

/** Extract provider prefix from a model ID like "openai/gpt-4o" */
export function extractProvider(modelId: string): string | null {
  const [provider] = parseModelString(modelId);
  return provider;
}

/** Check if a model ID uses a paid provider */
export function isPaidProvider(modelId: string): boolean {
  const provider = extractProvider(modelId);
  return provider !== null && PAID_PROVIDERS.has(provider);
}

/** Check if the user has already approved a provider */
export function isProviderApproved(modelId: string): boolean {
  const provider = extractProvider(modelId);
  if (!provider) return true;
  const approved = config.snapshot.approvedProviders ?? [];
  return approved.includes(provider);
}

/** Prompt user for one-time consent to use a paid provider, save to config */
export async function confirmPaidProviderConsent(modelId: string): Promise<boolean> {
  const provider = extractProvider(modelId);
  if (!provider) return true;

  const label = PROVIDER_LABELS[provider] ?? provider;

  if (!getPlatform().terminal.stdin.isTerminal()) {
    return false; // Non-interactive: deny by default
  }

  log.raw.log(
    `\nThis model uses your ${label} API key.` +
    `\nAPI calls will be charged to your ${label} account.`
  );
  log.raw.log("Continue? [y/N] ");

  const key = await readSingleKey();
  log.raw.log("");

  if (key !== "y") {
    return false;
  }

  // Save consent — never ask again for this provider
  const approved = config.snapshot.approvedProviders ?? [];
  if (!approved.includes(provider)) {
    await config.set("approvedProviders", [...approved, provider]);
  }
  return true;
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
  hlvm ask --model openai/gpt-4o "summarize this project"
  hlvm ask --model anthropic/claude-sonnet-4-5-20250929 "list files"
  hlvm ask --fresh "hello"               # Start fresh (no prior session context)

OPTIONS:
  --help, -h                   Show this help message
  --verbose                    Show agent header, tool labels, stats, and trace output
  --usage                      Show token usage summary after execution
  --model <provider/model>     Use a specific AI model (e.g., openai/gpt-4o, anthropic/claude-sonnet-4-5-20250929)
  --fresh                      Start a fresh session (no prior context)
`);
}

function createTraceCallback(
  verbose: boolean,
): ((event: TraceEvent) => void) | undefined {
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
        log.raw.log(
          `[TRACE] LLM responded (${event.length} chars): "${event.truncated}..."`,
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
          log.raw.log(`[TRACE] Result: SUCCESS`);
          log.raw.log(`[TRACE] ${truncate(raw, 200)}`);
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
          `[TRACE] Grounding ${
            event.grounded ? "ok" : "warn"
          } mode=${event.mode} retry=${event.retry}/${event.maxRetry}`,
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
  };
}

function isOllamaCloudModelId(modelId: string): boolean {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex <= 0) return false;
  const provider = modelId.slice(0, slashIndex).toLowerCase();
  if (provider !== "ollama") return false;
  const modelName = modelId.slice(slashIndex + 1);
  return isOllamaCloudModel(modelName);
}

const DEFAULT_TOOL_OUTPUT_MAX_LINES = 18;
const DEFAULT_TOOL_OUTPUT_MAX_CHARS = 1000;
const OLLAMA_SETTINGS_URL = "https://ollama.com/settings";

interface FormattedToolOutput {
  text: string;
  truncated: boolean;
}

export function formatToolOutputForDefaultMode(
  toolName: string,
  content: string,
): FormattedToolOutput {
  const normalized = content.trim();
  if (!normalized) return { text: "", truncated: false };

  const looksLikeMarkup = /<(html|head|body|script|style|div|span|meta|link)\b/i
    .test(normalized);
  if (looksLikeMarkup && normalized.length > 600) {
    return {
      text: `[${toolName}] Completed.`,
      truncated: true,
    };
  }

  const looksLikeJson = normalized.startsWith("{") || normalized.startsWith("[");
  if (looksLikeJson && normalized.length > 320) {
    return { text: `[${toolName}] Completed.`, truncated: true };
  }

  const lines = normalized.split("\n");
  if (lines.length > 6 || normalized.length > 320) {
    return { text: `[${toolName}] Completed.`, truncated: true };
  }

  const trimmedLines = lines
    .slice(0, DEFAULT_TOOL_OUTPUT_MAX_LINES)
    .map((line) => truncate(line, 220));
  const compact = trimmedLines.join("\n");
  const text = truncate(compact, DEFAULT_TOOL_OUTPUT_MAX_CHARS);
  const truncated = lines.length > DEFAULT_TOOL_OUTPUT_MAX_LINES ||
    text.length < normalized.length;
  return { text, truncated };
}

export interface CloudAuthRecoveryState {
  executionError: unknown;
  resolvedModel: string;
  streamedTokens: boolean;
}

export interface CloudAuthRecoveryDeps {
  isCloudModelId: (modelId: string) => boolean;
  isInteractiveTerminal: () => boolean;
  isAuthErrorMessage: (message: string) => boolean;
  runSignin: () => Promise<boolean>;
  verifyCloudAccess: (modelId: string) => Promise<boolean>;
  executeQuery: () => Promise<void>;
  logRaw: (message: string) => void;
  writeRaw: (message: string) => void;
}

export interface CloudAuthRecoveryResult {
  handled: boolean;
  recovered: boolean;
  executionError: unknown;
  streamedTokens: boolean;
}

export async function attemptCloudAuthRecovery(
  state: CloudAuthRecoveryState,
  deps: CloudAuthRecoveryDeps,
): Promise<CloudAuthRecoveryResult> {
  let { executionError, streamedTokens } = state;
  const { resolvedModel } = state;

  if (!(executionError instanceof Error)) {
    return { handled: false, recovered: false, executionError, streamedTokens };
  }
  if (!deps.isCloudModelId(resolvedModel)) {
    return { handled: false, recovered: false, executionError, streamedTokens };
  }
  if (!deps.isInteractiveTerminal()) {
    return { handled: false, recovered: false, executionError, streamedTokens };
  }
  if (!deps.isAuthErrorMessage(executionError.message)) {
    return { handled: false, recovered: false, executionError, streamedTokens };
  }

  if (streamedTokens) {
    deps.writeRaw("\n");
    streamedTokens = false;
  }

  const signedIn = await deps.runSignin();
  if (!signedIn) {
    deps.logRaw("Sign-in failed. Run `ollama signin` and retry.");
    deps.logRaw(`Cloud account/usage: ${OLLAMA_SETTINGS_URL}`);
    return { handled: true, recovered: false, executionError, streamedTokens };
  }

  const verified = await deps.verifyCloudAccess(resolvedModel);
  if (!verified) {
    deps.logRaw("Cloud sign-in not completed. Open the URL above, then retry.");
    deps.logRaw(`Cloud account/usage: ${OLLAMA_SETTINGS_URL}`);
    return { handled: true, recovered: false, executionError, streamedTokens };
  }

  deps.logRaw("Retrying query...\n");
  try {
    await deps.executeQuery();
    return {
      handled: true,
      recovered: true,
      executionError: null,
      streamedTokens,
    };
  } catch (retryError) {
    executionError = retryError;
    return { handled: true, recovered: false, executionError, streamedTokens };
  }
}

export async function askCommand(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    showAskHelp();
    return;
  }

  let query = "";
  let verbose = false;
  let showUsage = false;
  let freshSession = false;
  let modelOverride: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--usage") {
      showUsage = true;
    } else if (arg === "--fresh") {
      freshSession = true;
    } else if (arg === "--model") {
      i++;
      if (i >= args.length) {
        throw new ValidationError(
          "--model requires a value (e.g., openai/gpt-4o)",
          "ask",
        );
      }
      modelOverride = args[i];
    } else if (!arg.startsWith("--")) {
      query += (query ? " " : "") + arg;
    } else {
      throw new ValidationError(`Unknown option: ${arg}`, "ask");
    }
  }

  if (!query) {
    throw new ValidationError(
      'Missing query. Usage: hlvm ask "<query>"',
      "ask",
    );
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

  const { getConfiguredModel } = await import(
    "../../../common/ai-default-model.ts"
  );
  const resolvedModel = modelOverride ?? getConfiguredModel();
  const model = modelOverride ?? undefined;
  const rawContextWindow = isObjectValue(config.snapshot)
    ? config.snapshot.contextWindow
    : undefined;
  const contextWindow = typeof rawContextWindow === "number" &&
      Number.isInteger(rawContextWindow) && rawContextWindow > 0
    ? rawContextWindow
    : undefined;

  // Paid provider consent gate
  if (isPaidProvider(resolvedModel) && !isProviderApproved(resolvedModel)) {
    const consented = await confirmPaidProviderConsent(resolvedModel);
    if (!consented) {
      log.raw.log("Aborted. Use a free model (e.g., Ollama) or re-run to approve.");
      return;
    }
  }

  try {
    await ensureAgentReady(
      resolvedModel,
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
  let thinkingShown = false;
  let toolInProgress = false;

  const onToken = (text: string) => {
    if (thinkingShown) {
      log.raw.write(`\r\x1b[K`);
      thinkingShown = false;
    }
    streamedTokens = true;
    log.raw.write(text);
  };

  const onAgentEvent = (event: AgentUIEvent) => {
    if (verbose) {
      // Verbose mode: keep existing detailed output style
      switch (event.type) {
        case "tool_end":
          if (event.name === "ask_user") return;
          if (streamedTokens) { log.raw.write("\n"); streamedTokens = false; }
          {
            const label = event.success ? "Tool Result" : "Tool Error";
            log.raw.log(`\n[${label}] ${event.name}\n${event.content}\n`);
          }
          break;
      }
      return;
    }
    // Default mode: compact progress display
    switch (event.type) {
      case "thinking":
        if (!streamedTokens) {
          log.raw.write(`\r\x1b[K\x1b[2m\u2847 Thinking\u2026\x1b[0m`);
          thinkingShown = true;
        }
        break;
      case "tool_start":
        if (thinkingShown) { log.raw.write(`\r\x1b[K`); thinkingShown = false; }
        if (streamedTokens) { log.raw.write("\n"); streamedTokens = false; }
        log.raw.write(`  \x1b[2m\u2847 ${event.name} ${truncate(event.argsSummary, 60)}\x1b[0m`);
        toolInProgress = true;
        break;
      case "tool_end": {
        if (event.name === "ask_user") return;
        if (toolInProgress) {
          const icon = event.success ? "\x1b[32m\u2713\x1b[0m" : "\x1b[31m\u2717\x1b[0m";
          const dur = event.durationMs ? ` \x1b[2m(${(event.durationMs / 1000).toFixed(1)}s)\x1b[0m` : "";
          const summary = event.success
            ? truncate(event.content, 40)
            : `Error: ${truncate(event.content, 40)}`;
          log.raw.write(`\r\x1b[K  ${icon} ${event.name} ${event.argsSummary} \x1b[2m\u2192\x1b[0m ${summary}${dur}\n`);
          toolInProgress = false;
        } else {
          // tool_end without tool_start (shouldn't happen, but handle gracefully)
          if (streamedTokens) { log.raw.write("\n"); streamedTokens = false; }
          if (!event.success) {
            log.raw.log(`[${event.name}] Error: ${truncate(event.content.trim(), 300)}\n`);
          } else {
            const formatted = formatToolOutputForDefaultMode(event.name, event.content);
            if (formatted.text) log.raw.log(`${formatted.text}\n`);
          }
        }
        break;
      }
      case "turn_stats": {
        const dur = event.durationMs ? `${(event.durationMs / 1000).toFixed(1)}s` : "";
        log.raw.log(`\n\x1b[2m\u2500\u2500\u2500 ${event.toolCount} tool${event.toolCount !== 1 ? "s" : ""} \u00b7 ${dur} \u2500\u2500\u2500\x1b[0m\n`);
        break;
      }
    }
  };

  if (verbose) {
    log.raw.log(`\nAgent: ${query}\n`);
  }

  const executeQuery = async () => {
    const result = await runAgentQuery({
      query,
      model,
      contextWindow,
      skipSessionHistory: freshSession,
      callbacks: {
        onToken,
        onAgentEvent,
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
    } else if (
      !streamedTokens && result.stats.toolMessages === 0 && result.text.trim()
    ) {
      log.raw.log(`${result.text}\n`);
    }

    if (verbose) {
      log.raw.log(
        `[Stats: ${result.stats.messageCount} messages, ${result.stats.estimatedTokens} tokens, ${result.stats.toolMessages} tool messages]`,
      );
    }

    if (showUsage && result.stats.usage) {
      const u = result.stats.usage;
      log.raw.log(
        `[Usage] ${u.inputTokens} input + ${u.outputTokens} output = ${u.totalTokens} tokens (${u.source})`,
      );
    }
  };

  let executionError: unknown = null;
  try {
    await executeQuery();
    return;
  } catch (error) {
    executionError = error;
  }

  const {
    isOllamaAuthErrorMessage,
    runOllamaSignin,
    verifyOllamaCloudModelAccess,
  } = await import(
    "./first-run-setup.ts"
  );
  const recovery = await attemptCloudAuthRecovery(
    { executionError, resolvedModel, streamedTokens },
    {
      isCloudModelId: isOllamaCloudModelId,
      isInteractiveTerminal: () => getPlatform().terminal.stdin.isTerminal(),
      isAuthErrorMessage: isOllamaAuthErrorMessage,
      runSignin: runOllamaSignin,
      verifyCloudAccess: verifyOllamaCloudModelAccess,
      executeQuery,
      logRaw: (message: string) => log.raw.log(message),
      writeRaw: (message: string) => log.raw.write(message),
    },
  );
  streamedTokens = recovery.streamedTokens;
  executionError = recovery.executionError;
  if (recovery.recovered) return;

  if (executionError instanceof Error) {
    log.error(`Agent error: ${executionError.message}`);
    throw executionError;
  }
  throw executionError;
}
