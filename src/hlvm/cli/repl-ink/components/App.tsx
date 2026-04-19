/**
 * HLVM Ink REPL - Main App
 * Full-featured REPL with rich banner, keyboard shortcuts, completions
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, type Key, useApp, useInput, useStdout } from "ink";
import { Banner, getBannerRowCount } from "./Banner.tsx";
import { UpdateBanner } from "./UpdateBanner.tsx";
import { LoadingScreen } from "./LoadingScreen.tsx";
import { ConfigOverlay } from "./ConfigOverlay.tsx";
import {
  CommandPaletteOverlay,
  type KeyCombo,
} from "./CommandPaletteOverlay.tsx";
import { ShortcutsOverlay } from "./ShortcutsOverlay.tsx";
import { BackgroundTasksOverlay } from "./BackgroundTasksOverlay.tsx";
import { ModelBrowser } from "./ModelBrowser.tsx";
import { ModelSetupOverlay } from "./ModelSetupOverlay.tsx";
import { TranscriptViewerOverlay } from "./TranscriptViewerOverlay.tsx";
import { FooterHint } from "./FooterHint.tsx";
import {
  buildBackgroundStatusFooterModel,
  buildLocalAgentsManagerModel,
  LocalAgentsManagerPanel,
} from "./LocalAgentsStatusPanel.tsx";
import {
  ComposerSurface,
  type ComposerSurfaceHandle,
  type ComposerSurfaceUiState,
} from "./ComposerSurface.tsx";
import { QueuePreview } from "./QueuePreview.tsx";
import { VirtualTranscript } from "./VirtualTranscript.tsx";
import { FullscreenViewport } from "./FullscreenViewport.tsx";
import { getLatestCitation } from "./TimelineItemRenderer.tsx";
import { compactPlanTranscriptItems } from "./conversation/plan-flow.ts";
import { DialogStack } from "./DialogStack.tsx";
import { RenderErrorBoundary } from "./ErrorBoundary.tsx";
import {
  isPickerInteractionRequest,
  parsePlanReviewToolArgs,
} from "./conversation/interaction-dialog-layout.ts";
import { deriveLiveTurnStatus } from "./conversation/turn-activity.ts";
import {
  executeHandler,
  inspectHandlerKeybinding,
  isBareEscapeInput,
  type KeybindingAction,
  refreshKeybindingLookup,
} from "../keybindings/index.ts";
import {
  HandlerIds,
  registerHandler,
  unregisterHandler,
} from "../keybindings/handler-registry.ts";
import { useRepl } from "../hooks/useRepl.ts";
import { useInitialization } from "../hooks/useInitialization.ts";
import { useConversation } from "../hooks/useConversation.ts";
import { useModelConfig } from "../hooks/useModelConfig.ts";
import {
  type OverlayPanel,
  useOverlayPanel,
} from "../hooks/useOverlayPanel.ts";
import { useAgentRunner } from "../hooks/useAgentRunner.ts";
import type { EvalResult } from "../types.ts";
import { ReplState } from "../../repl/state.ts";
import { getPersistentAgentExecutionModeLabel } from "../../../agent/execution-mode.ts";
import { clearTerminal } from "../../ansi.ts";
import type { AnyAttachment } from "../hooks/useAttachments.ts";
import { DEFAULT_TERMINAL_WIDTH } from "../ui-constants.ts";
import { runCommand } from "../../repl/commands.ts";
import { isBalanced } from "../../repl/syntax.ts";
import { ensureError, truncate } from "../../../../common/utils.ts";
import {
  type HlvmConfig,
  normalizeModelId,
} from "../../../../common/config/types.ts";
import {
  buildSelectedModelConfigUpdates,
  persistSelectedModelConfig,
} from "../../../../common/config/model-selection.ts";
import { ReplProvider } from "../context/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";
import { isEvalTask, isTaskActive } from "../../repl/task-manager/index.ts";
import {
  getRuntimeConfigApi,
  patchRuntimeConfig,
} from "../../../runtime/host-client.ts";
import {
  getCustomKeybindingsSnapshot,
  setCustomKeybindingsSnapshot,
} from "../keybindings/custom-bindings.ts";
import { recordPromptHistory } from "../../repl/prompt-history.ts";
import { describeConversationAttachmentMimeTypeError } from "../../attachment-policy.ts";
import {
  type ConversationComposerDraft,
  createConversationComposerDraft,
  enqueueConversationDraft,
  getConversationQueueEditBinding,
  getConversationQueueEditBindingLabel,
  shiftQueuedConversationDraft,
} from "../utils/conversation-queue.ts";
import { resolveCtrlCAction } from "../ctrl-c-behavior.ts";
import type { InteractionResponse } from "../../../agent/registry.ts";
import {
  advanceComposerShellState,
  type ComposerShellState,
} from "../utils/composer-shell-state.ts";
import {
  isShellCommandText,
  resolveSubmitAction,
} from "../utils/submit-routing.ts";
import {
  shouldAutoCloseConversationSurface,
  shouldRenderMainBanner,
  shouldRenderShellLanes,
} from "../utils/app-surface.ts";
import { getShellContentWidth, SHELL_LAYOUT } from "../utils/layout-tokens.ts";
import { type LocalAgentEntry } from "../utils/local-agents.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { TuiStatusLine } from "./TuiStatusLine.tsx";
import { FullscreenLayout } from "../../../tui-v2/components/FullscreenLayout.tsx";
import { ScrollKeybindingHandler } from "../../../tui-v2/components/ScrollKeybindingHandler.tsx";
import type { ScrollBoxHandle } from "../../../tui-v2/ink/components/ScrollBox.tsx";
import {
  useCopyOnSelect,
  useSelectionBgColor,
} from "../../../tui-v2/hooks/useCopyOnSelect.ts";
import { getClipboardPath } from "../../../tui-v2/ink/termio/osc.ts";

interface CurrentEval {
  code: string;
  controller: AbortController;
  backgrounded: boolean;
  cancelled?: boolean;
  taskId?: string;
}

interface AppProps {
  showBanner?: boolean;
  initialConfig?: HlvmConfig;
  debug?: boolean;
}

interface BackgroundTasksOverlayState {
  initialSelectedItemId?: string;
  initialViewMode?: "list" | "result";
}

const GLOBAL_KEYBINDING_CATEGORIES = ["Global"] as const;
const DEFAULT_BACKGROUND_TASKS_OVERLAY_STATE: BackgroundTasksOverlayState = {
  initialViewMode: "list",
};
const RECENT_SCROLL_REPIN_WINDOW_MS = 3000;

function shouldRepinForOverlay(overlay: OverlayPanel): boolean {
  return overlay !== "none" && overlay !== "transcript-history";
}

function usesConversationContext(surfacePanel: string): boolean {
  return surfacePanel === "conversation";
}

function isAsyncIterable(
  value: unknown,
): value is AsyncIterableIterator<string> {
  return !!value && typeof value === "object" &&
    Symbol.asyncIterator in (value as object);
}

/**
 * App wrapper - provides ReplContext for FRP state management
 */
export function App(
  { showBanner = true, initialConfig, debug = false }: AppProps,
): React.ReactElement {
  const stateRef = useRef<ReplState>(new ReplState());

  return (
    <ReplProvider replState={stateRef.current}>
      <AppContent
        debug={debug}
        showBanner={showBanner}
        initialConfig={initialConfig}
        replState={stateRef.current}
      />
    </ReplProvider>
  );
}

interface AppContentProps extends AppProps {
  replState: ReplState;
}

/**
 * AppContent - main REPL UI (uses ReplContext for reactive state)
 */
function AppContent(
  { showBanner = true, initialConfig, replState, debug = false }:
    AppContentProps,
): React.ReactElement {
  const { exit } = useApp();

  const repl = useRepl({ state: replState });

  // Initialize: runtime, memory, AI
  const init = useInitialization(replState);
  const { refreshAiReadiness } = init;

  const [isEvaluating, setIsEvaluating] = useState(false);
  // Ref to avoid stale closure in useInput callback
  const isEvaluatingRef = useRef(false);
  useEffect(() => {
    isEvaluatingRef.current = isEvaluating;
  }, [isEvaluating]);
  const [hasBeenCleared, setHasBeenCleared] = useState(false); // Hide banner after Ctrl+L
  const composerRef = useRef<ComposerSurfaceHandle | null>(null);
  const [composerShellState, setComposerShellState] = useState<
    ComposerShellState
  >({
    draftTextLength: 0,
    hasDraftInput: false,
    hasSubmitText: false,
    queuedDraftCount: 0,
    queuePreviewRows: 0,
    submitAction: "send-agent",
    version: 0,
  });
  const lastUserScrollTsRef = useRef(0);
  const lastComposerUiStateRef = useRef<ComposerSurfaceUiState | null>(null);

  // Task manager for background evaluation
  const {
    tasks,
    createEvalTask,
    completeEvalTask,
    failEvalTask,
    updateEvalOutput,
    cancel,
    cancelAll,
    activeCount,
  } = useTaskManager();

  // Track current evaluation for Ctrl+B to push to background
  // AbortController enables true cancellation of async operations (AI calls, fetch, etc.)
  const currentEvalRef = useRef<CurrentEval | null>(null);
  // Forward-ref for handleSubmit — allows the drain callback to call it
  const handleSubmitRef = useRef<
    (code: string, attachments?: AnyAttachment[]) => Promise<void>
  >(
    async () => {},
  );

  // Overlay/surface panel state machine
  const overlay = useOverlayPanel({
    initReady: init.ready,
    needsModelSetup: init.needsModelSetup,
  });
  const {
    surfacePanel,
    setSurfacePanel,
    activeOverlay,
    setActiveOverlay,
    isOverlayOpen,
    hasStandaloneSurface,
    modelBrowserParentOverlay,
    setModelBrowserParentOverlay,
    modelBrowserParentSurface,
    setModelBrowserParentSurface,
    setModelSetupHandled,
    paletteState,
    setPaletteState,
    configOverlayState,
    setConfigOverlayState,
    togglePalette,
    toggleShortcutsOverlay,
    toggleTranscriptHistory,
    toggleBackgroundTasks,
  } = overlay;
  // Terminal width for responsive layout
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const shellContentWidth = getShellContentWidth(terminalWidth);
  const transcriptScrollRef = useRef<ScrollBoxHandle | null>(null);

  // Conversation state for agent mode
  const conversation = useConversation();
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const transcriptItemCount = conversation.historyItems.length +
    conversation.liveItems.length;
  const committedHistoryCount = conversation.historyItems.length;
  const [transcriptOverlaySearchActive, setTranscriptOverlaySearchActive] =
    useState(false);
  const [localAgentsFocused, setLocalAgentsFocused] = useState(false);
  const [backgroundTasksOverlayState, setBackgroundTasksOverlayState] =
    useState<BackgroundTasksOverlayState>(
      DEFAULT_BACKGROUND_TASKS_OVERLAY_STATE,
    );
  const allDisplayItems = useMemo(
    () =>
      compactPlanTranscriptItems(conversation.historyItems)
        .concat(conversation.liveItems),
    [conversation.historyItems, conversation.liveItems],
  );
  const hasConversationContext = usesConversationContext(surfacePanel);
  const hasActivePlanningState = Boolean(
    conversation.activePlan ||
      conversation.planningPhase ||
      conversation.pendingPlanReview ||
      conversation.planTodoState?.items.length,
  );
  // Model config: selection, execution mode, footer status
  const modelConfig = useModelConfig({
    initialConfig,
    initReady: init.ready,
  });
  const {
    modelSelection,
    configuredContextWindow,
    agentExecutionMode,
    footerStatusMessage,
    setFooterContextUsageLabel,
    applyRuntimeConfigState,
    refreshRuntimeConfigState,
    cycleAgentMode,
    flashFooterStatus,
  } = modelConfig;
  const handleSelectionCopied = useCallback((text: string) => {
    const path = getClipboardPath();
    const count = text.length.toLocaleString("en-US");
    if (path === "native") {
      flashFooterStatus(`copied ${count} chars to clipboard`);
      return;
    }
    if (path === "tmux-buffer") {
      flashFooterStatus(
        `copied ${count} chars to tmux buffer · paste with prefix + ]`,
      );
      return;
    }
    flashFooterStatus(
      `sent ${count} chars via OSC 52 · check terminal clipboard settings if paste fails`,
    );
  }, [flashFooterStatus]);
  useCopyOnSelect({ onCopied: handleSelectionCopied });
  useSelectionBgColor();

  const repinTranscriptScroll = useCallback(() => {
    transcriptScrollRef.current?.scrollToBottom();
  }, []);

  useEffect(() => {
    if (!init.ready) return;
    if (!modelSelection.activeModelId) return;
    refreshAiReadiness(modelSelection.activeModelId)
      .catch(() => {});
  }, [init.ready, modelSelection.activeModelId, refreshAiReadiness]);

  const handleModelSelectionChange = useCallback(async (modelName: string) => {
    const updates = buildSelectedModelConfigUpdates(modelName);
    const configApi = getRuntimeConfigApi();
    const normalizedModel = await persistSelectedModelConfig(
      configApi,
      modelName,
    );
    applyRuntimeConfigState(
      updates as unknown as Record<string, unknown>,
      normalizedModel,
    );
  }, [applyRuntimeConfigState]);

  const handleComposerUiStateChange = useCallback(
    (nextState: ComposerSurfaceUiState) => {
      const previousState = lastComposerUiStateRef.current;
      lastComposerUiStateRef.current = nextState;
      if (
        previousState &&
        previousState.draftTextLength === 0 &&
        nextState.draftTextLength > 0 &&
        Date.now() - lastUserScrollTsRef.current >=
          RECENT_SCROLL_REPIN_WINDOW_MS
      ) {
        const handle = transcriptScrollRef.current;
        if (handle && !handle.isSticky()) {
          repinTranscriptScroll();
        }
      }
      setComposerShellState((prev: ComposerShellState) =>
        advanceComposerShellState(prev, nextState)
      );
    },
    [repinTranscriptScroll],
  );

  const getCurrentComposerDraft = useCallback((): ConversationComposerDraft => {
    return composerRef.current?.getCurrentDraft() ??
      createConversationComposerDraft("", []);
  }, []);

  const getPendingConversationQueue = useCallback(
    (): ConversationComposerDraft[] =>
      composerRef.current?.getPendingQueue() ?? [],
    [],
  );

  const setPendingConversationQueue = useCallback(
    (updater: React.SetStateAction<ConversationComposerDraft[]>) => {
      composerRef.current?.setPendingQueue(updater);
    },
    [],
  );

  const restoreComposerDraft = useCallback(
    (draft: ConversationComposerDraft | null) => {
      composerRef.current?.restoreDraft(draft);
    },
    [],
  );

  const clearComposerDraft = useCallback(() => {
    composerRef.current?.clearDraft();
  }, []);
  const closeBackgroundTasksOverlay = useCallback(() => {
    setActiveOverlay("none");
    setBackgroundTasksOverlayState(DEFAULT_BACKGROUND_TASKS_OVERLAY_STATE);
  }, [setActiveOverlay]);
  const toggleBackgroundTasksOverlay = useCallback(() => {
    setBackgroundTasksOverlayState(DEFAULT_BACKGROUND_TASKS_OVERLAY_STATE);
    toggleBackgroundTasks();
  }, [toggleBackgroundTasks]);
  const openBackgroundTasksOverlay = useCallback((
    initialSelectedItemId?: string,
    initialViewMode: "list" | "result" = "list",
  ) => {
    setBackgroundTasksOverlayState({ initialSelectedItemId, initialViewMode });
    setActiveOverlay("background-tasks");
  }, [setActiveOverlay]);

  const agentRunner = useAgentRunner({
    conversation,
    debugEnabled: debug,
    activeModelId: modelSelection.activeModelId,
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
  });
  const {
    interactionQueue,
    pendingInteraction,
    localAgentEntries,
    interruptLocalAgentEntry,
    agentControllerRef,
    expandConversationDraftText,
    prepareConversationAttachmentPayload,
    runConversation,
    submitConversationDraft,
    handleInteractionResponse,
    interruptConversationRun,
    handleForceInterrupt,
  } = agentRunner;
  const previousBlockingInteractionRef = useRef<
    "none" | "permission" | "question"
  >("none");
  useLayoutEffect(() => {
    const currentInteraction = pendingInteraction?.mode ?? "none";
    if (previousBlockingInteractionRef.current !== currentInteraction) {
      repinTranscriptScroll();
      previousBlockingInteractionRef.current = currentInteraction;
    }
  }, [pendingInteraction?.mode, repinTranscriptScroll]);
  const previousRepinnedOverlayRef = useRef<OverlayPanel>(activeOverlay);
  useLayoutEffect(() => {
    const wasRepinned = shouldRepinForOverlay(previousRepinnedOverlayRef.current);
    const isRepinned = shouldRepinForOverlay(activeOverlay);
    if (wasRepinned !== isRepinned) {
      repinTranscriptScroll();
    }
    previousRepinnedOverlayRef.current = activeOverlay;
  }, [activeOverlay, repinTranscriptScroll]);
  useEffect(() => {
    if (localAgentEntries.length === 0) {
      setLocalAgentsFocused(false);
    }
  }, [localAgentEntries.length]);
  useEffect(() => {
    if (activeOverlay !== "none" || composerShellState.hasDraftInput) {
      setLocalAgentsFocused(false);
    }
  }, [activeOverlay, composerShellState.hasDraftInput]);
  const focusLocalAgents = useCallback(() => {
    if (localAgentEntries.length === 0) return false;
    setLocalAgentsFocused(true);
    return true;
  }, [localAgentEntries.length]);
  const interruptLocalAgent = useCallback((agent: LocalAgentEntry) => {
    return interruptLocalAgentEntry(agent.id);
  }, [interruptLocalAgentEntry]);
  const openLocalAgentsSurface = useCallback(() => {
    if (localAgentEntries.length === 0) return false;
    const singleAgent = localAgentEntries.length === 1
      ? localAgentEntries[0]
      : undefined;
    if (!singleAgent) {
      openBackgroundTasksOverlay(undefined, "list");
      return true;
    }
    openBackgroundTasksOverlay(singleAgent.id, "result");
    return true;
  }, [
    localAgentEntries,
    openBackgroundTasksOverlay,
  ]);
  const handleLocalAgentsInput = useCallback((input: string, key: {
    escape?: boolean;
    return?: boolean;
    space?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
  }) => {
    if (!localAgentsFocused || localAgentEntries.length === 0) {
      return false;
    }
    if (key.upArrow || key.escape) {
      setLocalAgentsFocused(false);
      return true;
    }
    if (
      key.return ||
      input === " " ||
      input === "\r" ||
      input === "\n" ||
      key.downArrow
    ) {
      openLocalAgentsSurface();
      return true;
    }
    return false;
  }, [
    localAgentEntries.length,
    localAgentsFocused,
    openLocalAgentsSurface,
  ]);
  const handleConversationInteractionResponse = useCallback((
    requestId: string,
    response: InteractionResponse,
  ) => {
    const interaction = pendingInteraction;
    if (
      interaction?.mode === "permission" &&
      interaction.requestId === requestId &&
      interaction.toolName === "plan_review"
    ) {
      const plan = conversationRef.current.pendingPlanReview?.plan ??
        parsePlanReviewToolArgs(interaction.toolName, interaction.toolArgs);
      if (plan) {
        const choice = response.userInput?.trim().toLowerCase();
        const reviseRequested = choice === "revise";
        const autoApproved = choice === "approve:auto";
        const approved = autoApproved ||
          (!reviseRequested && response.approved === true);
        conversationRef.current.addEvent({
          type: "plan_review_resolved",
          plan,
          approved,
          decision: approved
            ? "approved"
            : reviseRequested
            ? "revise"
            : "cancelled",
        });
      }
    }
    handleInteractionResponse(requestId, response);
  }, [
    handleInteractionResponse,
    pendingInteraction,
  ]);
  const handleQuestionInterrupt = useCallback(() => {
    if (pendingInteraction?.mode !== "question") return;
    interruptConversationRun({
      requestId: pendingInteraction.requestId,
      clearPlanning: hasActivePlanningState,
    });
  }, [
    hasActivePlanningState,
    interruptConversationRun,
    pendingInteraction,
  ]);
  const startupStatusLabel = useMemo(() => {
    if (init.aiAvailable) return undefined;
    if (init.needsModelSetup && init.modelToSetup) {
      return "Model setup needed";
    }
    return init.ready ? "Starting AI engine" : "Loading HLVM";
  }, [
    init.aiAvailable,
    init.modelToSetup,
    init.needsModelSetup,
    init.ready,
  ]);
  const startupFooterMessage = useMemo(() => {
    if (init.aiAvailable) return "";
    if (init.needsModelSetup && init.modelToSetup) {
      return `Model setup needed · /model select · ? shortcuts`;
    }
    return init.ready
      ? "Starting AI engine... /help, /config, and /model are available"
      : "Loading HLVM...";
  }, [
    init.aiAvailable,
    init.modelToSetup,
    init.needsModelSetup,
    init.ready,
  ]);
  const handleAgentSubmitBlocked = useCallback(() => {
    if (init.needsModelSetup && init.modelToSetup) {
      setModelSetupHandled(false);
      setActiveOverlay("model-setup");
      return;
    }
    flashFooterStatus("Starting AI engine...");
    refreshAiReadiness(modelSelection.activeModelId, {
      force: true,
    }).catch(() => {});
  }, [
    flashFooterStatus,
    init.modelToSetup,
    init.needsModelSetup,
    modelSelection.activeModelId,
    refreshAiReadiness,
    setActiveOverlay,
    setModelSetupHandled,
  ]);
  useEffect(() => {
    if (
      shouldAutoCloseConversationSurface({
        activeOverlay,
        surfacePanel,
        itemCount: transcriptItemCount,
        hasActiveRun: isEvaluating || agentControllerRef.current !== null,
        queuedDraftCount: composerShellState.queuedDraftCount,
        hasPendingInteraction: Boolean(pendingInteraction),
        hasPlanState: hasActivePlanningState,
      })
    ) {
      setSurfacePanel("none");
    }
  }, [
    activeOverlay,
    agentExecutionMode,
    surfacePanel,
    transcriptItemCount,
    agentControllerRef,
    isEvaluating,
    composerShellState.queuedDraftCount,
    pendingInteraction,
    hasActivePlanningState,
    setSurfacePanel,
  ]);

  const streamEvalToTask = useCallback((
    taskId: string,
    iterator: AsyncIterableIterator<string>,
    controller: AbortController,
    evalState: CurrentEval,
  ) => {
    const renderInterval = 100;
    let buffer = "";
    let lastUpdate = 0;
    let pendingUpdate: ReturnType<typeof setTimeout> | null = null;

    const scheduleUpdate = () => {
      const now = Date.now();
      const elapsed = now - lastUpdate;

      if (elapsed >= renderInterval) {
        updateEvalOutput(taskId, buffer, true);
        lastUpdate = now;
        return;
      }

      if (pendingUpdate) return;

      pendingUpdate = setTimeout(() => {
        pendingUpdate = null;
        updateEvalOutput(taskId, buffer, true);
        lastUpdate = Date.now();
      }, renderInterval - elapsed);
    };

    const finalizeForeground = () => {
      if (currentEvalRef.current === evalState && !evalState.backgrounded) {
        currentEvalRef.current = null;
        setIsEvaluating(false);
      }
    };

    (async () => {
      try {
        updateEvalOutput(taskId, buffer, true);

        for await (const chunk of iterator) {
          if (controller.signal.aborted) break;

          const content = typeof chunk === "string"
            ? chunk
            : (chunk as { content?: string }).content || "";

          if (content) {
            buffer += content;
            scheduleUpdate();
          }
        }

        if (pendingUpdate) {
          clearTimeout(pendingUpdate);
          pendingUpdate = null;
        }

        if (controller.signal.aborted) {
          cancel(taskId);
          return;
        }

        completeEvalTask(taskId, buffer);
      } catch (err) {
        const isAbort = controller.signal.aborted ||
          (err instanceof Error && err.name === "AbortError");
        if (isAbort) {
          cancel(taskId);
          return;
        }
        const error = ensureError(err);
        failEvalTask(taskId, error);
      } finally {
        finalizeForeground();
      }
    })().catch(() => {/* guard against unhandled rejection */});
  }, [
    updateEvalOutput,
    completeEvalTask,
    failEvalTask,
    cancel,
  ]);

  // ============================================================
  // Agent conversation handler
  // ============================================================

  // (runConversation, submitConversationDraft, handleInteractionResponse,
  //  handleForceInterrupt, queue drain effect
  //  all moved to useAgentRunner)
  const flushReplOutput = useCallback(() => {
    clearTerminal();
    setHasBeenCleared(true);
    conversationRef.current.clear();
  }, []);

  const handleAppExit = useCallback(async () => {
    try {
      await replState.flushHistory();
    } finally {
      replState.flushHistorySync();
    }
    exit();
  }, [exit, replState]);

  const handleCtrlC = useCallback(async () => {
    const action = resolveCtrlCAction({
      draftText: composerRef.current?.getDraftText() ?? "",
      attachmentCount: composerRef.current?.getAttachmentCount() ?? 0,
    });
    if (action === "clear-draft") {
      const handled = await executeHandler(HandlerIds.COMPOSER_CLEAR);
      if (!handled) {
        restoreComposerDraft(null);
      }
      return;
    }
    await handleAppExit();
  }, [handleAppExit, restoreComposerDraft]);

  const handleBackground = useCallback(() => {
    const activeEval = currentEvalRef.current;
    if (!activeEval || activeEval.backgrounded) return;
    activeEval.backgrounded = true;
    const taskId = activeEval.taskId ??
      createEvalTask(activeEval.code, activeEval.controller);
    activeEval.taskId = taskId;
    currentEvalRef.current = null;
    setIsEvaluating(false);
    const preview = truncate(activeEval.code, 40);
    conversationRef.current.addHqlEval("", {
      success: true,
      value: `Pushed to background (Task ${taskId.slice(0, 8)}): ${preview}`,
      isCommandOutput: true,
    });
  }, [createEvalTask]);

  // Ctrl+F double-press kill-all state
  const ctrlFTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKillAll = useCallback(() => {
    if (activeCount === 0) {
      conversationRef.current.addHqlEval("", {
        success: true,
        value: "No active tasks.",
        isCommandOutput: true,
      });
      return;
    }
    if (ctrlFTimerRef.current !== null) {
      // Second press within window — kill all
      clearTimeout(ctrlFTimerRef.current);
      ctrlFTimerRef.current = null;
      cancelAll();
      conversationRef.current.addHqlEval("", {
        success: true,
        value: "All background tasks cancelled.",
        isCommandOutput: true,
      });
    } else {
      // First press — start 3s confirmation window
      conversationRef.current.addHqlEval("", {
        success: true,
        value: "Press Ctrl+F again within 3s to cancel all tasks.",
        isCommandOutput: true,
      });
      ctrlFTimerRef.current = setTimeout(() => {
        ctrlFTimerRef.current = null;
      }, 3000);
    }
  }, [activeCount, cancelAll]);

  // Clean up Ctrl+F timer on unmount
  useEffect(() => {
    return () => {
      if (ctrlFTimerRef.current !== null) {
        clearTimeout(ctrlFTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    registerHandler(
      HandlerIds.APP_EXIT,
      handleCtrlC,
      "App",
    );
    registerHandler(
      HandlerIds.APP_SHORTCUTS,
      toggleShortcutsOverlay,
      "App",
    );
    registerHandler(
      HandlerIds.APP_CLEAR,
      flushReplOutput,
      "App",
    );
    registerHandler(
      HandlerIds.APP_PALETTE,
      togglePalette,
      "App",
    );
    registerHandler(
      HandlerIds.APP_BACKGROUND,
      handleBackground,
      "App",
    );
    registerHandler(
      HandlerIds.CONVERSATION_OPEN_HISTORY,
      toggleTranscriptHistory,
      "App",
    );
    registerHandler(
      HandlerIds.APP_KILL_ALL,
      handleKillAll,
      "App",
    );
    registerHandler(
      HandlerIds.APP_TASK_OVERLAY,
      toggleBackgroundTasksOverlay,
      "App",
    );
    registerHandler(
      HandlerIds.CONVERSATION_SEARCH,
      () => {
        setTranscriptOverlaySearchActive(true);
        setActiveOverlay("transcript-history");
      },
      "App",
    );
    registerHandler(
      HandlerIds.CONVERSATION_OPEN_LATEST_SOURCE,
      async () => {
        const allItems = [
          ...conversationRef.current.historyItems,
          ...conversationRef.current.liveItems,
        ];
        const citation = getLatestCitation(allItems);
        if (citation?.url) {
          await getPlatform().openUrl(citation.url).catch(() => {});
        }
      },
      "App",
    );
    return () => {
      unregisterHandler(HandlerIds.APP_EXIT);
      unregisterHandler(HandlerIds.APP_SHORTCUTS);
      unregisterHandler(HandlerIds.APP_CLEAR);
      unregisterHandler(HandlerIds.APP_PALETTE);
      unregisterHandler(HandlerIds.APP_BACKGROUND);
      unregisterHandler(HandlerIds.CONVERSATION_OPEN_HISTORY);
      unregisterHandler(HandlerIds.APP_KILL_ALL);
      unregisterHandler(HandlerIds.APP_TASK_OVERLAY);
      unregisterHandler(HandlerIds.CONVERSATION_SEARCH);
      unregisterHandler(HandlerIds.CONVERSATION_OPEN_LATEST_SOURCE);
    };
  }, [
    flushReplOutput,
    handleCtrlC,
    toggleShortcutsOverlay,
    handleBackground,
    handleKillAll,
    togglePalette,
    toggleTranscriptHistory,
    toggleBackgroundTasksOverlay,
    setActiveOverlay,
  ]);

  // Refs for values only read inside handlers — avoids re-creating callbacks
  // every time streaming tokens cause conversation/interaction/queue state to change.
  const pendingInteractionRef = useRef(pendingInteraction);
  pendingInteractionRef.current = pendingInteraction;
  const handleInteractionResponseRef = useRef(handleInteractionResponse);
  handleInteractionResponseRef.current = handleInteractionResponse;
  const restoreComposerDraftRef = useRef(restoreComposerDraft);
  restoreComposerDraftRef.current = restoreComposerDraft;

  const handleSubmit = useCallback(
    async (code: string, attachments?: AnyAttachment[]) => {
      if (!code.trim()) return;

      const trimmedInput = code.trim();
      const shellCommand = isShellCommandText(code);
      const normalizedInput = trimmedInput.startsWith(".")
        ? "/" + trimmedInput.slice(1)
        : trimmedInput;
      const [rawCommand = "", ...argTokens] = normalizedInput.split(/\s+/);
      const commandName = rawCommand.toLowerCase();
      const commandArgs = argTokens.join(" ").trim();
      const opensModelPicker = commandName === "/model" &&
        commandArgs.length === 0;
      const isPanelCommand = commandName === "/help" ||
        commandName === "/config" || commandName === "/flush" ||
        opensModelPicker;
      const isAnyCommand = isPanelCommand || shellCommand;
      const submitAction = resolveSubmitAction({
        text: code,
        isBalanced: isBalanced(trimmedInput),
        hasAttachments: (attachments?.length ?? 0) > 0,
        composerLanguage: hasConversationContext ? "chat" : "hql",
        routeHint: hasConversationContext ? "conversation" : "mixed-shell",
        isCommand: isAnyCommand,
      });

      if (submitAction === "continue-multiline") {
        return;
      }

      if (submitAction === "run-command") {
        if (commandName === "/help") {
          setActiveOverlay("shortcuts-overlay");
          return;
        }

        if (commandName === "/config") {
          setActiveOverlay("config-overlay");
          return;
        }

        if (opensModelPicker) {
          setModelBrowserParentSurface(surfacePanel);
          setModelBrowserParentOverlay("none");
          setActiveOverlay("models");
          return;
        }

        if (commandName === "/tasks") {
          openBackgroundTasksOverlay();
          return;
        }

        if (commandName === "/flush") {
          flushReplOutput();
          return;
        }

        recordPromptHistory(replState, code, "command");
        const output = await handleCommand(code, exit, replState);
        if (output !== null) {
          // Skill activation: re-submit as agent query with skill instructions
          const SKILL_MARKER = "\x00SKILL\x00";
          if (output.startsWith(SKILL_MARKER)) {
            const skillMessage = output.slice(SKILL_MARKER.length);
            conversationRef.current.addUserMessage(
              `${code}\n\n${skillMessage}`,
              { startTurn: true },
            );
            return;
          }
          conversationRef.current.addHqlEval(code, {
            success: true,
            value: output,
            isCommandOutput: true,
          });
        }
        return;
      }

      if (submitAction === "send-agent") {
        const currentPendingInteraction = pendingInteractionRef.current;
        if (currentPendingInteraction?.mode === "question") {
          recordPromptHistory(replState, code, "interaction");
          conversationRef.current.addUserMessage(
            trimmedInput,
            {
              startTurn: false,
            },
          );
          handleInteractionResponseRef.current(
            currentPendingInteraction.requestId,
            {
              approved: true,
              userInput: trimmedInput,
            },
          );
          return;
        }

        if (currentEvalRef.current && !currentEvalRef.current.backgrounded) {
          recordPromptHistory(
            replState,
            code,
            "conversation",
            undefined,
            attachments,
          );
          setSurfacePanel("conversation");
          const conversationDraft = createConversationComposerDraft(
            trimmedInput,
            attachments,
            trimmedInput.length,
            undefined,
            "chat",
          );
          setPendingConversationQueue((prev: ConversationComposerDraft[]) =>
            enqueueConversationDraft(prev, conversationDraft)
          );
          return;
        }

        if (hasConversationContext) {
          recordPromptHistory(
            replState,
            code,
            "conversation",
            undefined,
            attachments,
          );
          const conversationDraft = createConversationComposerDraft(
            trimmedInput,
            attachments,
            trimmedInput.length,
            undefined,
            "chat",
          );
          if (agentControllerRef.current) {
            setPendingConversationQueue((prev: ConversationComposerDraft[]) =>
              enqueueConversationDraft(prev, conversationDraft)
            );
            return;
          }
          const result = submitConversationDraft(conversationDraft);
          if (!result.started) {
            restoreComposerDraftRef.current(conversationDraft);
            if (result.unsupportedMimeType) {
              conversationRef.current.addError(
                describeConversationAttachmentMimeTypeError(
                  result.unsupportedMimeType,
                ),
              );
            }
          }
          return;
        }

        if (agentControllerRef.current) {
          conversationRef.current.addHqlEval(code, {
            success: false,
            error: new Error("Agent is already running. Press Esc to cancel."),
          });
          return;
        }

        recordPromptHistory(
          replState,
          code,
          "conversation",
          undefined,
          attachments,
        );
        const expandedText = expandConversationDraftText(
          trimmedInput,
          attachments,
        );
        const { attachments: conversationAttachments, unsupportedMimeType } =
          prepareConversationAttachmentPayload(attachments, trimmedInput);
        if (unsupportedMimeType) {
          conversationRef.current.addHqlEval(code, {
            success: false,
            error: new Error(
              describeConversationAttachmentMimeTypeError(
                unsupportedMimeType,
              ),
            ),
          });
          return;
        }
        setSurfacePanel("conversation");
        setIsEvaluating(true);
        void runConversation(
          expandedText,
          conversationAttachments,
          { displayText: trimmedInput },
        );
        return;
      }

      if (currentEvalRef.current && !currentEvalRef.current.backgrounded) {
        recordPromptHistory(
          replState,
          code,
          "evaluate",
          undefined,
          attachments,
        );
        const queuedEval = createConversationComposerDraft(
          trimmedInput,
          attachments,
          trimmedInput.length,
          undefined,
          "eval",
        );
        setPendingConversationQueue((prev: ConversationComposerDraft[]) =>
          enqueueConversationDraft(prev, queuedEval)
        );
        return;
      }
      if (agentControllerRef.current) {
        recordPromptHistory(
          replState,
          code,
          "evaluate",
          undefined,
          attachments,
        );
        const queuedEval = createConversationComposerDraft(
          trimmedInput,
          attachments,
          trimmedInput.length,
          undefined,
          "eval",
        );
        setPendingConversationQueue((prev: ConversationComposerDraft[]) =>
          enqueueConversationDraft(prev, queuedEval)
        );
        return;
      }

      recordPromptHistory(
        replState,
        code,
        "evaluate",
        undefined,
        attachments,
      );
      setIsEvaluating(true);

      // Evaluate (with optional attachments)
      // Create AbortController for true cancellation support
      const controller = new AbortController();
      const evalPromise = repl.evaluate(code, {
        attachments,
        signal: controller.signal,
      });
      const evalState: CurrentEval = {
        code,
        controller,
        backgrounded: false,
      };
      currentEvalRef.current = evalState;

      const finalizeForeground = () => {
        if (currentEvalRef.current === evalState) {
          currentEvalRef.current = null;
          setIsEvaluating(false);
        }
      };

      let result: EvalResult;
      try {
        result = await evalPromise;
      } catch (error) {
        if (evalState.cancelled) return;
        const err = ensureError(error);
        if (evalState.backgrounded || evalState.taskId) {
          const taskId = evalState.taskId ?? createEvalTask(code, controller);
          evalState.taskId = taskId;
          failEvalTask(taskId, err);
        } else {
          conversationRef.current.addHqlEval(code, {
            success: false,
            error: err,
          });
        }
        finalizeForeground();
        return;
      }

      if (evalState.cancelled) {
        return;
      }

      if (!result.success) {
        const err = result.error ?? new Error("Unknown error");
        if (evalState.backgrounded || evalState.taskId) {
          const taskId = evalState.taskId ?? createEvalTask(code, controller);
          evalState.taskId = taskId;
          failEvalTask(taskId, err);
        } else {
          conversationRef.current.addHqlEval(code, {
            success: false,
            error: err,
          });
        }
        finalizeForeground();
        return;
      }

      if (isAsyncIterable(result.value)) {
        const taskId = evalState.taskId ?? createEvalTask(code, controller);
        evalState.taskId = taskId;

        streamEvalToTask(
          taskId,
          result.value as AsyncIterableIterator<string>,
          controller,
          evalState,
        );

        if (!evalState.backgrounded) {
          conversationRef.current.addHqlEval(code, {
            success: true,
            streamTaskId: taskId,
          });
        }

        return;
      }

      if (evalState.backgrounded || evalState.taskId) {
        const taskId = evalState.taskId ?? createEvalTask(code, controller);
        evalState.taskId = taskId;
        completeEvalTask(taskId, result.value);
      } else {
        conversationRef.current.addHqlEval(code, result);
      }

      finalizeForeground();
    },
    [
      repl,
      exit,
      createEvalTask,
      completeEvalTask,
      failEvalTask,
      streamEvalToTask,
      prepareConversationAttachmentPayload,
      runConversation,
      submitConversationDraft,
      hasConversationContext,
      setPendingConversationQueue,
      setSurfacePanel,
      replState,
      conversation,
      flashFooterStatus,
      setFooterContextUsageLabel,
    ],
  );
  handleSubmitRef.current = handleSubmit;

  useEffect(() => {
    const pendingQueue = getPendingConversationQueue();
    if (pendingQueue.length === 0) return;
    if (isEvaluating) return;
    if (agentControllerRef.current) return;
    if (currentEvalRef.current && !currentEvalRef.current.backgrounded) return;
    if (pendingInteraction) return;
    if (conversation.planningPhase && conversation.planningPhase !== "done") {
      return;
    }
    if (conversation.pendingPlanReview) return;

    const { draft: nextInput, remaining } = shiftQueuedConversationDraft(
      pendingQueue,
    );
    if (!nextInput) return;
    setPendingConversationQueue(remaining);
    void handleSubmitRef.current(nextInput.text, nextInput.attachments);
  }, [
    agentControllerRef,
    composerShellState.version,
    conversation.pendingPlanReview,
    conversation.planningPhase,
    getPendingConversationQueue,
    isEvaluating,
    pendingInteraction,
    setPendingConversationQueue,
  ]);

  // Command palette action handler
  const handlePaletteAction = useCallback((action: KeybindingAction) => {
    setActiveOverlay("none");
    if (action.type === "SLASH_COMMAND") {
      // Execute slash command directly
      handleSubmit(action.cmd);
    } else if (action.type === "HANDLER") {
      // Execute registered handler by ID
      executeHandler(action.id);
    }
    // INFO type is display-only (shortcut reference)
  }, [handleSubmit]);

  // Keybinding rebind handler - saves new key combo to config
  const handleRebind = useCallback((keybindingId: string, combo: KeyCombo) => {
    // Convert KeyCombo to string format for storage
    const parts: string[] = [];
    if (combo.ctrl) parts.push("Ctrl");
    if (combo.meta) parts.push("Cmd");
    if (combo.alt) parts.push("Alt");
    if (combo.shift) parts.push("Shift");
    parts.push(combo.key.length === 1 ? combo.key.toUpperCase() : combo.key);
    const keyComboStr = parts.join("+");

    const nextBindings = {
      ...getCustomKeybindingsSnapshot(),
      [keybindingId]: keyComboStr,
    };

    patchRuntimeConfig({ keybindings: nextBindings }).then((updatedConfig) => {
      setCustomKeybindingsSnapshot(updatedConfig.keybindings);
      refreshKeybindingLookup();
    }).catch(() => {});
  }, []);

  const appInputHandlerRef = useRef(
    (_char: string, _key: Key) => {},
  );
  appInputHandlerRef.current = (char: string, key: Key) => {
    const isEscKey = isBareEscapeInput(char, key);
    const globalBinding = inspectHandlerKeybinding(char, key, {
      categories: GLOBAL_KEYBINDING_CATEGORIES,
    });
    if (
      activeOverlay === "transcript-history" &&
      globalBinding.kind === "handler" &&
      globalBinding.id === HandlerIds.APP_EXIT
    ) {
      setActiveOverlay("none");
      return;
    }
    const canOpenDefaultShortcuts = globalBinding.kind === "handler" &&
      globalBinding.id === HandlerIds.APP_SHORTCUTS &&
      globalBinding.source === "default" &&
      char === "?" &&
      !key.ctrl &&
      !key.meta &&
      !key.escape &&
      activeOverlay === "none" &&
      (composerRef.current?.getDraftText() ?? "").length === 0 &&
      pendingInteraction?.mode !== "question";
    if (
      globalBinding.kind === "handler" &&
      globalBinding.id === HandlerIds.APP_EXIT
    ) {
      void executeHandler(globalBinding.id);
      return;
    }
    if (
      globalBinding.kind === "handler" &&
      globalBinding.id === HandlerIds.APP_SHORTCUTS
    ) {
      if (globalBinding.source === "custom" || canOpenDefaultShortcuts) {
        void executeHandler(globalBinding.id);
      }
      return;
    }
    if (activeOverlay !== "none") {
      return;
    }
    if (globalBinding.kind === "handler") {
      void executeHandler(globalBinding.id);
      return;
    }
    if (
      globalBinding.kind === "disabled-default" ||
      globalBinding.kind === "shadowed"
    ) {
      return;
    }
    const pickerInteractionActive = hasConversationContext &&
      isPickerInteractionRequest(pendingInteraction);
    const isEnterLikeInput = key.return;

    if (pickerInteractionActive) {
      return;
    }
    if (hasConversationContext && pendingInteraction) {
      if (pendingInteraction.mode === "permission") {
        if (char === "y" || isEnterLikeInput) {
          handleInteractionResponse(pendingInteraction.requestId, {
            approved: true,
          });
          return;
        }
        if (
          pendingInteraction.toolName === "plan_review" &&
          char.toLowerCase() === "r"
        ) {
          handleInteractionResponse(pendingInteraction.requestId, {
            approved: false,
            userInput: "revise",
          });
          return;
        }
        if (char === "n" || isEscKey) {
          handleInteractionResponse(pendingInteraction.requestId, {
            approved: false,
          });
          return;
        }
      }
      if (pendingInteraction.mode === "question" && isEscKey) {
        interruptConversationRun({
          requestId: pendingInteraction.requestId,
          clearPlanning: hasActivePlanningState,
        });
        return;
      }
    }

    if (isEscKey && composerRef.current?.shouldSuppressAppEscapeInterrupt()) {
      return;
    }

    if (
      isEscKey &&
      hasConversationContext &&
      hasActivePlanningState &&
      !isConversationTaskRunning &&
      !pendingInteraction
    ) {
      conversation.cancelPlanning();
      return;
    }

    // NOTE: Escape→interrupt for running conversations is handled by Input.tsx
    // (via shouldInterruptConversationOnEsc → onInterruptRunningTask).
    // App.tsx must NOT duplicate it — both useInput handlers fire on the same
    // keypress, so a duplicate call would produce double cancellation artifacts.

    if (isEscKey && isEvaluatingRef.current && currentEvalRef.current) {
      const evalState = currentEvalRef.current;
      evalState.cancelled = true;

      if (evalState.taskId) {
        cancel(evalState.taskId);
      } else {
        evalState.controller.abort();
      }

      conversationRef.current.addHqlEval(evalState.code, {
        success: true,
        value: "[Cancelled]",
      });

      currentEvalRef.current = null;
      setIsEvaluating(false);
    }
  };
  const handleAppInput = useCallback((
    char: string,
    key: Parameters<
      typeof appInputHandlerRef.current
    >[1],
  ) => {
    appInputHandlerRef.current(char, key);
  }, []);
  useInput(handleAppInput);

  const recentActiveTaskLabel = useMemo(() => {
    const active = tasks.find(isTaskActive);
    if (!active) return undefined;
    return isEvalTask(active) ? active.preview : active.label;
  }, [tasks]);

  const pickerInteractionActive = hasConversationContext &&
    isPickerInteractionRequest(pendingInteraction);
  const interactionPromptActive = hasConversationContext &&
    Boolean(pendingInteraction);
  const blockingInteractionActive = interactionPromptActive &&
    (pendingInteraction?.mode === "permission" || pickerInteractionActive);
  const showBackgroundStatusSurface = !interactionPromptActive &&
    !isOverlayOpen;
  const showBottomDialog = interactionPromptActive && !isOverlayOpen;
  const isConversationInputVisible = hasConversationContext && !isOverlayOpen;
  const isInputVisible = !isOverlayOpen &&
    (surfacePanel === "none" || isConversationInputVisible);
  const isInputDisabled = blockingInteractionActive;
  const isForegroundTaskRunning = isEvaluating ||
    agentControllerRef.current !== null;
  const isConversationTaskRunning = hasConversationContext &&
    isForegroundTaskRunning;

  // Conversation shortcuts should only take over when the composer will not
  // immediately consume the same key sequence.
  const allowConversationToggleHotkeys = !isInputVisible || isInputDisabled ||
    !composerShellState.hasDraftInput;
  const liveTodoCount = hasConversationContext
    ? (conversation.planTodoState ?? conversation.todoState)?.items.length ?? 0
    : 0;
  const renderShellLanes = shouldRenderShellLanes({
    historyItemCount: committedHistoryCount,
    localEvalQueueCount: 0,
    liveItemCount: hasConversationContext ? conversation.liveItems.length : 0,
    liveTodoCount,
    hasPendingInteraction: hasConversationContext &&
      Boolean(pendingInteraction),
    hasLocalAgents: localAgentEntries.length > 0,
  });
  const interactionStatusLabel = useMemo(() => {
    if (!hasConversationContext) return undefined;
    if (pendingInteraction?.mode === "permission") {
      return pendingInteraction.toolName === "plan_review"
        ? "Plan review"
        : "Approval needed";
    }
    if (pendingInteraction?.mode === "question") {
      return "Reply needed";
    }
    return undefined;
  }, [hasConversationContext, pendingInteraction]);
  const currentTurnSummary = useMemo(() => {
    if (!hasConversationContext || pendingInteraction) return undefined;
    if (!isConversationTaskRunning) return undefined;
    const liveStatus = deriveLiveTurnStatus({
      items: conversation.liveItems,
      streamingState: conversation.streamingState,
      planningPhase: conversation.planningPhase,
    });
    if (liveStatus?.label) {
      return liveStatus.label;
    }
    const activeTool = conversation.activeTool;
    if (activeTool) {
      const summaryLabel = activeTool.toolTotal > 1
        ? `${activeTool.displayName} ${activeTool.toolIndex}/${activeTool.toolTotal}`
        : activeTool.displayName;
      const parts = [summaryLabel];
      if (activeTool.progressText?.trim()) {
        parts.push(truncate(activeTool.progressText.trim(), 48));
      }
      return parts.join(" · ");
    }
    return "Thinking";
  }, [
    conversation.activeTool,
    conversation.liveItems,
    conversation.planningPhase,
    conversation.streamingState,
    hasConversationContext,
    isConversationTaskRunning,
    pendingInteraction,
  ]);
  const currentTurnTone = useMemo(() => {
    if (!hasConversationContext || pendingInteraction || !isConversationTaskRunning) {
      return undefined;
    }
    return deriveLiveTurnStatus({
      items: conversation.liveItems,
      streamingState: conversation.streamingState,
      planningPhase: conversation.planningPhase,
    })?.tone ?? "active";
  }, [
    conversation.liveItems,
    conversation.planningPhase,
    conversation.streamingState,
    hasConversationContext,
    isConversationTaskRunning,
    pendingInteraction,
  ]);
  const localAgentsFooterModel = showBackgroundStatusSurface
    ? buildBackgroundStatusFooterModel(
      localAgentEntries,
      shellContentWidth,
      {
        focused: localAgentsFocused,
        leader: {
          activityText: currentTurnSummary,
          idleText: "Idle",
        },
        activeTaskCount: localAgentEntries.length === 0 ? activeCount : 0,
        recentActiveTaskLabel: localAgentEntries.length === 0
          ? recentActiveTaskLabel
          : undefined,
      },
    )
    : undefined;
  const localAgentsManagerModel = showBackgroundStatusSurface &&
      localAgentEntries.length > 0
    ? buildLocalAgentsManagerModel(
      localAgentEntries,
      shellContentWidth,
      {
        focused: localAgentsFocused,
        leader: {
          activityText: currentTurnSummary,
          idleText: "Idle",
        },
      },
    )
    : undefined;
  const queueEditBindingLabel = useMemo(
    () =>
      getConversationQueueEditBindingLabel(
        getConversationQueueEditBinding(getPlatform().env),
      ),
    [],
  );
  const queuedConversationDrafts = composerShellState.queuePreviewRows > 0
    ? composerRef.current?.getPendingQueue() ?? []
    : [];

  const bannerVisible = shouldRenderMainBanner({
    showBanner,
    hasBeenCleared,
    isOverlayOpen,
    hasStandaloneSurface,
    hasActivePlanningState,
    hasShellHistory: committedHistoryCount > 0,
    hasLiveConversation: conversation.liveItems.length > 0,
    hasQueuedInput: composerShellState.queuedDraftCount > 0,
    hasPendingInteraction: Boolean(pendingInteraction),
    hasLocalAgents: localAgentEntries.length > 0,
  });
  let overlayNode: React.ReactNode = null;

  if (activeOverlay === "palette") {
    overlayNode = (
      <CommandPaletteOverlay
        onClose={() => setActiveOverlay("none")}
        onExecute={handlePaletteAction}
        onRebind={handleRebind}
        initialState={paletteState}
        onStateChange={setPaletteState}
      />
    );
  } else if (activeOverlay === "models") {
    overlayNode = (
      <ModelBrowser
        currentModel={modelSelection.activeModelId}
        isCurrentModelConfigured={modelSelection.modelConfigured}
        onClose={() => {
          setSurfacePanel(modelBrowserParentSurface);
          setActiveOverlay(modelBrowserParentOverlay);
          setModelBrowserParentSurface("none");
          setModelBrowserParentOverlay("none");
        }}
        onModelSet={(modelName: string) => {
          const normalizedModel = normalizeModelId(modelName) ?? modelName;
          conversation.addHqlEval("", {
            success: true,
            value: `✓ Default model: ${normalizedModel}`,
            isCommandOutput: true,
          });
        }}
        onSelectModel={handleModelSelectionChange}
      />
    );
  } else if (activeOverlay === "model-setup" && init.modelToSetup) {
    overlayNode = (
      <ModelSetupOverlay
        modelName={init.modelToSetup}
        onComplete={() => {
          refreshAiReadiness(modelSelection.activeModelId, {
            force: true,
          }).catch(() => {});
          setModelSetupHandled(true);
          setActiveOverlay("none");
          conversation.addHqlEval("", {
            success: true,
            value: `✓ AI model installed: ${init.modelToSetup}`,
            isCommandOutput: true,
          });
        }}
        onCancel={() => {
          setModelSetupHandled(true);
          setActiveOverlay("none");
          conversation.addHqlEval("", {
            success: true,
            value:
              `AI model setup cancelled. Run "hlvm ai pull ${init.modelToSetup}" to download later.`,
            isCommandOutput: true,
          });
        }}
      />
    );
  } else if (activeOverlay === "config-overlay") {
    overlayNode = (
      <ConfigOverlay
        onClose={() => setActiveOverlay("none")}
        onOpenModelBrowser={() => {
          setModelBrowserParentSurface(surfacePanel);
          setModelBrowserParentOverlay("config-overlay");
          setActiveOverlay("models");
        }}
        onConfigChange={(cfg) =>
          applyRuntimeConfigState(
            cfg as unknown as Record<string, unknown>,
          )}
        initialState={configOverlayState}
        onStateChange={setConfigOverlayState}
      />
    );
  } else if (activeOverlay === "shortcuts-overlay") {
    overlayNode = (
      <ShortcutsOverlay onClose={() => setActiveOverlay("none")} />
    );
  } else if (activeOverlay === "transcript-history") {
    overlayNode = (
      <TranscriptViewerOverlay
        historyItems={conversation.historyItems}
        liveItems={conversation.liveItems}
        width={shellContentWidth}
        initialSearchActive={transcriptOverlaySearchActive}
        onClose={() => {
          setActiveOverlay("none");
          setTranscriptOverlaySearchActive(false);
        }}
      />
    );
  } else if (activeOverlay === "background-tasks") {
    overlayNode = (
      <BackgroundTasksOverlay
        onClose={closeBackgroundTasksOverlay}
        localAgents={localAgentEntries}
        initialSelectedItemId={backgroundTasksOverlayState
          .initialSelectedItemId}
        initialViewMode={backgroundTasksOverlayState.initialViewMode}
        onInterruptLocalAgent={interruptLocalAgent}
      />
    );
  }

  return (
    <FullscreenViewport>
      <Box
        flexDirection="column"
        flexGrow={1}
        height="100%"
        paddingX={SHELL_LAYOUT.gutterX}
      >
        {bannerVisible && (
          <>
            <Banner errors={init.errors} />
            {init.updateInfo && <UpdateBanner update={init.updateInfo} />}
            {!init.ready && <LoadingScreen progress={init.progress} />}
          </>
        )}

        <ScrollKeybindingHandler
          scrollRef={transcriptScrollRef}
          isActive={!pendingInteraction && activeOverlay === "none"}
          onScroll={() => {
            lastUserScrollTsRef.current = Date.now();
          }}
          onSelectionCopied={handleSelectionCopied}
        />

        <FullscreenLayout
          scrollRef={transcriptScrollRef}
          scrollable={(
            <Box flexDirection="column">
              {!hasStandaloneSurface && renderShellLanes && (
                <RenderErrorBoundary>
                  <VirtualTranscript
                    items={hasConversationContext ? allDisplayItems : []}
                    scrollRef={transcriptScrollRef}
                    width={shellContentWidth}
                    compactSpacing
                    streamingState={hasConversationContext
                      ? conversation.streamingState
                      : undefined}
                    planningPhase={hasConversationContext
                      ? conversation.planningPhase
                      : undefined}
                    todoState={hasConversationContext
                      ? (conversation.planTodoState ?? conversation.todoState)
                      : undefined}
                    showPlanChecklist={hasConversationContext}
                    showLeadingDivider={composerShellState.queuedDraftCount > 0}
                  />
                </RenderErrorBoundary>
              )}

              {(!blockingInteractionActive && !isOverlayOpen && isInputVisible) && (
                <Box
                  flexDirection="column"
                  marginTop={SHELL_LAYOUT.transcriptToComposerGap}
                >
                  {queuedConversationDrafts.length > 0 && (
                    <QueuePreview
                      items={queuedConversationDrafts}
                      editBindingLabel={queueEditBindingLabel}
                    />
                  )}
                  {localAgentsManagerModel && (
                    <RenderErrorBoundary>
                      <LocalAgentsManagerPanel
                        model={localAgentsManagerModel}
                        width={shellContentWidth}
                      />
                    </RenderErrorBoundary>
                  )}
                  <ComposerSurface
                    ref={composerRef}
                    replState={replState}
                    onUiStateChange={handleComposerUiStateChange}
                    onSubmit={handleSubmit}
                    canSubmitAgent={init.aiAvailable}
                    onAgentSubmitBlocked={handleAgentSubmitBlocked}
                    onEmptySubmit={undefined}
                    onFocusLocalAgents={localAgentEntries.length > 0 &&
                        !composerShellState.hasDraftInput
                      ? focusLocalAgents
                      : undefined}
                    onLocalAgentsInput={localAgentsFocused
                      ? handleLocalAgentsInput
                      : undefined}
                    localAgentsFocused={localAgentsFocused}
                    onForceSubmit={hasConversationContext
                      ? handleForceInterrupt
                      : undefined}
                    onInterruptRunningTask={hasConversationContext
                      ? () =>
                        interruptConversationRun({
                          clearPlanning: hasActivePlanningState,
                        })
                      : undefined}
                    queueEnabled={isForegroundTaskRunning}
                    isConversationTaskRunning={isConversationTaskRunning}
                    onCycleMode={cycleAgentMode}
                    disabled={isInputDisabled}
                    isConversationContext={hasConversationContext}
                    composerLanguage={hasConversationContext ? "chat" : "hql"}
                    promptLabel=">"
                    interactionMode={pickerInteractionActive
                      ? pendingInteraction?.mode
                      : undefined}
                    showQueuePreview={false}
                    onBareShortcutsToggle={toggleShortcutsOverlay}
                  />
                </Box>
              )}

              {(isInputVisible || hasConversationContext) && (
                <TuiStatusLine
                  modelName={modelSelection.displayLabel}
                  contextUsageLabel={modelConfig.footerContextUsageLabel}
                  modeLabel={getPersistentAgentExecutionModeLabel(
                    agentExecutionMode,
                  )}
                  planningPhase={hasConversationContext
                    ? conversation.planningPhase
                    : undefined}
                  interactionLabel={interactionStatusLabel}
                  turnLabel={currentTurnSummary}
                  turnTone={currentTurnTone}
                  aiAvailable={init.aiAvailable}
                  idleLabel={startupStatusLabel}
                />
              )}

              {(isInputVisible || hasConversationContext) &&
                (
                  <FooterHint
                    statusMessage={footerStatusMessage ||
                      (!composerShellState.hasSubmitText
                        ? startupFooterMessage
                        : "")}
                    planningPhase={hasConversationContext
                      ? conversation.planningPhase
                      : undefined}
                    streamingState={hasConversationContext
                      ? conversation.streamingState
                      : undefined}
                    interactionQueueLength={hasConversationContext
                      ? interactionQueue.length
                      : 0}
                    hasDraftInput={composerShellState.hasDraftInput}
                    hasSubmitText={composerShellState.hasSubmitText}
                    inConversation={hasConversationContext}
                    isEvaluating={isEvaluating && !hasConversationContext}
                    hasPendingPermission={hasConversationContext &&
                      pendingInteraction?.mode === "permission"}
                    hasPendingPlanReview={hasConversationContext &&
                      pendingInteraction?.mode === "permission" &&
                      pendingInteraction.toolName === "plan_review"}
                    hasPendingQuestion={hasConversationContext &&
                      pendingInteraction?.mode === "question"}
                    suppressInteractionHints={hasConversationContext &&
                      pickerInteractionActive}
                    conversationQueueCount={composerShellState.queuePreviewRows >
                        0
                      ? 0
                      : composerShellState.queuedDraftCount}
                    submitAction={composerShellState.hasSubmitText
                      ? composerShellState.submitAction
                      : undefined}
                    backgroundLabel={localAgentsFooterModel?.text}
                    backgroundHintLabel={localAgentsFooterModel?.hintText
                      ?.replace(/^ · /, "")}
                  />
                )}
            </Box>
          )}
          bottom={(
            <Box flexDirection="column">
              {showBottomDialog && (
                <RenderErrorBoundary>
                  <DialogStack
                    interactionRequest={pendingInteraction}
                    interactionQueueLength={interactionQueue.length}
                    onInteractionResponse={handleConversationInteractionResponse}
                    onQuestionInterrupt={pendingInteraction?.mode === "question"
                      ? handleQuestionInterrupt
                      : undefined}
                  />
                </RenderErrorBoundary>
              )}
            </Box>
          )}
        />

        {overlayNode}
      </Box>
    </FullscreenViewport>
  );
}

async function handleCommand(
  cmd: string,
  exit: () => void,
  state: ReplState,
): Promise<string | null> {
  const trimmed = cmd.trim().toLowerCase();

  // Normalize dot prefix to slash
  const normalized = trimmed.startsWith(".") ? "/" + trimmed.slice(1) : trimmed;

  // Commands that need React state (not in commands.ts)
  switch (normalized) {
    case "/js":
      return "Use (js ...) for JavaScript evaluation.";
    case "/hql":
      return "Use (...) for HQL evaluation.";
    case "/flush":
      return null; // Screen resets are handled by App.tsx
    case "/exit":
      await state.flushHistory();
      state.flushHistorySync();
      exit();
      return null;
  }

  // Delegate to centralized command handler and capture user-facing command output
  const outputs: string[] = [];

  await runCommand(cmd, state, {
    onOutput: (line) => outputs.push(line),
  });

  // deno-lint-ignore no-control-regex
  return outputs.join("\n").replace(/\x1b\[[0-9;]*m/g, "") || null; // Strip ANSI
}
