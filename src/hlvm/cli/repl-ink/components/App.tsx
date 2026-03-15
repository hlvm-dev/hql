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
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { Input } from "./Input.tsx";
import { Output } from "./Output.tsx";
import { Banner } from "./Banner.tsx";
import { SessionPicker } from "./SessionPicker.tsx";
import { ConfigOverlay, type ConfigOverlayState } from "./ConfigOverlay.tsx";
import {
  CommandPaletteOverlay,
  type KeyCombo,
  type PaletteState,
} from "./CommandPaletteOverlay.tsx";
import { BackgroundTasksOverlay } from "./BackgroundTasksOverlay.tsx";
import { TeamDashboardOverlay } from "./TeamDashboardOverlay.tsx";
import { ShortcutsOverlay } from "./ShortcutsOverlay.tsx";
import { ModelBrowser } from "./ModelBrowser.tsx";
import { ModelSetupOverlay } from "./ModelSetupOverlay.tsx";
import { FooterHint } from "./FooterHint.tsx";
import { QueuePreview } from "./QueuePreview.tsx";
import { ConversationPanel } from "./ConversationPanel.tsx";
import { RenderErrorBoundary } from "./ErrorBoundary.tsx";
import { isPickerInteractionRequest } from "./conversation/interaction-dialog-layout.ts";
import {
  executeHandler,
  inspectHandlerKeybinding,
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
import { useTeamState } from "../hooks/useTeamState.ts";
import { useModelConfig } from "../hooks/useModelConfig.ts";
import { useOverlayPanel } from "../hooks/useOverlayPanel.ts";
import { useSessionPicker } from "../hooks/useSessionPicker.ts";
import { useConversationComposer } from "../hooks/useConversationComposer.ts";
import { useAgentRunner } from "../hooks/useAgentRunner.ts";
import type { EvalResult } from "../types.ts";
import { ReplState } from "../../repl/state.ts";
import { clearTerminal } from "../../ansi.ts";
import {
  getUnclosedDepth,
  tokenize,
  type TokenType,
} from "../../repl/syntax.ts";
import { useTheme } from "../../theme/index.ts";
import type { AnyAttachment } from "../hooks/useAttachments.ts";
import { resetContext } from "../../repl/context.ts";
import { DEFAULT_TERMINAL_WIDTH } from "../ui-constants.ts";
import { isCommand, runCommand } from "../../repl/commands.ts";
import type { SessionInitOptions } from "../../repl/session/types.ts";
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
import { log } from "../../../api/log.ts";
import { looksLikeNaturalLanguage } from "../../repl/input-routing.ts";
import {
  getRuntimeConfigApi,
  patchRuntimeConfig,
} from "../../../runtime/host-client.ts";
import {
  getCustomKeybindingsSnapshot,
  setCustomKeybindingsSnapshot,
} from "../keybindings/custom-bindings.ts";
import {
  clearCurrentSession,
  session as sessionApi,
  syncCurrentSession,
} from "../../../api/session.ts";
import { recordPromptHistory } from "../../repl/prompt-history.ts";
import {
  type ConversationComposerDraft,
  createConversationComposerDraft,
  enqueueConversationDraft,
  mergeConversationDraftsForInterrupt,
} from "../utils/conversation-queue.ts";
import { resolveCtrlCAction } from "../ctrl-c-behavior.ts";

interface HistoryEntry {
  id: number;
  input: string;
  result: EvalResult;
}

interface CurrentEval {
  code: string;
  controller: AbortController;
  backgrounded: boolean;
  cancelled?: boolean;
  taskId?: string;
  historyId?: number;
}

interface AppProps {
  showBanner?: boolean;
  sessionOptions?: SessionInitOptions;
  initialConfig?: HlvmConfig;
}

const GLOBAL_KEYBINDING_CATEGORIES = ["Global"] as const;

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
 * Keep history input rendering stable by stripping terminal control bytes that
 * can leak from key sequences while preserving tabs/newlines.
 */
function sanitizeHistoryInput(input: string): string {
  // deno-lint-ignore no-control-regex -- intentional ANSI escape stripping
  const withoutAnsi = input.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "");
  // deno-lint-ignore no-control-regex -- intentional control-byte stripping except tab/newline
  return withoutAnsi.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
}

/**
 * App wrapper - provides ReplContext for FRP state management
 */
export function App(
  { showBanner = true, sessionOptions, initialConfig }: AppProps,
): React.ReactElement {
  const stateRef = useRef<ReplState>(new ReplState());

  return (
    <ReplProvider replState={stateRef.current}>
      <AppContent
        showBanner={showBanner}
        sessionOptions={sessionOptions}
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
  { showBanner = true, sessionOptions, initialConfig, replState }:
    AppContentProps,
): React.ReactElement {
  const { exit } = useApp();

  const repl = useRepl({ state: replState });

  // Initialize: runtime, memory, AI
  const init = useInitialization(replState);
  const { refreshAiReadiness } = init;

  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  // Ref to avoid stale closure in useInput callback
  const isEvaluatingRef = useRef(false);
  useEffect(() => {
    isEvaluatingRef.current = isEvaluating;
  }, [isEvaluating]);
  const [nextId, setNextId] = useState(1);
  const [clearKey, setClearKey] = useState(0); // Force re-render on clear
  const [hasBeenCleared, setHasBeenCleared] = useState(false); // Hide banner after Ctrl+L

  // Task manager for background evaluation
  const {
    createEvalTask,
    completeEvalTask,
    failEvalTask,
    updateEvalOutput,
    cancel,
  } = useTaskManager();

  // Track current evaluation for Ctrl+B to push to background
  // AbortController enables true cancellation of async operations (AI calls, fetch, etc.)
  const currentEvalRef = useRef<CurrentEval | null>(null);

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
    modelSetupHandled,
    setModelSetupHandled,
    paletteState,
    setPaletteState,
    configOverlayState,
    setConfigOverlayState,
    togglePalette,
    toggleTasksOverlay,
    toggleTeamDashboard,
    toggleShortcutsOverlay,
  } = overlay;
  // Theme from context (auto-updates when theme changes)
  const { color } = useTheme();

  // Terminal width for responsive layout
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;

  // Conversation state for agent mode
  const conversation = useConversation();
  const teamState = useTeamState(conversation.items);
  const hasConversationContext = usesConversationContext(surfacePanel);
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
    footerContextUsageLabel,
    setFooterContextUsageLabel,
    applyRuntimeConfigState,
    refreshRuntimeConfigState,
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

  // Conversation composer: attachments, queue, drafts
  const composer = useConversationComposer({ input, setInput, replState });
  const {
    composerAttachments,
    setComposerAttachments,
    restoredComposerDraftRevision,
    restoredComposerCursorOffset,
    pendingConversationQueue,
    setPendingConversationQueue,
    currentComposerDraft,
    queueEditBinding,
    queueEditBindingLabel,
    queuePreviewRows,
    restoreComposerDraft,
    handleQueueDraft,
    handleEditLastQueuedDraft,
  } = composer;
  // Helper to add history entry and increment ID (DRY pattern used 8+ times)
  // Uses ref to avoid stale closure — no dependency on nextId state
  const nextIdRef = useRef(nextId);
  useEffect(() => {
    nextIdRef.current = nextId;
  }, [nextId]);
  const addHistoryEntry = useCallback((input: string, result: EvalResult) => {
    const id = nextIdRef.current;
    setHistory((prev: HistoryEntry[]) => [
      ...prev,
      { id, input: sanitizeHistoryInput(input), result },
    ]);
    setNextId((n: number) => n + 1);
  }, []);

  // Session picker management
  const sessionPicker = useSessionPicker({
    sessionOptions,
    conversation,
    addHistoryEntry,
    setSurfacePanel,
    setFooterContextUsageLabel,
  });
  const {
    currentSession,
    setCurrentSession,
    pickerSessions,
    setPickerSessions,
    setPendingResumeInput,
    resumeConversationSession,
    handlePickerSelect,
    handlePickerCancel,
  } = sessionPicker;

  // Agent runner: conversation execution, interaction queue, force-interrupt
  const agentRunner = useAgentRunner({
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
  });
  const {
    interactionQueue,
    setInteractionQueue,
    pendingInteraction,
    agentControllerRef,
    interactionResolversRef,
    prepareConversationMediaPayload,
    getConversationAttachmentLabels,
    runConversation,
    submitConversationDraft,
    handleInteractionResponse,
    closeConversationMode,
    handleForceInterrupt,
  } = agentRunner;

  useEffect(() => {
    if (activeOverlay !== "none") return;
    if (
      surfacePanel === "conversation" &&
      conversation.items.length === 0 &&
      !agentControllerRef.current &&
      pendingConversationQueue.length === 0 &&
      !pendingInteraction
    ) {
      setSurfacePanel("none");
    }
  }, [
    activeOverlay,
    agentExecutionMode,
    surfacePanel,
    conversation.items.length,
    agentControllerRef,
    pendingConversationQueue.length,
    pendingInteraction,
    setSurfacePanel,
  ]);

  const suppressHistoryOutput = useCallback((historyId: number) => {
    setHistory((prev: HistoryEntry[]) =>
      prev.map((entry: HistoryEntry) => {
        if (entry.id !== historyId) return entry;
        return {
          ...entry,
          result: { ...entry.result, suppressOutput: true },
        };
      })
    );
  }, []);

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

  /** Detect if input looks like natural language rather than code */
  const isNaturalLanguage = useCallback((input: string): boolean => {
    return looksLikeNaturalLanguage(input, {
      hasBinding: (name: string) => replState.hasBinding(name),
    });
  }, [replState]);

  // (runConversation, submitConversationDraft, handleInteractionResponse,
  //  closeConversationMode, handleForceInterrupt, queue drain effect
  //  all moved to useAgentRunner)
  const clearReplSurface = useCallback(() => {
    clearTerminal();
    setHistory([]);
    setNextId(1);
    setHasBeenCleared(true);
    setClearKey((k: number) => k + 1);
    restoreComposerDraft(null);
    clearCurrentSession();
    setCurrentSession(null);
    interactionResolversRef.current.clear();
    setInteractionQueue([]);
    conversation.clear();
    setFooterContextUsageLabel("");
    setActiveOverlay("none");
    setSurfacePanel("none");
    if (hasConversationContext) {
      closeConversationMode({ clearConversation: true });
    }
  }, [
    restoreComposerDraft,
    closeConversationMode,
    conversation,
    hasConversationContext,
  ]);

  const handleAppExit = useCallback(() => {
    replState.flushHistorySync();
    exit();
  }, [exit, replState]);

  const handleCtrlC = useCallback(async () => {
    const action = resolveCtrlCAction({
      draftText: input,
      attachmentCount: composerAttachments.length,
    });
    if (action === "clear-draft") {
      const handled = await executeHandler(HandlerIds.COMPOSER_CLEAR);
      if (!handled) {
        restoreComposerDraft(null);
      }
      return;
    }
    handleAppExit();
  }, [
    composerAttachments.length,
    handleAppExit,
    input,
    restoreComposerDraft,
  ]);

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
      clearReplSurface,
      "App",
    );
    registerHandler(
      HandlerIds.APP_PALETTE,
      togglePalette,
      "App",
    );
    registerHandler(
      HandlerIds.APP_TASKS,
      toggleTasksOverlay,
      "App",
    );
    registerHandler(
      HandlerIds.APP_TEAM_DASHBOARD,
      toggleTeamDashboard,
      "App",
    );
    return () => {
      unregisterHandler(HandlerIds.APP_EXIT);
      unregisterHandler(HandlerIds.APP_SHORTCUTS);
      unregisterHandler(HandlerIds.APP_CLEAR);
      unregisterHandler(HandlerIds.APP_PALETTE);
      unregisterHandler(HandlerIds.APP_TASKS);
      unregisterHandler(HandlerIds.APP_TEAM_DASHBOARD);
    };
  }, [
    clearReplSurface,
    handleCtrlC,
    toggleShortcutsOverlay,
    togglePalette,
    toggleTasksOverlay,
    toggleTeamDashboard,
  ]);

  // Refs for values only read inside handleSubmit — avoids re-creating the callback
  // every time streaming tokens cause conversation/interaction/queue state to change.
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const pendingInteractionRef = useRef(pendingInteraction);
  pendingInteractionRef.current = pendingInteraction;
  const pendingConversationQueueRef = useRef(pendingConversationQueue);
  pendingConversationQueueRef.current = pendingConversationQueue;
  const closeConversationModeRef = useRef(closeConversationMode);
  closeConversationModeRef.current = closeConversationMode;
  const handleInteractionResponseRef = useRef(handleInteractionResponse);
  handleInteractionResponseRef.current = handleInteractionResponse;
  const restoreComposerDraftRef = useRef(restoreComposerDraft);
  restoreComposerDraftRef.current = restoreComposerDraft;

  const handleSubmit = useCallback(
    async (code: string, attachments?: AnyAttachment[]) => {
      if (!code.trim()) return;
      setInput("");

      // Expand text attachments: replace [Pasted text #N ...] with actual content
      // This allows pasted HQL code to be executed even when collapsed
      let expandedCode = code;
      if (attachments) {
        for (const att of attachments) {
          // TextAttachment has 'content', regular Attachment has 'base64Data'
          if ("content" in att) {
            expandedCode = expandedCode.replace(att.displayName, att.content);
          }
        }
      }

      // Handle commands that need React state (pickers/panels)
      const trimmedInput = code.trim();
      const forceConversationPrompt = (() => {
        const match = trimmedInput.match(/^>\s+([\s\S]+)$/);
        return match ? match[1].trim() : undefined;
      })();
      const normalizedInput = trimmedInput.startsWith(".")
        ? "/" + trimmedInput.slice(1)
        : trimmedInput;
      const [rawCommand = "", ...argTokens] = normalizedInput.split(/\s+/);
      const commandName = rawCommand.toLowerCase();
      const commandArgs = argTokens.join(" ").trim();
      const opensModelPicker = commandName === "/models" ||
        (commandName === "/model" && commandArgs.length === 0);
      const isPanelCommand = commandName === "/help" ||
        commandName === "/config" || commandName === "/tasks" ||
        commandName === "/bg" || commandName === "/resume" ||
        commandName === "/clear" || opensModelPicker;
      const isAnyCommand = isPanelCommand || isCommand(code);

      // If there's a pending question interaction, route non-command input as the answer.
      // Commands must still work while a question prompt is active.
      const currentPendingInteraction = pendingInteractionRef.current;
      if (currentPendingInteraction?.mode === "question" && !isAnyCommand) {
        recordPromptHistory(replState, code, "interaction");
        conversationRef.current.addUserMessage(
          forceConversationPrompt ?? code.trim(),
          {
            startTurn: false,
          },
        );
        handleInteractionResponseRef.current(
          currentPendingInteraction.requestId,
          {
            approved: true,
            userInput: forceConversationPrompt ?? code.trim(),
          },
        );
        return;
      }

      if (commandName === "/help") {
        setActiveOverlay("shortcuts-overlay");
        return;
      }

      // Handle /config command - show floating overlay
      if (commandName === "/config") {
        setActiveOverlay("config-overlay");
        return;
      }

      // Handle /tasks command - show background tasks overlay
      if (commandName === "/tasks") {
        setActiveOverlay("tasks-overlay");
        return;
      }

      // Handle /bg command - push current evaluation to background
      if (commandName === "/bg") {
        const activeEval = currentEvalRef.current;
        if (activeEval && !activeEval.backgrounded) {
          activeEval.backgrounded = true;
          const taskId = activeEval.taskId ??
            createEvalTask(activeEval.code, activeEval.controller);
          activeEval.taskId = taskId;

          if (activeEval.historyId != null) {
            suppressHistoryOutput(activeEval.historyId);
          }

          currentEvalRef.current = null;
          setIsEvaluating(false);

          const preview = truncate(activeEval.code, 40);
          addHistoryEntry("/bg", {
            success: true,
            value: `⏳ Pushed to background (Task ${
              taskId.slice(0, 8)
            })\n   ${preview}\n   Use /tasks to view`,
          });
        } else {
          addHistoryEntry("/bg", {
            success: false,
            error: new Error("No running evaluation to background"),
          });
        }
        return;
      }

      // Handle /resume command
      if (commandName === "/resume") {
        if (commandArgs.length > 0) {
          await resumeConversationSession(commandArgs, code, commandArgs);
          return;
        }
        const sessions = await sessionApi.list({ limit: 20 });

        if (sessions.length === 0) {
          addHistoryEntry(code, { success: true, value: "No sessions found" });
        } else {
          setPendingResumeInput(code); // Store command for history
          setPickerSessions(sessions);
          setSurfacePanel("picker");
        }
        return;
      }

      // Handle /undo command
      if (commandName === "/undo") {
        const sessionId = sessionApi.current()?.id ?? currentSession?.id;
        if (!sessionId) {
          addHistoryEntry(code, {
            success: false,
            error: new Error("No current session to undo."),
          });
          return;
        }

        const restored = await sessionApi.restoreCheckpoint(sessionId);
        if (!restored.restored || !restored.checkpoint) {
          addHistoryEntry(code, {
            success: false,
            error: new Error("No checkpoint available to restore."),
          });
          return;
        }

        if (hasConversationContext) {
          conversationRef.current.addEvent({
            type: "checkpoint_restored",
            checkpoint: restored.checkpoint,
            restoredFileCount: restored.restoredFileCount,
          });
          conversationRef.current.addInfo(
            `Restored checkpoint (${restored.restoredFileCount} file${
              restored.restoredFileCount === 1 ? "" : "s"
            }).`,
          );
        } else {
          addHistoryEntry(code, {
            success: true,
            value: `Restored checkpoint (${restored.restoredFileCount} file${
              restored.restoredFileCount === 1 ? "" : "s"
            }).`,
            isCommandOutput: true,
          });
        }

        const refreshed = await syncCurrentSession(sessionId);
        if (refreshed) {
          setCurrentSession(refreshed);
        }
        return;
      }

      // Handle /model and /models commands - open model picker
      if (opensModelPicker) {
        setModelBrowserParentSurface(surfacePanel);
        setModelBrowserParentOverlay("none");
        setSurfacePanel("models");
        return;
      }

      // Handle /clear command - clear screen and history (fallback for Cmd+K)
      if (commandName === "/clear") {
        clearReplSurface();
        return;
      }

      // Commands (supports both /command and .command)
      if (isAnyCommand) {
        recordPromptHistory(replState, code, "command");
        const output = await handleCommand(code, repl, exit, replState);
        if (output !== null) {
          addHistoryEntry(code, {
            success: true,
            value: output,
            isCommandOutput: true,
          });
        }
        // FRP: bindingNames auto-update via ReplContext when bindings change
        return;
      }

      if (currentEvalRef.current && !currentEvalRef.current.backgrounded) {
        addHistoryEntry(code, {
          success: false,
          error: new Error("Evaluation already running. Use /bg or Esc."),
        });
        return;
      }

      // Conversation mode: keep input active and queue turns while the agent is running.
      if (hasConversationContext) {
        recordPromptHistory(replState, code, "conversation");
        const conversationDraft = createConversationComposerDraft(
          forceConversationPrompt ?? code.trim(),
          attachments,
        );
        if (agentControllerRef.current) {
          setPendingConversationQueue((prev: ConversationComposerDraft[]) =>
            enqueueConversationDraft(prev, conversationDraft)
          );
          setComposerAttachments([]);
          return;
        }
        const result = submitConversationDraft(conversationDraft);
        if (!result.started) {
          restoreComposerDraftRef.current(conversationDraft);
          if (result.unsupportedMimeType) {
            conversationRef.current.addError(
              `Attachment unsupported: ${result.unsupportedMimeType}`,
            );
          }
        }
        return;
      }

      if (agentControllerRef.current) {
        addHistoryEntry(code, {
          success: false,
          error: new Error("Agent is already running. Press Esc to cancel."),
        });
        return;
      }

      // Natural language → agent conversation mode
      const candidateConversationQuery = forceConversationPrompt ??
        expandedCode.trim();
      if (
        forceConversationPrompt ||
        agentExecutionMode === "plan" ||
        isNaturalLanguage(candidateConversationQuery)
      ) {
        recordPromptHistory(replState, code, "conversation");
        const { images, unsupportedMimeType } = prepareConversationMediaPayload(
          attachments,
        );
        if (unsupportedMimeType) {
          addHistoryEntry(code, {
            success: false,
            error: new Error(
              `Attachment unsupported: ${unsupportedMimeType}. Supported inputs are images, audio, video, and PDF files.`,
            ),
          });
          return;
        }
        const imagePaths = images && images.length > 0 ? images : undefined;
        const attachmentLabels = getConversationAttachmentLabels(attachments);
        setSurfacePanel("conversation");
        setIsEvaluating(true);
        void runConversation(
          candidateConversationQuery,
          imagePaths,
          attachmentLabels,
        );
        return;
      }

      setIsEvaluating(true);

      // Evaluate (with optional attachments)
      // Use expandedCode which has text attachment placeholders replaced with actual content
      // Create AbortController for true cancellation support
      const controller = new AbortController();
      const evalPromise = repl.evaluate(expandedCode, {
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
          addHistoryEntry(code, { success: false, error: err });
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
          addHistoryEntry(code, { success: false, error: err });
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
          const historyId = nextId;
          addHistoryEntry(code, { success: true, streamTaskId: taskId });
          evalState.historyId = historyId;
        }

        return;
      }

      if (evalState.backgrounded || evalState.taskId) {
        const taskId = evalState.taskId ?? createEvalTask(code, controller);
        evalState.taskId = taskId;
        completeEvalTask(taskId, result.value);
      } else {
        addHistoryEntry(code, result);
      }

      finalizeForeground();
    },
    [
      repl,
      exit,
      addHistoryEntry,
      createEvalTask,
      completeEvalTask,
      failEvalTask,
      suppressHistoryOutput,
      streamEvalToTask,
      agentExecutionMode,
      prepareConversationMediaPayload,
      getConversationAttachmentLabels,
      runConversation,
      submitConversationDraft,
      isNaturalLanguage,
      hasConversationContext,
      replState,
      conversation,
      setFooterContextUsageLabel,
    ],
  );

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

  // Global shortcuts (handler-backed globals plus ESC cancel-in-place)
  useInput((char, key) => {
    const globalBinding = inspectHandlerKeybinding(char, key, {
      categories: GLOBAL_KEYBINDING_CATEGORIES,
    });
    const canOpenDefaultShortcuts = globalBinding.kind === "handler" &&
      globalBinding.id === HandlerIds.APP_SHORTCUTS &&
      globalBinding.source === "default" &&
      char === "?" &&
      !key.ctrl &&
      !key.meta &&
      !key.escape &&
      activeOverlay === "none" &&
      input.length === 0 &&
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
    const isEnterLikeInput = key.return || char === "\r" || char === "\n";

    // Interaction response keys (y/n/Enter) during conversation permission dialogs
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
        if (char === "n" || key.escape) {
          handleInteractionResponse(pendingInteraction.requestId, {
            approved: false,
          });
          return;
        }
      }
      if (pendingInteraction.mode === "question" && key.escape) {
        interruptConversationRun({
          requestId: pendingInteraction.requestId,
          clearPlanning: agentExecutionMode === "plan",
        });
        return;
      }
    }

    // ESC during conversation:
    // - running: cancel in-place and restore queued drafts into composer
    // - idle: exit conversation mode
    if (key.escape && surfacePanel === "conversation") {
      if (agentControllerRef.current) {
        const restoredDraft = mergeConversationDraftsForInterrupt(
          pendingConversationQueue,
          currentComposerDraft,
        );
        agentControllerRef.current.abort();
        setIsEvaluating(false);
        setPendingConversationQueue([]);
        restoreComposerDraft(restoredDraft);
      } else {
        closeConversationMode();
      }
      return;
    }

    // ESC during evaluation: abort and cancel
    // This actually stops the evaluation (if it supports AbortSignal)
    // Use ref to avoid stale closure issue
    if (key.escape && isEvaluatingRef.current && currentEvalRef.current) {
      const evalState = currentEvalRef.current;
      evalState.cancelled = true;

      if (evalState.taskId) {
        cancel(evalState.taskId);
      } else {
        evalState.controller.abort();
      }

      if (evalState.historyId == null) {
        addHistoryEntry(evalState.code, {
          success: true,
          value: "[Cancelled]",
        });
      }

      currentEvalRef.current = null;
      setIsEvaluating(false);
    }
  });

  const pickerInteractionActive = hasConversationContext &&
    isPickerInteractionRequest(pendingInteraction);
  const isConversationInputVisible = hasConversationContext && !isOverlayOpen &&
    !pickerInteractionActive;
  const isInputVisible = !isOverlayOpen &&
    (surfacePanel === "none" || isConversationInputVisible);
  const isInputDisabled = init.loading ||
    (hasConversationContext && pendingInteraction?.mode === "permission");

  // Keep Ctrl+O section toggles from conflicting with Input paredit Ctrl+O.
  // Safe contexts:
  // - conversation mode without input visible (Input hidden, no conflict)
  // - input disabled (agent actively running / permission mode / overlays)
  // - empty prompt (paredit no-op)
  const allowConversationToggleHotkeys = !isInputVisible || isInputDisabled ||
    input.length === 0;
  const interruptConversationRun = useCallback((
    options?: { requestId?: string; clearPlanning?: boolean },
  ) => {
    if (options?.requestId) {
      handleInteractionResponse(options.requestId, {
        approved: false,
      });
    }
    if (options?.clearPlanning) {
      conversation.cancelPlanning();
    }
    if (agentControllerRef.current && !agentControllerRef.current.signal.aborted) {
      const restoredDraft = mergeConversationDraftsForInterrupt(
        pendingConversationQueue,
        currentComposerDraft,
      );
      agentControllerRef.current.abort();
      setIsEvaluating(false);
      setPendingConversationQueue([]);
      restoreComposerDraft(restoredDraft);
    }
  }, [
    agentControllerRef,
    conversation,
    currentComposerDraft,
    handleInteractionResponse,
    pendingConversationQueue,
    restoreComposerDraft,
    setIsEvaluating,
    setPendingConversationQueue,
  ]);
  // overlayScreen removed — overlays are inlined as flat conditional siblings in JSX
  const standaloneSurfaceScreen = (() => {
    switch (surfacePanel) {
      case "picker":
        return (
          <SessionPicker
            sessions={pickerSessions}
            currentSessionId={sessionApi.current()?.id ?? currentSession?.id}
            onSelect={handlePickerSelect}
            onCancel={handlePickerCancel}
          />
        );
      case "models":
        return (
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
              addHistoryEntry("", {
                success: true,
                value: `✓ Default model: ${normalizedModel}`,
                isCommandOutput: true,
              });
            }}
            onSelectModel={handleModelSelectionChange}
          />
        );
      case "model-setup":
        return init.modelToSetup
          ? (
            <ModelSetupOverlay
              modelName={init.modelToSetup}
              onComplete={() => {
                refreshAiReadiness(modelSelection.activeModelId, {
                  force: true,
                }).catch(() => {});
                setModelSetupHandled(true);
                setSurfacePanel("none");
                addHistoryEntry("", {
                  success: true,
                  value: `✓ AI model installed: ${init.modelToSetup}`,
                  isCommandOutput: true,
                });
              }}
              onCancel={() => {
                setModelSetupHandled(true);
                setSurfacePanel("none");
                addHistoryEntry("", {
                  success: true,
                  value:
                    `AI model setup cancelled. Run "hlvm ai pull ${init.modelToSetup}" to download later.`,
                  isCommandOutput: true,
                });
              }}
            />
          )
          : null;
      default:
        return null;
    }
  })();
  const tokenColor = useMemo(() => {
    const s = color("secondary");
    const a = color("accent");
    const p = color("primary");
    const m = color("muted");
    const w = color("warning");
    const map: Record<string, string | undefined> = {
      string: s,
      number: a,
      keyword: p,
      macro: p,
      comment: m,
      whitespace: m,
      boolean: w,
      operator: a,
    };
    return (type: TokenType): string | undefined => map[type];
  }, [color]);

  return (
    <Box
      key={clearKey}
      flexDirection="column"
      paddingX={1}
    >
      {showBanner && !hasBeenCleared &&
        (
          init.ready
            ? (
              <Banner
                aiExports={init.aiExports}
                aiReadiness={init.aiReadiness}
                errors={init.errors}
                modelName={modelSelection.displayLabel}
              />
            )
            : <Text dimColor>Loading HLVM...</Text>
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
      {activeOverlay === "config-overlay" && (
        <ConfigOverlay
          onClose={() => setActiveOverlay("none")}
          onOpenModelBrowser={() => {
            setModelBrowserParentSurface(surfacePanel);
            setModelBrowserParentOverlay("config-overlay");
            setActiveOverlay("none");
            setSurfacePanel("models");
          }}
          onConfigChange={(cfg) =>
            applyRuntimeConfigState(
              cfg as unknown as Record<string, unknown>,
            )}
          initialState={configOverlayState}
          onStateChange={setConfigOverlayState}
        />
      )}
      {activeOverlay === "tasks-overlay" && (
        <BackgroundTasksOverlay onClose={() => setActiveOverlay("none")} />
      )}
      {activeOverlay === "team-dashboard" && (
        <TeamDashboardOverlay
          onClose={() => setActiveOverlay("none")}
          teamState={teamState}
          interactionMode={pendingInteraction?.mode}
        />
      )}
      {activeOverlay === "shortcuts-overlay" && (
        <ShortcutsOverlay onClose={() => setActiveOverlay("none")} />
      )}

      {/* History of inputs and outputs (hidden during conversation to prevent ghost rendering) */}
      {!isOverlayOpen && !hasConversationContext && !hasStandaloneSurface &&
        history.map((entry: HistoryEntry) => {
          const lines = entry.input.split("\n");
          const unclosedDepth = lines.length > 1
            ? getUnclosedDepth(entry.input)
            : 0;
          return (
            <Box key={entry.id} flexDirection="column" marginBottom={1}>
              {lines.map((line: string, lineIndex: number) => (
                <Box key={`${entry.id}-${lineIndex}`}>
                  <Text color={color("primary")} bold>
                    {lineIndex === 0
                      ? "hlvm>"
                      : (unclosedDepth > 0 ? `..${unclosedDepth}>` : "...>")}
                  </Text>
                  <Box>
                    {tokenize(line).map((token, tokenIdx) => (
                      <React.Fragment
                        key={`${entry.id}-${lineIndex}-${tokenIdx}`}
                      >
                        <Text color={tokenColor(token.type)}>
                          {token.value}
                        </Text>
                      </React.Fragment>
                    ))}
                  </Box>
                </Box>
              ))}
              <Output result={entry.result} />
            </Box>
          );
        })}

      {/* Standalone surfaces (picker, model browser, etc.) */}
      {!isOverlayOpen && hasStandaloneSurface && standaloneSurfaceScreen && (
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          {standaloneSurfaceScreen}
        </Box>
      )}

      {/* Conversation Panel (agent mode) */}
      {!isOverlayOpen && hasConversationContext && (
        <Box flexDirection="column">
          <RenderErrorBoundary>
            <ConversationPanel
              items={conversation.items}
              width={Math.max(20, terminalWidth - 2)}
              streamingState={conversation.streamingState}
              activePlan={conversation.activePlan}
              planningPhase={conversation.planningPhase}
              todoState={conversation.planTodoState ?? conversation.todoState}
              pendingPlanReview={conversation.pendingPlanReview}
              latestCheckpoint={conversation.latestCheckpoint}
              allowToggleHotkeys={surfacePanel === "conversation" &&
                allowConversationToggleHotkeys}
              interactionRequest={pendingInteraction}
              interactionQueueLength={interactionQueue.length}
              onInteractionResponse={handleInteractionResponse}
              onQuestionInterrupt={pendingInteraction?.mode === "question"
                ? () =>
                  interruptConversationRun({
                    requestId: pendingInteraction.requestId,
                    clearPlanning: agentExecutionMode === "plan",
                  })
                : undefined}
              extraReservedRows={queuePreviewRows}
            />
          </RenderErrorBoundary>
        </Box>
      )}

      {/* Queue preview bar (visible above input when queue has items in conversation mode) */}
      {!isOverlayOpen && hasConversationContext &&
        pendingConversationQueue.length > 0 &&
        (
          <QueuePreview
            items={pendingConversationQueue}
            editBindingLabel={queueEditBindingLabel}
          />
        )}

      {/* Input line */}
      {!isOverlayOpen && isInputVisible &&
        (
          <Input
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            onForceSubmit={hasConversationContext
              ? handleForceInterrupt
              : undefined}
            onInterruptRunningTask={hasConversationContext &&
                agentControllerRef.current
              ? () =>
                interruptConversationRun({
                  clearPlanning: agentExecutionMode === "plan",
                })
              : undefined}
            onQueueDraft={hasConversationContext && agentControllerRef.current
              ? handleQueueDraft
              : undefined}
            onEditLastQueuedDraft={hasConversationContext &&
                pendingConversationQueue.length > 0
              ? handleEditLastQueuedDraft
              : undefined}
            queueEditBinding={queueEditBinding}
            canEditQueuedDraft={hasConversationContext &&
              pendingConversationQueue.length > 0}
            isConversationTaskRunning={hasConversationContext &&
              agentControllerRef.current !== null}
            onAttachmentsChange={setComposerAttachments}
            restoredAttachments={composerAttachments}
            restoredCursorOffset={restoredComposerCursorOffset}
            restoredDraftRevision={restoredComposerDraftRevision}
            onCycleMode={cycleAgentMode}
            disabled={isInputDisabled}
            highlightMode={hasConversationContext ? "chat" : "code"}
            promptLabel={hasConversationContext &&
                pendingInteraction?.mode === "question" &&
                !pickerInteractionActive
              ? "answer>"
              : "hlvm>"}
          />
        )}

      {/* Footer hint (directly under input, no gap) */}
      {!isOverlayOpen && (isInputVisible || hasConversationContext) &&
        (
          <FooterHint
            modelName={modelSelection.displayLabel}
            statusMessage={footerStatusMessage}
            streamingState={hasConversationContext
              ? conversation.streamingState
              : undefined}
            activeTool={hasConversationContext
              ? conversation.activeTool
              : undefined}
            contextUsageLabel={hasConversationContext
              ? footerContextUsageLabel
              : ""}
            checkpointLabel={hasConversationContext &&
                conversation.latestCheckpoint &&
                !conversation.latestCheckpoint.restoredAt
              ? "/undo ready"
              : ""}
            interactionQueueLength={hasConversationContext
              ? interactionQueue.length
              : 0}
            hasDraftInput={input.trim().length > 0 ||
              composerAttachments.length > 0}
            inConversation={hasConversationContext}
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
          />
        )}

      {!isOverlayOpen && isEvaluating && !hasConversationContext && (
        <Text dimColor>...</Text>
      )}
    </Box>
  );
}

async function handleCommand(
  cmd: string,
  repl: ReturnType<typeof useRepl>,
  exit: () => void,
  state: ReplState,
): Promise<string | null> {
  const trimmed = cmd.trim().toLowerCase();

  // Normalize dot prefix to slash
  const normalized = trimmed.startsWith(".") ? "/" + trimmed.slice(1) : trimmed;

  // Commands that need React state (not in commands.ts)
  switch (normalized) {
    case "/js":
      return "Polyglot mode is always on (HQL + JavaScript).";
    case "/hql":
      return "Polyglot mode is always on (HQL + JavaScript).";
    case "/clear":
      return null; // Clear is handled by returning null
    case "/exit":
    case "/quit":
      await state.flushHistory();
      state.flushHistorySync();
      exit();
      return null;
    case "/reset": {
      repl.reset();
      resetContext();
      // SSOT: Use bindings API only
      const bindingsApi = (globalThis as Record<string, unknown>).bindings as {
        clear: () => Promise<void>;
      } | undefined;
      if (bindingsApi?.clear) {
        await bindingsApi.clear();
      }
      return "REPL state reset. All bindings cleared.";
    }
  }

  // Delegate to centralized command handler and capture user-facing command output
  const outputs: string[] = [];

  await runCommand(cmd, state, {
    onOutput: (line) => outputs.push(line),
  });
  // deno-lint-ignore no-control-regex
  return outputs.join("\n").replace(/\x1b\[[0-9;]*m/g, "") || null; // Strip ANSI
}
