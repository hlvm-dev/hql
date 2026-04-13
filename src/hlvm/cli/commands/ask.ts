/**
 * Ask Command - Interactive AI Agent (CLI entry point)
 *
 * CLI shell over the shared HLVM runtime host.
 * Agent execution is routed through the local host boundary.
 */

import { parseArgs } from "@std/cli/parse-args";
import { log } from "../../api/log.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";
import { readLineInput, readSingleKey } from "../utils/input.ts";
import { ValidationError } from "../../../common/error.ts";
import { EXIT_CODES } from "../../agent/constants.ts";
import { isOllamaAuthErrorMessage } from "../../../common/ollama-auth.ts";
import { truncate } from "../../../common/utils.ts";
import {
  createStreamingResponseSanitizer,
  shouldSuppressFinalResponse,
  stripPlanEnvelopeBlocks,
} from "../../agent/model-compat.ts";
import { describeErrorForDisplay } from "../../agent/error-taxonomy.ts";
import { isAutoModel } from "../../agent/auto-select.ts";
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
import {
  PERMISSION_MODES,
  PERMISSION_MODES_SET,
  type PermissionMode,
} from "../../../common/config/types.ts";
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
import { formatDelegateGroupForCli } from "../delegate-group-format.ts";
import type { DelegateGroupEntry } from "../repl-ink/types.ts";
import { formatPlanForContext } from "../../agent/planning.ts";
import {
  createTranscriptState,
  getVisibleTodoSummary,
  reduceTranscriptState,
} from "../agent-transcript-state.ts";
import { ANSI_COLORS } from "../ansi.ts";
import {
  buildToolTranscriptInvocationLabel,
  resolveToolTranscriptDisplayName,
  resolveToolTranscriptProgress,
  resolveToolTranscriptResult,
} from "../repl-ink/components/conversation/tool-transcript.ts";

const { DIM, RESET, GREEN, RED } = ANSI_COLORS;
const CLEAR_LINE = "\r\x1b[K";

export function showAskHelp(): void {
  log.raw.log(`
HLVM Ask - Interactive AI Agent

USAGE:
  hlvm ask "<query>"           Ask the agent to perform a task
  hlvm ask --help              Show this help message

EXAMPLES:
  # Interactive mode (default)
  hlvm ask "list files in src/"
  hlvm ask "count test files in tests/unit"

  # Non-interactive / print mode
  hlvm ask -p "analyze code quality"
  hlvm ask --print "explain this function"

  # Explicit permission mode
  hlvm ask --permission-mode acceptEdits "fix bug"
  hlvm ask --permission-mode dontAsk "analyze code"

  # Explicit tool permissions
  hlvm ask --allowedTools write_file "fix bug"
  hlvm ask --disallowedTools shell_exec "analyze code"

  # Advanced usage
  hlvm ask --attach ./screenshot.png "describe this UI issue"
  hlvm ask --verbose "count test files"  # Debug mode with detailed output
  hlvm ask --output-format stream-json "count test files"  # NDJSON events
  hlvm ask --output-format json "count test files"         # Single JSON result
  hlvm ask --model openai/gpt-4o "summarize this codebase"
  hlvm ask --no-session-persistence "hello"  # Use an isolated hidden session

OPTIONS:
  --help, -h                   Show this help message
  -p, --print                  Non-interactive output (defaults to dontAsk mode)
  --verbose                    Show agent header, tool labels, stats, and trace output
  --output-format <format>     Output format: text (default), json, stream-json
  --usage                      Show token usage summary after execution
  --attach <path>              Attach a file input (repeatable)
  --model <provider/model>     Use a specific AI model (e.g., openai/gpt-4o)
  --no-session-persistence     Use an isolated hidden session for this run only

  Permission Mode:
  --permission-mode <mode>     Set permission mode (default, acceptEdits, plan,
                               bypassPermissions, dontAsk, auto)

  Tool Permission Control:
  --allowedTools <name>        Allow specific tool (repeatable)
  --disallowedTools <name>     Deny specific tool (repeatable)

  --dangerously-skip-permissions  Alias for --permission-mode bypassPermissions

  Headless Safety:
  --max-turns <N>            Maximum agent loop iterations (headless safety)
  --max-budget <N>           Maximum API cost in USD (headless safety)

PERMISSION MODES:
  default:                     Prompt for L1/L2 tools, auto-approve L0 (read-only)
  acceptEdits:                 Auto-approve L0+L1, prompt for L2 (destructive)
  plan:                        Research/plan first, execute with approval
  bypassPermissions:           Auto-approve all tools (unsafe)
  dontAsk:                     Non-interactive (auto-deny L1/L2, allow L0)
  auto:                        Local LLM classifies tool safety — safe=approve, unsafe=prompt

  Tool Safety Levels:
    L0: Safe read-only (read_file, list_files, search_code)
    L1: Mutations (write_file, edit_file, shell_exec)
    L2: High-risk (destructive shell commands, delete operations)

  Priority order: deny > allow > mode > default
`);
}

async function promptRuntimeInteraction(
  event: {
    mode: "permission" | "question";
    toolName?: string;
    toolArgs?: string;
    question?: string;
  },
  permissionMode: PermissionMode,
): Promise<{ approved?: boolean; userInput?: string }> {
  if (!getPlatform().terminal.stdin.isTerminal()) {
    if (event.mode === "permission") {
      if (permissionMode === "bypassPermissions") {
        return event.toolName === "plan_review"
          ? { approved: true, userInput: "approve:auto" }
          : { approved: true };
      }
      if (
        permissionMode === "acceptEdits" && event.toolName === "plan_review"
      ) {
        return { approved: true };
      }
    }
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
      case "playwright_trace":
        log.raw.log(
          `[TRACE] Playwright trace ${event.status}: ${event.reason} -> ${event.path}`,
        );
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
      case "llm_performance": {
        const firstToken = event.firstTokenLatencyMs !== undefined
          ? ` first-token=${event.firstTokenLatencyMs}ms`
          : "";
        const tokens = event.inputTokens !== undefined ||
            event.outputTokens !== undefined
          ? ` tokens=${event.inputTokens ?? 0}/${event.outputTokens ?? 0}`
          : "";
        const cache = event.cacheReadInputTokens !== undefined ||
            event.cacheCreationInputTokens !== undefined
          ? ` cache=read:${event.cacheReadInputTokens ?? 0},create:${
            event.cacheCreationInputTokens ?? 0
          }`
          : "";
        log.raw.log(
          `[TRACE] LLM perf: ${event.providerName}/${event.modelId} latency=${event.latencyMs}ms${firstToken}${tokens} stable=${event.stableCacheSignatureHash ?? "none"} segments=${event.stableSegmentCount ?? 0}${cache}`,
        );
        break;
      }
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

  const notHandled = {
    handled: false,
    recovered: false,
    executionError,
    streamedTokens,
  } as const;
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

  const parsed = parseArgs(args, {
    boolean: [
      "verbose",
      "usage",
      "no-session-persistence",
      "print",
      "dangerously-skip-permissions",
    ],
    string: [
      "permission-mode",
      "allowedTools",
      "disallowedTools",
      "model",
      "attach",
      "output-format",
      "max-turns",
      "max-budget",
    ],
    alias: {
      p: "print",
    },
    collect: ["allowedTools", "disallowedTools", "attach"],
    unknown: (flag: string) => {
      if (flag.startsWith("-")) {
        throw new ValidationError(`Unknown option: ${flag}`, "ask");
      }
      return true;
    },
  });

  const verbose = parsed.verbose;
  const outputFormat = (parsed["output-format"] as string) ?? "text";
  const VALID_OUTPUT_FORMATS = new Set(["text", "json", "stream-json"]);
  if (!VALID_OUTPUT_FORMATS.has(outputFormat)) {
    throw new ValidationError(
      `Invalid output format: "${outputFormat}". Valid formats: ${
        [...VALID_OUTPUT_FORMATS].join(", ")
      }`,
      "ask",
    );
  }
  const jsonOutput = outputFormat !== "text";
  const showUsage = parsed.usage;
  let stateless = parsed["no-session-persistence"];
  const printMode = parsed.print;
  let modelOverride: string | undefined = parsed.model || undefined;
  const attachmentArgs: string[] = (parsed.attach as string[]) ?? [];
  const allowedTools = new Set<string>((parsed.allowedTools as string[]) ?? []);
  const deniedTools = new Set<string>(
    (parsed.disallowedTools as string[]) ?? [],
  );

  // Headless safety bounds
  const maxTurns = parsed["max-turns"]
    ? parseInt(parsed["max-turns"] as string, 10)
    : undefined;
  if (maxTurns !== undefined && (isNaN(maxTurns) || maxTurns < 1)) {
    throw new ValidationError(
      "--max-turns must be a positive integer",
      "ask",
    );
  }
  const maxBudget = parsed["max-budget"]
    ? parseFloat(parsed["max-budget"] as string)
    : undefined;
  if (maxBudget !== undefined && (isNaN(maxBudget) || maxBudget <= 0)) {
    throw new ValidationError(
      "--max-budget must be a positive number",
      "ask",
    );
  }

  // Resolve permission mode from flags
  let permissionModeOverride: PermissionMode | undefined;
  let permissionModeExplicitlySet = false;

  if (parsed["permission-mode"]) {
    const mode = parsed["permission-mode"] as PermissionMode;
    if (!PERMISSION_MODES_SET.has(mode)) {
      throw new ValidationError(
        `Invalid permission mode: "${
          parsed["permission-mode"]
        }". Valid modes: ${PERMISSION_MODES.join(", ")}`,
        "ask",
      );
    }
    permissionModeOverride = mode;
    permissionModeExplicitlySet = true;
  }

  if (parsed["dangerously-skip-permissions"]) {
    permissionModeOverride = "bypassPermissions";
    permissionModeExplicitlySet = true;
  }

  // -p/--print: default to dontAsk if no explicit --permission-mode was set
  if (printMode && !permissionModeExplicitlySet) {
    permissionModeOverride = "dontAsk";
  }

  const query = parsed._.join(" ");

  if (!query) {
    throw new ValidationError(
      'Missing query. Usage: hlvm ask "<query>"',
      "ask",
    );
  }

  if (jsonOutput && verbose) {
    throw new ValidationError(
      "--output-format json/stream-json cannot be combined with --verbose",
      "ask",
    );
  }

  const fixturePath = getPlatform().env.get("HLVM_ASK_FIXTURE_PATH")?.trim() ||
    undefined;
  if (fixturePath) {
    stateless = true;
  }

  const attachmentIds = await resolveAskAttachmentIds(attachmentArgs);
  if (!fixturePath && attachmentIds?.length && modelOverride && !isAutoModel(modelOverride)) {
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

  const contextWindow = runtimeConfig.getContextWindow();

  const isAuto = isAutoModel(resolvedModel);

  if (!fixturePath && attachmentIds?.length && !isAuto) {
    await ensureModelAttachmentSupport(resolvedModel, attachmentIds);
  }

  // Paid provider consent gate (skipped for auto — concrete model not yet known)
  if (
    !fixturePath && !isAuto &&
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
  const activeDelegateGroups = new Map<string, DelegateGroupEntry[]>();
  let groupEntryCounter = 0;

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
    if (outputFormat === "stream-json") {
      emitJson({ type: "token", text });
      return;
    }
    if (outputFormat === "json") return;
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
    if (outputFormat === "stream-json") {
      emitJson({ type: "agent_event", event });
      return;
    }
    if (outputFormat === "json") return;
    if (verbose) {
      switch (event.type) {
        case "tool_start":
          if (event.name === "ask_user" || event.name === "delegate_agent") {
            return;
          }
          flushStream();
          log.raw.log(
            `\n[Tool] ${
              buildToolTranscriptInvocationLabel({
                name: event.name,
                displayName: resolveToolTranscriptDisplayName(event.name),
                argsSummary: event.argsSummary,
              })
            }\n`,
          );
          break;
        case "tool_progress": {
          if (event.name === "ask_user" || event.name === "delegate_agent") {
            return;
          }
          const progress = resolveToolTranscriptProgress(event.name, event);
          if (!progress?.message) return;
          flushStream();
          log.raw.log(
            `\n[Tool] ${resolveToolTranscriptDisplayName(event.name)}\n${
              progress.message
            }\n`,
          );
          break;
        }
        case "tool_end":
          if (event.name === "ask_user" || event.name === "delegate_agent") {
            return;
          }
          flushStream();
          {
            const label = event.success ? "Tool Result" : "Tool Error";
            const transcriptResult = resolveToolTranscriptResult(event.name, {
              toolCallId: event.toolCallId,
              name: event.name,
              success: event.success,
              summary: event.summary,
              content: event.content,
              durationMs: event.durationMs,
              argsSummary: event.argsSummary,
              meta: event.meta,
            });
            log.raw.log(
              `\n[${label}] ${resolveToolTranscriptDisplayName(event.name)}\n${
                transcriptResult.detailText ?? event.content
              }\n`,
            );
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
          if (event.batchId) {
            const entries = activeDelegateGroups.get(event.batchId) ?? [];
            entries.push({
              id: `dge-${++groupEntryCounter}`,
              agent: event.agent,
              task: event.task,
              status: "queued",
              threadId: event.threadId,
              nickname: event.nickname,
              childSessionId: event.childSessionId,
            });
            activeDelegateGroups.set(event.batchId, entries);
            log.raw.log(
              `\n${formatDelegateGroupForCli(entries, true)}\n`,
            );
          } else {
            log.raw.log(`\n[Delegate] ${event.agent}\n${event.task}\n`);
          }
          break;
        case "delegate_running": {
          flushStream();
          for (const [, entries] of activeDelegateGroups) {
            const match = entries.find(
              (e) => e.threadId === event.threadId && e.status === "queued",
            );
            if (match) {
              match.status = "running";
              log.raw.log(`\n${formatDelegateGroupForCli(entries, true)}\n`);
              break;
            }
          }
          break;
        }
        case "delegate_end": {
          flushStream();
          if (event.batchId && activeDelegateGroups.has(event.batchId)) {
            const entries = activeDelegateGroups.get(event.batchId)!;
            const isCancelled = !event.success &&
              event.error?.toLowerCase().includes("abort");
            const match = entries.find((e) =>
              (event.threadId && e.threadId === event.threadId) ||
              (e.agent === event.agent && e.task === event.task &&
                (e.status === "running" || e.status === "queued"))
            );
            if (match) {
              match.status = isCancelled
                ? "cancelled"
                : event.success
                ? "success"
                : "error";
              match.summary = event.summary;
              match.error = event.error;
              match.durationMs = event.durationMs;
              match.snapshot = event.snapshot;
            }
            log.raw.log(
              `\n${formatDelegateGroupForCli(entries, true)}\n`,
            );
          } else {
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
        case "team_member_activity":
          flushStream();
          log.raw.log(
            `\n[Team Worker] ${event.memberLabel} ${event.summary}\n`,
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
          // Suppress when delegate group already shows richer data
          if (!activeDelegateGroups.has(event.snapshot.batchId)) {
            flushStream();
            log.raw.log(
              `\n[Batch ${event.snapshot.batchId}] ${event.snapshot.running} running \u00b7 ${event.snapshot.completed} completed \u00b7 ${event.snapshot.errored} errored \u00b7 ${event.snapshot.cancelled} cancelled\n`,
            );
          }
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
          `  ${DIM}\u2847 ${
            buildToolTranscriptInvocationLabel({
              name: event.name,
              displayName: resolveToolTranscriptDisplayName(event.name),
              argsSummary: truncate(event.argsSummary, 60),
            })
          }${RESET}`,
        );
        toolInProgress = true;
        break;
      case "tool_progress":
        break;
      case "tool_end": {
        if (event.name === "ask_user" || event.name === "delegate_agent") {
          return;
        }
        const transcriptResult = resolveToolTranscriptResult(event.name, {
          toolCallId: event.toolCallId,
          name: event.name,
          success: event.success,
          summary: event.summary,
          content: event.content,
          durationMs: event.durationMs,
          argsSummary: event.argsSummary,
          meta: event.meta,
        });
        const toolLabel = buildToolTranscriptInvocationLabel({
          name: event.name,
          displayName: resolveToolTranscriptDisplayName(event.name),
          argsSummary: event.argsSummary,
        });
        if (toolInProgress) {
          const icon = event.success
            ? `${GREEN}\u2713${RESET}`
            : `${RED}\u2717${RESET}`;
          const dur = event.durationMs
            ? ` ${DIM}(${(event.durationMs / 1000).toFixed(1)}s)${RESET}`
            : "";
          const summary = transcriptResult.summaryText ||
            summarizeToolEventForDefaultMode(
              event.name,
              event.summary,
              event.content,
            );
          const renderedSummary = event.success ? summary : `Error: ${summary}`;
          log.raw.write(
            `${CLEAR_LINE}  ${icon} ${toolLabel} ${DIM}\u2192${RESET} ${renderedSummary}${dur}\n`,
          );
          toolInProgress = false;
        } else {
          flushStream();
          const summary = transcriptResult.summaryText ||
            summarizeToolEventForDefaultMode(
              event.name,
              event.summary,
              event.content,
            );
          if (!event.success) {
            log.raw.log(
              `[${resolveToolTranscriptDisplayName(event.name)}] Error: ${summary}\n`,
            );
          } else if (summary) {
            log.raw.log(`${summary}\n`);
          }
        }
        break;
      }
      case "delegate_start":
        clearThinking();
        flushStream();
        if (event.batchId) {
          const entries = activeDelegateGroups.get(event.batchId) ?? [];
          entries.push({
            id: `dge-${++groupEntryCounter}`,
            agent: event.agent,
            task: event.task,
            status: "queued",
            threadId: event.threadId,
            nickname: event.nickname,
            childSessionId: event.childSessionId,
          });
          activeDelegateGroups.set(event.batchId, entries);
          log.raw.write(
            `${CLEAR_LINE}  ${DIM}${
              formatDelegateGroupForCli(entries, false)
            }${RESET}`,
          );
          toolInProgress = true;
        } else {
          log.raw.write(
            `  ${DIM}\u2847 delegate ${event.agent} ${
              truncate(event.task, 60)
            }${RESET}`,
          );
          toolInProgress = true;
        }
        break;
      case "delegate_running": {
        for (const [, entries] of activeDelegateGroups) {
          const match = entries.find(
            (e) => e.threadId === event.threadId && e.status === "queued",
          );
          if (match) {
            match.status = "running";
            log.raw.write(
              `${CLEAR_LINE}  ${DIM}${
                formatDelegateGroupForCli(entries, false)
              }${RESET}`,
            );
            break;
          }
        }
        break;
      }
      case "delegate_end": {
        if (event.batchId && activeDelegateGroups.has(event.batchId)) {
          const entries = activeDelegateGroups.get(event.batchId)!;
          const isCancelled = !event.success &&
            event.error?.toLowerCase().includes("abort");
          const match = entries.find((e) =>
            (event.threadId && e.threadId === event.threadId) ||
            (e.agent === event.agent && e.task === event.task &&
              (e.status === "running" || e.status === "queued"))
          );
          if (match) {
            match.status = isCancelled
              ? "cancelled"
              : event.success
              ? "success"
              : "error";
            match.summary = event.summary;
            match.error = event.error;
            match.durationMs = event.durationMs;
            match.snapshot = event.snapshot;
          }
          const allDone = entries.every((e) =>
            e.status === "success" || e.status === "error" ||
            e.status === "cancelled"
          );
          log.raw.write(
            `${CLEAR_LINE}  ${
              allDone
                ? entries.some((e) =>
                    e.status === "error" || e.status === "cancelled"
                  )
                  ? `${RED}\u2717${RESET}`
                  : `${GREEN}\u2713${RESET}`
                : DIM
            } ${formatDelegateGroupForCli(entries, false)}${
              allDone ? "" : RESET
            }\n`,
          );
          if (allDone) {
            toolInProgress = false;
          }
        } else if (toolInProgress) {
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
        const cost = typeof event.costUsd === "number"
          ? ` · $${
            event.costUsd >= 0.01
              ? event.costUsd.toFixed(3)
              : event.costUsd.toFixed(4)
          } est`
          : "";
        const continuation = event.continuationCount
          ? ` · ${event.continuationCount} continuation${
            event.continuationCount === 1 ? "" : "s"
          }`
          : "";
        const compaction = event.compactionReason
          ? ` · ${
            event.compactionReason === "proactive_pressure"
              ? "compacted"
              : "overflow retry"
          }`
          : "";
        log.raw.log(
          `\n${DIM}\u2500\u2500\u2500 ${event.toolCount} tool${
            event.toolCount !== 1 ? "s" : ""
          } \u00b7 ${dur}${cost}${continuation}${compaction} \u2500\u2500\u2500${RESET}\n`,
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
      stateless,
      permissionMode: effectivePermissionMode,
      toolAllowlist: allowedTools.size > 0
        ? Array.from(allowedTools)
        : undefined,
      toolDenylist: deniedTools.size > 0 ? Array.from(deniedTools) : undefined,
      maxIterations: maxTurns,
      maxBudgetUsd: maxBudget,
      callbacks: {
        onToken,
        onAgentEvent,
        onTrace: createTraceCallback(verbose),
        onFinalResponseMeta: (meta) => {
          finalMeta = meta;
        },
      },
      onInteraction: (event) =>
        promptRuntimeInteraction(event, effectivePermissionMode),
    });
    const visibleResultText = stripPlanEnvelopeBlocks(result.text);

    if (outputFormat === "stream-json") {
      emitJson({
        type: "final",
        text: result.text,
        stats: result.stats,
        meta: finalMeta,
      });
      return;
    }

    if (outputFormat === "json") {
      log.raw.log(JSON.stringify({
        type: "result",
        result: result.text,
        stats: result.stats,
        meta: finalMeta,
      }));
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
    const described = await describeErrorForDisplay(executionError);
    const errorPayload = {
      type: "error",
      message: described.message,
      errorClass: described.class,
      retryable: described.retryable,
    };
    log.raw.log(JSON.stringify(errorPayload));
    getPlatform().process.exit(EXIT_CODES.GENERAL_FAILURE);
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
    const described = await describeErrorForDisplay(executionError);
    log.error(`Agent error (${described.class}): ${described.message}`);
    if (described.hint) log.error(`Hint: ${described.hint}`);
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
