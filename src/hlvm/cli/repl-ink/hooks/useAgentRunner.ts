/**
 * useAgentRunner — Manages agent conversation execution, interaction queue,
 * force-interrupt, and queue draining.
 */

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AnyAttachment } from "./useAttachments.ts";
import type { AgentExecutionMode } from "../../../agent/execution-mode.ts";
import type {
  InteractionRequestEvent,
  InteractionResponse,
} from "../../../agent/registry.ts";
import type { TraceEvent } from "../../../agent/orchestrator.ts";
import type {
  AssistantCitation,
  ConversationAttachmentRef,
  TurnCompletionStatus,
} from "../types.ts";
import { createConversationAttachmentRef } from "../types.ts";
import type { UseConversationResult } from "./useConversation.ts";
import type { SurfacePanel } from "./useOverlayPanel.ts";
import {
  type ConversationComposerDraft,
  createConversationComposerDraft,
  hasConversationDraftContent,
} from "../utils/conversation-queue.ts";
import { ensureError } from "../../../../common/utils.ts";

import { ConfigError } from "../../../../common/config/types.ts";
import {
  checkModelAttachmentIds,
  describeAttachmentFailure,
  describeConversationAttachmentMimeTypeError,
} from "../../attachment-policy.ts";
import {
  expandTextAttachmentReferences,
  filterReferencedAttachments,
  type Attachment,
} from "../../repl/attachment.ts";
import { runChatViaHost } from "../../../runtime/host-client.ts";
import { getTaskManager } from "../../repl/task-manager/index.ts";
import { recordPromptHistory } from "../../repl/prompt-history.ts";
import type { ReplState } from "../../repl/state.ts";
import type { OverlayPanel } from "./useOverlayPanel.ts";
import { REPL_MAIN_THREAD_QUERY_SOURCE } from "../../../agent/query-tool-routing.ts";
import {
  buildTraceTextPreview,
  traceReplMainThread,
} from "../../../repl-main-thread-trace.ts";

const CONVERSATION_DELEGATE_TOOL_DENYLIST = [
  "delegate_agent",
  "batch_delegate",
  "wait_agent",
  "list_agents",
  "close_agent",
  "apply_agent_changes",
  "discard_agent_changes",
  "send_input",
  "interrupt_agent",
  "resume_agent",
] as const;

const CONVERSATION_TEAM_TOOL_DENYLIST = [
  "Teammate",
  "SendMessage",
  "TaskCreate",
  "TaskGet",
  "TaskUpdate",
  "TaskList",
  "TeamStatus",
] as const;

type ContextPressureLevel =
  Extract<TraceEvent, { type: "context_pressure" }>["level"];

function formatContextPressureLabel(
  percent: number,
  level: ContextPressureLevel,
): string {
  if (level === "urgent") return `ctx ${percent}% !!`;
  if (level === "soft") return `ctx ${percent}% ↑`;
  return `ctx ${percent}%`;
}

export function getConversationToolDenylist(
  agentExecutionMode: AgentExecutionMode,
): string[] {
  return agentExecutionMode === "plan"
    ? ["complete_task", ...CONVERSATION_TEAM_TOOL_DENYLIST]
    : [
      "complete_task",
      ...CONVERSATION_DELEGATE_TOOL_DENYLIST,
      ...CONVERSATION_TEAM_TOOL_DENYLIST,
    ];
}

interface UseAgentRunnerInput {
  conversation: UseConversationResult;
  activeModelId: string | null;
  agentExecutionMode: AgentExecutionMode;
  configuredContextWindow: number | undefined;
  refreshRuntimeConfigState: () => Promise<
    { activeModelId: string | null }
  >;
  setIsEvaluating: Dispatch<SetStateAction<boolean>>;
  setFooterContextUsageLabel: (label: string) => void;
  setSurfacePanel: Dispatch<SetStateAction<SurfacePanel>>;
  setActiveOverlay: Dispatch<SetStateAction<OverlayPanel>>;
  clearComposerDraft: () => void;
  getCurrentComposerDraft: () => ConversationComposerDraft;
  getPendingConversationQueue: () => ConversationComposerDraft[];
  setPendingConversationQueue: Dispatch<
    SetStateAction<ConversationComposerDraft[]>
  >;
  restoreComposerDraft: (draft: ConversationComposerDraft | null) => void;
  replState: ReplState;
}

export interface UseAgentRunnerResult {
  interactionQueue: InteractionRequestEvent[];
  setInteractionQueue: Dispatch<SetStateAction<InteractionRequestEvent[]>>;
  pendingInteraction: InteractionRequestEvent | undefined;
  agentControllerRef: MutableRefObject<AbortController | null>;
  interactionResolversRef: MutableRefObject<
    Map<string, (response: InteractionResponse) => void>
  >;
  prepareConversationAttachmentPayload: (
    attachments?: AnyAttachment[],
    text?: string,
  ) => {
    attachments: ConversationAttachmentRef[] | undefined;
    unsupportedMimeType: string | undefined;
  };
  expandConversationDraftText: (
    text: string,
    attachments?: AnyAttachment[],
  ) => string;
  runConversation: (
    query: string,
    attachments?: ConversationAttachmentRef[],
    options?: {
      displayText?: string;
      skipTranscriptSeed?: boolean;
    },
  ) => Promise<void>;
  submitConversationDraft: (
    draft: ConversationComposerDraft,
  ) => { started: boolean; unsupportedMimeType?: string };
  handleInteractionResponse: (
    requestId: string,
    response: InteractionResponse,
  ) => void;
  closeConversationMode: (
    options?: { clearConversation?: boolean },
  ) => void;
  interruptConversationRun: (
    options?: {
      requestId?: string;
      clearPlanning?: boolean;
      restoreDraft?: boolean;
    },
  ) => void;
  handleForceInterrupt: (
    code: string,
    attachments?: AnyAttachment[],
  ) => void;
}

export function useAgentRunner(
  {
    conversation,
    activeModelId,
    agentExecutionMode,
    configuredContextWindow,
    refreshRuntimeConfigState,
    setIsEvaluating,
    setFooterContextUsageLabel,
    setSurfacePanel,
    setActiveOverlay,
    clearComposerDraft,
    getCurrentComposerDraft,
    getPendingConversationQueue,
    setPendingConversationQueue,
    restoreComposerDraft,
    replState,
  }: UseAgentRunnerInput,
): UseAgentRunnerResult {
  const [interactionQueue, setInteractionQueue] = useState<
    InteractionRequestEvent[]
  >([]);
  const pendingInteraction = interactionQueue[0];

  // Stable ref for conversation — avoids recreating callbacks on every event
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  const agentControllerRef = useRef<AbortController | null>(null);
  const interactionResolversRef = useRef<
    Map<string, (response: InteractionResponse) => void>
  >(new Map());
  const pendingStreamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const activeRunTurnIdRef = useRef<string | undefined>(undefined);
  const contextPressureLevelRef = useRef<ContextPressureLevel>("normal");

  // Cleanup orphaned stream timer on unmount
  useEffect(() => () => {
    if (pendingStreamTimerRef.current) {
      clearTimeout(pendingStreamTimerRef.current);
      pendingStreamTimerRef.current = null;
    }
  }, []);

  const prepareConversationAttachmentPayload = useCallback(
    (attachments?: AnyAttachment[], text = "") => {
      const referencedAttachments = text.trim().length > 0
        ? filterReferencedAttachments(text, attachments ?? [])
        : attachments ?? [];
      const runtimeAttachments = referencedAttachments.filter(
        (attachment): attachment is Attachment =>
          "attachmentId" in attachment && !("content" in attachment),
      );

      return {
        attachments: runtimeAttachments.length > 0
          ? runtimeAttachments.map((attachment) =>
            createConversationAttachmentRef(
              attachment.displayName,
              attachment.attachmentId,
            )
          )
          : undefined,
        unsupportedMimeType: undefined,
      };
    },
    [],
  );

  const expandConversationDraftText = useCallback((
    text: string,
    attachments?: AnyAttachment[],
  ): string => {
    return expandTextAttachmentReferences(text, attachments ?? []);
  }, []);

  const runConversation = useCallback(async (
    query: string,
    attachments?: ConversationAttachmentRef[],
    options?: {
      displayText?: string;
      skipTranscriptSeed?: boolean;
    },
  ) => {
    // Guard: prevent double agent start — set ref atomically before any async work
    if (agentControllerRef.current) return;
    const controller = new AbortController();
    agentControllerRef.current = controller;
    const isActiveConversationRun = () =>
      agentControllerRef.current === controller;

    setSurfacePanel("conversation");
    setFooterContextUsageLabel("");
    contextPressureLevelRef.current = "normal";

    // Show user message and pending indicator immediately — before expensive
    // config/model init, unless the caller already seeded the transcript.
    const runTurnId = !options?.skipTranscriptSeed
      ? conversationRef.current.addUserMessage(
        options?.displayText ?? query,
        {
          submittedText: options?.displayText !== undefined &&
              options.displayText !== query
            ? query
            : undefined,
          attachments,
        },
      )
      : conversationRef.current.activeTurnId;
    activeRunTurnIdRef.current = runTurnId;
    if (!options?.skipTranscriptSeed) {
      conversationRef.current.addAssistantText("", true, undefined, {
        turnId: runTurnId,
      });
    }

    let finalizeStatus: TurnCompletionStatus = "completed";
    const requestId = crypto.randomUUID();
    const runStartedAt = Date.now();
    traceReplMainThread("ui.run_conversation.start", {
      requestId,
      agentExecutionMode,
      activeModelId: activeModelId ?? null,
      queryPreview: buildTraceTextPreview(query),
      attachmentCount: attachments?.length ?? 0,
    });

    try {
      const attachmentIds = attachments
        ?.flatMap((attachment) =>
          attachment.attachmentId ? [attachment.attachmentId] : []
        );
      const modelResolutionStartedAt = Date.now();
      const model = activeModelId ||
        (await refreshRuntimeConfigState()).activeModelId ||
        undefined;
      traceReplMainThread("ui.model_resolution.done", {
        requestId,
        durationMs: Date.now() - modelResolutionStartedAt,
        model: model ?? null,
        usedActiveModelId: !!activeModelId,
      });
      if (!model) {
        throw new ConfigError(
          "No configured model available for conversation mode.",
        );
      }
      if (attachmentIds?.length) {
        const attachmentSupport = await checkModelAttachmentIds(
          model,
          attachmentIds,
          null,
        );
        if (!attachmentSupport.supported) {
          if (attachmentSupport.catalogFailed) {
            throw new ConfigError(
              "Could not verify model attachment support. Check provider connection and try again.",
            );
          }
          throw new ConfigError(
            describeAttachmentFailure(attachmentSupport, model) ||
              `Selected model does not support these attachments: ${model}`,
          );
        }
      }

      let textBuffer = "";
      let finalCitations: AssistantCitation[] | undefined;
      // Plan mode should feel status-driven, not like a streaming chat reply.
      // Keep intermediate assistant tokens hidden and let events/tool progress
      // drive the UI; the final response is still rendered after the run ends.
      let suppressPlanningTokens = agentExecutionMode === "plan";
      // Throttle streaming renders to avoid Ink full-screen redraws on every token.
      // Tokens arrive every ~10-30ms; batching to 120ms gives smooth output at ~8 FPS.
      const STREAM_RENDER_INTERVAL = 120;
      let lastStreamRender = 0;
      const flushStreamBuffer = () => {
        pendingStreamTimerRef.current = null;
        if (!controller.signal.aborted && isActiveConversationRun()) {
          conversationRef.current.addAssistantText(textBuffer, true, undefined, {
            turnId: activeRunTurnIdRef.current,
          });
          lastStreamRender = Date.now();
        }
      };
      const result = await runChatViaHost({
        mode: "agent",
        querySource: REPL_MAIN_THREAD_QUERY_SOURCE,
        requestId,
        messages: [{
          role: "user",
          content: query,
          display_content: options?.displayText !== undefined &&
              options.displayText !== query
            ? options.displayText
            : undefined,
          attachment_ids: attachmentIds,
          client_turn_id: crypto.randomUUID(),
        }],
        model,
        permissionMode: agentExecutionMode,
        // Allow structured follow-up questions in normal conversation too so
        // the REPL can render pickers instead of dead-end prose.
        toolDenylist: getConversationToolDenylist(agentExecutionMode),
        signal: controller.signal,
        callbacks: {
          onToken: (text: string) => {
            if (controller.signal.aborted || !isActiveConversationRun()) {
              return;
            }
            if (suppressPlanningTokens) {
              return;
            }
            textBuffer += text;
            const now = Date.now();
            if (now - lastStreamRender >= STREAM_RENDER_INTERVAL) {
              if (pendingStreamTimerRef.current) {
                clearTimeout(pendingStreamTimerRef.current);
                pendingStreamTimerRef.current = null;
              }
              flushStreamBuffer();
            } else if (!pendingStreamTimerRef.current) {
              pendingStreamTimerRef.current = setTimeout(
                flushStreamBuffer,
                STREAM_RENDER_INTERVAL - (now - lastStreamRender),
              );
            }
          },
          onAgentEvent: (event) => {
            if (controller.signal.aborted || !isActiveConversationRun()) {
              return;
            }
            if (event.type === "plan_phase_changed") {
              suppressPlanningTokens = event.phase !== "done";
              // Don't clear textBuffer or cancel timers — let any
              // partially-streamed text flush naturally to avoid
              // visible screen flicker during plan phase transitions.
            }
            // Finalize the current text segment before tool results appear.
            // Each LLM call in the ReAct loop produces a separate text block;
            // flushing here keeps them as individual items in the transcript
            // (interleaved with tool groups) instead of one concatenated blob.
            if (event.type === "tool_start" && textBuffer.trim()) {
              if (pendingStreamTimerRef.current) {
                clearTimeout(pendingStreamTimerRef.current);
                pendingStreamTimerRef.current = null;
              }
              conversationRef.current.addAssistantText(textBuffer, false, undefined, {
                turnId: activeRunTurnIdRef.current,
              });
              textBuffer = "";
              lastStreamRender = 0;
            }
            conversationRef.current.addEvent(event);
            // Wire background delegate lifecycle to TaskManager
            if (event.type === "delegate_start" && event.threadId) {
              getTaskManager().createDelegateTask(
                event.threadId,
                event.agent,
                event.nickname ?? event.agent,
                event.task,
              );
            } else if (event.type === "delegate_running" && event.threadId) {
              getTaskManager().markDelegateThreadRunning(event.threadId);
            } else if (event.type === "delegate_end" && event.threadId) {
              getTaskManager().resolveDelegateThread(event.threadId, {
                success: event.success,
                summary: event.summary,
                error: event.error,
                snapshot: event.snapshot,
              });
            }
          },
          onFinalResponseMeta: (meta) => {
            if (!isActiveConversationRun()) return;
            finalCitations = meta.citationSpans as
              | AssistantCitation[]
              | undefined;
          },
          onTrace: (event) => {
            if (controller.signal.aborted || !isActiveConversationRun()) {
              return;
            }
            if (event.type === "context_pressure") {
              setFooterContextUsageLabel(
                formatContextPressureLabel(event.percent, event.level),
              );
              const previousLevel = contextPressureLevelRef.current;
              contextPressureLevelRef.current = event.level;
              if (event.level === previousLevel) {
                return;
              }
              if (event.level === "soft") {
                conversationRef.current.addInfo(
                  "Context pressure is rising; older context may compact soon.",
                  {
                    isTransient: true,
                    turnId: activeRunTurnIdRef.current,
                  },
                );
                return;
              }
              if (event.level === "urgent") {
                conversationRef.current.addInfo(
                  "Context is nearly full; this turn may compact older messages.",
                  {
                    isTransient: true,
                    turnId: activeRunTurnIdRef.current,
                  },
                );
              }
              return;
            }
            if (event.type === "context_overflow_retry") {
              contextPressureLevelRef.current = "normal";
              setFooterContextUsageLabel("");
              conversationRef.current.addInfo(
                "Context was compacted and the turn retried.",
                {
                  isTransient: true,
                  turnId: activeRunTurnIdRef.current,
                },
              );
              return;
            }
            if (event.type === "context_compaction") {
              contextPressureLevelRef.current = "normal";
              setFooterContextUsageLabel("");
              conversationRef.current.addInfo(
                "Older context was compacted before the next model call.",
                {
                  isTransient: true,
                  turnId: activeRunTurnIdRef.current,
                },
              );
              return;
            }
            if (
              event.type === "response_continuation" &&
              event.status === "starting"
            ) {
              conversationRef.current.addInfo(
                "Continuing truncated response...",
                {
                  isTransient: true,
                  turnId: activeRunTurnIdRef.current,
                },
              );
            }
          },
        },
        onInteraction: (event) => {
          if (controller.signal.aborted || !isActiveConversationRun()) {
            throw new DOMException("Agent interaction aborted", "AbortError");
          }
          const interactionEvent: InteractionRequestEvent = {
            type: "interaction_request",
            requestId: event.requestId,
            mode: event.mode,
            toolName: event.toolName,
            toolArgs: event.toolArgs,
            question: event.question,
            options: event.options,
            sourceLabel: event.sourceLabel,
            sourceMemberId: event.sourceMemberId,
            sourceThreadId: event.sourceThreadId,
            sourceTeamName: event.sourceTeamName,
          };
          setInteractionQueue((prev: InteractionRequestEvent[]) => {
            if (
              prev.some((item) => item.requestId === interactionEvent.requestId)
            ) return prev;
            return [...prev, interactionEvent];
          });
          // Wait for user response — reject if agent is aborted
          return new Promise<InteractionResponse>((resolve, reject) => {
            let settled = false;
            const finalizeRequest = () => {
              if (
                !interactionResolversRef.current.has(interactionEvent.requestId)
              ) return;
              interactionResolversRef.current.delete(
                interactionEvent.requestId,
              );
              setInteractionQueue((prev: InteractionRequestEvent[]) =>
                prev.filter((item) =>
                  item.requestId !== interactionEvent.requestId
                )
              );
              controller.signal.removeEventListener("abort", onAbort);
            };
            const onAbort = () => {
              if (settled) return;
              settled = true;
              finalizeRequest();
              reject(
                new DOMException("Agent interaction aborted", "AbortError"),
              );
            };
            const handler = (response: InteractionResponse) => {
              if (settled) return;
              settled = true;
              finalizeRequest();
              resolve(response);
            };
            interactionResolversRef.current.set(
              interactionEvent.requestId,
              handler,
            );
            controller.signal.addEventListener("abort", onAbort, {
              once: true,
            });
          });
        },
      });
      traceReplMainThread("ui.run_conversation.host_done", {
        requestId,
        durationMs: Date.now() - runStartedAt,
        textChars: result.text.length,
        estimatedTokens: result.stats.estimatedTokens,
        toolMessages: result.stats.toolMessages,
      });
      // Clear any pending streaming render timer
      if (pendingStreamTimerRef.current) {
        clearTimeout(pendingStreamTimerRef.current);
        pendingStreamTimerRef.current = null;
      }
      if (!isActiveConversationRun()) {
        return;
      }
      contextPressureLevelRef.current = "normal";

      // Finalize assistant message
      const sanitizePlanModeFinalText = (text: string): string => {
        let cleaned = text;
        const lastPlanEnd = cleaned.lastIndexOf("END_PLAN");
        if (lastPlanEnd >= 0) {
          cleaned = cleaned.slice(lastPlanEnd + "END_PLAN".length);
        }
        cleaned = cleaned.replace(/STEP_DONE\s*[:\-]?\s*[a-z0-9_-]+/gi, "")
          .replace(/\b(?:Now\s+)?let me\b[^.?!]*[.?!]?/gi, "")
          .replace(/\bI need to\b[^.?!]*[.?!]?/gi, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        const paragraphs = cleaned.split(/\n{2,}/)
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
        return (paragraphs.at(-1) ?? "")
          .replace(/^(That said,\s*)/i, "")
          .replace(/\s{2,}/g, " ")
          .trim();
      };
      const finalAssistantText = agentExecutionMode === "plan"
        ? sanitizePlanModeFinalText(result.text ?? textBuffer)
        : textBuffer;
      if (finalAssistantText) {
        conversationRef.current.addAssistantText(
          finalAssistantText,
          false,
          finalCitations,
          { turnId: activeRunTurnIdRef.current },
        );
      }

      // Footer context usage (Gemini-style compact indicator)
      const usage = result.stats.usage;
      if (
        usage && typeof configuredContextWindow === "number" &&
        configuredContextWindow > 0
      ) {
        const pct = Math.max(
          0,
          Math.min(
            100,
            Math.round((usage.totalTokens / configuredContextWindow) * 100),
          ),
        );
        setFooterContextUsageLabel(`${pct}% ctx`);
      } else if (usage) {
        setFooterContextUsageLabel(`${usage.totalTokens} tokens`);
      } else {
        setFooterContextUsageLabel("");
      }
    } catch (error) {
      traceReplMainThread("ui.run_conversation.error", {
        requestId,
        durationMs: Date.now() - runStartedAt,
        error: ensureError(error).message,
      });
      if (controller.signal.aborted) {
        finalizeStatus = "cancelled";
        if (isActiveConversationRun()) {
          conversationRef.current.addInfo("Cancelled", {
            turnId: activeRunTurnIdRef.current,
          });
        }
      } else {
        finalizeStatus = "failed";
        if (isActiveConversationRun()) {
          conversationRef.current.addError(ensureError(error).message, {
            turnId: activeRunTurnIdRef.current,
          });
        }
      }
    } finally {
      if (isActiveConversationRun()) {
        agentControllerRef.current = null;
        interactionResolversRef.current.clear();
        setInteractionQueue([]);
        setIsEvaluating(false);
        contextPressureLevelRef.current = "normal";
        conversationRef.current.finalize(finalizeStatus, {
          turnId: activeRunTurnIdRef.current,
        });
        activeRunTurnIdRef.current = undefined;
      }
      traceReplMainThread("ui.run_conversation.finally", {
        requestId,
        durationMs: Date.now() - runStartedAt,
        status: finalizeStatus,
      });
    }
  }, [
    activeModelId,
    agentExecutionMode,
    configuredContextWindow,
    refreshRuntimeConfigState,
  ]);

  const submitConversationDraft = useCallback((
    draft: ConversationComposerDraft,
  ): { started: boolean; unsupportedMimeType?: string } => {
    const expandedText = expandConversationDraftText(
      draft.text,
      draft.attachments,
    );
    const { attachments, unsupportedMimeType } =
      prepareConversationAttachmentPayload(draft.attachments, draft.text);
    if (unsupportedMimeType) {
      return { started: false, unsupportedMimeType };
    }
    setIsEvaluating(true);
    void runConversation(expandedText, attachments, {
      displayText: draft.text,
    });
    return { started: true };
  }, [
    expandConversationDraftText,
    prepareConversationAttachmentPayload,
    runConversation,
  ]);

  const handleInteractionResponse = useCallback(
    (requestId: string, response: InteractionResponse) => {
      const resolver = interactionResolversRef.current.get(requestId);
      if (!resolver) return;
      resolver(response);
    },
    [],
  );

  const closeConversationMode = useCallback(
    (options?: { clearConversation?: boolean }) => {
      // Resolve all queued interactions as denied so orchestrator is never left hanging.
      for (const interaction of interactionQueue) {
        const resolver = interactionResolversRef.current.get(
          interaction.requestId,
        );
        if (resolver) {
          resolver({ approved: false });
        }
      }
      interactionResolversRef.current.clear();
      setInteractionQueue([]);
      const hadActiveRun = agentControllerRef.current !== null;
      if (agentControllerRef.current) {
        agentControllerRef.current.abort();
        agentControllerRef.current = null;
      }
      setIsEvaluating(false);
      if (options?.clearConversation) {
        conversationRef.current.clear();
      } else if (hadActiveRun) {
        conversationRef.current.finalize("cancelled", {
          turnId: activeRunTurnIdRef.current,
        });
      }
      activeRunTurnIdRef.current = undefined;
      setPendingConversationQueue([]);
      setFooterContextUsageLabel("");
      contextPressureLevelRef.current = "normal";
      setActiveOverlay("none");
      setSurfacePanel("none");
    },
    [interactionQueue],
  );

  const interruptConversationRun = useCallback((
    options?: {
      requestId?: string;
      clearPlanning?: boolean;
      restoreDraft?: boolean;
    },
  ) => {
    if (options?.requestId) {
      handleInteractionResponse(options.requestId, {
        approved: false,
      });
    }
    if (options?.clearPlanning) {
      conversationRef.current.cancelPlanning();
    }

    const controller = agentControllerRef.current;
    if (!controller || controller.signal.aborted) {
      return;
    }

    const currentComposerDraft = getCurrentComposerDraft();
    const restoredDraft = options?.restoreDraft === false ||
        !hasConversationDraftContent(currentComposerDraft)
      ? null
      : currentComposerDraft;

    if (pendingStreamTimerRef.current) {
      clearTimeout(pendingStreamTimerRef.current);
      pendingStreamTimerRef.current = null;
    }

    agentControllerRef.current = null;
    controller.abort();
    interactionResolversRef.current.clear();
    setInteractionQueue([]);
    setIsEvaluating(false);
    setFooterContextUsageLabel("");
    contextPressureLevelRef.current = "normal";
    restoreComposerDraft(restoredDraft);
    conversationRef.current.finalize("cancelled", {
      turnId: activeRunTurnIdRef.current,
    });
    activeRunTurnIdRef.current = undefined;
  }, [
    getCurrentComposerDraft,
    getPendingConversationQueue,
    handleInteractionResponse,
    restoreComposerDraft,
    setFooterContextUsageLabel,
  ]);

  const handleForceInterrupt = useCallback(
    (code: string, attachments?: AnyAttachment[]) => {
      if (!code.trim()) return;
      recordPromptHistory(replState, code, "conversation", undefined, attachments);
      clearComposerDraft();
      const draft = createConversationComposerDraft(code.trim(), attachments);

      interruptConversationRun({
        restoreDraft: false,
      });

      // Send immediately (bypass queue)
      const result = submitConversationDraft(draft);
      if (!result.started) {
        restoreComposerDraft(draft);
        if (result.unsupportedMimeType) {
          conversationRef.current.addError(
            describeConversationAttachmentMimeTypeError(
              result.unsupportedMimeType,
            ),
          );
        }
      }
    },
    [
      clearComposerDraft,
      interruptConversationRun,
      replState,
      restoreComposerDraft,
      submitConversationDraft,
    ],
  );

  return {
    interactionQueue,
    setInteractionQueue,
    pendingInteraction,
    agentControllerRef,
    interactionResolversRef,
    prepareConversationAttachmentPayload,
    expandConversationDraftText,
    runConversation,
    submitConversationDraft,
    handleInteractionResponse,
    closeConversationMode,
    interruptConversationRun,
    handleForceInterrupt,
  };
}
