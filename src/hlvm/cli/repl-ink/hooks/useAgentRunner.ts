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
import type { AssistantCitation, ConversationAttachmentRef } from "../types.ts";
import { createConversationAttachmentRef } from "../types.ts";
import type { UseConversationResult } from "./useConversation.ts";
import type { SurfacePanel } from "./useOverlayPanel.ts";
import {
  type ConversationComposerDraft,
  createConversationComposerDraft,
  mergeConversationDraftsForInterrupt,
  shiftQueuedConversationDraft,
} from "../utils/conversation-queue.ts";
import { ensureError } from "../../../../common/utils.ts";

import { ConfigError } from "../../../../common/config/types.ts";
import {
  checkModelAttachmentIds,
  describeAttachmentFailure,
  describeConversationAttachmentMimeTypeError,
} from "../../attachment-policy.ts";
import { runChatViaHost } from "../../../runtime/host-client.ts";
import { getTaskManager } from "../../repl/task-manager/index.ts";
import { recordPromptHistory } from "../../repl/prompt-history.ts";
import type { ReplState } from "../../repl/state.ts";
import type { OverlayPanel } from "./useOverlayPanel.ts";

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

export function getConversationToolDenylist(
  agentExecutionMode: AgentExecutionMode,
): string[] {
  return agentExecutionMode === "plan"
    ? ["complete_task"]
    : ["complete_task", ...CONVERSATION_DELEGATE_TOOL_DENYLIST];
}

interface UseAgentRunnerInput {
  conversation: UseConversationResult;
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
  pendingConversationQueueVersion: number;
  setPendingConversationQueue: Dispatch<
    SetStateAction<ConversationComposerDraft[]>
  >;
  restoreComposerDraft: (draft: ConversationComposerDraft | null) => void;
  hasConversationContext: boolean;
  replState: ReplState;
  onQueuedHqlEval?: (code: string, attachments?: AnyAttachment[]) => Promise<void>;
  isLocalEvalBusy?: () => boolean;
}

export interface UseAgentRunnerResult {
  interactionQueue: InteractionRequestEvent[];
  setInteractionQueue: Dispatch<SetStateAction<InteractionRequestEvent[]>>;
  pendingInteraction: InteractionRequestEvent | undefined;
  agentControllerRef: MutableRefObject<AbortController | null>;
  interactionResolversRef: MutableRefObject<
    Map<string, (response: InteractionResponse) => void>
  >;
  prepareConversationAttachmentPayload: (attachments?: AnyAttachment[]) => {
    attachments: ConversationAttachmentRef[] | undefined;
    unsupportedMimeType: string | undefined;
  };
  expandConversationDraftText: (text: string) => string;
  runConversation: (
    query: string,
    attachments?: ConversationAttachmentRef[],
    options?: {
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
      addCancelledInfo?: boolean;
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
    pendingConversationQueueVersion,
    setPendingConversationQueue,
    restoreComposerDraft,
    hasConversationContext,
    replState,
    onQueuedHqlEval,
    isLocalEvalBusy,
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

  // Cleanup orphaned stream timer on unmount
  useEffect(() => () => {
    if (pendingStreamTimerRef.current) {
      clearTimeout(pendingStreamTimerRef.current);
      pendingStreamTimerRef.current = null;
    }
  }, []);

  const prepareConversationAttachmentPayload = useCallback(
    (attachments?: AnyAttachment[]) => {
      const runtimeAttachments = attachments
        ?.filter((a): a is import("../../repl/attachment.ts").Attachment =>
          "attachmentId" in a
        ) ??
        [];

      return {
        attachments: runtimeAttachments.map((attachment) =>
          createConversationAttachmentRef(
            attachment.displayName,
            attachment.attachmentId,
          )
        ),
        unsupportedMimeType: undefined,
      };
    },
    [],
  );

  const expandConversationDraftText = useCallback((text: string): string => {
    return text;
  }, []);

  const runConversation = useCallback(async (
    query: string,
    attachments?: ConversationAttachmentRef[],
    options?: {
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

    // Show user message and pending indicator immediately — before expensive
    // config/model init, unless the caller already seeded the transcript.
    if (!options?.skipTranscriptSeed) {
      conversationRef.current.addUserMessage(query, { attachments });
      conversationRef.current.addAssistantText("", true);
    }

    try {
      const attachmentIds = attachments
        ?.flatMap((attachment) =>
          attachment.attachmentId ? [attachment.attachmentId] : []
        );
      const currentModelSelection = await refreshRuntimeConfigState();
      const model = currentModelSelection.activeModelId || undefined;
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
          conversationRef.current.addAssistantText(textBuffer, true);
          lastStreamRender = Date.now();
        }
      };
      const result = await runChatViaHost({
        mode: "agent",
        messages: [{
          role: "user",
          content: query,
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
      // Clear any pending streaming render timer
      if (pendingStreamTimerRef.current) {
        clearTimeout(pendingStreamTimerRef.current);
        pendingStreamTimerRef.current = null;
      }
      if (!isActiveConversationRun()) {
        return;
      }

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
        : (textBuffer || result.text || "");
      if (finalAssistantText) {
        conversationRef.current.addAssistantText(
          finalAssistantText,
          false,
          finalCitations,
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
      if (controller.signal.aborted) {
        if (isActiveConversationRun()) {
          conversationRef.current.addInfo("Cancelled");
        }
      } else {
        if (isActiveConversationRun()) {
          conversationRef.current.addError(ensureError(error).message);
        }
      }
    } finally {
      if (isActiveConversationRun()) {
        agentControllerRef.current = null;
        interactionResolversRef.current.clear();
        setInteractionQueue([]);
        setIsEvaluating(false);
        conversationRef.current.finalize();
      }
    }
  }, [
    agentExecutionMode,
    configuredContextWindow,
    refreshRuntimeConfigState,
  ]);

  const submitConversationDraft = useCallback((
    draft: ConversationComposerDraft,
  ): { started: boolean; unsupportedMimeType?: string } => {
    const expandedText = expandConversationDraftText(
      draft.text,
    );
    const { attachments, unsupportedMimeType } =
      prepareConversationAttachmentPayload(draft.attachments);
    if (unsupportedMimeType) {
      return { started: false, unsupportedMimeType };
    }
    conversationRef.current.addUserMessage(expandedText, { attachments });
    conversationRef.current.addAssistantText("", true);
    setIsEvaluating(true);
    void runConversation(expandedText, attachments, {
      skipTranscriptSeed: true,
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
      if (agentControllerRef.current) {
        agentControllerRef.current.abort();
        agentControllerRef.current = null;
      }
      setIsEvaluating(false);
      if (options?.clearConversation) {
        conversationRef.current.clear();
      } else {
        conversationRef.current.finalize();
      }
      setPendingConversationQueue([]);
      setFooterContextUsageLabel("");
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
      addCancelledInfo?: boolean;
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

    const pendingConversationQueue = getPendingConversationQueue();
    const currentComposerDraft = getCurrentComposerDraft();
    const restoredDraft = options?.restoreDraft === false
      ? null
      : mergeConversationDraftsForInterrupt(
        pendingConversationQueue,
        currentComposerDraft,
      );

    if (pendingStreamTimerRef.current) {
      clearTimeout(pendingStreamTimerRef.current);
      pendingStreamTimerRef.current = null;
    }

    agentControllerRef.current = null;
    controller.abort();
    interactionResolversRef.current.clear();
    setInteractionQueue([]);
    setIsEvaluating(false);
    setPendingConversationQueue([]);
    setFooterContextUsageLabel("");
    restoreComposerDraft(restoredDraft);
    if (options?.addCancelledInfo !== false) {
      conversationRef.current.addInfo("Cancelled");
    }
    conversationRef.current.finalize();
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
      recordPromptHistory(replState, code, "conversation");
      clearComposerDraft();
      const draft = createConversationComposerDraft(code.trim(), attachments);

      interruptConversationRun({
        restoreDraft: false,
        addCancelledInfo: false,
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

  // Queue drain effect: auto-submit queued drafts when agent is idle
  useEffect(() => {
    if (!hasConversationContext) return;
    if (agentControllerRef.current) return;
    if (isLocalEvalBusy?.()) return;
    // Don't drain during plan workflow gaps (agent briefly idle between plan turns)
    const { planningPhase, pendingPlanReview } = conversationRef.current;
    if (planningPhase && planningPhase !== "done") return;
    if (pendingPlanReview) return;
    const pendingConversationQueue = getPendingConversationQueue();
    if (pendingConversationQueue.length === 0) return;

    const { draft: nextTurn, remaining } = shiftQueuedConversationDraft(
      pendingConversationQueue,
    );
    if (!nextTurn) return;

    // Route queued HQL evals to the local evaluator instead of the agent
    if (nextTurn.text.trim().startsWith("(") && onQueuedHqlEval) {
      setPendingConversationQueue(remaining);
      void onQueuedHqlEval(nextTurn.text);
      return;
    }

    const result = submitConversationDraft(nextTurn);
    if (result.started) {
      setPendingConversationQueue(remaining);
      return;
    }
    const currentComposerDraft = getCurrentComposerDraft();
    setPendingConversationQueue(remaining);
    restoreComposerDraft(
      mergeConversationDraftsForInterrupt([nextTurn], currentComposerDraft),
    );
    if (result.unsupportedMimeType) {
      conversationRef.current.addError(
        describeConversationAttachmentMimeTypeError(
          result.unsupportedMimeType,
        ),
      );
    }
  }, [
    getCurrentComposerDraft,
    getPendingConversationQueue,
    hasConversationContext,
    isLocalEvalBusy,
    onQueuedHqlEval,
    pendingConversationQueueVersion,
    restoreComposerDraft,
    submitConversationDraft,
  ]);

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
