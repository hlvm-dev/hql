/**
 * Agent mode handlers: HLVM agent and Claude Code subprocess delegation.
 * Extracted from chat.ts for modularity.
 */

import {
  ensureAgentReady,
  getOrCreateCachedSession,
  runAgentQuery,
} from "../../../agent/agent-runner.ts";
import { DEFAULT_TOOL_DENYLIST } from "../../../agent/constants.ts";
import { resolveQueryToolAllowlist } from "../../../agent/query-tool-routing.ts";
import {
  getSession,
  insertMessage,
  updateMessage,
  updateSession,
} from "../../../store/conversation-store.ts";
import { pushSSEEvent } from "../../../store/sse-store.ts";
import { loadAllMessages } from "../../../store/message-utils.ts";
import type { ModelInfo } from "../../../providers/types.ts";
import { config } from "../../../api/config.ts";
import type { PermissionMode } from "../../../../common/config/types.ts";
import { log } from "../../../api/log.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { RuntimeError, ValidationError } from "../../../../common/error.ts";
import { AI_NO_OUTPUT_FALLBACK_TEXT } from "../../../../common/ai-messages.ts";
import {
  buildClaudeCodeCommand,
  captureSessionIdFromInitEvent,
  isSessionMemoryEnabled,
  parseSessionMemoryMetadata,
} from "./session-memory.ts";
import type { ChatRequest } from "./chat-session.ts";
import {
  AGENT_CONTEXT_HISTORY_LIMIT,
  awaitInteractionResponse,
  getAgentReadyPromise,
  getLastUserMessage,
  pushSessionUpdatedEvent,
  setAgentReadyPromise,
} from "./chat-session.ts";
import { streamDirectChatFallback } from "./chat-direct.ts";
import {
  buildAgentHistoryMessages,
  shouldHonorRequestMessages,
} from "./chat-context.ts";
import type { ChatResultStats } from "../../../runtime/chat-protocol.ts";

export async function handleAgentMode(
  body: ChatRequest,
  resolvedModel: string,
  assistantMessageId: number,
  signal: AbortSignal,
  emit: (obj: unknown) => void,
  onPartial: (text: string) => void,
  requestId: string,
  modelInfo?: ModelInfo | null,
): Promise<ChatResultStats> {
  const effectiveToolDenylist = body.tool_denylist?.length
    ? [...body.tool_denylist]
    : [...DEFAULT_TOOL_DENYLIST];
  const fixturePath = typeof body.fixture_path === "string" &&
      body.fixture_path.trim()
    ? body.fixture_path.trim()
    : undefined;
  if (!fixturePath) {
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
  }

  const workspace = getPlatform().process.cwd();
  const resolvedWorkspace = body.workspace?.trim() || workspace;
  const lastUserMessage = getLastUserMessage(body.messages);
  const query = lastUserMessage?.content ?? "";
  const toolAllowlist = resolveQueryToolAllowlist(query);
  const cachedSession = fixturePath
    ? undefined
    : await getOrCreateCachedSession(
      resolvedWorkspace,
      resolvedModel,
      {
        toolAllowlist,
        toolDenylist: effectiveToolDenylist,
        modelInfo,
      },
    );

  const history = await buildAgentHistoryMessages({
    requestMessages: body.messages,
    storedMessages: shouldHonorRequestMessages(body.messages)
      ? []
      : loadAllMessages(body.session_id),
    assistantMessageId,
    maxGroups: AGENT_CONTEXT_HISTORY_LIMIT,
    modelKey: resolvedModel,
  });

  let streamedFinalText = false;
  let successfulToolCalls = 0;
  let failedToolCalls = 0;

  const result = await runAgentQuery({
    query,
    model: resolvedModel,
    permissionMode: body.permission_mode ??
      (config.snapshot.permissionMode as PermissionMode | undefined) ??
      "default",
    noInput: false,
    signal,
    toolAllowlist,
    toolDenylist: effectiveToolDenylist,
    workspace: resolvedWorkspace,
    contextWindow: body.context_window,
    fixturePath,
    skipSessionHistory: body.skip_session_history === true,
    messageHistory: history,
    modelInfo,
    cachedSession,
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
          case "thinking":
            emit({ event: "thinking", iteration: event.iteration });
            break;
          case "tool_start":
            emit({
              event: "tool_start",
              name: event.name,
              args_summary: event.argsSummary,
              tool_index: event.toolIndex,
              tool_total: event.toolTotal,
            });
            break;
          case "tool_end": {
            if (event.success) {
              successfulToolCalls += 1;
            } else {
              failedToolCalls += 1;
            }
            const toolMsg = insertMessage({
              session_id: body.session_id,
              role: "tool",
              content: event.content ?? "",
              tool_name: event.name,
              sender_type: "agent",
              request_id: requestId,
            });
            pushSSEEvent(body.session_id, "message_added", {
              message: toolMsg,
            });
            pushSessionUpdatedEvent(body.session_id);
            emit({
              event: "tool_end",
              name: event.name,
              success: event.success,
              content: event.content,
              summary: event.summary,
              duration_ms: event.durationMs,
              args_summary: event.argsSummary,
              meta: event.meta,
            });
            break;
          }
          case "thinking_update":
            emit({
              event: "thinking_update",
              iteration: event.iteration,
              summary: event.summary,
            });
            break;
          case "delegate_start":
            emit({
              event: "delegate_start",
              agent: event.agent,
              task: event.task,
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
            });
            break;
          case "turn_stats":
            emit({
              event: "turn_stats",
              iteration: event.iteration,
              tool_count: event.toolCount,
              duration_ms: event.durationMs,
            });
            break;
          case "interaction_request":
            break;
        }
      },
      onTrace: body.trace
        ? (trace) => emit({ event: "trace", trace })
        : undefined,
      onFinalResponseMeta: (meta) =>
        emit({ event: "final_response_meta", meta }),
    },
  });

  if (!signal.aborted) {
    let finalText = result.text;
    const shouldFallbackToDirectChat =
      result.finalResponseState.suppressFinalResponse ||
      result.finalResponseState.orchestratorFailureCode !== null ||
      (failedToolCalls > 0 && successfulToolCalls === 0 && !finalText.trim());
    if (shouldFallbackToDirectChat) {
      const fallbackText = await streamDirectChatFallback(
        body.messages,
        body.session_id,
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
      }
    }

    if (finalText.trim().length === 0) {
      finalText = AI_NO_OUTPUT_FALLBACK_TEXT;
      streamedFinalText = false;
    }

    if (!streamedFinalText) {
      onPartial(finalText);
      emit({ event: "token", text: finalText });
    }

    updateMessage(assistantMessageId, { content: finalText });
    pushSSEEvent(body.session_id, "message_updated", {
      id: assistantMessageId,
      content: finalText,
    });
    pushSessionUpdatedEvent(body.session_id);
  }

  emit({ event: "result_stats", stats: result.stats });
  return result.stats;
}

/** Claude Code Agent Mode — delegates the entire agentic loop to Claude Code CLI. */
export async function handleClaudeCodeAgentMode(
  body: ChatRequest,
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
  const sessionMemoryEnabled = isSessionMemoryEnabled(
    cfgSnapshot.sessionMemory,
  );

  let claudeCodeSessionId: string | null = null;
  let existingMeta: Record<string, unknown> = {};
  if (sessionMemoryEnabled) {
    const session = getSession(body.session_id);
    const parsedMeta = parseSessionMemoryMetadata(session?.metadata);
    existingMeta = parsedMeta.existingMeta;
    claudeCodeSessionId = parsedMeta.claudeCodeSessionId;
  }

  const result = await spawnClaudeCodeProcess(
    query,
    claudeCodeSessionId,
    body.session_id,
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
      updateSession(body.session_id, {
        metadata: JSON.stringify(existingMeta),
      });
      const retryResult = await spawnClaudeCodeProcess(
        query,
        null,
        body.session_id,
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
    pushSSEEvent(hlvmSessionId, "message_updated", {
      id: assistantMessageId,
      content: fullText,
    });
    pushSessionUpdatedEvent(hlvmSessionId);
  }

  return { success: true };
}
