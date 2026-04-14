/**
 * Tool execution: single call, batch parallel/sequential, timeout handling.
 * Extracted from orchestrator.ts for modularity.
 */

import {
  getTool,
  isToolConcurrencySafe,
  normalizeToolName,
  prepareToolArgsForExecution,
  searchTools,
  suggestToolNames,
  type ToolExecutionOptions,
  type ToolFunction,
} from "./registry.ts";
import { checkToolSafety, isMutatingTool } from "./security/safety.ts";
import { classifyShellCommand } from "./security/shell-classifier.ts";
import { DEFAULT_TIMEOUTS, RATE_LIMITS } from "./constants.ts";
import { withTimeout } from "../../common/timeout-utils.ts";
import { SlidingWindowRateLimiter } from "../../common/rate-limiter.ts";
import {
  getErrorMessage,
  isObjectValue,
  truncate,
} from "../../common/utils.ts";
import { RuntimeError } from "../../common/error.ts";
import { getAgentLogger } from "./logger.ts";
import { isPlanExecutionMode } from "./execution-mode.ts";
import { normalizeToolArgs } from "./validation.ts";
import type { ToolCall } from "./tool-call.ts";
import {
  ensurePlaywrightChromium,
  isPlaywrightMissingError,
} from "./playwright-support.ts";
import type {
  AgentUIEvent,
  MemoryActivityEntry,
  OrchestratorConfig,
} from "./orchestrator.ts";
import {
  effectiveAllowlist,
  effectiveDenylist,
  type ToolExecutionResult,
} from "./orchestrator-state.ts";
import { createRateLimiter } from "./orchestrator-state.ts";
import {
  buildIsToolAllowed,
  buildToolErrorResult,
  buildToolResultOutputs,
  emitToolSuccess,
  generateArgsSummary,
  isRenderToolName,
  sanitizeArgs,
} from "./orchestrator-tool-formatting.ts";
import { buildEditFileRecovery } from "./error-taxonomy.ts";
import { resolveToolPath } from "./path-utils.ts";
import { getPlatform } from "../../platform/platform.ts";
import {
  createProcessAbortHandler,
  readProcessStream,
} from "../../common/stream-utils.ts";
import type { WriteVerificationResult } from "./lsp-diagnostics.ts";
import {
  buildToolFailureMetadata,
  isToolFailureMetadata,
  normalizeToolFailureText,
  type ToolFailureMetadata,
} from "./tool-results.ts";
import { capturePlaywrightFailureDiagnostics } from "./playwright/diagnostics.ts";

const CHECKPOINT_SUPPORTED_MUTATION_TOOLS = new Set([
  "write_file",
  "edit_file",
  "archive_files",
]);

function supportsAutomaticCheckpoint(toolName: string): boolean {
  return CHECKPOINT_SUPPORTED_MUTATION_TOOLS.has(toolName);
}

function buildPlanReviewCancelledResult(
  toolCall: ToolCall,
  startedAt: number,
  config: OrchestratorConfig,
  message = "Plan review was cancelled before mutation.",
): ToolExecutionResult {
  const result = buildToolErrorResult(
    toolCall.toolName,
    message,
    startedAt,
    config,
    toolCall.id,
  );
  result.stopReason = "plan_review_cancelled";
  return result;
}

export function getToolTimeoutMs(
  toolName: string,
  configuredTimeout?: number,
): number {
  if (toolName === "ask_user") {
    return DEFAULT_TIMEOUTS.userInput;
  }
  return configuredTimeout ?? DEFAULT_TIMEOUTS.tool;
}

/** Options for executeToolWithTimeout — collapses 27 positional params into a single object. */
interface ToolTimeoutOptions {
  toolFn: ToolFunction;
  toolCall: ToolCall;
  args: unknown;
  config: OrchestratorConfig;
  timeout: number;
  toolAllowlist?: string[];
  toolDenylist?: string[];
}

/**
 * Execute tool with timeout
 */
async function executeToolWithTimeout(
  opts: ToolTimeoutOptions,
): Promise<unknown> {
  const {
    toolFn,
    args,
    toolCall,
    config,
    timeout,
    toolAllowlist,
    toolDenylist,
  } = opts;
  return await withTimeout(
    async (signal) => {
      // Wrap signal in a controller so CU escape can abort the current tool
      const toolAbortController = new AbortController();
      signal.addEventListener("abort", () => toolAbortController.abort(signal.reason), { once: true });
      const toolOptions: ToolExecutionOptions = {
        signal: toolAbortController.signal,
        abortController: toolAbortController,
        toolName: toolCall.toolName,
        toolCallId: toolCall.id,
        argsSummary: generateArgsSummary(toolCall.toolName, args),
        modelId: config.modelId,
        modelTier: config.modelTier,
        policy: config.policy ?? null,
        onInteraction: config.onInteraction,
        toolOwnerId: config.toolOwnerId,
        ensureMcpLoaded: config.ensureMcpLoaded,
        todoState: config.todoState,
        fileStateCache: config.fileStateCache,
        searchTools: (query, options) =>
          searchTools(query, {
            ...options,
            allowlist: options?.allowlist ?? config.toolSearchUniverseAllowlist,
            denylist: options?.denylist ?? config.toolSearchUniverseDenylist ??
              toolDenylist,
            ownerId: options?.ownerId ?? config.toolOwnerId,
          }),
        sessionId: config.sessionId,
        currentUserRequest: config.currentUserRequest,
        hookRuntime: config.hookRuntime,
        onAgentEvent: config.onAgentEvent,
        agentProfiles: config.agentProfiles,
        instructions: config.instructions,
        permissionMode: config.permissionMode,
        toolAllowlist,
        toolDenylist,
        llmFunction: config.llmFunction,
      };
      const result = await toolFn(args, config.workspace, toolOptions);
      if (signal.aborted) {
        throw new RuntimeError("Tool execution aborted");
      }
      return result;
    },
    { timeoutMs: timeout, label: "Tool execution", signal: config.signal },
  );
}

function getStructuredFailure(
  result: unknown,
): { message: string; failure: ToolFailureMetadata } | undefined {
  if (!isObjectValue(result) || result.success !== false) return undefined;
  const primaryMessage =
    typeof result.message === "string" && result.message.trim().length > 0
      ? result.message
      : typeof result.error === "string" && result.error.trim().length > 0
      ? result.error
      : undefined;
  if (!primaryMessage) return undefined;
  const message = normalizeToolFailureText({
    message: primaryMessage,
    stderr: typeof result.stderr === "string" ? result.stderr : undefined,
    stdout: typeof result.stdout === "string" ? result.stdout : undefined,
  });
  return {
    message,
    failure: buildToolFailureMetadata(
      message,
      isToolFailureMetadata(result.failure)
        ? result.failure
        : { source: "tool" },
    ),
  };
}

async function maybeEnrichPlaywrightFailureResult(
  toolCall: ToolCall,
  toolResult: ToolExecutionResult,
  sessionId?: string,
): Promise<ToolExecutionResult> {
  if (toolResult.success || !toolCall.toolName.startsWith("pw_")) {
    return toolResult;
  }
  const errorText = toolResult.error ?? toolResult.llmContent ?? "";
  const diagnostics = await capturePlaywrightFailureDiagnostics({
    errorText,
    failure: toolResult.failure,
    sessionId,
  });
  if (!diagnostics) {
    return toolResult;
  }
  return {
    ...toolResult,
    ...(diagnostics.diagnosticText
      ? { diagnosticText: diagnostics.diagnosticText }
      : {}),
    ...(diagnostics.imageAttachment
      ? {
        imageAttachments: [
          ...(toolResult.imageAttachments ?? []),
          diagnostics.imageAttachment,
        ],
      }
      : {}),
  };
}

async function maybeBuildEditFileRecoveryResult(
  toolCall: ToolCall,
  args: unknown,
  result: unknown,
  config: OrchestratorConfig,
): Promise<import("./error-taxonomy.ts").EditFileRecovery | undefined> {
  if (toolCall.toolName !== "edit_file") return undefined;

  const errorMessage = getStructuredFailure(result)?.message;
  const argRecord = isObjectValue(args) ? args : null;
  const path = typeof argRecord?.path === "string" ? argRecord.path : undefined;
  const find = typeof argRecord?.find === "string" ? argRecord.find : undefined;
  if (!errorMessage || !path || !find) return undefined;

  try {
    const resolvedPath = await resolveToolPath(
      path,
      config.workspace,
      config.policy ?? null,
    );
    const fileContent = await getPlatform().fs.readTextFile(resolvedPath);
    return buildEditFileRecovery({ path, find }, errorMessage, fileContent) ??
      undefined;
  } catch {
    return undefined;
  }
}

function buildEditFileAutoRetryArgs(
  args: unknown,
  recovery: import("./error-taxonomy.ts").EditFileRecovery | undefined,
): Record<string, unknown> | null {
  if (!recovery?.closestCurrentLine || !isObjectValue(args)) return null;

  const find = typeof args.find === "string" ? args.find : undefined;
  const replace = typeof args.replace === "string" ? args.replace : undefined;
  const mode = typeof args.mode === "string" ? args.mode : undefined;
  if (!find || mode === "regex") return null;
  if (find.includes("\n") || find.includes("\r")) return null;

  const nextFind = recovery.closestCurrentLine.trim();
  if (!nextFind || nextFind === find.trim()) return null;
  if (replace && nextFind === replace.trim()) return null;

  return {
    ...args,
    find: recovery.closestCurrentLine,
  };
}

/**
 * Execute single tool call
 */
export async function executeToolCall(
  toolCall: ToolCall,
  config: OrchestratorConfig,
  toolIndex = 0,
  toolTotal = 1,
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  const l1Store = config.l1Confirmations ?? new Map<string, boolean>();

  // Lazy MCP bootstrap: defer MCP connect+registration until a tool call needs it.
  if (
    config.ensureMcpLoaded &&
    (toolCall.toolName.startsWith("mcp_") ||
      toolCall.toolName === "tool_search")
  ) {
    await config.ensureMcpLoaded(config.signal);
  }

  // Normalize tool name (handle camelCase, casing, separators)
  const resolvedName =
    normalizeToolName(toolCall.toolName, config.toolOwnerId) ??
      toolCall.toolName;
  if (resolvedName !== toolCall.toolName) {
    getAgentLogger().debug(
      `Tool name normalized: ${toolCall.toolName} → ${resolvedName}`,
    );
    toolCall = { ...toolCall, toolName: resolvedName };
  }

  const normalizedArgs = sanitizeArgs(normalizeToolArgs(toolCall.args));
  let preparedArgs: ReturnType<typeof prepareToolArgsForExecution> | undefined;
  try {
    preparedArgs = prepareToolArgsForExecution(
      toolCall.toolName,
      normalizedArgs,
      config.toolOwnerId,
    );
  } catch {
    // Tool not found — handled below
  }
  const toolExists = preparedArgs !== undefined;
  const coercedArgs = preparedArgs?.coercedArgs ?? normalizedArgs;
  const preToolFeedback = await config.hookRuntime?.dispatchWithFeedback(
    "pre_tool",
    {
      workspace: config.workspace,
      toolName: toolCall.toolName,
      toolCallId: toolCall.id,
      modelId: config.modelId,
      sessionId: config.sessionId,
      turnId: config.turnId,
      args: coercedArgs,
      argsSummary: generateArgsSummary(toolCall.toolName, coercedArgs),
      toolIndex,
      toolTotal,
    },
  );
  if (preToolFeedback?.blocked) {
    const msg = preToolFeedback.feedback ??
      `Tool ${toolCall.toolName} was blocked by a pre_tool hook.`;
    return buildToolErrorResult(toolCall.toolName, msg, startedAt, config, toolCall.id);
  }
  // Emit trace event: tool call
  config.onTrace?.({
    type: "tool_call",
    toolName: toolCall.toolName,
    toolCallId: toolCall.id,
    args: coercedArgs,
  });
  config.onAgentEvent?.({
    type: "tool_start",
    name: toolCall.toolName,
    toolCallId: toolCall.id,
    argsSummary: generateArgsSummary(toolCall.toolName, coercedArgs),
    toolIndex,
    toolTotal,
  });

  try {
    // Validate tool exists
    if (!toolExists) {
      const suggestions = suggestToolNames(
        toolCall.toolName,
        config.toolOwnerId,
      );
      const hint = suggestions.length > 0
        ? ` Did you mean: ${suggestions.join(", ")}?`
        : "";
      return buildToolErrorResult(
        toolCall.toolName,
        `Unknown tool: ${toolCall.toolName}.${hint}`,
        startedAt,
        config,
        toolCall.id,
      );
    }

    const isToolAllowed = buildIsToolAllowed(config);
    if (!isToolAllowed(toolCall.toolName)) {
      // Hint model to use tool_search when the tool exists but isn't in the active set.
      const toolSearchAvailable = isToolAllowed("tool_search");
      const hint = toolSearchAvailable
        ? ` Use tool_search to discover and enable "${toolCall.toolName}".`
        : "";
      return buildToolErrorResult(
        toolCall.toolName,
        `Tool not available: ${toolCall.toolName}.${hint}`,
        startedAt,
        config,
        toolCall.id,
        buildToolFailureMetadata(
          `Tool not available: ${toolCall.toolName}.${hint}`,
          {
            source: "validation",
            kind: "unknown_tool",
            code: "tool_not_available",
            facts: {
              requestedTool: toolCall.toolName,
              toolSearchAvailable,
            },
          },
        ),
      );
    }

    const validation = preparedArgs?.validation ?? { valid: true };
    if (!validation.valid) {
      return buildToolErrorResult(
        toolCall.toolName,
        `Invalid arguments for ${toolCall.toolName}: ${
          validation.message ?? (validation.errors ?? []).join(" ")
        }`,
        startedAt,
        config,
        toolCall.id,
        validation.failure,
      );
    }

    if (toolCall.toolName === "ask_user") {
      // Block ask_user in headless mode
      if (config.permissionMode === "dontAsk") {
        return buildToolErrorResult(
          toolCall.toolName,
          "ask_user is blocked in non-interactive mode (--print). The agent must complete the task without user interaction.",
          startedAt,
          config,
          toolCall.id,
        );
      }

      // Block ask_user during plan execution
      if (
        config.planModeState?.active &&
        config.planModeState.phase === "executing"
      ) {
        return buildToolErrorResult(
          toolCall.toolName,
          "Approved plan execution should not ask new clarifying questions. Continue with best effort, or finish with a concise blocker summary instead.",
          startedAt,
          config,
          toolCall.id,
        );
      }
    }

    const mutatingTool = isMutatingTool(
      toolCall.toolName,
      config.toolOwnerId,
      toolCall.args,
    );
    if (mutatingTool && isPlanExecutionMode(config.permissionMode)) {
      return buildToolErrorResult(
        toolCall.toolName,
        "Plan mode does not allow mutating tools. Inspect the workspace, refine the plan, or ask the user to leave plan mode before editing.",
        startedAt,
        config,
        toolCall.id,
      );
    }
    if (
      mutatingTool &&
      config.planReview?.shouldGateMutatingTools() &&
      config.planReview.getCurrentPlan()
    ) {
      const plan = config.planReview.getCurrentPlan();
      if (plan) {
        try {
          const reviewDecision = await config.planReview.ensureApproved(plan);
          if (reviewDecision !== "approved") {
            return buildPlanReviewCancelledResult(
              toolCall,
              startedAt,
              config,
            );
          }
        } catch (error) {
          return buildPlanReviewCancelledResult(
            toolCall,
            startedAt,
            config,
            `Plan review failed before mutation: ${
              truncate(getErrorMessage(error), 120)
            }`,
          );
        }
      }
    }

    const safetyWarning = mutatingTool &&
        !supportsAutomaticCheckpoint(toolCall.toolName)
      ? "Automatic rollback is not available for this mutation."
      : undefined;

    // Check safety
    const permissionMode = config.permissionMode ?? "default";
    const toolPermissions = {
      allowedTools: config.permissionToolAllowlist
        ? new Set(config.permissionToolAllowlist)
        : new Set<string>(),
      deniedTools: config.permissionToolDenylist
        ? new Set(config.permissionToolDenylist)
        : new Set<string>(),
    };
    const approved = await checkToolSafety(
      toolCall.toolName,
      coercedArgs,
      permissionMode,
      config.policy ?? null,
      l1Store,
      config.toolOwnerId,
      config.onInteraction,
      safetyWarning,
      toolPermissions,
    );

    if (!approved) {
      return buildToolErrorResult(
        toolCall.toolName,
        `Tool execution denied: ${toolCall.toolName}${
          config.permissionMode === "dontAsk"
            ? " (unsafe tool blocked in non-interactive mode)"
            : ""
        }`,
        startedAt,
        config,
        toolCall.id,
        { source: "permission" },
      );
    }

    // Execute tool (with timeout)
    const tool = getTool(toolCall.toolName, config.toolOwnerId);
    const toolTimeout = getToolTimeoutMs(toolCall.toolName, config.toolTimeout);
    const currentToolAllowlist = effectiveAllowlist(config);
    const currentToolDenylist = effectiveDenylist(config);
    const runTool = (args: unknown = coercedArgs) =>
      executeToolWithTimeout({
        toolFn: tool.fn,
        toolCall,
        args,
        config,
        timeout: toolTimeout,
        toolAllowlist: currentToolAllowlist,
        toolDenylist: currentToolDenylist,
      });
    let result: unknown;
    try {
      result = await runTool();
    } catch (error) {
      const message = getErrorMessage(error);
      if (
        !isRenderToolName(toolCall.toolName) ||
        !isPlaywrightMissingError(message) ||
        !await ensurePlaywrightChromium(config)
      ) {
        return buildToolErrorResult(
          toolCall.toolName,
          message,
          startedAt,
          config,
          toolCall.id,
        );
      }
      result = await runTool();
    }

    let executedArgs = coercedArgs;
    let recovery = await maybeBuildEditFileRecoveryResult(
      toolCall,
      executedArgs,
      result,
      config,
    );
    const retryArgs = buildEditFileAutoRetryArgs(executedArgs, recovery);
    if (retryArgs) {
      const retriedResult = await runTool(retryArgs);
      if (isSuccessfulToolPayload(retriedResult)) {
        result = retriedResult;
        executedArgs = retryArgs;
        recovery = undefined;
      }
    }

    if (isFileWriteTool(toolCall.toolName) && isSuccessfulToolPayload(result)) {
      const verification = await maybeVerifyWrite(toolCall, config);
      if (verification) {
        await config.hookRuntime?.dispatch("write_verified", {
          toolName: toolCall.toolName,
          toolCallId: toolCall.id,
          modelId: config.modelId,
          sessionId: config.sessionId,
          path: typeof toolCall.args?.path === "string"
            ? toolCall.args.path
            : undefined,
          ok: verification.ok,
          source: verification.source,
          verifier: verification.verifier,
          summary: verification.summary,
          diagnostics: verification.diagnostics,
        });
        result = attachWriteVerification(result, verification);
      }
    }

    let structuredFailure = getStructuredFailure(result);
    if (structuredFailure) {
      // On-demand Chromium install: if a pw_* tool reports browser unavailable,
      // attempt auto-install and retry once before returning the failure.
      if (
        toolCall.toolName.startsWith("pw_") &&
        structuredFailure.failure.code === "pw_browser_unavailable" &&
        await ensurePlaywrightChromium(config)
      ) {
        result = await runTool();
        structuredFailure = getStructuredFailure(result);
      }
      if (structuredFailure) {
        const failureResult = buildToolErrorResult(
          toolCall.toolName,
          structuredFailure.message,
          startedAt,
          config,
          toolCall.id,
          structuredFailure.failure,
        );
        return await maybeEnrichPlaywrightFailureResult(
          toolCall,
          failureResult,
          config.sessionId,
        );
      }
    }

    const outputs = await buildToolResultOutputs(
      toolCall.toolName,
      result,
      config,
      toolCall.id,
    );
    emitToolSuccess(
      config,
      toolCall.toolName,
      toolCall.id,
      outputs,
      startedAt,
      executedArgs,
      result,
    );

    if (toolCall.toolName.startsWith("memory_")) {
      const activity = buildMemoryActivityEvent(toolCall, result);
      if (activity) config.onAgentEvent?.(activity);
    }

    if (toolCall.toolName === "todo_write" && config.todoState) {
      config.onAgentEvent?.({
        type: "todo_updated",
        todoState: {
          items: config.todoState.items.map((item) => ({ ...item })),
        },
        source: "tool",
      });
    }

    // Extract image attachments from computer-use tools (e.g., cu_screenshot)
    const imageAttachments = result &&
        typeof result === "object" &&
        "_imageAttachment" in (result as Record<string, unknown>)
      ? [
        (result as Record<string, unknown>)._imageAttachment as {
          data: string;
          mimeType: string;
          width?: number;
          height?: number;
        },
      ]
      : undefined;

    return {
      success: true,
      result,
      ...outputs,
      recovery,
      ...(imageAttachments ? { imageAttachments } : {}),
    };
  } catch (error) {
    const failureResult = buildToolErrorResult(
      toolCall.toolName,
      getErrorMessage(error),
      startedAt,
      config,
      toolCall.id,
    );
    return await maybeEnrichPlaywrightFailureResult(
      toolCall,
      failureResult,
      config.sessionId,
    );
  }
}

// ============================================================
// Auto-verify: syntax check after file writes
// ============================================================

const FILE_WRITE_TOOLS = new Set(["write_file", "edit_file"]);
const DENO_CONFIG_FILES = ["deno.json", "deno.jsonc"] as const;

export function isFileWriteTool(name: string): boolean {
  return FILE_WRITE_TOOLS.has(name);
}

const SYNTAX_CHECKER_TIMEOUT = 5000; // 5s — syntax checks should be fast

interface SyntaxVerificationResult {
  ok: boolean;
  source: "syntax";
  verifier: string;
  summary: string;
  diagnostics?: string;
}

function isSuccessfulToolPayload(result: unknown): boolean {
  return !isObjectValue(result) || result.success !== false;
}

function appendSentence(base: string, sentence: string): string {
  const normalized = base.trim();
  if (!normalized) return sentence;
  return /[.!?]$/.test(normalized)
    ? `${normalized} ${sentence}`
    : `${normalized}. ${sentence}`;
}

function attachWriteVerification(
  result: unknown,
  verification: WriteVerificationResult,
): unknown {
  if (!isObjectValue(result) || result.success !== true) return result;

  const message = typeof result.message === "string"
    ? result.message
    : "File operation completed";
  return {
    ...result,
    message: appendSentence(message, verification.summary),
    verification: {
      ok: verification.ok,
      source: verification.source,
      verifier: verification.verifier,
      diagnostics: verification.diagnostics,
    },
    ...(verification.source === "syntax"
      ? {
        syntaxCheck: {
          ok: verification.ok,
          command: verification.verifier,
          diagnostics: verification.diagnostics,
        },
      }
      : {}),
  };
}

async function resolveSyntaxCheckCommand(
  filePath: string,
  workspace: string,
): Promise<string[] | null> {
  const platform = getPlatform();
  const ext = platform.path.extname(filePath).toLowerCase();

  if (ext === ".ts" || ext === ".tsx") {
    for (const configName of DENO_CONFIG_FILES) {
      if (await platform.fs.exists(platform.path.join(workspace, configName))) {
        return ["deno", "check", filePath];
      }
    }
    return ["tsc", "--noEmit", "--pretty", "false", filePath];
  }
  if (ext === ".py") {
    return ["python3", "-m", "py_compile", filePath];
  }
  if (ext === ".js" || ext === ".jsx") {
    return ["node", "--check", filePath];
  }
  return null;
}

function describeSyntaxVerifier(cmd: string[]): string {
  if (cmd[0] === "deno" && cmd[1] === "check") return "deno check";
  if (cmd[0] === "tsc" && cmd.includes("--noEmit")) return "tsc --noEmit";
  if (cmd[0] === "node" && cmd[1] === "--check") return "node --check";
  if (
    cmd[0] === "python3" &&
    cmd[1] === "-m" &&
    cmd[2] === "py_compile"
  ) {
    return "python3 -m py_compile";
  }
  return cmd.join(" ");
}

/** Run a quick syntax check after a file write. Returns diagnostic info or null. */
export async function maybeVerifySyntax(
  toolCall: ToolCall,
  config: OrchestratorConfig,
): Promise<SyntaxVerificationResult | null> {
  const filePath = toolCall.args?.path;
  if (typeof filePath !== "string") return null;

  const platform = getPlatform();
  const workspace = config.workspace;
  const cmd = await resolveSyntaxCheckCommand(filePath, workspace);
  if (!cmd) return null;

  const verifier = describeSyntaxVerifier(cmd);
  if (classifyShellCommand(verifier).level === "L2") {
    return null;
  }

  try {
    const process = platform.command.run({
      cmd,
      cwd: workspace,
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    });

    const abortController = new AbortController();
    const streamSignal = config.signal
      ? AbortSignal.any([config.signal, abortController.signal])
      : abortController.signal;
    const abortHandler = createProcessAbortHandler(process, platform.build.os);
    let timedOut = false;

    const abortProcess = (): void => {
      abortController.abort();
      abortHandler.abort();
    };
    if (config.signal) {
      config.signal.addEventListener("abort", abortProcess, { once: true });
    }
    const timeoutId = setTimeout(() => {
      timedOut = true;
      abortProcess();
    }, SYNTAX_CHECKER_TIMEOUT);

    try {
      const [stdoutBytes, stderrBytes, status] = await Promise.all([
        readProcessStream(process.stdout, streamSignal),
        readProcessStream(process.stderr, streamSignal),
        process.status,
      ]);

      if (timedOut || config.signal?.aborted) {
        return null;
      }

      if (status.code !== 0) {
        const diag = new TextDecoder()
          .decode(stderrBytes.length > 0 ? stderrBytes : stdoutBytes)
          .trim();
        return {
          ok: false,
          source: "syntax",
          verifier,
          summary: `Syntax check failed via ${verifier}.`,
          diagnostics: truncate(diag, 500),
        };
      }

      return {
        ok: true,
        source: "syntax",
        verifier,
        summary: `Syntax check passed via ${verifier}.`,
      };
    } finally {
      clearTimeout(timeoutId);
      abortHandler.clear();
      if (config.signal) {
        config.signal.removeEventListener("abort", abortProcess);
      }
    }
  } catch {
    return null; // checker not available or timed out — don't block
  }
}

/** Try LSP diagnostics first, then fall back to one-shot syntax verification. */
export async function maybeVerifyWrite(
  toolCall: ToolCall,
  config: OrchestratorConfig,
): Promise<WriteVerificationResult | null> {
  const filePath = toolCall.args?.path;
  if (typeof filePath !== "string") return null;

  const lspVerification = await config.lspDiagnostics?.verifyFile(
    filePath,
    config.signal,
  );
  if (lspVerification) return lspVerification;

  return await maybeVerifySyntax(toolCall, config);
}

// ============================================================
// Memory tool event builder
// ============================================================

function buildMemoryActivityEvent(
  toolCall: ToolCall,
  result: unknown,
): Extract<AgentUIEvent, { type: "memory_activity" }> | null {
  if (
    toolCall.toolName === "memory_write" && result && typeof result === "object"
  ) {
    const r = result as Record<string, unknown>;
    const text = truncate(String(r.content ?? r.message ?? ""), 120);
    const factId = typeof r.factId === "number" ? r.factId : undefined;
    return {
      type: "memory_activity",
      recalled: [],
      written: [{ text, factId }],
    };
  }
  if (
    toolCall.toolName === "memory_search" && result &&
    typeof result === "object"
  ) {
    const r = result as Record<string, unknown>;
    const query = String(r.query ?? toolCall.args?.query ?? "");
    const count = typeof r.count === "number"
      ? r.count
      : Array.isArray(r.results)
      ? r.results.length
      : 0;
    return {
      type: "memory_activity",
      recalled: [],
      written: [],
      searched: { query, count },
    };
  }
  return null;
}

/**
 * Execute multiple tool calls
 *
 * Default: run consecutive concurrency-safe calls in parallel batches while
 * serializing mutating or otherwise unsafe calls.
 * When continueOnError is false, uses sequential execution to stop on first error.
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  config: OrchestratorConfig,
  rateLimiter?: SlidingWindowRateLimiter | null,
): Promise<ToolExecutionResult[]> {
  const continueOnError = config.continueOnError ?? true;
  const toolLimiter = rateLimiter ?? config.toolRateLimiter ??
    createRateLimiter(config.toolRateLimit ?? RATE_LIMITS.toolCalls);

  const checkRateLimit = (): ToolExecutionResult | null => {
    if (!toolLimiter) return null;
    const status = toolLimiter.consume(1);
    if (status.allowed) return null;
    config.onTrace?.({
      type: "rate_limit",
      target: "tool",
      maxCalls: status.maxCalls,
      windowMs: status.windowMs,
      used: status.used,
      remaining: status.remaining,
      resetMs: status.resetMs,
    });
    return {
      success: false,
      error:
        `Tool rate limit exceeded (${status.used}/${status.maxCalls} per ${status.windowMs}ms)`,
    };
  };

  const total = toolCalls.length;

  // Sequential execution: stop on first error
  if (!continueOnError) {
    const results: ToolExecutionResult[] = [];
    for (let i = 0; i < toolCalls.length; i++) {
      const rateLimited = checkRateLimit();
      if (rateLimited) {
        results.push(rateLimited);
        break;
      }
      const result = await executeToolCall(toolCalls[i], config, i, total);
      results.push(result);
      if (!result.success) break;
    }
    return results;
  }

  type ToolExecutionBatch =
    | {
      kind: "parallel";
      startIndex: number;
      calls: ToolCall[];
    }
    | {
      kind: "serial";
      startIndex: number;
      calls: [ToolCall];
    };

  const partitionToolCalls = (): ToolExecutionBatch[] => {
    const batches: ToolExecutionBatch[] = [];
    let safeBatchStart = -1;
    let safeBatchCalls: ToolCall[] = [];

    const flushSafeBatch = (): void => {
      if (safeBatchCalls.length === 0 || safeBatchStart < 0) return;
      batches.push({
        kind: "parallel",
        startIndex: safeBatchStart,
        calls: safeBatchCalls,
      });
      safeBatchStart = -1;
      safeBatchCalls = [];
    };

    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      const resolvedName =
        normalizeToolName(call.toolName, config.toolOwnerId) ??
          call.toolName;
      let concurrencySafe = false;
      try {
        concurrencySafe = isToolConcurrencySafe(
          resolvedName,
          config.toolOwnerId,
        );
      } catch {
        concurrencySafe = false;
      }
      if (concurrencySafe) {
        if (safeBatchCalls.length === 0) {
          safeBatchStart = i;
        }
        safeBatchCalls.push(call);
        continue;
      }
      flushSafeBatch();
      batches.push({
        kind: "serial",
        startIndex: i,
        calls: [call],
      });
    }

    flushSafeBatch();
    return batches;
  };

  const results = new Array<ToolExecutionResult>(toolCalls.length);
  const deniedToolsThisTurn = new Set<string>();
  for (const batch of partitionToolCalls()) {
    if (batch.kind === "parallel") {
      const batchResults = await Promise.all(
        batch.calls.map((call, offset): Promise<ToolExecutionResult> => {
          const rateLimited = checkRateLimit();
          if (rateLimited) return Promise.resolve(rateLimited);
          return executeToolCall(
            call,
            config,
            batch.startIndex + offset,
            total,
          );
        }),
      );
      for (let offset = 0; offset < batchResults.length; offset++) {
        results[batch.startIndex + offset] = batchResults[offset];
      }
      continue;
    }

    const rateLimited = checkRateLimit();
    const call = batch.calls[0];
    const normalizedName =
      normalizeToolName(call.toolName, config.toolOwnerId) ??
        call.toolName;
    if (deniedToolsThisTurn.has(normalizedName)) {
      results[batch.startIndex] = buildToolErrorResult(
        call.toolName,
        `Tool execution denied: ${call.toolName}`,
        Date.now(),
        config,
        call.id,
        { source: "permission" },
      );
      continue;
    }

    const result = rateLimited ??
      await executeToolCall(
        call,
        config,
        batch.startIndex,
        total,
      );
    results[batch.startIndex] = result;
    if (!result.success && result.failure?.kind === "permission_denied") {
      deniedToolsThisTurn.add(normalizedName);
    }
  }

  return results;
}
