/**
 * HLVM Ink REPL - Main App
 * Full-featured REPL with rich banner, keyboard shortcuts, completions
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, type Key, useApp, useInput, useStdout } from "ink";
import { Banner } from "./Banner.tsx";
import { LoadingScreen } from "./LoadingScreen.tsx";
import { ConfigOverlay } from "./ConfigOverlay.tsx";
import {
  CommandPaletteOverlay,
  type KeyCombo,
} from "./CommandPaletteOverlay.tsx";
import { TeamDashboardOverlay } from "./TeamDashboardOverlay.tsx";
import { ShortcutsOverlay } from "./ShortcutsOverlay.tsx";
import { BackgroundTasksOverlay } from "./BackgroundTasksOverlay.tsx";
import { ModelBrowser } from "./ModelBrowser.tsx";
import { ModelSetupOverlay } from "./ModelSetupOverlay.tsx";
import { TranscriptViewerOverlay } from "./TranscriptViewerOverlay.tsx";
import { ExecutionSurfaceOverlay } from "./ExecutionSurfaceOverlay.tsx";
import { FooterHint } from "./FooterHint.tsx";
import {
  LocalAgentsBar,
  shouldRenderLocalAgentsBar,
} from "./LocalAgentsBar.tsx";
import {
  getLocalAgentsStatusPanelRowCount,
  LocalAgentsStatusPanel,
} from "./LocalAgentsStatusPanel.tsx";
import {
  ComposerSurface,
  type ComposerSurfaceHandle,
  type ComposerSurfaceUiState,
} from "./ComposerSurface.tsx";
import { TranscriptHistory } from "./TranscriptHistory.tsx";
import { PendingTurnPanel } from "./PendingTurnPanel.tsx";
import { DialogStack } from "./DialogStack.tsx";
import { RenderErrorBoundary } from "./ErrorBoundary.tsx";
import {
  isPickerInteractionRequest,
  parsePlanReviewToolArgs,
} from "./conversation/interaction-dialog-layout.ts";
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
import { type TeamMemberItem, useTeamState } from "../hooks/useTeamState.ts";
import { useModelConfig } from "../hooks/useModelConfig.ts";
import {
  type OverlayPanel,
  useOverlayPanel,
} from "../hooks/useOverlayPanel.ts";
import { useAgentRunner } from "../hooks/useAgentRunner.ts";
import type { EvalResult } from "../types.ts";
import { ReplState } from "../../repl/state.ts";
import { getPersistentAgentExecutionModeLabel } from "../../../agent/execution-mode.ts";
import {
  getRuntimeModeFooterLabel,
  getRuntimeModeStatusLabel,
  normalizeRuntimeMode,
} from "../../../agent/runtime-mode.ts";
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
  resolveConversationEscapeAction,
  shouldAutoCloseConversationSurface,
  shouldRenderMainBanner,
  shouldRenderShellLanes,
} from "../utils/app-surface.ts";
import { getShellContentWidth, SHELL_LAYOUT } from "../utils/layout-tokens.ts";
import {
  buildLocalAgentEntries,
  type LocalAgentEntry,
} from "../utils/local-agents.ts";
import { getActiveTeamStore } from "../../../agent/team-store.ts";
import { sendThreadInput } from "../../../agent/delegate-threads.ts";

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
}

interface TeamDashboardOverlayState {
  initialViewMode: "dashboard" | "details";
  initialDetailItemId?: string;
  sessionOnly: boolean;
}

interface BackgroundTasksOverlayState {
  initialSelectedItemId?: string;
  initialViewMode?: "list" | "result";
}

const GLOBAL_KEYBINDING_CATEGORIES = ["Global"] as const;
const DEFAULT_TEAM_DASHBOARD_OVERLAY_STATE: TeamDashboardOverlayState = {
  initialViewMode: "dashboard",
  sessionOnly: false,
};
const DEFAULT_BACKGROUND_TASKS_OVERLAY_STATE: BackgroundTasksOverlayState = {
  initialViewMode: "list",
};

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
  { showBanner = true, initialConfig }: AppProps,
): React.ReactElement {
  const stateRef = useRef<ReplState>(new ReplState());

  return (
    <ReplProvider replState={stateRef.current}>
      <AppContent
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
  { showBanner = true, initialConfig, replState }: AppContentProps,
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
    hasDraftInput: false,
    hasSubmitText: false,
    queuedDraftCount: 0,
    queuePreviewRows: 0,
    submitAction: "send-agent",
    version: 0,
  });

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

  // Conversation state for agent mode
  const conversation = useConversation();
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const baseTeamState = useTeamState(conversation.items);
  const transcriptItemCount = conversation.historyItems.length +
    conversation.liveItems.length;
  const committedHistoryCount = conversation.historyItems.length;
  const [focusedTeammateIndex, setFocusedTeammateIndex] = useState(-1);
  const [localAgentsFocused, setLocalAgentsFocused] = useState(false);
  const [teamDashboardOverlayState, setTeamDashboardOverlayState] = useState<
    TeamDashboardOverlayState
  >(DEFAULT_TEAM_DASHBOARD_OVERLAY_STATE);
  const [backgroundTasksOverlayState, setBackgroundTasksOverlayState] =
    useState<BackgroundTasksOverlayState>(
      DEFAULT_BACKGROUND_TASKS_OVERLAY_STATE,
    );
  const teamState = useMemo(
    () => ({ ...baseTeamState, focusedWorkerIndex: focusedTeammateIndex }),
    [baseTeamState, focusedTeammateIndex],
  );
  const activeTeammates = useMemo(
    () =>
      teamState.members.filter((member: TeamMemberItem) =>
        member.role === "worker" && member.status !== "terminated"
      ),
    [teamState.members],
  );
  const focusedTeammate = focusedTeammateIndex >= 0
    ? activeTeammates[focusedTeammateIndex]
    : undefined;
  const teamWorkerSummary = useMemo(() => {
    if (!teamState.active) return undefined;
    const workers = teamState.members.filter((m: TeamMemberItem) =>
      m.role === "worker" && m.status !== "terminated"
    );
    if (workers.length === 0) return undefined;
    const activeCount = workers.filter((m: TeamMemberItem) =>
      Boolean(m.currentTaskId)
    ).length;
    const idleCount = workers.length - activeCount;
    if (activeCount > 0 && idleCount > 0) {
      return `${activeCount} working \u00B7 ${idleCount} idle`;
    }
    if (activeCount > 0) {
      return `${activeCount} working`;
    }
    return `${idleCount} idle`;
  }, [teamState.active, teamState.members]);
  const baseLocalAgentEntries = useMemo<LocalAgentEntry[]>(
    () =>
      buildLocalAgentEntries(
        teamState.members,
        teamState.memberActivity,
        tasks,
        {
          taskBoard: teamState.taskBoard,
          pendingApprovals: teamState.pendingApprovals,
        },
      ),
    [
      tasks,
      teamState.memberActivity,
      teamState.members,
      teamState.pendingApprovals,
      teamState.taskBoard,
    ],
  );
  useEffect(() => {
    setFocusedTeammateIndex((prev: number) =>
      prev >= activeTeammates.length ? -1 : prev
    );
  }, [activeTeammates.length]);
  useEffect(() => {
    if (baseLocalAgentEntries.length === 0) {
      setLocalAgentsFocused(false);
    }
  }, [baseLocalAgentEntries.length]);
  useEffect(() => {
    if (activeOverlay !== "none" || composerShellState.hasDraftInput) {
      setLocalAgentsFocused(false);
    }
  }, [activeOverlay, composerShellState.hasDraftInput]);
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
    runtimeMode,
    footerStatusMessage,
    setFooterContextUsageLabel,
    applyRuntimeConfigState,
    refreshRuntimeConfigState,
    setSessionRuntimeMode,
    cycleAgentMode,
    flashFooterStatus,
  } = modelConfig;

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
      setComposerShellState((prev: ComposerShellState) =>
        advanceComposerShellState(prev, nextState)
      );
    },
    [],
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
  const closeTeamDashboardOverlay = useCallback(() => {
    setActiveOverlay("none");
    setTeamDashboardOverlayState(DEFAULT_TEAM_DASHBOARD_OVERLAY_STATE);
  }, [setActiveOverlay]);
  const closeBackgroundTasksOverlay = useCallback(() => {
    setActiveOverlay("none");
    setBackgroundTasksOverlayState(DEFAULT_BACKGROUND_TASKS_OVERLAY_STATE);
  }, [setActiveOverlay]);
  const toggleTeamDashboardOverlay = useCallback(() => {
    setTeamDashboardOverlayState(DEFAULT_TEAM_DASHBOARD_OVERLAY_STATE);
    setActiveOverlay((current: OverlayPanel) =>
      current === "team-dashboard" ? "none" : "team-dashboard"
    );
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
  const openFocusedTeammateSession = useCallback(() => {
    if (!focusedTeammate) return;
    setTeamDashboardOverlayState({
      initialViewMode: "details",
      initialDetailItemId: `member-${focusedTeammate.id}`,
      sessionOnly: true,
    });
    setActiveOverlay("team-dashboard");
  }, [focusedTeammate, setActiveOverlay]);
  const focusLocalAgents = useCallback(() => {
    if (baseLocalAgentEntries.length === 0) return false;
    setLocalAgentsFocused(true);
    return true;
  }, [baseLocalAgentEntries.length]);
  const foregroundLocalAgent = useCallback((agent: LocalAgentEntry) => {
    if (
      agent.kind !== "teammate" ||
      !agent.memberId ||
      agent.foregroundable !== true
    ) {
      return false;
    }
    const teammateIndex = activeTeammates.findIndex((member: TeamMemberItem) =>
      member.id === agent.memberId
    );
    if (teammateIndex < 0) return false;
    setFocusedTeammateIndex(teammateIndex);
    setLocalAgentsFocused(false);
    setTeamDashboardOverlayState({
      initialViewMode: "details",
      initialDetailItemId: `member-${agent.memberId}`,
      sessionOnly: true,
    });
    setActiveOverlay("team-dashboard");
    return true;
  }, [activeTeammates, setActiveOverlay]);
  const openLocalAgentsSurface = useCallback(() => {
    if (baseLocalAgentEntries.length === 0) return false;
    const singleAgent = baseLocalAgentEntries.length === 1
      ? baseLocalAgentEntries[0]
      : undefined;
    if (!singleAgent) {
      openBackgroundTasksOverlay(undefined, "list");
      return true;
    }
    if (
      singleAgent.kind === "teammate" &&
      singleAgent.foregroundable === true &&
      foregroundLocalAgent(singleAgent)
    ) {
      return true;
    }
    openBackgroundTasksOverlay(singleAgent.id, "result");
    return true;
  }, [
    baseLocalAgentEntries,
    foregroundLocalAgent,
    openBackgroundTasksOverlay,
  ]);
  const handleLocalAgentsInput = useCallback((input: string, key: {
    escape?: boolean;
    return?: boolean;
    space?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
  }) => {
    if (!localAgentsFocused || baseLocalAgentEntries.length === 0) {
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
    baseLocalAgentEntries.length,
    localAgentsFocused,
    openLocalAgentsSurface,
  ]);

  const agentRunner = useAgentRunner({
    conversation,
    agentExecutionMode,
    runtimeMode,
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
    agentControllerRef,
    prepareConversationAttachmentPayload,
    runConversation,
    submitConversationDraft,
    handleInteractionResponse,
    interruptConversationRun,
    handleForceInterrupt,
  } = agentRunner;
  const localAgentEntries = useMemo<LocalAgentEntry[]>(
    () =>
      pendingInteraction
        ? buildLocalAgentEntries(
          teamState.members,
          teamState.memberActivity,
          tasks,
          {
            taskBoard: teamState.taskBoard,
            pendingApprovals: teamState.pendingApprovals,
            pendingInteraction: {
              sourceMemberId: pendingInteraction.sourceMemberId,
              mode: pendingInteraction.mode,
            },
          },
        )
        : baseLocalAgentEntries,
    [
      baseLocalAgentEntries,
      pendingInteraction?.mode,
      pendingInteraction?.sourceMemberId,
      tasks,
      teamState.memberActivity,
      teamState.members,
      teamState.pendingApprovals,
      teamState.taskBoard,
    ],
  );
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

  const handleAppExit = useCallback(() => {
    replState.flushHistorySync();
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
    handleAppExit();
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
      HandlerIds.APP_TEAM_DASHBOARD,
      toggleTeamDashboardOverlay,
      "App",
    );
    registerHandler(
      HandlerIds.APP_CYCLE_TEAMMATE,
      () => {
        const teammateCount = activeTeammatesRef.current.length;
        if (teammateCount === 0) {
          setFocusedTeammateIndex(-1);
          return;
        }
        setFocusedTeammateIndex((prev: number) =>
          prev + 1 >= teammateCount ? -1 : prev + 1
        );
      },
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
    return () => {
      unregisterHandler(HandlerIds.APP_EXIT);
      unregisterHandler(HandlerIds.APP_SHORTCUTS);
      unregisterHandler(HandlerIds.APP_CLEAR);
      unregisterHandler(HandlerIds.APP_PALETTE);
      unregisterHandler(HandlerIds.APP_BACKGROUND);
      unregisterHandler(HandlerIds.CONVERSATION_OPEN_HISTORY);
      unregisterHandler(HandlerIds.APP_TEAM_DASHBOARD);
      unregisterHandler(HandlerIds.APP_CYCLE_TEAMMATE);
      unregisterHandler(HandlerIds.APP_KILL_ALL);
      unregisterHandler(HandlerIds.APP_TASK_OVERLAY);
    };
  }, [
    flushReplOutput,
    handleCtrlC,
    toggleShortcutsOverlay,
    handleBackground,
    handleKillAll,
    togglePalette,
    toggleTranscriptHistory,
    toggleTeamDashboardOverlay,
    toggleBackgroundTasksOverlay,
  ]);

  // Refs for values only read inside handlers — avoids re-creating callbacks
  // every time streaming tokens cause conversation/interaction/queue state to change.
  const teamStateRef = useRef(teamState);
  teamStateRef.current = teamState;
  const activeTeammatesRef = useRef(activeTeammates);
  activeTeammatesRef.current = activeTeammates;
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
      const opensExecutionSurface = commandName === "/surface";
      const handlesRuntimeMode = commandName === "/runtime";
      const isPanelCommand = commandName === "/help" ||
        commandName === "/config" || commandName === "/flush" ||
        opensModelPicker || opensExecutionSurface || handlesRuntimeMode;
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

        if (opensExecutionSurface) {
          recordPromptHistory(replState, code, "command");
          if (commandArgs) {
            conversationRef.current.addError("Usage: /surface");
            return;
          }
          setActiveOverlay("execution-surface");
          return;
        }

        if (commandName === "/flush") {
          flushReplOutput();
          return;
        }

        if (handlesRuntimeMode) {
          recordPromptHistory(replState, code, "command");
          const requestedMode = normalizeRuntimeMode(commandArgs.toLowerCase());
          if (!requestedMode) {
            if (!commandArgs) {
              flashFooterStatus(
                `${
                  getRuntimeModeStatusLabel(runtimeMode)
                } · /runtime manual|auto`,
              );
              return;
            }
            conversationRef.current.addError("Usage: /runtime manual|auto");
            return;
          }

          try {
            const nextRuntimeMode = await setSessionRuntimeMode(requestedMode);
            flashFooterStatus(getRuntimeModeStatusLabel(nextRuntimeMode));
          } catch (error) {
            conversationRef.current.addError(ensureError(error).message);
          }
          return;
        }

        recordPromptHistory(replState, code, "command");
        const output = await handleCommand(code, exit, replState);
        if (output !== null) {
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

        const targetTeammate = focusedTeammateIndex >= 0
          ? activeTeammatesRef.current[focusedTeammateIndex]
          : undefined;
        if (hasConversationContext && targetTeammate) {
          const preview = truncate(trimmedInput.replace(/\s+/g, " "), 120);
          let delivered = false;

          if (targetTeammate.threadId) {
            delivered = sendThreadInput(targetTeammate.threadId, trimmedInput);
          }

          if (!delivered) {
            const store = getActiveTeamStore();
            if (store) {
              await store.sendMessage({
                id: crypto.randomUUID(),
                type: "message",
                from: "lead",
                content: trimmedInput,
                summary: truncate(trimmedInput.replace(/\s+/g, " "), 80),
                timestamp: Date.now(),
                recipient: targetTeammate.id,
              });
              delivered = true;
            }
          }

          if (!delivered) {
            conversationRef.current.addError(
              `Could not send message to teammate '${targetTeammate.id}'.`,
            );
            return;
          }

          recordPromptHistory(replState, code, "conversation");
          conversationRef.current.addEvent({
            type: "team_message",
            kind: "message",
            fromMemberId: "lead",
            toMemberId: targetTeammate.id,
            contentPreview: preview,
          });
          clearComposerDraft();
          return;
        }

        if (currentEvalRef.current && !currentEvalRef.current.backgrounded) {
          recordPromptHistory(replState, code, "conversation");
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
          recordPromptHistory(replState, code, "conversation");
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

        recordPromptHistory(replState, code, "conversation");
        const { attachments: conversationAttachments, unsupportedMimeType } =
          prepareConversationAttachmentPayload(attachments);
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
          trimmedInput,
          conversationAttachments,
          {},
        );
        return;
      }

      if (currentEvalRef.current && !currentEvalRef.current.backgrounded) {
        recordPromptHistory(replState, code, "evaluate");
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
        recordPromptHistory(replState, code, "evaluate");
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

      recordPromptHistory(replState, code, "evaluate");
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
      setSessionRuntimeMode,
      setSurfacePanel,
      replState,
      runtimeMode,
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
    if (
      globalBinding.kind === "handler" &&
      globalBinding.id === HandlerIds.APP_CYCLE_TEAMMATE
    ) {
      if (activeOverlay !== "none") return;
      void executeHandler(globalBinding.id);
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

    if (isEscKey) {
      const conversationEscapeAction = resolveConversationEscapeAction({
        surfacePanel,
        isConversationTaskRunning,
      });
      if (conversationEscapeAction === "interrupt") {
        interruptConversationRun({
          clearPlanning: hasActivePlanningState,
        });
        return;
      }
    }

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
  const isConversationInputVisible = hasConversationContext && !isOverlayOpen;
  const isInputVisible = !isOverlayOpen &&
    (surfacePanel === "none" || isConversationInputVisible);
  const isInputDisabled = hasConversationContext &&
    (pendingInteraction?.mode === "permission" || pickerInteractionActive);
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
  const localAgentsPanelRows = getLocalAgentsStatusPanelRowCount(
    localAgentEntries.length,
  );
  const transcriptReservedRows = 10 +
    SHELL_LAYOUT.transcriptToComposerGap +
    composerShellState.queuePreviewRows +
    (hasConversationContext && pendingInteraction ? 8 : 0) +
    (hasConversationContext &&
        (conversation.liveItems.length > 0 || liveTodoCount > 0)
      ? Math.min(conversation.liveItems.length + liveTodoCount + 2, 12)
      : 0) +
    localAgentsPanelRows;
  return (
    <Box
      flexDirection="column"
      paddingX={SHELL_LAYOUT.gutterX}
    >
      {shouldRenderMainBanner({
        showBanner,
        hasBeenCleared,
        isOverlayOpen,
        hasStandaloneSurface,
        hasActivePlanningState,
        hasShellHistory: committedHistoryCount > 0,
      }) && (
        <>
          <Banner errors={init.errors} />
          {!init.ready && <LoadingScreen progress={init.progress} />}
        </>
      )}

      {/* Overlays rendered as siblings (not ternary) to preserve Ink's live area tracking */}
      {activeOverlay === "palette" && (
        <CommandPaletteOverlay
          onClose={() => setActiveOverlay("none")}
          onExecute={handlePaletteAction}
          onRebind={handleRebind}
          initialState={paletteState}
          onStateChange={setPaletteState}
        />
      )}
      {activeOverlay === "models" && (
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
      )}
      {activeOverlay === "model-setup" && init.modelToSetup && (
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
      )}
      {activeOverlay === "config-overlay" && (
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
      )}
      {activeOverlay === "team-dashboard" && (
        <TeamDashboardOverlay
          onClose={closeTeamDashboardOverlay}
          teamState={teamState}
          interactionMode={pendingInteraction?.mode}
          interactionSourceMemberId={pendingInteraction?.sourceMemberId}
          interactionSourceLabel={pendingInteraction?.sourceLabel}
          initialViewMode={teamDashboardOverlayState.initialViewMode}
          initialDetailItemId={teamDashboardOverlayState.initialDetailItemId}
          sessionOnly={teamDashboardOverlayState.sessionOnly}
        />
      )}
      {activeOverlay === "shortcuts-overlay" && (
        <ShortcutsOverlay onClose={() => setActiveOverlay("none")} />
      )}
      {activeOverlay === "transcript-history" && (
        <TranscriptViewerOverlay
          historyItems={conversation.historyItems}
          liveItems={conversation.liveItems}
          width={shellContentWidth}
          onClose={() => setActiveOverlay("none")}
        />
      )}
      {activeOverlay === "execution-surface" && (
        <ExecutionSurfaceOverlay onClose={() => setActiveOverlay("none")} />
      )}
      {activeOverlay === "background-tasks" && (
        <BackgroundTasksOverlay
          onClose={closeBackgroundTasksOverlay}
          localAgents={localAgentEntries}
          teamTasks={teamState.taskBoard}
          teamState={teamState}
          interactionMode={pendingInteraction?.mode}
          interactionSourceMemberId={pendingInteraction?.sourceMemberId}
          initialSelectedItemId={backgroundTasksOverlayState
            .initialSelectedItemId}
          initialViewMode={backgroundTasksOverlayState.initialViewMode}
          onForegroundLocalAgent={foregroundLocalAgent}
        />
      )}

      {/* Shell lanes: committed history, live turn, dialogs */}
      {!hasStandaloneSurface && renderShellLanes && (
        <Box
          flexDirection="column"
          marginBottom={SHELL_LAYOUT.transcriptToComposerGap}
        >
          <RenderErrorBoundary>
            <TranscriptHistory
              historyItems={conversation.historyItems}
              width={shellContentWidth}
              reservedRows={transcriptReservedRows}
              compactPlanTranscript={Boolean(
                conversation.planningPhase &&
                  conversation.planningPhase !== "done",
              )}
              interactive={!isOverlayOpen}
              allowToggleHotkeys={surfacePanel === "conversation" &&
                allowConversationToggleHotkeys &&
                conversation.liveItems.length === 0}
            />
          </RenderErrorBoundary>
          {hasConversationContext && (
            <>
              <RenderErrorBoundary>
                <PendingTurnPanel
                  items={conversation.liveItems}
                  width={shellContentWidth}
                  streamingState={conversation.streamingState}
                  planningPhase={conversation.planningPhase}
                  todoState={conversation.planTodoState ??
                    conversation.todoState}
                  compactSpacing
                  showLeadingDivider={committedHistoryCount > 0 ||
                    composerShellState.queuedDraftCount > 0}
                  allowToggleHotkeys={surfacePanel === "conversation" &&
                    allowConversationToggleHotkeys &&
                    conversation.liveItems.length > 0}
                />
              </RenderErrorBoundary>
              <RenderErrorBoundary>
                {!isOverlayOpen && (
                  <DialogStack
                    interactionRequest={pendingInteraction}
                    interactionQueueLength={interactionQueue.length}
                    onInteractionResponse={handleConversationInteractionResponse}
                    onQuestionInterrupt={pendingInteraction?.mode === "question"
                      ? handleQuestionInterrupt
                      : undefined}
                  />
                )}
              </RenderErrorBoundary>
            </>
          )}
          {localAgentEntries.length > 0 && (
            <LocalAgentsStatusPanel
              entries={localAgentEntries}
              memberActivity={teamState.memberActivity}
              width={shellContentWidth}
            />
          )}
        </Box>
      )}

      {/* Input line */}
      {!isOverlayOpen && isInputVisible &&
        (
          <ComposerSurface
            ref={composerRef}
            replState={replState}
            onUiStateChange={handleComposerUiStateChange}
            onSubmit={handleSubmit}
            onEmptySubmit={hasConversationContext && focusedTeammate &&
                !localAgentsFocused
              ? openFocusedTeammateSession
              : undefined}
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
            promptLabel={focusedTeammate ? `${focusedTeammate.id}>` : ">"}
            interactionMode={pickerInteractionActive
              ? pendingInteraction?.mode
              : undefined}
          />
        )}

      {shouldRenderLocalAgentsBar(
        localAgentEntries,
        localAgentsFocused,
        teamWorkerSummary,
      ) && (
        <LocalAgentsBar
          entries={localAgentEntries}
          focused={localAgentsFocused}
          teamWorkerSummary={teamWorkerSummary}
          width={shellContentWidth}
        />
      )}

      {/* Footer hint (directly under input, no gap) */}
      {(isInputVisible || hasConversationContext) &&
        (
          <FooterHint
            modelName={modelSelection.displayLabel}
            runtimeModeLabel={getRuntimeModeFooterLabel(runtimeMode)}
            statusMessage={footerStatusMessage}
            modeLabel={getPersistentAgentExecutionModeLabel(agentExecutionMode)}
            planningPhase={hasConversationContext
              ? conversation.planningPhase
              : undefined}
            streamingState={hasConversationContext
              ? conversation.streamingState
              : undefined}
            activeTool={hasConversationContext
              ? conversation.activeTool
              : undefined}
            contextUsageLabel={modelConfig.footerContextUsageLabel}
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
            teamActive={teamState.active}
            teamAttentionCount={teamState.attentionItems.length}
            teamFocusLabel={focusedTeammate?.id}
            teamWorkerSummary={teamWorkerSummary}
            localAgentCount={localAgentEntries.length}
            pendingInteractionLabel={pendingInteraction?.sourceLabel}
            activeTaskCount={activeCount}
            recentActiveTaskLabel={recentActiveTaskLabel}
            aiAvailable={init.aiAvailable}
            conversationQueueCount={composerShellState.queuedDraftCount}
            submitAction={composerShellState.hasSubmitText
              ? composerShellState.submitAction
              : undefined}
          />
        )}
    </Box>
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
