/**
 * Ask Command - Interactive AI Agent (CLI entry point)
 *
 * CLI shell over the shared HLVM runtime host.
 * Agent execution is routed through the local host boundary.
 */

import { log } from "../../api/log.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";
import { readLineInput, readSingleKey } from "../utils/input.ts";
import { ValidationError } from "../../../common/error.ts";
import { isOllamaAuthErrorMessage } from "../../../common/ollama-auth.ts";
import { truncate } from "../../../common/utils.ts";
import { shouldSuppressFinalResponse } from "../../agent/model-compat.ts";
import { classifyError, getRecoveryHint } from "../../agent/error-taxonomy.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { isOllamaCloudModel } from "../../providers/ollama/cloud.ts";
import {
  extractProvider,
  isPaidProvider,
} from "../../providers/approval.ts";
import type {
  AgentUIEvent,
  FinalResponseMeta,
  TraceEvent,
} from "../../agent/orchestrator.ts";
import type { ChatResultStats } from "../../runtime/chat-protocol.ts";
import type { PermissionMode } from "../../../common/config/types.ts";
import { OLLAMA_SETTINGS_URL } from "./shared.ts";
import { runAgentQueryViaHost } from "../../runtime/host-client.ts";
import { createRuntimeModelConfigManager } from "../../runtime/model-config.ts";
import { confirmPaidProviderConsent } from "../utils/provider-consent.ts";
import type {
  DelegateTranscriptEvent,
  DelegateTranscriptSnapshot,
} from "../../agent/delegate-transcript.ts";

// MARK: - Paid Provider Consent

export {
  extractProvider,
  isPaidProvider,
} from "../../providers/approval.ts";
export { confirmPaidProviderConsent } from "../utils/provider-consent.ts";

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
  hlvm ask --json "count test files"     # Stream NDJSON events for automation
  hlvm ask --model openai/gpt-4o "summarize this project"
  hlvm ask --model anthropic/claude-sonnet-4-5-20250929 "list files"
  hlvm ask --fresh "hello"               # Start fresh (no prior session context)

OPTIONS:
  --help, -h                   Show this help message
  --verbose                    Show agent header, tool labels, stats, and trace output
  --json                       Emit newline-delimited JSON events
  --usage                      Show token usage summary after execution
  --model <provider/model>     Use a specific AI model (e.g., openai/gpt-4o, anthropic/claude-sonnet-4-5-20250929)
  --fresh                      Start a fresh session (no prior context)
  --auto-edit                  Auto-approve file reads and writes; only confirm destructive ops
  --dangerously-skip-permissions  Skip ALL permission prompts (like Claude Code --dangerously-skip-permissions)
`);
}

async function promptRuntimeInteraction(event: {
  mode: "permission" | "question";
  toolName?: string;
  toolArgs?: string;
  question?: string;
}): Promise<{ approved?: boolean; userInput?: string }> {
  if (!getPlatform().terminal.stdin.isTerminal()) {
    return event.mode === "question"
      ? { approved: false, userInput: "" }
      : { approved: false };
  }

  if (event.mode === "question") {
    log.raw.log(`\n${event.question ?? "Input requested"}`);
    log.raw.write("> ");
    const userInput = await readLineInput();
    return { approved: true, userInput };
  }

  log.raw.log(`\n[Tool: ${event.toolName ?? "unknown"}]`);
  if (event.toolArgs?.trim()) {
    log.raw.log(event.toolArgs);
  }
  log.raw.log("\nAllow? [y/N] ");
  const key = await readSingleKey();
  log.raw.log("");
  return { approved: key === "y" };
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

export function summarizeToolEventForDefaultMode(
  toolName: string,
  summary?: string,
  content?: string,
): string {
  const candidate = summary?.trim();
  if (candidate) {
    const firstLine = candidate.split("\n").map((line) => line.trim()).find(Boolean) ?? candidate;
    return truncate(firstLine.replace(/\s+/g, " "), 80);
  }
  const formatted = formatToolOutputForDefaultMode(toolName, content ?? "");
  return formatted.text;
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

export type AskJsonEvent =
  | { type: "token"; text: string }
  | { type: "agent_event"; event: AgentUIEvent }
  | {
    type: "final";
    text: string;
    stats: ChatResultStats;
    meta?: FinalResponseMeta;
  }
  | {
    type: "error";
    message: string;
    errorClass: string;
    retryable: boolean;
  };

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
  let jsonOutput = false;
  let showUsage = false;
  let freshSession = false;
  let modelOverride: string | undefined;
  let permissionModeOverride: PermissionMode | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--usage") {
      showUsage = true;
    } else if (arg === "--fresh") {
      freshSession = true;
    } else if (arg === "--auto-edit") {
      permissionModeOverride = "auto-edit";
    } else if (arg === "--dangerously-skip-permissions") {
      permissionModeOverride = "yolo";
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

  if (jsonOutput && verbose) {
    throw new ValidationError(
      "--json cannot be combined with --verbose",
      "ask",
    );
  }

  const fixturePath = getPlatform().env.get("HLVM_ASK_FIXTURE_PATH")?.trim() ||
    undefined;
  if (fixturePath) {
    freshSession = true;
  }

  const runtimeModelConfig = await createRuntimeModelConfigManager();

  const forceSetup = getPlatform().env.get("HLVM_FORCE_SETUP") === "1";
  if (!fixturePath && !modelOverride) {
    const initialModel = await runtimeModelConfig.ensureInitialModelConfigured({
      allowFirstRunSetup: getPlatform().terminal.stdin.isTerminal() || forceSetup,
      runFirstTimeSetup: async () => {
        const { runFirstTimeSetup } = await import("./first-run-setup.ts");
        return await runFirstTimeSetup();
      },
    });
    if (initialModel.modelConfigured) {
      modelOverride = initialModel.model;
    }
  }

  let resolvedModel = modelOverride ?? runtimeModelConfig.getConfiguredModel();
  if (!fixturePath) {
    const normalized = await runtimeModelConfig.resolveCompatibleClaudeCodeModel(
      resolvedModel,
    );
    if (normalized !== resolvedModel) {
      resolvedModel = normalized;
      if (modelOverride) {
        modelOverride = normalized;
      }
    }
  }

  const model = modelOverride ?? undefined;
  const contextWindow = runtimeModelConfig.getContextWindow();

  // Paid provider consent gate
  if (
    !fixturePath &&
    isPaidProvider(resolvedModel) &&
    !runtimeModelConfig.isProviderApproved(resolvedModel)
  ) {
    const consented = await confirmPaidProviderConsent(resolvedModel);
    if (!consented) {
      log.raw.log("Aborted. Use a free model (e.g., Ollama) or re-run to approve.");
      return;
    }
  }

  let streamedTokens = false;
  let thinkingShown = false;
  let toolInProgress = false;
  let activePlan: Extract<AgentUIEvent, { type: "plan_created" }>["plan"] | undefined;
  let finalMeta: FinalResponseMeta | undefined;

  const emitJson = (event: AskJsonEvent): void => {
    log.raw.log(JSON.stringify(event));
  };

  const onToken = (text: string) => {
    if (jsonOutput) {
      emitJson({ type: "token", text });
      return;
    }
    if (thinkingShown) {
      log.raw.write(`\r\x1b[K`);
      thinkingShown = false;
    }
    streamedTokens = true;
    log.raw.write(text);
  };

  const onAgentEvent = (event: AgentUIEvent) => {
    if (jsonOutput) {
      emitJson({ type: "agent_event", event });
      return;
    }
    if (verbose) {
      // Verbose mode: keep existing detailed output style
      switch (event.type) {
        case "tool_end":
          if (event.name === "ask_user" || event.name === "delegate_agent") return;
          if (streamedTokens) { log.raw.write("\n"); streamedTokens = false; }
          {
            const label = event.success ? "Tool Result" : "Tool Error";
            log.raw.log(`\n[${label}] ${event.name}\n${event.content}\n`);
          }
          break;
        case "delegate_start":
          if (streamedTokens) { log.raw.write("\n"); streamedTokens = false; }
          log.raw.log(`\n[Delegate] ${event.agent}\n${event.task}\n`);
          break;
        case "delegate_end": {
          if (streamedTokens) { log.raw.write("\n"); streamedTokens = false; }
          const label = event.success ? "Delegate Result" : "Delegate Error";
          const body = event.success
            ? event.summary ?? "Delegation complete."
            : event.error ?? "Delegation failed.";
          log.raw.log(`\n[${label}] ${event.agent}\n${body}\n`);
          const snapshotText = formatDelegateSnapshotForVerboseMode(
            event.snapshot,
          );
          if (snapshotText) {
            log.raw.log(`${snapshotText}\n`);
          }
          break;
        }
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
        if (event.name === "delegate_agent") return;
        if (thinkingShown) { log.raw.write(`\r\x1b[K`); thinkingShown = false; }
        if (streamedTokens) { log.raw.write("\n"); streamedTokens = false; }
        log.raw.write(`  \x1b[2m\u2847 ${event.name} ${truncate(event.argsSummary, 60)}\x1b[0m`);
        toolInProgress = true;
        break;
      case "tool_end": {
        if (event.name === "ask_user" || event.name === "delegate_agent") return;
        if (toolInProgress) {
          const icon = event.success ? "\x1b[32m\u2713\x1b[0m" : "\x1b[31m\u2717\x1b[0m";
          const dur = event.durationMs ? ` \x1b[2m(${(event.durationMs / 1000).toFixed(1)}s)\x1b[0m` : "";
          const summary = summarizeToolEventForDefaultMode(
            event.name,
            event.summary,
            event.content,
          );
          const renderedSummary = event.success ? summary : `Error: ${summary}`;
          log.raw.write(`\r\x1b[K  ${icon} ${event.name} ${event.argsSummary} \x1b[2m\u2192\x1b[0m ${renderedSummary}${dur}\n`);
          toolInProgress = false;
        } else {
          // tool_end without tool_start (shouldn't happen, but handle gracefully)
          if (streamedTokens) { log.raw.write("\n"); streamedTokens = false; }
          if (!event.success) {
            const summary = summarizeToolEventForDefaultMode(
              event.name,
              event.summary,
              event.content,
            );
            log.raw.log(`[${event.name}] Error: ${summary}\n`);
          } else {
            const summary = summarizeToolEventForDefaultMode(
              event.name,
              event.summary,
              event.content,
            );
            if (summary) log.raw.log(`${summary}\n`);
          }
        }
        break;
      }
      case "delegate_start":
        if (thinkingShown) { log.raw.write(`\r\x1b[K`); thinkingShown = false; }
        if (streamedTokens) { log.raw.write("\n"); streamedTokens = false; }
        log.raw.write(
          `  \x1b[2m\u2847 delegate ${event.agent} ${truncate(event.task, 60)}\x1b[0m`,
        );
        toolInProgress = true;
        break;
      case "delegate_end": {
        if (toolInProgress) {
          const icon = event.success ? "\x1b[32m\u2713\x1b[0m" : "\x1b[31m\u2717\x1b[0m";
          const dur = event.durationMs ? ` \x1b[2m(${(event.durationMs / 1000).toFixed(1)}s)\x1b[0m` : "";
          const summary = event.success
            ? event.summary ?? "Delegation complete."
            : `Error: ${event.error ?? "Delegation failed."}`;
          log.raw.write(`\r\x1b[K  ${icon} delegate ${event.agent} \x1b[2m\u2192\x1b[0m ${summary}${dur}\n`);
          toolInProgress = false;
        } else {
          if (streamedTokens) { log.raw.write("\n"); streamedTokens = false; }
          const summary = event.success
            ? event.summary ?? "Delegation complete."
            : `Error: ${event.error ?? "Delegation failed."}`;
          log.raw.log(`delegate ${event.agent} \x1b[2m\u2192\x1b[0m ${summary}\n`);
        }
        break;
      }
      case "plan_created": {
        activePlan = event.plan;
        if (thinkingShown) { log.raw.write(`\r\x1b[K`); thinkingShown = false; }
        if (streamedTokens) { log.raw.write("\n"); streamedTokens = false; }
        const goal = truncate(event.plan.goal, 64);
        log.raw.log(
          `  \x1b[2mPlan \u2192 ${event.plan.steps.length} step${
            event.plan.steps.length === 1 ? "" : "s"
          }: ${goal}\x1b[0m`,
        );
        break;
      }
      case "plan_step": {
        if (thinkingShown) { log.raw.write(`\r\x1b[K`); thinkingShown = false; }
        if (streamedTokens) { log.raw.write("\n"); streamedTokens = false; }
        const step = activePlan?.steps[event.index];
        const label = step?.title ?? event.stepId;
        const total = activePlan?.steps.length;
        const progress = total ? `${event.index + 1}/${total}` : `${event.index + 1}`;
        log.raw.log(
          `  \x1b[2mPlan ${progress} \u2192 ${truncate(label, 72)}\x1b[0m`,
        );
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

  // Resolve permission mode: CLI flag > config > default
  const effectivePermissionMode: PermissionMode = permissionModeOverride
    ?? runtimeModelConfig.getPermissionMode()
    ?? "default";

  const executeQuery = async () => {
    const result = await runAgentQueryViaHost({
      query,
      model: resolvedModel,
      workspace: getPlatform().process.cwd(),
      fixturePath,
      contextWindow,
      skipSessionHistory: freshSession,
      permissionMode: effectivePermissionMode,
      callbacks: {
        onToken,
        onAgentEvent,
        onTrace: createTraceCallback(verbose),
        onFinalResponseMeta: (meta) => {
          finalMeta = meta;
        },
      },
      onInteraction: promptRuntimeInteraction,
    });

    if (jsonOutput) {
      emitJson({
        type: "final",
        text: result.text,
        stats: result.stats,
        meta: finalMeta,
      });
      return;
    }

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

  if (jsonOutput) {
    const classified = classifyError(executionError);
    emitJson({
      type: "error",
      message: executionError instanceof Error
        ? executionError.message
        : String(executionError),
      errorClass: classified.class,
      retryable: classified.retryable,
    });
    getPlatform().process.exit(1);
    return;
  }

  const {
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
    const classified = classifyError(executionError);
    const hint = getRecoveryHint(executionError.message);
    log.error(`Agent error (${classified.class}): ${executionError.message}`);
    if (hint) log.error(`Hint: ${hint}`);
    throw executionError;
  }
  throw executionError;
}

function formatDelegateSnapshotForVerboseMode(
  snapshot?: DelegateTranscriptSnapshot,
): string {
  if (!snapshot) return "";
  const lines: string[] = ["  Child transcript:"];
  for (const event of snapshot.events) {
    const line = formatDelegateSnapshotEvent(event);
    if (line) lines.push(`    ${line}`);
  }
  if (snapshot.finalResponse?.trim()) {
    lines.push(`    Final: ${truncate(snapshot.finalResponse.trim(), 120)}`);
  }
  return lines.join("\n");
}

function formatDelegateSnapshotEvent(
  event: DelegateTranscriptEvent,
): string {
  switch (event.type) {
    case "thinking":
      return event.summary?.trim()
        ? `Thinking: ${truncate(event.summary.trim(), 100)}`
        : "Thinking";
    case "plan_created":
      return `Plan created (${event.stepCount} steps)`;
    case "plan_step":
      return `Plan step ${event.index + 1} complete: ${event.stepId}`;
    case "tool_start":
      return `Tool ${event.name} ${truncate(event.argsSummary, 72)}`;
    case "tool_end": {
      const summary = summarizeToolEventForDefaultMode(
        event.name,
        event.summary,
        event.content,
      );
      const prefix = event.success ? "Tool" : "Tool error";
      return `${prefix} ${event.name} -> ${truncate(summary, 72)}`;
    }
    case "turn_stats":
      return `${event.toolCount} tool${event.toolCount === 1 ? "" : "s"} in ${(event.durationMs / 1000).toFixed(1)}s`;
  }
}
