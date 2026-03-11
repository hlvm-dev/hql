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
import { Box, Static, Text, useApp, useInput, useStdout } from "ink";
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
import type { KeybindingAction } from "../keybindings/index.ts";
import {
  executeHandler,
  inspectHandlerKeybinding,
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
import { useAlternateBuffer } from "../hooks/useAlternateBuffer.ts";
import type { AssistantCitation, EvalResult } from "../types.ts";
import { ReplState } from "../../repl/state.ts";
import { clearTerminal, resetTerminalViewport } from "../../ansi.ts";
import {
  getUnclosedDepth,
  tokenize,
  type TokenType,
} from "../../repl/syntax.ts";
import { useTheme } from "../../theme/index.ts";
import type { AnyAttachment } from "../hooks/useAttachments.ts";
import { resetContext } from "../../repl/context.ts";
import {
  DEFAULT_TERMINAL_HEIGHT,
  DEFAULT_TERMINAL_WIDTH,
} from "../ui-constants.ts";
import { isCommand, runCommand } from "../../repl/commands.ts";
import type {
  SessionInitOptions,
  SessionMeta,
} from "../../repl/session/types.ts";
import type {
  InteractionRequestEvent,
  InteractionResponse,
} from "../../../agent/registry.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { ensureError, truncate } from "../../../../common/utils.ts";
import {
  ConfigError,
  type HlvmConfig,
  normalizeModelId,
} from "../../../../common/config/types.ts";
import {
  getConfiguredModel,
  getContextWindow,
  getPermissionMode,
} from "../../../../common/config/selectors.ts";
import {
  buildSelectedModelConfigUpdates,
  persistSelectedModelConfig,
} from "../../../../common/config/model-selection.ts";
import { ReplProvider } from "../context/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";
import { getTaskManager } from "../../repl/task-manager/index.ts";
import { log } from "../../../api/log.ts";
import { looksLikeNaturalLanguage } from "../../repl/input-routing.ts";
import {
  getRuntimeConfigApi,
  patchRuntimeConfig,
  runChatViaHost,
} from "../../../runtime/host-client.ts";
import { createRuntimeConfigManager } from "../../../runtime/model-config.ts";
import {
  getCustomKeybindingsSnapshot,
  setCustomKeybindingsSnapshot,
} from "../keybindings/custom-bindings.ts";
import {
  clearCurrentSession,
  ensureCurrentSession,
  session as sessionApi,
  syncCurrentSession,
} from "../../../api/session.ts";
import { resolveSessionStart } from "../../repl/session/start.ts";
import { recordPromptHistory } from "../../repl/prompt-history.ts";
import { buildTranscriptStateFromSession } from "../conversation-history.ts";
import type { ConfiguredModelReadinessState } from "../../../runtime/configured-model-readiness.ts";
import {
  type AgentExecutionMode,
  cycleReplAgentExecutionMode,
  getAgentExecutionModeBadge,
  getAgentExecutionModeChangeMessage,
  toAgentExecutionMode,
} from "../../../agent/execution-mode.ts";
import {
  type ConversationComposerDraft,
  createConversationComposerDraft,
  enqueueConversationDraft,
  getConversationQueueEditBinding,
  getConversationQueueEditBindingLabel,
  mergeConversationDraftsForInterrupt,
  popLastQueuedConversationDraft,
  shiftQueuedConversationDraft,
} from "../utils/conversation-queue.ts";
import { buildQueuePreviewLines } from "./QueuePreview.tsx";

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

interface BannerItem {
  id: string;
  aiExports: string[];
  aiReadiness: ConfiguredModelReadinessState;
  errors: string[];
  modelName: string;
}

interface AppProps {
  showBanner?: boolean;
  sessionOptions?: SessionInitOptions;
  initialConfig?: HlvmConfig;
}

const GLOBAL_KEYBINDING_CATEGORIES = ["Global"] as const;

export function usesConversationContext(surfacePanel: string): boolean {
  return surfacePanel === "conversation";
}

export function usesStandaloneSurfacePanel(surfacePanel: string): boolean {
  return surfacePanel === "picker" || surfacePanel === "models" ||
    surfacePanel === "model-setup";
}

export function isModalOverlayPanel(panel: string): boolean {
  return panel === "palette" || panel === "config-overlay" ||
    panel === "tasks-overlay" || panel === "team-dashboard" ||
    panel === "shortcuts-overlay";
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

  // Conversation session management
  const [currentSession, setCurrentSession] = useState<SessionMeta | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    const initConversationSession = async () => {
      try {
        const resolution = await resolveSessionStart(sessionOptions, {
          listSessions: (options) => sessionApi.list(options),
          hasSession: (sessionId) => sessionApi.has(sessionId),
        }, {
          defaultBehavior: "new",
        });

        switch (resolution.kind) {
          case "picker":
            clearCurrentSession();
            if (!cancelled) {
              setCurrentSession(null);
              setPickerSessions(resolution.sessions);
              if (resolution.sessions.length > 0) {
                setSurfacePanel("picker");
              }
            }
            return;
          case "resume": {
            const resumed = await sessionApi.resume(resolution.sessionId);
            if (!cancelled) {
              setCurrentSession(resumed?.meta ?? null);
            }
            return;
          }
          case "missing":
            clearCurrentSession();
            log.error(
              `Conversation session not found: ${resolution.sessionId}`,
            );
            if (!cancelled) {
              setCurrentSession(null);
            }
            return;
          case "new":
            clearCurrentSession();
            if (!cancelled) {
              setCurrentSession(null);
            }
            return;
          case "latest": {
            const active = resolution.sessionId
              ? await syncCurrentSession(resolution.sessionId)
              : null;
            if (!cancelled) {
              setCurrentSession(active);
            }
            return;
          }
        }
      } catch (error) {
        log.error(`Conversation session init failed: ${error}`);
      }
    };

    void initConversationSession();

    return () => {
      cancelled = true;
    };
  }, [sessionOptions]);

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
  // Banner rendered once via Static to prevent double-render issues with Ink
  const [bannerRendered, setBannerRendered] = useState(false);

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

  type SurfacePanel =
    | "none"
    | "picker"
    | "models"
    | "model-setup"
    | "conversation";
  type OverlayPanel =
    | "none"
    | "palette"
    | "config-overlay"
    | "tasks-overlay"
    | "team-dashboard"
    | "shortcuts-overlay";
  const [surfacePanel, setSurfacePanel] = useState<SurfacePanel>("none");
  const [activeOverlay, setActiveOverlay] = useState<OverlayPanel>("none");

  // Track where ModelBrowser was opened from (for back navigation)
  const [modelBrowserParentOverlay, setModelBrowserParentOverlay] = useState<
    OverlayPanel
  >("none");
  const [modelBrowserParentSurface, setModelBrowserParentSurface] = useState<
    SurfacePanel
  >("none");

  // Track if model setup has been handled (completed or cancelled) to prevent infinite loop
  const [modelSetupHandled, setModelSetupHandled] = useState(false);

  // Debounce ref for panel toggles - prevents rapid open/close during streaming re-renders
  const lastPanelToggleRef = useRef<number>(0);
  // Session picker data (separate from panel state)
  const [pickerSessions, setPickerSessions] = useState<SessionMeta[]>([]);
  const [pendingResumeInput, setPendingResumeInput] = useState<string | null>(
    null,
  );

  // Mark banner as rendered once when init completes (for Static component)
  useEffect(() => {
    if (init.ready && !bannerRendered) {
      setBannerRendered(true);
    }
  }, [init.ready, bannerRendered]);

  // Command palette persistent state (survives open/close)
  const [paletteState, setPaletteState] = useState<PaletteState>({
    query: "",
    cursorPos: 0,
    selectedIndex: 0,
    scrollOffset: 0,
  });

  // Config overlay persistent state (survives open/close)
  const [configOverlayState, setConfigOverlayState] = useState<
    ConfigOverlayState
  >({
    selectedIndex: 0,
  });

  // Theme from context (auto-updates when theme changes)
  const { color } = useTheme();

  // Terminal width for responsive layout
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const terminalHeight = stdout?.rows ?? DEFAULT_TERMINAL_HEIGHT;

  // Conversation state for agent mode
  const conversation = useConversation();
  const teamState = useTeamState(conversation.items);
  const hasConversationContext = usesConversationContext(surfacePanel);
  const [interactionQueue, setInteractionQueue] = useState<
    InteractionRequestEvent[]
  >([]);
  const pendingInteraction = interactionQueue[0];
  const replModeTouchedRef = useRef(false);
  const footerStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [agentExecutionMode, setAgentExecutionMode] = useState<
    AgentExecutionMode
  >(() => toAgentExecutionMode(getPermissionMode(initialConfig)));
  const [footerStatusMessage, setFooterStatusMessage] = useState("");

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

  const agentControllerRef = useRef<AbortController | null>(null);
  const interactionResolversRef = useRef<
    Map<string, (response: InteractionResponse) => void>
  >(new Map());
  const [configuredModelId, setConfiguredModelId] = useState<string>(
    getConfiguredModel(initialConfig),
  );
  const [isConfiguredModelExplicit, setIsConfiguredModelExplicit] = useState(
    initialConfig?.modelConfigured === true,
  );
  const [footerModelName, setFooterModelName] = useState<string>(
    typeof initialConfig?.model === "string"
      ? initialConfig.model.replace("ollama/", "")
      : "",
  );
  const [configuredContextWindow, setConfiguredContextWindow] = useState<
    number | undefined
  >(getContextWindow(initialConfig));
  const [footerContextUsageLabel, setFooterContextUsageLabel] = useState<
    string
  >("");
  const [pendingConversationQueue, setPendingConversationQueue] = useState<
    ConversationComposerDraft[]
  >([]);
  const [composerAttachments, setComposerAttachments] = useState<
    AnyAttachment[]
  >([]);
  const [
    restoredComposerDraftRevision,
    setRestoredComposerDraftRevision,
  ] = useState(0);
  const [
    restoredComposerCursorOffset,
    setRestoredComposerCursorOffset,
  ] = useState(0);
  // NOTE: composerLayoutRows was removed — the feedback loop between Input's
  // onLayoutRowsChange → App state → ConversationPanel reservedRows caused
  // cascading re-renders on every keystroke, duplicating prompt lines in Ink.
  const queueEditBinding = useMemo(
    () => getConversationQueueEditBinding(getPlatform().env),
    [],
  );
  const queueEditBindingLabel = useMemo(
    () => getConversationQueueEditBindingLabel(queueEditBinding),
    [queueEditBinding],
  );
  const queuePreviewRows = useMemo(
    () =>
      buildQueuePreviewLines(
        pendingConversationQueue,
        queueEditBindingLabel,
      ).length,
    [pendingConversationQueue, queueEditBindingLabel],
  );
  const shouldUseAlternateBuffer = hasConversationContext &&
    conversation.items.length >= 80;
  useAlternateBuffer(shouldUseAlternateBuffer);

  const previousOverlayRef = useRef<OverlayPanel>("none");
  useEffect(() => {
    if (previousOverlayRef.current === activeOverlay) return;
    resetTerminalViewport();
    previousOverlayRef.current = activeOverlay;
  }, [activeOverlay]);

  useEffect(() => {
    return () => {
      if (footerStatusTimerRef.current) {
        clearTimeout(footerStatusTimerRef.current);
      }
    };
  }, []);

  const flashFooterStatus = useCallback((message: string) => {
    if (footerStatusTimerRef.current) {
      clearTimeout(footerStatusTimerRef.current);
    }
    setFooterStatusMessage(message);
    footerStatusTimerRef.current = setTimeout(() => {
      footerStatusTimerRef.current = null;
      setFooterStatusMessage("");
    }, 2200);
  }, []);

  const applyRuntimeConfigState = useCallback(
    (cfg: Record<string, unknown>) => {
      const modelId = getConfiguredModel(cfg);
      setConfiguredModelId(modelId);
      setIsConfiguredModelExplicit(cfg.modelConfigured === true);
      setFooterModelName(modelId.replace("ollama/", ""));
      setConfiguredContextWindow(getContextWindow(cfg));
      if (!replModeTouchedRef.current) {
        setAgentExecutionMode(toAgentExecutionMode(getPermissionMode(cfg)));
      }
    },
    [],
  );

  const cycleAgentMode = useCallback(() => {
    const nextMode = cycleReplAgentExecutionMode(agentExecutionMode);
    replModeTouchedRef.current = true;
    setAgentExecutionMode(nextMode);
    flashFooterStatus(getAgentExecutionModeChangeMessage(nextMode));
  }, [agentExecutionMode, flashFooterStatus]);

  const refreshRuntimeConfigState = useCallback(async () => {
    const runtimeConfig = await createRuntimeConfigManager();
    const runtimeSnapshot = await runtimeConfig.sync();
    applyRuntimeConfigState(
      runtimeSnapshot as unknown as Record<string, unknown>,
    );
  }, [applyRuntimeConfigState]);

  useEffect(() => {
    if (initialConfig) {
      applyRuntimeConfigState(
        initialConfig as unknown as Record<string, unknown>,
      );
      return;
    }

    refreshRuntimeConfigState()
      .catch(() => {});
  }, [applyRuntimeConfigState, initialConfig, refreshRuntimeConfigState]);

  useEffect(() => {
    if (!init.ready) return;
    refreshRuntimeConfigState()
      .catch(() => {});
  }, [init.ready, refreshRuntimeConfigState]);

  // Show model setup overlay if default model needs to be downloaded (only once)
  useEffect(() => {
    if (
      init.ready && init.needsModelSetup && surfacePanel === "none" &&
      activeOverlay === "none" &&
      !modelSetupHandled
    ) {
      setSurfacePanel("model-setup");
    }
  }, [
    activeOverlay,
    init.ready,
    init.needsModelSetup,
    modelSetupHandled,
    surfacePanel,
  ]);

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

  const resumeConversationSession = useCallback(async (
    sessionId: string,
    commandInput: string,
    sessionTitle?: string,
  ): Promise<boolean> => {
    const loaded = await sessionApi.resume(sessionId);

    if (!loaded) {
      addHistoryEntry(commandInput, {
        success: false,
        error: new Error(`Session not found: ${sessionTitle ?? sessionId}`),
      });
      setSurfacePanel("none");
      return false;
    }

    const transcriptState = buildTranscriptStateFromSession(loaded);
    conversation.hydrateState(transcriptState);
    conversation.addInfo(
      `Resumed: ${loaded.meta.title} (${loaded.meta.messageCount} messages)`,
    );
    conversation.resetStatus();
    setCurrentSession(loaded.meta);
    setFooterContextUsageLabel("");
    setSurfacePanel("conversation");
    return true;
  }, [addHistoryEntry, conversation]);

  // Session picker handlers
  const handlePickerSelect = useCallback(async (session: SessionMeta) => {
    await resumeConversationSession(
      session.id,
      pendingResumeInput || "/resume",
      session.title,
    );
    setPendingResumeInput(null);
  }, [pendingResumeInput, resumeConversationSession]);

  const handlePickerCancel = useCallback(() => {
    // Add history entry showing command was cancelled (only if user typed /resume)
    if (pendingResumeInput) {
      addHistoryEntry(pendingResumeInput, {
        success: true,
        value: "Cancelled",
      });
      setPendingResumeInput(null);
    }
    setSurfacePanel("none");
  }, [pendingResumeInput, addHistoryEntry]);

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

  const runConversation = useCallback(async (
    query: string,
    mediaPaths?: string[],
  ) => {
    // Guard: prevent double agent start — set ref atomically before any async work
    if (agentControllerRef.current) return;
    const controller = new AbortController();
    agentControllerRef.current = controller;
    const isActiveConversationRun = () =>
      agentControllerRef.current === controller;

    setSurfacePanel("conversation");
    setFooterContextUsageLabel("");
    conversation.addUserMessage(query);

    try {
      const runtimeConfig = await createRuntimeConfigManager();
      const ensuredModel = await runtimeConfig
        .ensureInitialModelConfigured();
      const runtimeSnapshot = runtimeConfig.getConfig();
      const model = ensuredModel.model || configuredModelId || undefined;
      if (
        runtimeSnapshot.model !== configuredModelId ||
        (runtimeSnapshot.modelConfigured === true) !== isConfiguredModelExplicit
      ) {
        applyRuntimeConfigState(
          runtimeSnapshot as unknown as Record<string, unknown>,
        );
      }
      if (model) {
        conversation.addInfo("Initializing agent...", { isTransient: true });
      } else {
        throw new ConfigError(
          "No configured model available for conversation mode.",
        );
      }

      const sessionMeta = sessionApi.current() ?? currentSession ??
        await ensureCurrentSession();
      if (!currentSession || currentSession.id !== sessionMeta.id) {
        setCurrentSession(sessionMeta);
      }

      let textBuffer = "";
      let finalCitations: AssistantCitation[] | undefined;
      // Throttle streaming renders to avoid Ink full-screen redraws on every token.
      // Tokens arrive every ~10-30ms; batching to 80ms gives smooth output without flicker.
      const STREAM_RENDER_INTERVAL = 80;
      let lastStreamRender = 0;
      let pendingStreamTimer: ReturnType<typeof setTimeout> | null = null;
      const flushStreamBuffer = () => {
        pendingStreamTimer = null;
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
        // REPL UX: avoid model-initiated ask_user detours for simple chat turns.
        // Keep direct conversational flow unless explicit permission prompts are needed.
        toolDenylist: ["ask_user", "complete_task"],
        signal: controller.signal,
        callbacks: {
          onToken: (text: string) => {
            if (controller.signal.aborted || !isActiveConversationRun()) {
              return;
            }
            textBuffer += text;
            const now = Date.now();
            if (now - lastStreamRender >= STREAM_RENDER_INTERVAL) {
              if (pendingStreamTimer) {
                clearTimeout(pendingStreamTimer);
                pendingStreamTimer = null;
              }
              flushStreamBuffer();
            } else if (!pendingStreamTimer) {
              pendingStreamTimer = setTimeout(
                flushStreamBuffer,
                STREAM_RENDER_INTERVAL - (now - lastStreamRender),
              );
            }
          },
          onAgentEvent: (event) => {
            if (controller.signal.aborted || !isActiveConversationRun()) {
              return;
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
      if (pendingStreamTimer) {
        clearTimeout(pendingStreamTimer);
        pendingStreamTimer = null;
      }
      if (!isActiveConversationRun()) {
        return;
      }

      // Finalize assistant message
      if (textBuffer) {
        conversation.addAssistantText(textBuffer, false, finalCitations);
      } else if (result.text) {
        conversation.addAssistantText(result.text, false, finalCitations);
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
    isConfiguredModelExplicit,
    configuredModelId,
    conversation,
    currentSession,
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
    setIsEvaluating(true);
    void runConversation(expandedText, imagePaths);
    return { started: true };
  }, [
    expandConversationDraftText,
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

  const restoreComposerDraft = useCallback(
    (draft: ConversationComposerDraft | null) => {
      if (!draft) {
        setInput("");
        setComposerAttachments([]);
        setRestoredComposerCursorOffset(0);
        setRestoredComposerDraftRevision((prev: number) => prev + 1);
        return;
      }
      setInput(draft.text);
      setComposerAttachments(draft.attachments);
      setRestoredComposerCursorOffset(draft.cursorOffset);
      setRestoredComposerDraftRevision((prev: number) => prev + 1);
    },
    [],
  );

  const currentComposerDraft = useMemo(
    () => createConversationComposerDraft(input, composerAttachments),
    [composerAttachments, input],
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

  const clearReplSurface = useCallback(() => {
    clearTerminal();
    setHistory([]);
    setNextId(1);
    setHasBeenCleared(true);
    setClearKey((k: number) => k + 1);
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
    closeConversationMode,
    conversation,
    hasConversationContext,
  ]);

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

  const toggleTeamDashboard = useCallback(() => {
    const now = Date.now();
    if (now - lastPanelToggleRef.current < 150) {
      return;
    }
    lastPanelToggleRef.current = now;
    setActiveOverlay((prev: OverlayPanel) =>
      prev === "team-dashboard" ? "none" : "team-dashboard"
    );
  }, []);

  const togglePalette = useCallback(() => {
    const now = Date.now();
    if (now - lastPanelToggleRef.current < 150) {
      return;
    }
    lastPanelToggleRef.current = now;
    setActiveOverlay((prev: OverlayPanel) =>
      prev === "palette" ? "none" : "palette"
    );
  }, []);

  const toggleTasksOverlay = useCallback(() => {
    const now = Date.now();
    if (now - lastPanelToggleRef.current < 150) {
      return;
    }
    lastPanelToggleRef.current = now;
    setActiveOverlay((prev: OverlayPanel) =>
      prev === "tasks-overlay" ? "none" : "tasks-overlay"
    );
  }, []);

  const toggleShortcutsOverlay = useCallback(() => {
    const now = Date.now();
    if (now - lastPanelToggleRef.current < 150) {
      return;
    }
    lastPanelToggleRef.current = now;
    setActiveOverlay((prev: OverlayPanel) =>
      prev === "shortcuts-overlay" ? "none" : "shortcuts-overlay"
    );
  }, []);

  const handleAppExit = useCallback(() => {
    replState.flushHistorySync();
    exit();
  }, [exit, replState]);

  useEffect(() => {
    registerHandler(
      HandlerIds.APP_EXIT,
      handleAppExit,
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
    handleAppExit,
    toggleShortcutsOverlay,
    togglePalette,
    toggleTasksOverlay,
    toggleTeamDashboard,
  ]);

  // Force-interrupt: abort current agent and immediately send new message
  const handleForceInterrupt = useCallback(
    (code: string, attachments?: AnyAttachment[]) => {
      if (!code.trim()) return;
      recordPromptHistory(replState, code, "conversation");
      restoreComposerDraft(null);
      const draft = createConversationComposerDraft(code.trim(), attachments);

      // Abort current agent if running
      if (agentControllerRef.current) {
        agentControllerRef.current.abort();
        agentControllerRef.current = null;
      }
      interactionResolversRef.current.clear();
      setInteractionQueue([]);
      setIsEvaluating(false);
      setPendingConversationQueue([]);
      conversation.finalize();

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
      conversation,
      replState,
      restoreComposerDraft,
      submitConversationDraft,
    ],
  );

  const handleQueueDraft = useCallback((draft: ConversationComposerDraft) => {
    recordPromptHistory(replState, draft.text, "conversation");
    setPendingConversationQueue((prev: ConversationComposerDraft[]) =>
      enqueueConversationDraft(prev, draft)
    );
    setComposerAttachments([]);
  }, [replState]);

  const handleEditLastQueuedDraft = useCallback(() => {
    const { draft, remaining } = popLastQueuedConversationDraft(
      pendingConversationQueue,
    );
    if (!draft) return;
    setPendingConversationQueue(remaining);
    restoreComposerDraft(draft);
  }, [pendingConversationQueue, restoreComposerDraft]);

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
      if (pendingInteraction?.mode === "question" && !isAnyCommand) {
        recordPromptHistory(replState, code, "interaction");
        conversation.addUserMessage(forceConversationPrompt ?? code.trim(), {
          startTurn: false,
        });
        handleInteractionResponse(pendingInteraction.requestId, {
          approved: true,
          userInput: forceConversationPrompt ?? code.trim(),
        });
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
          conversation.addEvent({
            type: "checkpoint_restored",
            checkpoint: restored.checkpoint,
            restoredFileCount: restored.restoredFileCount,
          });
          conversation.addInfo(
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
        // FRP: memoryNames auto-update via ReplContext when bindings change
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
          restoreComposerDraft(conversationDraft);
          if (result.unsupportedMimeType) {
            conversation.addError(
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
        code.trim();
      if (
        forceConversationPrompt || isNaturalLanguage(candidateConversationQuery)
      ) {
        recordPromptHistory(replState, code, "conversation");
        const conversationDraft = createConversationComposerDraft(
          candidateConversationQuery,
          attachments,
        );
        const result = submitConversationDraft(conversationDraft);
        if (!result.started) {
          restoreComposerDraft(conversationDraft);
          const unsupportedMimeType = result.unsupportedMimeType;
          if (!unsupportedMimeType) return;
          const modelLabel = footerModelName || "current model";
          addHistoryEntry(code, {
            success: false,
            error: new Error(
              `Attachment unsupported: ${unsupportedMimeType} is not supported by model ${modelLabel}.`,
            ),
          });
          return;
        }
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
      isNaturalLanguage,
      runConversation,
      conversation,
      pendingConversationQueue,
      closeConversationMode,
      pendingInteraction,
      handleInteractionResponse,
      footerModelName,
      configuredModelId,
      configuredContextWindow,
      replState,
      applyRuntimeConfigState,
      prepareConversationMediaPayload,
      restoreComposerDraft,
      submitConversationDraft,
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
    // Interaction response keys (y/n/Enter) during conversation permission dialogs
    if (hasConversationContext && pendingInteraction) {
      if (pendingInteraction.mode === "permission") {
        if (char === "y" || key.return) {
          handleInteractionResponse(pendingInteraction.requestId, {
            approved: true,
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
        handleInteractionResponse(pendingInteraction.requestId, {
          approved: false,
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

  // Prepare banner items for Static component (renders once, never re-renders)
  const bannerItems: BannerItem[] =
    showBanner && !hasBeenCleared && bannerRendered
      ? [{
        id: "banner",
        aiExports: init.aiExports,
        aiReadiness: init.aiReadiness,
        errors: init.errors,
        modelName: footerModelName,
      }]
      : [];

  const isOverlayOpen = isModalOverlayPanel(activeOverlay);
  const hasStandaloneSurface = usesStandaloneSurfacePanel(surfacePanel);
  const isConversationInputVisible = hasConversationContext && !isOverlayOpen;
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
  const renderBannerItem = (item: BannerItem): React.ReactElement => (
    <Box key={item.id}>
      <Banner
        aiExports={item.aiExports}
        aiReadiness={item.aiReadiness}
        errors={item.errors}
        modelName={item.modelName}
      />
    </Box>
  );
  const staticBannerProps = { items: bannerItems, children: renderBannerItem };
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
            currentModel={configuredModelId}
            isCurrentModelConfigured={isConfiguredModelExplicit}
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
            onSelectModel={async (modelName: string) => {
              const updates = buildSelectedModelConfigUpdates(modelName);
              const configApi = getRuntimeConfigApi();
              await persistSelectedModelConfig(configApi, modelName);
              applyRuntimeConfigState(
                updates as unknown as Record<string, unknown>,
              );
            }}
          />
        );
      case "model-setup":
        return init.modelToSetup
          ? (
            <ModelSetupOverlay
              modelName={init.modelToSetup}
              onComplete={() => {
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
  const tokenColor = (type: TokenType): string | undefined => {
    switch (type) {
      case "string":
        return color("secondary");
      case "number":
        return color("accent");
      case "keyword":
      case "macro":
        return color("primary");
      case "comment":
      case "whitespace":
        return color("muted");
      case "boolean":
        return color("warning");
      case "operator":
        return color("accent");
      default:
        return undefined;
    }
  };

  return (
    <Box
      key={clearKey}
      flexDirection="column"
      paddingX={1}
    >
      {/* Banner rendered via Static — MUST be unconditional direct child (Ink requirement) */}
      {showBanner && !hasBeenCleared && !bannerRendered && (
        <Text dimColor>Loading HLVM...</Text>
      )}
      <Static<BannerItem> {...staticBannerProps} />

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
        <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
          <ConversationPanel
            items={conversation.items}
            width={Math.max(20, terminalWidth - 2)}
            streamingState={conversation.streamingState}
            activePlan={conversation.activePlan}
            todoState={conversation.todoState ?? conversation.planTodoState}
            pendingPlanReview={conversation.pendingPlanReview}
            latestCheckpoint={conversation.latestCheckpoint}
            allowToggleHotkeys={surfacePanel === "conversation" &&
              allowConversationToggleHotkeys}
            interactionRequest={pendingInteraction}
            interactionQueueLength={interactionQueue.length}
            onInteractionResponse={handleInteractionResponse}
          />
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
      {/* FRP: Input now gets history, bindings, signatures, docstrings from ReplContext */}
      {!isOverlayOpen && isInputVisible &&
        (
          <Input
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            onForceSubmit={hasConversationContext
              ? handleForceInterrupt
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
                pendingInteraction?.mode === "question"
              ? "answer>"
              : "hlvm>"}
          />
        )}

      {/* Keep the prompt attached to content while pinning the footer to the bottom in plain REPL mode */}
      {!isOverlayOpen && !hasConversationContext && !hasStandaloneSurface && (
        <Box flexGrow={1} />
      )}

      {/* Footer hint */}
      {!isOverlayOpen && (isInputVisible || hasConversationContext) &&
        (
          <FooterHint
            modelName={footerModelName}
            modeLabel={getAgentExecutionModeBadge(agentExecutionMode)}
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
            hasPendingQuestion={hasConversationContext &&
              pendingInteraction?.mode === "question"}
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
      // SSOT: Use memory API only
      const memoryApi = (globalThis as Record<string, unknown>).memory as {
        clear: () => Promise<void>;
      } | undefined;
      if (memoryApi?.clear) {
        await memoryApi.clear();
      }
      return "REPL state reset. All bindings and memory cleared.";
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
