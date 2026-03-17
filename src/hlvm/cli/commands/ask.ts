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
import {
  createStreamingResponseSanitizer,
  shouldSuppressFinalResponse,
  stripPlanEnvelopeBlocks,
} from "../../agent/model-compat.ts";
import { classifyError, getRecoveryHint } from "../../agent/error-taxonomy.ts";
import { getPlatform } from "../../../platform/platform.ts";
import {
  createAttachment,
  isAttachment,
  isSupportedConversationAttachmentPath,
} from "../repl/attachment.ts";
import type {
  AgentUIEvent,
  FinalResponseMeta,
  TraceEvent,
} from "../../agent/orchestrator.ts";
import {
  isOllamaCloudModelId,
  runOllamaCloudSignin,
  verifyOllamaCloudAccess,
} from "../../runtime/ollama-cloud-access.ts";
import type { ChatResultStats } from "../../runtime/chat-protocol.ts";
import type { PermissionMode } from "../../../common/config/types.ts";
import { OLLAMA_SETTINGS_URL } from "./shared.ts";
import { runAgentQueryViaHost } from "../../runtime/host-client.ts";
import { createRuntimeConfigManager } from "../../runtime/model-config.ts";
import { confirmPaidProviderConsent } from "../utils/provider-consent.ts";
import {
  checkModelAttachmentIds,
  describeAttachmentFailure,
} from "../attachment-policy.ts";
import {
  type DelegateTranscriptSnapshot,
  listDelegateTranscriptLines,
} from "../../agent/delegate-transcript.ts";
import { formatPlanForContext } from "../../agent/planning.ts";
import {
  createTranscriptState,
  getVisibleTodoSummary,
  reduceTranscriptState,
} from "../agent-transcript-state.ts";
import { ANSI_COLORS } from "../ansi.ts";

const { DIM, RESET, GREEN, RED } = ANSI_COLORS;
const CLEAR_LINE = "\r\x1b[K";

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
  hlvm ask --attach ./screenshot.png "describe this UI issue"
  hlvm ask --verbose "count test files"  # Debug mode with detailed output
  hlvm ask --json "count test files"     # Stream NDJSON events for automation
  hlvm ask --model openai/gpt-4o "summarize this codebase"
  hlvm ask --model anthropic/claude-sonnet-4-5-20250929 "list files"
  hlvm ask --fresh "hello"               # Start fresh (no prior session history)

OPTIONS:
  --help, -h                   Show this help message
  --verbose                    Show agent header, tool labels, stats, and trace output
  --json                       Emit newline-delimited JSON events
  --usage                      Show token usage summary after execution
  --attach <path>              Attach a file input (repeatable)
  --model <provider/model>     Use a specific AI model (e.g., openai/gpt-4o, anthropic/claude-sonnet-4-5-20250929)
  --fresh                      Start a fresh session (no prior session history)
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

  if (event.toolName === "plan_review") {
    log.raw.log("\n[Plan Review Required]");
    if (event.toolArgs?.trim()) {
      log.raw.log(event.toolArgs);
    }
    log.raw.log("\nApprove this plan before any mutations? [y/N] ");
    const key = await readSingleKey();
    log.raw.log("");
    return { approved: key === "y" };
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
      case "thinking_profile":
        log.raw.log(
          `[TRACE] Thinking profile: iteration=${event.iteration} phase=${event.phase} openai=${event.openaiReasoningEffort} google=${event.googleThinkingLevel} anthropic=${event.anthropicBudgetTokens} recent_tools=${event.recentToolCalls} failures=${event.consecutiveFailures}`,
        );
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

const DEFAULT_TOOL_OUTPUT_MAX_LINES = 18;
const DEFAULT_TOOL_OUTPUT_MAX_CHARS = 1000;

interface FormattedToolOutput {
  text: string;
  truncated: boolean;
}

function formatToolOutputForDefaultMode(
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

  const looksLikeJson = normalized.startsWith("{") ||
    normalized.startsWith("[");
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

function summarizeToolEventForDefaultMode(
  toolName: string,
  summary?: string,
  content?: string,
): string {
  const candidate = summary?.trim();
  if (candidate) {
    const firstLine = candidate.split("\n").map((line) =>
      line.trim()
    ).find(Boolean) ?? candidate;
    return truncate(firstLine.replace(/\s+/g, " "), 80);
  }
  const formatted = formatToolOutputForDefaultMode(toolName, content ?? "");
  return formatted.text;
}

async function ensureModelAttachmentSupport(
  modelName: string,
  attachmentIds: readonly string[],
): Promise<void> {
  const attachmentSupport = await checkModelAttachmentIds(
    modelName,
    attachmentIds,
    null,
  );
  if (attachmentSupport.supported) return;
  if (attachmentSupport.catalogFailed) {
    throw new ValidationError(
      "Could not verify model attachment support. Check provider connection and try again.",
      "ask",
    );
  }
  throw new ValidationError(
    describeAttachmentFailure(attachmentSupport, modelName) ||
      `Selected model does not support these attachments: ${modelName}`,
    "ask",
  );
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

type AskJsonEvent =
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

  const notHandled = { handled: false, recovered: false, executionError, streamedTokens } as const;
  if (!(executionError instanceof Error)) return notHandled;
  if (!deps.isCloudModelId(resolvedModel)) return notHandled;
  if (!deps.isInteractiveTerminal()) return notHandled;
  if (!deps.isAuthErrorMessage(executionError.message)) return notHandled;

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
  const attachmentArgs: string[] = [];

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
    } else if (arg === "--attach") {
      i++;
      if (i >= args.length) {
        throw new ValidationError(
          "--attach requires a file path",
          "ask",
        );
      }
      attachmentArgs.push(args[i]);
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

  const attachmentIds = await resolveAskAttachmentIds(attachmentArgs);
  if (!fixturePath && attachmentIds?.length && modelOverride) {
    await ensureModelAttachmentSupport(modelOverride, attachmentIds);
  }

  const runtimeConfig = await createRuntimeConfigManager();

  const forceSetup = getPlatform().env.get("HLVM_FORCE_SETUP") === "1";
  if (!fixturePath && !modelOverride) {
    const initialModel = await runtimeConfig.ensureInitialModelConfigured({
      allowFirstRunSetup: getPlatform().terminal.stdin.isTerminal() ||
        forceSetup,
      runFirstTimeSetup: async () => {
        const { runFirstTimeSetup } = await import("./first-run-setup.ts");
        return await runFirstTimeSetup();
      },
    });
    if (initialModel.modelConfigured) {
      modelOverride = initialModel.model;
    }
  }

  let resolvedModel = modelOverride ?? runtimeConfig.getConfiguredModel();
  if (!fixturePath) {
    const normalized = await runtimeConfig
      .resolveCompatibleClaudeCodeModel(
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
  const contextWindow = runtimeConfig.getContextWindow();

  if (!fixturePath && attachmentIds?.length) {
    await ensureModelAttachmentSupport(resolvedModel, attachmentIds);
  }

  // Paid provider consent gate
  if (
    !fixturePath &&
    runtimeConfig.evaluateProviderApproval(resolvedModel).status ===
      "approval_required"
  ) {
    const consented = await confirmPaidProviderConsent(
      resolvedModel,
      runtimeConfig,
    );
    if (!consented) {
      log.raw.log(
        "Aborted. Use a free model (e.g., Ollama) or re-run to approve.",
      );
      return;
    }
  }

  let streamedTokens = false;
  let thinkingShown = false;
  let toolInProgress = false;
  let transcriptState = createTranscriptState();
  let finalMeta: FinalResponseMeta | undefined;
  const responseSanitizer = createStreamingResponseSanitizer();

  const flushStream = (): void => {
    if (streamedTokens) {
      log.raw.write("\n");
      streamedTokens = false;
    }
  };

  const clearThinking = (): void => {
    if (thinkingShown) {
      log.raw.write(CLEAR_LINE);
      thinkingShown = false;
    }
  };

  const emitJson = (event: AskJsonEvent): void => {
    log.raw.log(JSON.stringify(event));
  };

  const onToken = (text: string) => {
    if (jsonOutput) {
      emitJson({ type: "token", text });
      return;
    }
    const visibleText = responseSanitizer.push(text);
    if (!visibleText) return;
    clearThinking();
    streamedTokens = true;
    log.raw.write(visibleText);
  };

  const onAgentEvent = (event: AgentUIEvent) => {
    transcriptState = reduceTranscriptState(transcriptState, {
      type: "agent_event",
      event,
    });
    if (jsonOutput) {
      emitJson({ type: "agent_event", event });
      return;
    }
    if (verbose) {
      switch (event.type) {
        case "tool_end":
          if (event.name === "ask_user" || event.name === "delegate_agent") {
            return;
          }
          flushStream();
          {
            const label = event.success ? "Tool Result" : "Tool Error";
            log.raw.log(`\n[${label}] ${event.name}\n${event.content}\n`);
          }
          break;
        case "reasoning_update":
          flushStream();
          if (event.summary.trim()) {
            log.raw.log(`\n[Reasoning] ${event.summary}\n`);
          }
          break;
        case "planning_update":
          flushStream();
          if (event.summary.trim()) {
            log.raw.log(`\n[Planning] ${event.summary}\n`);
          }
          break;
        case "delegate_start":
          flushStream();
          log.raw.log(`\n[Delegate] ${event.agent}\n${event.task}\n`);
          break;
        case "delegate_end": {
          flushStream();
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
        case "todo_updated":
          flushStream();
          log.raw.log(
            `\n[Todo] ${getVisibleTodoSummary(transcriptState) ?? "updated"}\n`,
          );
          break;
        case "team_task_updated":
          flushStream();
          log.raw.log(
            `\n[Team Task] ${event.status} ${event.goal}${
              event.assigneeMemberId ? ` (${event.assigneeMemberId})` : ""
            }\n`,
          );
          break;
        case "team_message":
          flushStream();
          log.raw.log(
            `\n[Team Message] ${event.fromMemberId}${
              event.toMemberId ? ` -> ${event.toMemberId}` : ""
            } ${event.contentPreview}\n`,
          );
          break;
        case "team_plan_review_required":
          flushStream();
          log.raw.log(
            `\n[Team Plan Review] requested for task ${event.taskId}\n`,
          );
          break;
        case "team_plan_review_resolved":
          flushStream();
          log.raw.log(
            `\n[Team Plan Review] ${
              event.approved ? "approved" : "rejected"
            } for task ${event.taskId}\n`,
          );
          break;
        case "team_shutdown_requested":
          flushStream();
          log.raw.log(
            `\n[Team Shutdown] requested for ${event.memberId}\n`,
          );
          break;
        case "team_shutdown_resolved":
          flushStream();
          log.raw.log(
            `\n[Team Shutdown] ${event.status} for ${event.memberId}\n`,
          );
          break;
        case "batch_progress_updated":
          flushStream();
          log.raw.log(
            `\n[Batch ${event.snapshot.batchId}] ${event.snapshot.running} running \u00b7 ${event.snapshot.completed} completed \u00b7 ${event.snapshot.errored} errored \u00b7 ${event.snapshot.cancelled} cancelled\n`,
          );
          break;
        case "plan_review_required":
          flushStream();
          log.raw.log(
            `\n[Plan Review]\n${
              formatPlanForContext(event.plan, {
                mode: "always",
                requireStepMarkers: false,
              })
            }\n`,
          );
          break;
        case "plan_review_resolved":
          flushStream();
          log.raw.log(
            `\n[Plan Review Result] ${
              event.decision ??
                (event.approved ? "approved" : "cancelled")
            }\n`,
          );
          break;
      }
      return;
    }
    // Default mode: compact progress display
    switch (event.type) {
      case "thinking":
        if (!streamedTokens) {
          log.raw.write(`${CLEAR_LINE}${DIM}\u2847 Working\u2026${RESET}`);
          thinkingShown = true;
        }
        break;
      case "tool_start":
        if (event.name === "delegate_agent") return;
        clearThinking();
        flushStream();
        log.raw.write(
          `  ${DIM}\u2847 ${event.name} ${
            truncate(event.argsSummary, 60)
          }${RESET}`,
        );
        toolInProgress = true;
        break;
      case "tool_end": {
        if (event.name === "ask_user" || event.name === "delegate_agent") {
          return;
        }
        if (toolInProgress) {
          const icon = event.success
            ? `${GREEN}\u2713${RESET}`
            : `${RED}\u2717${RESET}`;
          const dur = event.durationMs
            ? ` ${DIM}(${(event.durationMs / 1000).toFixed(1)}s)${RESET}`
            : "";
          const summary = summarizeToolEventForDefaultMode(
            event.name,
            event.summary,
            event.content,
          );
          const renderedSummary = event.success ? summary : `Error: ${summary}`;
          log.raw.write(
            `${CLEAR_LINE}  ${icon} ${event.name} ${event.argsSummary} ${DIM}\u2192${RESET} ${renderedSummary}${dur}\n`,
          );
          toolInProgress = false;
        } else {
          flushStream();
          const summary = summarizeToolEventForDefaultMode(
            event.name,
            event.summary,
            event.content,
          );
          if (!event.success) {
            log.raw.log(`[${event.name}] Error: ${summary}\n`);
          } else if (summary) {
            log.raw.log(`${summary}\n`);
          }
        }
        break;
      }
      case "delegate_start":
        clearThinking();
        flushStream();
        log.raw.write(
          `  ${DIM}\u2847 delegate ${event.agent} ${
            truncate(event.task, 60)
          }${RESET}`,
        );
        toolInProgress = true;
        break;
      case "delegate_end": {
        if (toolInProgress) {
          const icon = event.success
            ? `${GREEN}\u2713${RESET}`
            : `${RED}\u2717${RESET}`;
          const dur = event.durationMs
            ? ` ${DIM}(${(event.durationMs / 1000).toFixed(1)}s)${RESET}`
            : "";
          const summary = event.success
            ? event.summary ?? "Delegation complete."
            : `Error: ${event.error ?? "Delegation failed."}`;
          log.raw.write(
            `${CLEAR_LINE}  ${icon} delegate ${event.agent} ${DIM}\u2192${RESET} ${summary}${dur}\n`,
          );
          toolInProgress = false;
        } else {
          flushStream();
          const summary = event.success
            ? event.summary ?? "Delegation complete."
            : `Error: ${event.error ?? "Delegation failed."}`;
          log.raw.log(
            `delegate ${event.agent} ${DIM}\u2192${RESET} ${summary}\n`,
          );
        }
        break;
      }
      case "todo_updated":
      case "team_task_updated":
      case "team_message":
      case "team_plan_review_required":
      case "team_plan_review_resolved":
      case "team_shutdown_requested":
      case "team_shutdown_resolved":
      case "batch_progress_updated":
      case "plan_created":
      case "plan_step":
      case "plan_review_required":
      case "plan_review_resolved":
        break;
      case "turn_stats": {
        const dur = event.durationMs
          ? `${(event.durationMs / 1000).toFixed(1)}s`
          : "";
        log.raw.log(
          `\n${DIM}\u2500\u2500\u2500 ${event.toolCount} tool${
            event.toolCount !== 1 ? "s" : ""
          } \u00b7 ${dur} \u2500\u2500\u2500${RESET}\n`,
        );
        break;
      }
    }
  };

  if (verbose) {
    log.raw.log(`\nAgent: ${query}\n`);
  }

  // Resolve permission mode: CLI flag > config > default
  const effectivePermissionMode: PermissionMode = permissionModeOverride ??
    runtimeConfig.getPermissionMode() ??
    "default";

  const executeQuery = async () => {
    const result = await runAgentQueryViaHost({
      query,
      attachmentIds,
      model: resolvedModel,
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
    const visibleResultText = stripPlanEnvelopeBlocks(result.text);

    if (jsonOutput) {
      emitJson({
        type: "final",
        text: result.text,
        stats: result.stats,
        meta: finalMeta,
      });
      return;
    }

    const remainingVisibleText = responseSanitizer.flush();
    if (remainingVisibleText) {
      clearThinking();
      streamedTokens = true;
      log.raw.write(remainingVisibleText);
    }

    if (streamedTokens) {
      log.raw.write("\n");
    }

    if (verbose) {
      if (
        visibleResultText && !shouldSuppressFinalResponse(visibleResultText)
      ) {
        log.raw.log(`\nResult:\n${visibleResultText}\n`);
      }
    } else if (
      !streamedTokens && result.stats.toolMessages === 0 && visibleResultText
    ) {
      log.raw.log(`${visibleResultText}\n`);
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

  const recovery = await attemptCloudAuthRecovery(
    { executionError, resolvedModel, streamedTokens },
    {
      isCloudModelId: isOllamaCloudModelId,
      isInteractiveTerminal: () => getPlatform().terminal.stdin.isTerminal(),
      isAuthErrorMessage: isOllamaAuthErrorMessage,
      runSignin: () =>
        runOllamaCloudSignin({
          onOutput: (line) => log.raw.log(line),
        }),
      verifyCloudAccess: (modelId) =>
        verifyOllamaCloudAccess(modelId, {
          onError: (message) =>
            log.error(`Cloud access check failed: ${message}`),
        }),
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
  for (const line of listDelegateTranscriptLines(snapshot)) {
    if (line) lines.push(`    ${line}`);
  }
  return lines.join("\n");
}

async function resolveAskAttachmentIds(
  attachmentArgs: readonly string[],
): Promise<string[] | undefined> {
  if (attachmentArgs.length === 0) return undefined;

  const platform = getPlatform();
  const resolvedIds: string[] = [];

  for (let i = 0; i < attachmentArgs.length; i++) {
    const rawPath = attachmentArgs[i]?.trim();
    if (!rawPath) {
      throw new ValidationError(
        "--attach requires a non-empty file path",
        "ask",
      );
    }

    const absolutePath = platform.path.isAbsolute(rawPath)
      ? platform.path.normalize(rawPath)
      : platform.path.resolve(platform.process.cwd(), rawPath);

    if (!isSupportedConversationAttachmentPath(absolutePath)) {
      throw new ValidationError(
        `Unsupported attachment type: ${rawPath}.`,
        "ask",
      );
    }

    const attachment = await createAttachment(absolutePath, i + 1);
    if (!isAttachment(attachment)) {
      throw new ValidationError(
        `Invalid attachment ${rawPath}: ${attachment.message}`,
        "ask",
      );
    }

    resolvedIds.push(attachment.attachmentId);
  }

  return resolvedIds;
}
