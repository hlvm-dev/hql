/**
 * Agent mode handlers: HLVM agent and Claude Code subprocess delegation.
 * Extracted from chat.ts for modularity.
 */

import {
  ensureAgentReady,
  runAgentQuery,
} from "../../../agent/agent-runner.ts";
import { DEFAULT_TOOL_DENYLIST } from "../../../agent/constants.ts";
import {
  isMainThreadQuerySource,
  resolveQueryToolAllowlist,
} from "../../../agent/query-tool-routing.ts";
import {
  invalidateReplLiveAgentSession,
  resolveReplLiveAgentSession,
  setReplLiveAgentSession,
} from "../../../agent/repl-live-session-cache.ts";
import {
  getMessage,
  getSession,
  insertMessage,
  updateMessage,
  updateSession,
} from "../../../store/conversation-store.ts";
import { pushSSEEvent } from "../../../store/sse-store.ts";
import { loadAllMessages } from "../../../store/message-utils.ts";
import type { ModelInfo } from "../../../providers/types.ts";
import { toRuntimeSessionMessage } from "../../../runtime/session-protocol.ts";
import { config } from "../../../api/config.ts";
import { log } from "../../../api/log.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { RuntimeError, ValidationError } from "../../../../common/error.ts";
import { AI_NO_OUTPUT_FALLBACK_TEXT } from "../../../../common/ai-messages.ts";
import { getPermissionMode } from "../../../../common/config/selectors.ts";
import {
  buildClaudeCodeCommand,
  captureSessionIdFromInitEvent,
  parseSessionMemoryMetadata,
  resolveSessionMemoryEnabled,
} from "./session-memory.ts";
import type { ChatRequest } from "./chat-session.ts";
import {
  AGENT_CONTEXT_HISTORY_LIMIT,
  awaitInteractionResponse,
  getAgentReadyPromise,
  getLastUserMessage,
  pushConversationUpdatedEvent,
  setAgentReadyPromise,
} from "./chat-session.ts";
import { streamDirectChatFallback } from "./chat-direct.ts";
import {
  buildAgentHistoryMessages,
  resolveAttachments,
  shouldHonorRequestMessages,
} from "./chat-context.ts";
import {
  getConversationMaterializationOptionsForModel,
} from "../../attachment-policy.ts";
import type { ChatResultStats } from "../../../runtime/chat-protocol.ts";
import {
  buildTraceTextPreview,
  summarizeTraceEvent,
  traceReplMainThreadForSource,
} from "../../../repl-main-thread-trace.ts";

export async function handleAgentMode(
  body: ChatRequest,
  sessionId: string,
  resolvedModel: string,
  assistantMessageId: number,
  signal: AbortSignal,
  emit: (obj: unknown) => void,
  onPartial: (text: string) => void,
  requestId: string,
  preTurnSessionVersion: number,
  modelInfo?: ModelInfo | null,
): Promise<ChatResultStats> {
  const handlerStartedAt = Date.now();
  const effectiveToolDenylist = body.tool_denylist?.length
    ? [...body.tool_denylist]
    : [...DEFAULT_TOOL_DENYLIST];
  const fixturePath = typeof body.fixture_path === "string" &&
      body.fixture_path.trim()
    ? body.fixture_path.trim()
    : undefined;
  traceReplMainThreadForSource(body.query_source, "server.agent.handle.start", {
    requestId,
    sessionId,
    model: resolvedModel,
    fixturePath: !!fixturePath,
    queryPreview: buildTraceTextPreview(getLastUserMessage(body.messages)?.content),
  });
  if (!fixturePath) {
    const agentReadyStartedAt = Date.now();
    let agentReadyPromise = getAgentReadyPromise(resolvedModel);
    if (!agentReadyPromise) {
      agentReadyPromise = ensureAgentReady(
        resolvedModel,
        (msg) => log.info(msg),
      )
        .catch((err) => {
          setAgentReadyPromise(resolvedModel, null);
          throw err;
        });
      setAgentReadyPromise(resolvedModel, agentReadyPromise);
    }
    await agentReadyPromise;
    traceReplMainThreadForSource(body.query_source, "server.agent.ensure_ready.done", {
      requestId,
      sessionId,
      durationMs: Date.now() - agentReadyStartedAt,
      model: resolvedModel,
    });
  }

  const workingDirectory = getPlatform().process.cwd();
  const lastUserMessage = getLastUserMessage(body.messages);
  const query = lastUserMessage?.content ?? "";
  const attachmentMaterializationOptions =
    await getConversationMaterializationOptionsForModel(
      resolvedModel,
      modelInfo ?? null,
    );
  const attachments = await resolveAttachments(
    lastUserMessage?.attachment_ids,
    attachmentMaterializationOptions,
  );
  const toolAllowlist = resolveQueryToolAllowlist(body.tool_allowlist);
  const permissionMode = body.permission_mode ??
    getPermissionMode(config.snapshot) ??
    "default";
  const mainThreadQuery = isMainThreadQuerySource(body.query_source);
  const requestOverridesStoredHistory = shouldHonorRequestMessages(body.messages);
  const hotSessionReusableTurn = mainThreadQuery &&
    !fixturePath &&
    !requestOverridesStoredHistory &&
    body.skip_session_history !== true &&
    attachments.length === 0 &&
    body.response_schema === undefined &&
    body.computer_use !== true;
  let hotSessionInvalidationReason: string | undefined;
  let liveSessionEntry: ReturnType<typeof resolveReplLiveAgentSession>["entry"];
  let historyStrategy: "live_session" | "persisted_replay" = "persisted_replay";

  if (mainThreadQuery && !hotSessionReusableTurn) {
    hotSessionInvalidationReason = requestOverridesStoredHistory
      ? "request_messages_override"
      : body.skip_session_history === true
      ? "skip_session_history"
      : attachments.length > 0
      ? "attachments_present"
      : body.response_schema !== undefined
      ? "structured_output_requested"
      : body.computer_use === true
      ? "computer_use_requested"
      : undefined;
    invalidateReplLiveAgentSession(sessionId);
  } else if (hotSessionReusableTurn) {
    const liveSessionResult = resolveReplLiveAgentSession({
      sessionId,
      expectedSessionVersion: preTurnSessionVersion,
      model: resolvedModel,
      querySource: body.query_source,
      permissionMode,
      toolAllowlist,
      toolDenylist: effectiveToolDenylist,
    });
    liveSessionEntry = liveSessionResult.entry;
    hotSessionInvalidationReason = liveSessionResult.invalidationReason;
    if (liveSessionResult.hotSessionReuse) {
      historyStrategy = "live_session";
    }
  }

  const history = historyStrategy === "live_session"
    ? []
    : await buildAgentHistoryMessages({
      requestMessages: body.messages,
      storedMessages: requestOverridesStoredHistory
        ? []
        : loadAllMessages(sessionId),
      assistantMessageId,
      maxGroups: AGENT_CONTEXT_HISTORY_LIMIT,
      modelKey: resolvedModel,
      modelInfo,
    });
  const messageHistory = historyStrategy === "live_session" ? undefined : history;

  let streamedFinalText = false;
  let successfulToolCalls = 0;
  let failedToolCalls = 0;
  traceReplMainThreadForSource(body.query_source, "server.agent.context_ready", {
    requestId,
    sessionId,
    historyCount: history.length,
    historyStrategy,
    hotSessionReuse: historyStrategy === "live_session",
    hotSessionInvalidationReason: hotSessionInvalidationReason ?? null,
    attachmentCount: attachments.length,
    toolAllowlistCount: toolAllowlist?.length ?? 0,
    toolDenylistCount: effectiveToolDenylist.length,
  });

  let result: Awaited<ReturnType<typeof runAgentQuery>>;
  try {
    result = await runAgentQuery({
      query,
      model: resolvedModel,
      querySource: body.query_source,
      requestId,
      sessionId,
      transcriptPersistenceMode: "caller",
      permissionMode,
      noInput: false,
      signal,
      toolAllowlist,
      toolDenylist: effectiveToolDenylist,
      workspace: workingDirectory,
      maxOutputTokens: body.max_tokens,
      contextWindow: body.context_window,
      fixturePath,
      skipSessionHistory: body.skip_session_history === true,
      skipPersistedHistoryReplay: historyStrategy === "live_session",
      disablePersistentMemory: body.disable_persistent_memory === true,
      messageHistory,
      attachments: attachments.length > 0 ? attachments : undefined,
      responseSchema: body.response_schema,
      computerUse: body.computer_use === true,
      modelInfo,
      reusableSession: liveSessionEntry?.session,
      retainSessionForReuse: hotSessionReusableTurn,
      callbacks: {
        onToken: (text: string) => {
          streamedFinalText = true;
          onPartial(text);
          emit({ event: "token", text });
        },
        onInteraction: async (event) => {
          return await awaitInteractionResponse(event, signal, emit);
        },
        onAgentEvent: (event) => {
        switch (event.type) {
          case "tool_start":
            traceReplMainThreadForSource(body.query_source, "server.agent.tool_start", {
              requestId,
              sessionId,
              name: event.name,
              toolCallId: event.toolCallId,
              toolIndex: event.toolIndex,
              toolTotal: event.toolTotal,
              argsSummary: event.argsSummary,
            });
            break;
          case "tool_end":
            traceReplMainThreadForSource(body.query_source, "server.agent.tool_end", {
              requestId,
              sessionId,
              name: event.name,
              toolCallId: event.toolCallId,
              success: event.success,
              durationMs: event.durationMs,
              summary: event.summary,
            });
            break;
          case "delegate_start":
            traceReplMainThreadForSource(body.query_source, "server.agent.delegate_start", {
              requestId,
              sessionId,
              agent: event.agent,
              task: buildTraceTextPreview(event.task, 120),
              threadId: event.threadId,
            });
            break;
          case "delegate_end":
            traceReplMainThreadForSource(body.query_source, "server.agent.delegate_end", {
              requestId,
              sessionId,
              agent: event.agent,
              success: event.success,
              durationMs: event.durationMs,
              threadId: event.threadId,
              summary: buildTraceTextPreview(event.summary, 120),
              error: event.error,
            });
            break;
          case "turn_stats":
            traceReplMainThreadForSource(body.query_source, "server.agent.turn_stats", {
              requestId,
              sessionId,
              iteration: event.iteration,
              toolCount: event.toolCount,
              durationMs: event.durationMs,
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              modelId: event.modelId,
              continuedThisTurn: event.continuedThisTurn,
              continuationCount: event.continuationCount,
              compactionReason: event.compactionReason,
            });
            break;
        }
        switch (event.type) {
          case "thinking":
            emit({ event: "thinking", iteration: event.iteration });
            break;
          case "tool_start":
            emit({
              event: "tool_start",
              name: event.name,
              tool_call_id: event.toolCallId,
              args_summary: event.argsSummary,
              tool_index: event.toolIndex,
              tool_total: event.toolTotal,
            });
            break;
          case "tool_progress":
            emit({
              event: "tool_progress",
              name: event.name,
              tool_call_id: event.toolCallId,
              args_summary: event.argsSummary,
              message: event.message,
              tone: event.tone,
              phase: event.phase,
            });
            break;
          case "tool_end": {
            if (event.success) {
              successfulToolCalls += 1;
            } else {
              failedToolCalls += 1;
            }
            const toolMsg = insertMessage({
              session_id: sessionId,
              role: "tool",
              content: event.content ?? "",
              tool_name: event.name,
              sender_type: "agent",
              request_id: requestId,
            });
            pushSSEEvent(sessionId, "message_added", {
              message: toolMsg,
            });
            pushConversationUpdatedEvent(sessionId);
            emit({
              event: "tool_end",
              name: event.name,
              tool_call_id: event.toolCallId,
              success: event.success,
              content: event.content,
              summary: event.summary,
              duration_ms: event.durationMs,
              args_summary: event.argsSummary,
              meta: event.meta,
            });
            break;
          }
          case "reasoning_update":
            emit({
              event: "reasoning_update",
              iteration: event.iteration,
              summary: event.summary,
            });
            break;
          case "planning_update":
            emit({
              event: "planning_update",
              iteration: event.iteration,
              summary: event.summary,
            });
            break;
          case "delegate_start":
            emit({
              event: "delegate_start",
              agent: event.agent,
              task: event.task,
              thread_id: event.threadId,
              nickname: event.nickname,
              child_session_id: event.childSessionId,
              batch_id: event.batchId,
            });
            break;
          case "delegate_running":
            emit({
              event: "delegate_running",
              thread_id: event.threadId,
            });
            break;
          case "delegate_end":
            emit({
              event: "delegate_end",
              agent: event.agent,
              task: event.task,
              success: event.success,
              summary: event.summary,
              duration_ms: event.durationMs,
              error: event.error,
              snapshot: event.snapshot,
              child_session_id: event.childSessionId,
              thread_id: event.threadId,
              batch_id: event.batchId,
            });
            break;
          case "todo_updated":
            emit({
              event: "todo_updated",
              todo_state: event.todoState,
              source: event.source,
            });
            break;
          case "team_task_updated":
            emit({
              event: "team_task_updated",
              task_id: event.taskId,
              goal: event.goal,
              status: event.status,
              assignee_member_id: event.assigneeMemberId,
            });
            break;
          case "team_message":
            emit({
              event: "team_message",
              kind: event.kind,
              from_member_id: event.fromMemberId,
              to_member_id: event.toMemberId,
              related_task_id: event.relatedTaskId,
              content_preview: event.contentPreview,
            });
            break;
          case "team_member_activity":
            emit({
              event: "team_member_activity",
              member_id: event.memberId,
              member_label: event.memberLabel,
              thread_id: event.threadId,
              activity_kind: event.activityKind,
              summary: event.summary,
              status: event.status,
            });
            break;
          case "team_plan_review_required":
            emit({
              event: "team_plan_review_required",
              approval_id: event.approvalId,
              task_id: event.taskId,
              submitted_by_member_id: event.submittedByMemberId,
            });
            break;
          case "team_plan_review_resolved":
            emit({
              event: "team_plan_review_resolved",
              approval_id: event.approvalId,
              task_id: event.taskId,
              submitted_by_member_id: event.submittedByMemberId,
              approved: event.approved,
              reviewed_by_member_id: event.reviewedByMemberId,
            });
            break;
          case "team_shutdown_requested":
            emit({
              event: "team_shutdown_requested",
              request_id: event.requestId,
              member_id: event.memberId,
              requested_by_member_id: event.requestedByMemberId,
              reason: event.reason,
            });
            break;
          case "team_shutdown_resolved":
            emit({
              event: "team_shutdown_resolved",
              request_id: event.requestId,
              member_id: event.memberId,
              requested_by_member_id: event.requestedByMemberId,
              status: event.status,
            });
            break;
          case "batch_progress_updated":
            emit({
              event: "batch_progress_updated",
              snapshot: event.snapshot,
            });
            break;
          case "plan_phase_changed":
            emit({
              event: "plan_phase_changed",
              phase: event.phase,
            });
            break;
          case "plan_created":
            emit({
              event: "plan_created",
              plan: event.plan,
            });
            break;
          case "plan_step":
            emit({
              event: "plan_step",
              step_id: event.stepId,
              index: event.index,
              completed: event.completed,
            });
            break;
          case "plan_review_required":
            emit({
              event: "plan_review_required",
              plan: event.plan,
            });
            break;
          case "plan_review_resolved":
            emit({
              event: "plan_review_resolved",
              plan: event.plan,
              approved: event.approved,
              decision: event.decision,
            });
            break;
          case "turn_stats":
            emit({
              event: "turn_stats",
              iteration: event.iteration,
              tool_count: event.toolCount,
              duration_ms: event.durationMs,
              input_tokens: event.inputTokens,
              output_tokens: event.outputTokens,
              model_id: event.modelId,
              cost_usd: event.costUsd,
              cost_estimated: event.costEstimated,
              continued_this_turn: event.continuedThisTurn,
              continuation_count: event.continuationCount,
              compaction_reason: event.compactionReason,
            });
            break;
          case "interaction_request":
            break;
        }
      },
        onTrace: body.trace
          ? (trace) => {
            traceReplMainThreadForSource(body.query_source, "server.agent.trace", {
              requestId,
              sessionId,
              ...summarizeTraceEvent(trace),
            });
            emit({ event: "trace", trace });
          }
          : undefined,
        onFinalResponseMeta: (meta) =>
          emit({ event: "final_response_meta", meta }),
      },
    });
  } catch (error) {
    if (hotSessionReusableTurn) {
      invalidateReplLiveAgentSession(sessionId);
    }
    traceReplMainThreadForSource(body.query_source, "server.agent.handle.error", {
      requestId,
      sessionId,
      durationMs: Date.now() - handlerStartedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  traceReplMainThreadForSource(body.query_source, "server.agent.handle.done", {
    requestId,
    sessionId,
    durationMs: Date.now() - handlerStartedAt,
    textChars: result.text.length,
    successfulToolCalls,
    failedToolCalls,
  });

  if (!signal.aborted) {
    let finalText = result.text;
    let usedDirectChatFallback = false;
    const structuredResponseRequested = !!body.response_schema;
    const shouldFallbackToDirectChat = !structuredResponseRequested &&
      (
        result.finalResponseState.suppressFinalResponse ||
        result.finalResponseState.orchestratorFailureCode !== null ||
        (failedToolCalls > 0 && successfulToolCalls === 0 && !finalText.trim())
      );
    if (shouldFallbackToDirectChat) {
      traceReplMainThreadForSource(body.query_source, "server.agent.direct_chat_fallback.start", {
        requestId,
        sessionId,
      });
      const fallbackText = await streamDirectChatFallback(
        body.messages,
        sessionId,
        assistantMessageId,
        resolvedModel,
        body,
        signal,
        emit,
        onPartial,
        modelInfo,
      );
      if (fallbackText.trim().length > 0) {
        finalText = fallbackText;
        streamedFinalText = true;
        usedDirectChatFallback = true;
      }
      traceReplMainThreadForSource(body.query_source, "server.agent.direct_chat_fallback.done", {
        requestId,
        sessionId,
        textChars: fallbackText.length,
      });
    }

    if (finalText.trim().length === 0) {
      finalText = AI_NO_OUTPUT_FALLBACK_TEXT;
      streamedFinalText = false;
    }

    if (result.structuredResult !== undefined) {
      emit({
        event: "structured_result",
        result: result.structuredResult,
      });
    } else if (!streamedFinalText) {
      onPartial(finalText);
      emit({ event: "token", text: finalText });
    }

    updateMessage(assistantMessageId, { content: finalText });
    const updatedAssistant = getMessage(assistantMessageId);
    pushSSEEvent(sessionId, "message_updated", {
      message: updatedAssistant
        ? await toRuntimeSessionMessage(updatedAssistant)
        : {
          id: assistantMessageId,
          content: finalText,
        },
    });
    pushConversationUpdatedEvent(sessionId);
    if (hotSessionReusableTurn && usedDirectChatFallback) {
      invalidateReplLiveAgentSession(sessionId);
      if (historyStrategy !== "live_session" && result.liveSession) {
        await result.liveSession.dispose().catch(() => {});
      }
    } else if (hotSessionReusableTurn && result.liveSession) {
      const updatedSession = getSession(sessionId);
      setReplLiveAgentSession(sessionId, {
        session: result.liveSession,
        lastSessionVersion: updatedSession?.session_version ?? preTurnSessionVersion,
        model: resolvedModel,
        querySource: body.query_source,
        permissionMode,
        toolAllowlist,
        toolDenylist: effectiveToolDenylist,
      });
    }
  } else if (hotSessionReusableTurn) {
    invalidateReplLiveAgentSession(sessionId);
  }

  emit({ event: "result_stats", stats: result.stats });
  return result.stats;
}

/** Claude Code Agent Mode — delegates the entire agentic loop to Claude Code CLI. */
export async function handleClaudeCodeAgentMode(
  body: ChatRequest,
  sessionId: string,
  assistantMessageId: number,
  signal: AbortSignal,
  emit: (obj: unknown) => void,
  onPartial: (text: string) => void,
): Promise<void> {
  const lastUserMessage = getLastUserMessage(body.messages);
  const query = lastUserMessage?.content ?? "";

  if (!query.trim()) {
    throw new ValidationError(
      "Empty query for Claude Code agent",
      "claude_code_agent_mode",
    );
  }

  const cfgSnapshot = config.snapshot;
  const sessionMemoryEnabled = resolveSessionMemoryEnabled(
    cfgSnapshot.sessionMemory,
    body.disable_persistent_memory === true,
  );

  let claudeCodeSessionId: string | null = null;
  let existingMeta: Record<string, unknown> = {};
  if (sessionMemoryEnabled) {
    const session = getSession(sessionId);
    const parsedMeta = parseSessionMemoryMetadata(session?.metadata);
    existingMeta = parsedMeta.existingMeta;
    claudeCodeSessionId = parsedMeta.claudeCodeSessionId;
  }

  const result = await spawnClaudeCodeProcess(
    query,
    claudeCodeSessionId,
    sessionId,
    assistantMessageId,
    sessionMemoryEnabled,
    existingMeta,
    signal,
    emit,
    onPartial,
  );

  if (!result.success && !signal.aborted) {
    if (claudeCodeSessionId) {
      log.info(
        `Claude Code --resume failed (session ${claudeCodeSessionId}), retrying fresh`,
      );
      existingMeta.claudeCodeSessionId = undefined;
      updateSession(sessionId, {
        metadata: JSON.stringify(existingMeta),
      });
      const retryResult = await spawnClaudeCodeProcess(
        query,
        null,
        sessionId,
        assistantMessageId,
        sessionMemoryEnabled,
        existingMeta,
        signal,
        emit,
        onPartial,
      );
      if (!retryResult.success && !signal.aborted) {
        throw new RuntimeError(
          retryResult.error ?? "Claude Code failed after retry",
        );
      }
    } else {
      throw new RuntimeError(result.error ?? "Claude Code failed");
    }
  }
}

function processClaudeCodeJsonLine(
  trimmed: string,
  state: { fullText: string },
  sessionMemoryEnabled: boolean,
  claudeCodeSessionId: string | null,
  existingMeta: Record<string, unknown>,
  hlvmSessionId: string,
  emit: (obj: unknown) => void,
  onPartial: (text: string) => void,
): void {
  try {
    const event = JSON.parse(trimmed);

    if (
      captureSessionIdFromInitEvent(
        event,
        sessionMemoryEnabled,
        claudeCodeSessionId,
        existingMeta,
      )
    ) {
      updateSession(hlvmSessionId, { metadata: JSON.stringify(existingMeta) });
    }

    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          state.fullText += block.text;
          onPartial(block.text);
          emit({ event: "token", text: block.text });
        }
      }
    } else if (event.type === "content_block_delta" && event.delta?.text) {
      state.fullText += event.delta.text;
      onPartial(event.delta.text);
      emit({ event: "token", text: event.delta.text });
    } else if (event.type === "result" && event.result) {
      if (typeof event.result === "string" && event.result.length > 0) {
        state.fullText = event.result;
      }
    }
  } catch (e) {
    if (trimmed.length > 0) {
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        log.warn(
          `Failed to parse JSON-like Claude Code output: ${
            trimmed.slice(0, 120)
          }`,
          e,
        );
        emit({
          event: "warning",
          message: "Unparseable JSON in Claude Code stream",
        });
      }
      state.fullText += trimmed + "\n";
      onPartial(trimmed + "\n");
      emit({ event: "token", text: trimmed + "\n" });
    }
  }
}

function buildClaudeSubprocessEnv(): Record<string, string> {
  const platform = getPlatform();
  const env = platform.env.toObject();

  const home = env.HOME ?? "";

  if (!env.USER && home) {
    const parts = home.split("/").filter(Boolean);
    env.USER = parts[parts.length - 1] ?? "";
  }
  if (!env.LOGNAME) env.LOGNAME = env.USER ?? "";

  if (!env.TMPDIR) env.TMPDIR = "/tmp";
  if (!env.SHELL) env.SHELL = "/bin/zsh";
  if (!env.LANG) env.LANG = "en_US.UTF-8";
  if (!env.TERM) env.TERM = "xterm-256color";

  if (home && env.PATH && !env.PATH.includes(`${home}/.local/bin`)) {
    env.PATH = `${home}/.local/bin:${env.PATH}`;
  }

  return env;
}

async function spawnClaudeCodeProcess(
  query: string,
  claudeCodeSessionId: string | null,
  hlvmSessionId: string,
  assistantMessageId: number,
  sessionMemoryEnabled: boolean,
  existingMeta: Record<string, unknown>,
  signal: AbortSignal,
  emit: (obj: unknown) => void,
  onPartial: (text: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const platform = getPlatform();

  const cmd = buildClaudeCodeCommand(query, claudeCodeSessionId);
  const proc = platform.command.run({
    cmd,
    env: buildClaudeSubprocessEnv(),
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  });
  const onAbort = () => {
    proc.kill?.("SIGTERM");
  };
  signal.addEventListener("abort", onAbort, { once: true });

  let fullText = "";

  try {
    const stdout = proc.stdout as ReadableStream<Uint8Array> | undefined;
    if (!stdout) {
      return { success: false, error: "Failed to capture Claude Code output" };
    }

    const stderrPromise = (async () => {
      const stderr = proc.stderr as ReadableStream<Uint8Array> | undefined;
      if (!stderr) return "";
      try {
        const errReader = stderr.getReader();
        const chunks: string[] = [];
        while (true) {
          const { done: errDone, value: errValue } = await errReader.read();
          if (errDone) break;
          chunks.push(new TextDecoder().decode(errValue));
        }
        return chunks.join("").trim();
      } catch {
        return "";
      }
    })();

    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const textState = { fullText };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        processClaudeCodeJsonLine(
          trimmed,
          textState,
          sessionMemoryEnabled,
          claudeCodeSessionId,
          existingMeta,
          hlvmSessionId,
          emit,
          onPartial,
        );
      }
    }

    const residual = buffer.trim();
    if (residual) {
      processClaudeCodeJsonLine(
        residual,
        textState,
        sessionMemoryEnabled,
        claudeCodeSessionId,
        existingMeta,
        hlvmSessionId,
        emit,
        onPartial,
      );
    }

    fullText = textState.fullText;

    const result = await proc.status;
    if (!result.success && !signal.aborted) {
      const errText = await stderrPromise;
      const errMsg = errText || `Claude Code exited with code ${result.code}`;
      return { success: false, error: errMsg };
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }

  if (!signal.aborted) {
    updateMessage(assistantMessageId, { content: fullText });
    const updatedAssistant = getMessage(assistantMessageId);
    pushSSEEvent(hlvmSessionId, "message_updated", {
      message: updatedAssistant
        ? await toRuntimeSessionMessage(updatedAssistant)
        : {
          id: assistantMessageId,
          content: fullText,
        },
    });
    pushConversationUpdatedEvent(hlvmSessionId);
  }

  return { success: true };
}
