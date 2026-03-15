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
import type { AssistantCitation } from "../types.ts";
import type { UseConversationResult } from "./useConversation.ts";
import type { SurfacePanel } from "./useOverlayPanel.ts";
import {
  type ConversationComposerDraft,
  createConversationComposerDraft,
  mergeConversationDraftsForInterrupt,
  shiftQueuedConversationDraft,
} from "../utils/conversation-queue.ts";
import { ensureError } from "../../../../common/utils.ts";

import {
  ConfigError,
} from "../../../../common/config/types.ts";
import type { ModelSelectionState } from "../../../../common/config/model-selection.ts";
import {
  ensureCurrentSession,
  session as sessionApi,
  syncCurrentSession,
} from "../../../api/session.ts";
import { modelSupportsVision } from "../../model-capabilities.ts";
import { runChatViaHost } from "../../../runtime/host-client.ts";
import { getTaskManager } from "../../repl/task-manager/index.ts";
import { recordPromptHistory } from "../../repl/prompt-history.ts";
import type { ReplState } from "../../repl/state.ts";
import type { SessionMeta } from "../../repl/session/types.ts";
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
  applyRuntimeConfigState: (
    cfg: Record<string, unknown>,
    activeModelId?: string,
  ) => ModelSelectionState;
  modelSelection: { activeModelId: string | null };
  currentSession: SessionMeta | null;
  setCurrentSession: Dispatch<SetStateAction<SessionMeta | null>>;
  setIsEvaluating: Dispatch<SetStateAction<boolean>>;
  setFooterContextUsageLabel: (label: string) => void;
  setSurfacePanel: Dispatch<SetStateAction<SurfacePanel>>;
  setActiveOverlay: Dispatch<SetStateAction<OverlayPanel>>;
  setPendingConversationQueue: Dispatch<
    SetStateAction<ConversationComposerDraft[]>
  >;
  pendingConversationQueue: ConversationComposerDraft[];
  currentComposerDraft: ConversationComposerDraft;
  restoreComposerDraft: (draft: ConversationComposerDraft | null) => void;
  hasConversationContext: boolean;
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
  prepareConversationMediaPayload: (attachments?: AnyAttachment[]) => {
    images: string[] | undefined;
    unsupportedMimeType: string | undefined;
  };
  expandConversationDraftText: (
    text: string,
    attachments?: AnyAttachment[],
  ) => string;
  getConversationAttachmentLabels: (
    attachments?: AnyAttachment[],
  ) => string[] | undefined;
  runConversation: (
    query: string,
    mediaPaths?: string[],
    attachmentLabels?: string[],
    options?: { skipTranscriptSeed?: boolean },
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
    applyRuntimeConfigState,
    modelSelection,
    currentSession,
    setCurrentSession,
    setIsEvaluating,
    setFooterContextUsageLabel,
    setSurfacePanel,
    setActiveOverlay,
    setPendingConversationQueue,
    pendingConversationQueue,
    currentComposerDraft,
    restoreComposerDraft,
    hasConversationContext,
    replState,
  }: UseAgentRunnerInput,
): UseAgentRunnerResult {
  const [interactionQueue, setInteractionQueue] = useState<
    InteractionRequestEvent[]
  >([]);
  const pendingInteraction = interactionQueue[0];

  const agentControllerRef = useRef<AbortController | null>(null);
  const interactionResolversRef = useRef<
    Map<string, (response: InteractionResponse) => void>
  >(new Map());
  const pendingStreamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup orphaned stream timer on unmount
  useEffect(() => () => {
    if (pendingStreamTimerRef.current) {
      clearTimeout(pendingStreamTimerRef.current);
      pendingStreamTimerRef.current = null;
    }
  }, []);

  const prepareConversationMediaPayload = useCallback(
    (attachments?: AnyAttachment[]) => {
      const mediaAttachments = attachments
        ?.filter((a): a is import("../../repl/attachment.ts").Attachment =>
          "base64Data" in a && a.type !== "text"
        ) ??
        [];

      const unsupported = mediaAttachments.filter((a) => {
        if (a.mimeType.startsWith("image/")) return false;
        if (a.mimeType.startsWith("audio/")) return false;
        if (a.mimeType.startsWith("video/")) return false;
        if (a.mimeType === "application/pdf") return false;
        return true;
      });

      if (unsupported.length > 0) {
        return {
          images: undefined,
          unsupportedMimeType: unsupported[0].mimeType,
        };
      }

      return {
        images: mediaAttachments.map((a) => a.path),
        unsupportedMimeType: undefined,
      };
    },
    [],
  );

  const expandConversationDraftText = useCallback((
    text: string,
    attachments?: AnyAttachment[],
  ): string => {
    let expandedText = text;
    for (const attachment of attachments ?? []) {
      if ("content" in attachment) {
        expandedText = expandedText.replace(
          attachment.displayName,
          attachment.content,
        );
      }
    }
    return expandedText;
  }, []);

  const getConversationAttachmentLabels = useCallback((
    attachments?: AnyAttachment[],
  ): string[] | undefined => {
    const labels = attachments
      ?.filter((
        attachment,
      ): attachment is import("../../repl/attachment.ts").Attachment =>
        "base64Data" in attachment && attachment.type !== "text"
      )
      .map((attachment) => attachment.displayName) ?? [];
    return labels.length > 0 ? labels : undefined;
  }, []);

  const runConversation = useCallback(async (
    query: string,
    mediaPaths?: string[],
    attachmentLabels?: string[],
    options?: { skipTranscriptSeed?: boolean },
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
      conversation.addUserMessage(query, { attachments: attachmentLabels });
      conversation.addAssistantText("", true);
    }

    try {
      const currentModelSelection = await refreshRuntimeConfigState();
      const model = currentModelSelection.activeModelId || undefined;
      if (!model) {
        throw new ConfigError(
          "No configured model available for conversation mode.",
        );
      }
      if (mediaPaths?.length) {
        const visionCheck = await modelSupportsVision(model, null);
        if (!visionCheck.supported) {
          if (visionCheck.catalogFailed) {
            throw new ConfigError(
              "Could not verify model media-attachment support. Check provider connection and try again.",
            );
          }
          throw new ConfigError(
            `Selected model does not support media attachments: ${model}`,
          );
        }
      }

      const sessionMeta = sessionApi.current() ?? currentSession ??
        await ensureCurrentSession();
      if (!currentSession || currentSession.id !== sessionMeta.id) {
        setCurrentSession(sessionMeta);
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
          conversation.addAssistantText(textBuffer, true);
          lastStreamRender = Date.now();
        }
      };
      const result = await runChatViaHost({
        mode: "agent",
        sessionId: sessionMeta.id,
        messages: [{
          role: "user",
          content: query,
          image_paths: mediaPaths,
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
              if (suppressPlanningTokens) {
                textBuffer = "";
                if (pendingStreamTimerRef.current) {
                  clearTimeout(pendingStreamTimerRef.current);
                  pendingStreamTimerRef.current = null;
                }
              }
            }
            conversation.addEvent(event);
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
        conversation.addAssistantText(
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

      const refreshed = await syncCurrentSession(sessionMeta.id);
      if (refreshed) {
        setCurrentSession(refreshed);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        if (isActiveConversationRun()) {
          conversation.addInfo("Cancelled");
        }
      } else {
        if (isActiveConversationRun()) {
          conversation.addError(ensureError(error).message);
        }
      }
    } finally {
      if (isActiveConversationRun()) {
        agentControllerRef.current = null;
        interactionResolversRef.current.clear();
        setInteractionQueue([]);
        setIsEvaluating(false);
        conversation.finalize();
      }
    }
  }, [
    applyRuntimeConfigState,
    agentExecutionMode,
    configuredContextWindow,
    modelSelection,
    conversation,
    currentSession,
    refreshRuntimeConfigState,
  ]);

  const submitConversationDraft = useCallback((
    draft: ConversationComposerDraft,
  ): { started: boolean; unsupportedMimeType?: string } => {
    const expandedText = expandConversationDraftText(
      draft.text,
      draft.attachments,
    );
    const { images, unsupportedMimeType } = prepareConversationMediaPayload(
      draft.attachments,
    );
    if (unsupportedMimeType) {
      return { started: false, unsupportedMimeType };
    }
    const imagePaths = images && images.length > 0 ? images : undefined;
    const attachmentLabels = getConversationAttachmentLabels(draft.attachments);
    conversation.addUserMessage(expandedText, { attachments: attachmentLabels });
    conversation.addAssistantText("", true);
    setIsEvaluating(true);
    void runConversation(expandedText, imagePaths, attachmentLabels, {
      skipTranscriptSeed: true,
    });
    return { started: true };
  }, [
    conversation,
    expandConversationDraftText,
    getConversationAttachmentLabels,
    prepareConversationMediaPayload,
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
        conversation.clear();
      } else {
        conversation.finalize();
      }
      setPendingConversationQueue([]);
      setFooterContextUsageLabel("");
      setActiveOverlay("none");
      setSurfacePanel("none");
    },
    [conversation, interactionQueue],
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
      conversation.cancelPlanning();
    }

    const controller = agentControllerRef.current;
    if (!controller || controller.signal.aborted) {
      return;
    }

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
      conversation.addInfo("Cancelled");
    }
    conversation.finalize();
  }, [
    conversation,
    currentComposerDraft,
    handleInteractionResponse,
    pendingConversationQueue,
    restoreComposerDraft,
    setFooterContextUsageLabel,
  ]);

  const handleForceInterrupt = useCallback(
    (code: string, attachments?: AnyAttachment[]) => {
      if (!code.trim()) return;
      recordPromptHistory(replState, code, "conversation");
      restoreComposerDraft(null);
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
          conversation.addError(
            `Attachment unsupported: ${result.unsupportedMimeType}`,
          );
        }
      }
    },
    [
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
    if (pendingConversationQueue.length === 0) return;

    const { draft: nextTurn, remaining } = shiftQueuedConversationDraft(
      pendingConversationQueue,
    );
    if (!nextTurn) return;
    const result = submitConversationDraft(nextTurn);
    if (result.started) {
      setPendingConversationQueue(remaining);
      return;
    }
    setPendingConversationQueue(remaining);
    restoreComposerDraft(
      mergeConversationDraftsForInterrupt([nextTurn], currentComposerDraft),
    );
    if (result.unsupportedMimeType) {
      conversation.addError(
        `Attachment unsupported: ${result.unsupportedMimeType}`,
      );
    }
  }, [
    conversation,
    currentComposerDraft,
    hasConversationContext,
    pendingConversationQueue,
    restoreComposerDraft,
    submitConversationDraft,
  ]);

  return {
    interactionQueue,
    setInteractionQueue,
    pendingInteraction,
    agentControllerRef,
    interactionResolversRef,
    prepareConversationMediaPayload,
    expandConversationDraftText,
    getConversationAttachmentLabels,
    runConversation,
    submitConversationDraft,
    handleInteractionResponse,
    closeConversationMode,
    interruptConversationRun,
    handleForceInterrupt,
  };
}
