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
import { ShortcutsOverlay } from "./ShortcutsOverlay.tsx";
import { ModelBrowser } from "./ModelBrowser.tsx";
import { ModelSetupOverlay } from "./ModelSetupOverlay.tsx";
import { FooterHint } from "./FooterHint.tsx";
import { ConversationPanel } from "./ConversationPanel.tsx";
import type { KeybindingAction } from "../keybindings/index.ts";
import {
  executeHandler,
  refreshKeybindingLookup,
} from "../keybindings/index.ts";
import { useRepl } from "../hooks/useRepl.ts";
import { useInitialization } from "../hooks/useInitialization.ts";
import { useConversation } from "../hooks/useConversation.ts";
import { useAlternateBuffer } from "../hooks/useAlternateBuffer.ts";
import type { AssistantCitation, EvalResult } from "../types.ts";
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
import type {
  SessionInitOptions,
  SessionMeta,
} from "../../repl/session/types.ts";
import type {
  InteractionRequestEvent,
  InteractionResponse,
} from "../../../agent/registry.ts";
import { ensureError } from "../../../../common/utils.ts";
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
import {
  looksLikeNaturalLanguage,
  resolveConversationMode,
} from "../../repl/input-routing.ts";
import { stripTerminalControlBytes } from "../../repl/input-normalization.ts";
import {
  getRuntimeConfigApi,
  getRuntimeModelDiscovery,
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
import { buildTranscriptStateFromSession } from "../conversation-history.ts";
import {
  cycleReplAgentExecutionMode,
  getAgentExecutionModeBadge,
  getAgentExecutionModeChangeMessage,
  getAgentExecutionModeSelectionLabel,
  toAgentExecutionMode,
  type AgentExecutionMode,
} from "../../../agent/execution-mode.ts";
import {
  formatExecutionModeModelDisplayName,
  getExecutionModeModelForMode,
  resolveExecutionModeModels,
  type ReplAgentExecutionModeModelOverrides,
} from "../../../agent/execution-mode-models.ts";
import type { RuntimeModelDiscoveryResponse } from "../../../runtime/model-protocol.ts";

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

interface QueuedConversationTurn {
  query: string;
  mediaPaths?: string[];
}

interface AppProps {
  showBanner?: boolean;
  sessionOptions?: SessionInitOptions;
  initialConfig?: HlvmConfig;
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
  return stripTerminalControlBytes(input);
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
        });

        switch (resolution.kind) {
          case "picker":
            clearCurrentSession();
            if (!cancelled) {
              setCurrentSession(null);
              setPickerSessions(resolution.sessions);
              if (resolution.sessions.length > 0) {
                setActivePanel("picker");
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

  // Unified panel state - only one panel can be open at a time
  // "palette", "config-overlay", "tasks-overlay", and "shortcuts-overlay" are overlays
  // (input visible but disabled), others hide input entirely
  // "conversation" renders the agent conversation panel
  type ActivePanel =
    | "none"
    | "picker"
    | "config-overlay"
    | "tasks-overlay"
    | "shortcuts-overlay"
    | "models"
    | "palette"
    | "model-setup"
    | "conversation";
  const [activePanel, setActivePanel] = useState<ActivePanel>("none");

  // Track where ModelBrowser was opened from (for back navigation)
  const [modelBrowserParent, setModelBrowserParent] = useState<ActivePanel>(
    "none",
  );

  // Track if model setup has been handled (completed or cancelled) to prevent infinite loop
  const [modelSetupHandled, setModelSetupHandled] = useState(false);

  // Debounce ref for panel toggles - prevents rapid open/close during streaming re-renders
  const lastPanelToggleRef = useRef<number>(0);

  // Session picker data (separate from panel state)
  const [pickerSessions, setPickerSessions] = useState<SessionMeta[]>([]);
  const [pendingResumeInput, setPendingResumeInput] = useState<string | null>(
    null,
  );

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

  // Conversation state for agent mode
  const conversation = useConversation();
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
  const [configuredContextWindow, setConfiguredContextWindow] = useState<
    number | undefined
  >(getContextWindow(initialConfig));
  const [runtimeModelDiscovery, setRuntimeModelDiscovery] = useState<
    RuntimeModelDiscoveryResponse | undefined
  >(undefined);
  const [modeModelOverrides, setModeModelOverrides] = useState<
    ReplAgentExecutionModeModelOverrides
  >({});
  const [footerContextUsageLabel, setFooterContextUsageLabel] = useState<
    string
  >("");
  const [pendingConversationQueue, setPendingConversationQueue] = useState<
    QueuedConversationTurn[]
  >([]);
  const executionModeModels = useMemo(
    () =>
      resolveExecutionModeModels(
        configuredModelId,
        runtimeModelDiscovery,
        modeModelOverrides,
      ),
    [configuredModelId, runtimeModelDiscovery, modeModelOverrides],
  );
  const activeExecutionModeModel = getExecutionModeModelForMode(
    agentExecutionMode,
    executionModeModels,
    configuredModelId,
    configuredContextWindow,
  );
  const activeModelId = activeExecutionModeModel?.id ?? configuredModelId;
  const footerModelName = activeExecutionModeModel?.displayName ??
    formatExecutionModeModelDisplayName(configuredModelId);
  const activeContextWindow = activeExecutionModeModel?.contextWindow ??
    configuredContextWindow;
  const activeModeModelOverrideId = modeModelOverrides[agentExecutionMode];
  const shouldUseAlternateBuffer = activePanel === "conversation" &&
    conversation.items.length >= 80;
  useAlternateBuffer(shouldUseAlternateBuffer);

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
      setConfiguredContextWindow(getContextWindow(cfg));
      if (!replModeTouchedRef.current) {
        setAgentExecutionMode(toAgentExecutionMode(getPermissionMode(cfg)));
      }
    },
    [],
  );

  const refreshRuntimeModelDiscovery = useCallback(async () => {
    const discovery = await getRuntimeModelDiscovery();
    setRuntimeModelDiscovery(discovery);
  }, []);

  const cycleAgentMode = useCallback(() => {
    const nextMode = cycleReplAgentExecutionMode(agentExecutionMode);
    replModeTouchedRef.current = true;
    setAgentExecutionMode(nextMode);
    const nextModel = executionModeModels.byMode[nextMode];
    const modeMessage = getAgentExecutionModeChangeMessage(nextMode);
    flashFooterStatus(
      nextModel && nextModel.id !== activeModelId
        ? `${modeMessage} · ${nextModel.displayName}`
        : modeMessage,
    );
  }, [
    agentExecutionMode,
    activeModelId,
    executionModeModels.byMode,
    flashFooterStatus,
  ]);

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
    refreshRuntimeModelDiscovery()
      .catch(() => {});
  }, [init.ready, refreshRuntimeConfigState, refreshRuntimeModelDiscovery]);

  // Show model setup overlay if default model needs to be downloaded (only once)
  useEffect(() => {
    if (
      init.ready && init.needsModelSetup && activePanel === "none" &&
      !modelSetupHandled
    ) {
      setActivePanel("model-setup");
    }
  }, [init.ready, init.needsModelSetup, activePanel, modelSetupHandled]);

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
      setActivePanel("none");
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
    setActivePanel("conversation");
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
    setActivePanel("none");
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
        const error = err instanceof Error ? err : new Error(String(err));
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

    setActivePanel("conversation");
    setFooterContextUsageLabel("");
    conversation.addUserMessage(query);

    try {
      const runtimeConfig = await createRuntimeConfigManager();
      const ensuredModel = await runtimeConfig
        .ensureInitialModelConfigured();
      const runtimeSnapshot = runtimeConfig.getConfig();
      const runtimeConfiguredModelId = ensuredModel.model || runtimeSnapshot.model ||
        configuredModelId;
      const runtimeExecutionModeModels = resolveExecutionModeModels(
        runtimeConfiguredModelId,
        runtimeModelDiscovery,
        modeModelOverrides,
      );
      const runtimeExecutionModeModel = getExecutionModeModelForMode(
        agentExecutionMode,
        runtimeExecutionModeModels,
        runtimeConfiguredModelId,
        configuredContextWindow,
      );
      const model = runtimeExecutionModeModel?.id;
      const conversationMode = resolveConversationMode(
        model,
        runtimeExecutionModeModel,
      );
      if (
        runtimeSnapshot.model !== configuredModelId ||
        (runtimeSnapshot.modelConfigured === true) !== isConfiguredModelExplicit
      ) {
        applyRuntimeConfigState(
          runtimeSnapshot as unknown as Record<string, unknown>,
        );
      }
      if (model) {
        conversation.addInfo(
          `${
            conversationMode === "agent"
              ? "Initializing agent"
              : "Starting chat"
          } (${runtimeExecutionModeModel?.displayName ?? formatExecutionModeModelDisplayName(model)})...`,
          { isTransient: true },
        );
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
      const result = await runChatViaHost({
        mode: conversationMode,
        sessionId: sessionMeta.id,
        messages: [{
          role: "user",
          content: query,
          image_paths: mediaPaths,
          client_turn_id: crypto.randomUUID(),
        }],
        model,
        ...(conversationMode === "agent"
          ? {
            permissionMode: agentExecutionMode,
            // REPL UX: avoid model-initiated ask_user detours for simple chat turns.
            // Keep direct conversational flow unless explicit permission prompts are needed.
            toolDenylist: ["ask_user", "complete_task"],
          }
          : {}),
        signal: controller.signal,
        callbacks: {
          onToken: (text: string) => {
            textBuffer += text;
            conversation.addAssistantText(textBuffer, true);
          },
          onAgentEvent: (event) => {
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
            finalCitations = meta.citationSpans as
              | AssistantCitation[]
              | undefined;
          },
        },
        onInteraction: conversationMode === "agent" ? (event) => {
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
              reject(new Error("Agent interaction aborted"));
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
        } : undefined,
      });

      // Finalize assistant message
      if (textBuffer) {
        conversation.addAssistantText(textBuffer, false, finalCitations);
      } else if (result.text) {
        conversation.addAssistantText(result.text, false, finalCitations);
      }

      // Footer context usage (Gemini-style compact indicator)
      const usage = result.stats.usage;
      if (
        usage && typeof runtimeExecutionModeModel?.contextWindow === "number" &&
        runtimeExecutionModeModel.contextWindow > 0
      ) {
        const pct = Math.max(
          0,
          Math.min(
            100,
            Math.round(
              (usage.totalTokens / runtimeExecutionModeModel.contextWindow) *
                100,
            ),
          ),
        );
        setFooterContextUsageLabel(`${pct}% ctx`);
      } else if (
        usage && typeof activeContextWindow === "number" && activeContextWindow > 0
      ) {
        const pct = Math.max(
          0,
          Math.min(
            100,
            Math.round((usage.totalTokens / activeContextWindow) * 100),
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
        conversation.addInfo("Cancelled");
      } else {
        conversation.addError(ensureError(error).message);
      }
    } finally {
      agentControllerRef.current = null;
      interactionResolversRef.current.clear();
      setInteractionQueue([]);
      setIsEvaluating(false);
      conversation.finalize();
    }
  }, [
    applyRuntimeConfigState,
    agentExecutionMode,
    activeContextWindow,
    isConfiguredModelExplicit,
    configuredModelId,
    conversation,
    currentSession,
    modeModelOverrides,
    runtimeModelDiscovery,
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
      setActivePanel("none");
    },
    [conversation, interactionQueue],
  );

  useEffect(() => {
    if (activePanel !== "conversation") return;
    if (agentControllerRef.current) return;
    if (pendingConversationQueue.length === 0) return;

    const [nextTurn, ...rest] = pendingConversationQueue;
    setPendingConversationQueue(rest);
    setIsEvaluating(true);
    void runConversation(nextTurn.query, nextTurn.mediaPaths);
  }, [activePanel, pendingConversationQueue, runConversation]);

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
      const isPanelCommand = commandName === "/config" ||
        commandName === "/tasks" || commandName === "/bg" ||
        commandName === "/resume" || commandName === "/clear" ||
        opensModelPicker;
      const isAnyCommand = isPanelCommand || isCommand(code);

      // If there's a pending question interaction, route non-command input as the answer.
      // Commands must still work while a question prompt is active.
      if (pendingInteraction?.mode === "question" && !isAnyCommand) {
        conversation.addUserMessage(forceConversationPrompt ?? code.trim(), {
          startTurn: false,
        });
        handleInteractionResponse(pendingInteraction.requestId, {
          approved: true,
          userInput: forceConversationPrompt ?? code.trim(),
        });
        return;
      }

      // Handle /config command - show floating overlay
      if (commandName === "/config") {
        setActivePanel("config-overlay");
        return;
      }

      // Handle /tasks command - show background tasks overlay
      if (commandName === "/tasks") {
        setActivePanel("tasks-overlay");
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

          const preview = activeEval.code.length > 40
            ? activeEval.code.slice(0, 37) + "..."
            : activeEval.code;
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
          setActivePanel("picker");
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

        if (activePanel === "conversation") {
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
        setModelBrowserParent("none");
        setActivePanel("models");
        return;
      }

      // Handle /clear command - clear screen and history (fallback for Cmd+K)
      if (commandName === "/clear") {
        clearTerminal();
        setHistory([]);
        setNextId(1);
        setHasBeenCleared(true);
        setClearKey((k: number) => k + 1);
        interactionResolversRef.current.clear();
        setInteractionQueue([]);
        conversation.clear();
        setFooterContextUsageLabel("");
        if (activePanel === "conversation") {
          closeConversationMode({ clearConversation: true });
        }
        return;
      }

      // Commands (supports both /command and .command)
      if (isAnyCommand) {
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
      if (activePanel === "conversation") {
        const { images, unsupportedMimeType } = prepareConversationMediaPayload(
          attachments,
        );
        if (unsupportedMimeType) {
          conversation.addError(
            `Attachment unsupported: ${unsupportedMimeType}`,
          );
          return;
        }
        const imagePayload = images && images.length > 0 ? images : undefined;
        const conversationQuery = forceConversationPrompt ?? expandedCode;
        if (agentControllerRef.current) {
          setPendingConversationQueue((prev: QueuedConversationTurn[]) => [
            ...prev,
            { query: conversationQuery, mediaPaths: imagePayload },
          ]);
          return;
        }
        setIsEvaluating(true);
        runConversation(conversationQuery, imagePayload);
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
        expandedCode;
      if (
        forceConversationPrompt || isNaturalLanguage(candidateConversationQuery)
      ) {
        // Convert media attachments to structured payload for multimodal models.
        // Fail fast on generic/untyped binary payloads with explicit guidance.
        const { images, unsupportedMimeType } = prepareConversationMediaPayload(
          attachments,
        );
        if (unsupportedMimeType) {
          const modelLabel = footerModelName || "current model";
          addHistoryEntry(code, {
            success: false,
            error: new Error(
              `Attachment unsupported: ${unsupportedMimeType} is not supported by model ${modelLabel}.`,
            ),
          });
          return;
        }

        setIsEvaluating(true);
        runConversation(
          candidateConversationQuery,
          images?.length ? images : undefined,
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
      isNaturalLanguage,
      runConversation,
      conversation,
      activePanel,
      pendingConversationQueue,
      closeConversationMode,
      pendingInteraction,
      handleInteractionResponse,
      footerModelName,
      configuredModelId,
      configuredContextWindow,
      applyRuntimeConfigState,
      prepareConversationMediaPayload,
    ],
  );

  // Command palette action handler
  const handlePaletteAction = useCallback((action: KeybindingAction) => {
    setActivePanel("none");
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

  // Global shortcuts (Ctrl+C exit, Ctrl+L/Cmd+K clear, Ctrl+P palette, Ctrl+B tasks, ESC cancel-in-place)
  useInput((char, key) => {
    if (key.ctrl && char === "c") {
      replState.flushHistorySync();
      exit();
    }
    if (
      char === "?" && !key.ctrl && !key.meta && !key.escape &&
      (activePanel === "none" || activePanel === "conversation" ||
        activePanel === "shortcuts-overlay") &&
      input.length === 0 &&
      pendingInteraction?.mode !== "question"
    ) {
      setActivePanel((prev: ActivePanel) =>
        prev === "shortcuts-overlay" ? "none" : "shortcuts-overlay"
      );
      return;
    }
    if (key.ctrl && char === "p") {
      // Debounce: prevent rapid toggles during streaming re-renders
      const now = Date.now();
      if (now - lastPanelToggleRef.current < 150) {
        return; // Ignore if toggled within 150ms
      }
      lastPanelToggleRef.current = now;
      // Toggle palette
      setActivePanel((prev: ActivePanel) =>
        prev === "palette" ? "none" : "palette"
      );
      return;
    }
    // Ctrl+B: Toggle Background Tasks Overlay
    if (key.ctrl && char === "b") {
      const now = Date.now();
      if (now - lastPanelToggleRef.current < 150) {
        return;
      }
      lastPanelToggleRef.current = now;
      setActivePanel((prev: ActivePanel) =>
        prev === "tasks-overlay" ? "none" : "tasks-overlay"
      );
      return;
    }
    // Ctrl+L or Cmd+K: Clear screen and history
    // Note: Cmd+K may be intercepted by terminal emulator first, sending ANSI clear
    // but we still need to clear React state to prevent content from reappearing on re-render
    if ((key.ctrl && char === "l") || (key.meta && char === "k")) {
      // Clear terminal first
      clearTerminal();
      // Then clear React state
      setHistory([]);
      setNextId(1);
      setHasBeenCleared(true); // Hide banner after clear
      setClearKey((k: number) => k + 1); // Force full re-render
      interactionResolversRef.current.clear();
      setInteractionQueue([]);
      conversation.clear();
      setFooterContextUsageLabel("");
      // Also clear conversation if in conversation mode
      if (activePanel === "conversation") {
        closeConversationMode({ clearConversation: true });
      }
      return;
    }
    // Interaction response keys (y/n/Enter) during conversation permission dialogs
    if (activePanel === "conversation" && pendingInteraction) {
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
    // - running: cancel in-place (keep chat surface)
    // - idle: exit conversation mode
    if (key.escape && activePanel === "conversation") {
      if (agentControllerRef.current) {
        agentControllerRef.current.abort();
        setIsEvaluating(false);
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

  // Input visible: always for normal/overlay modes and always visible in conversation mode.
  const isConversationInputVisible = activePanel === "conversation";
  const isInputVisible = activePanel === "none" ||
    activePanel === "palette" || activePanel === "config-overlay" ||
    activePanel === "tasks-overlay" || activePanel === "shortcuts-overlay" ||
    isConversationInputVisible;
  const isInputDisabled = init.loading || activePanel === "palette" ||
    activePanel === "config-overlay" || activePanel === "tasks-overlay" ||
    activePanel === "shortcuts-overlay" ||
    (activePanel === "conversation" &&
      pendingInteraction?.mode === "permission");
  // Keep Ctrl+O section toggles from conflicting with Input paredit Ctrl+O.
  // Safe contexts:
  // - conversation mode without input visible (Input hidden, no conflict)
  // - input disabled (agent actively running / permission mode / overlays)
  // - empty prompt (paredit no-op)
  const allowConversationToggleHotkeys = !isInputVisible || isInputDisabled ||
    input.length === 0;

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
    <Box key={clearKey} flexDirection="column" paddingX={1}>
        {/* Banner hidden during conversation to prevent Ink re-render duplication */}
        {showBanner && !hasBeenCleared && activePanel !== "conversation" && !init.ready && (
          <Text dimColor>Loading HLVM...</Text>
        )}
        {showBanner && !hasBeenCleared && activePanel !== "conversation" && init.ready && (
          <Banner
            aiExports={init.aiExports}
            aiReadiness={init.aiReadiness}
            errors={init.errors}
            modelName={footerModelName}
          />
        )}

        {/* History of inputs and outputs (hidden during conversation to prevent ghost rendering) */}
        {activePanel !== "conversation" && history.map((entry: HistoryEntry) => {
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

        {/* Session Picker */}
        {activePanel === "picker" && (
          <SessionPicker
            sessions={pickerSessions}
            currentSessionId={sessionApi.current()?.id ?? currentSession?.id}
            onSelect={handlePickerSelect}
            onCancel={handlePickerCancel}
          />
        )}

        {/* Command Palette (True Floating Overlay) */}
        {activePanel === "palette" && (
          <CommandPaletteOverlay
            onClose={() => setActivePanel("none")}
            onExecute={handlePaletteAction}
            onRebind={handleRebind}
            initialState={paletteState}
            onStateChange={setPaletteState}
          />
        )}

        {/* Config Overlay (True Floating Overlay) */}
        {activePanel === "config-overlay" && (
          <ConfigOverlay
            onClose={() => setActivePanel("none")}
            onOpenModelBrowser={() => {
              setModelBrowserParent("config-overlay");
              setActivePanel("models");
            }}
            onConfigChange={(cfg) =>
              applyRuntimeConfigState(cfg as unknown as Record<string, unknown>)}
            initialState={configOverlayState}
            onStateChange={setConfigOverlayState}
          />
        )}

        {/* Background Tasks Overlay (True Floating Overlay) */}
        {activePanel === "tasks-overlay" && (
          <BackgroundTasksOverlay onClose={() => setActivePanel("none")} />
        )}

        {/* Shortcuts Overlay (True Floating Overlay) */}
        {activePanel === "shortcuts-overlay" && (
          <ShortcutsOverlay onClose={() => setActivePanel("none")} />
        )}

        {/* Model Browser Panel */}
        {activePanel === "models" && (
          <ModelBrowser
            currentModel={activeModelId}
            isCurrentModelConfigured={agentExecutionMode === "default"
              ? isConfiguredModelExplicit
              : !!activeModeModelOverrideId}
            selectionScopeLabel={getAgentExecutionModeSelectionLabel(
              agentExecutionMode,
            )}
            onClose={() => {
              setActivePanel(modelBrowserParent);
              setModelBrowserParent("none");
            }}
            onModelSet={(modelName: string) => {
              const normalizedModel = normalizeModelId(modelName) ?? modelName;
              addHistoryEntry("", {
                success: true,
                value: `✓ ${
                  getAgentExecutionModeSelectionLabel(agentExecutionMode)
                }: ${normalizedModel}`,
                isCommandOutput: true,
              });
            }}
            onSelectModel={async (modelName: string) => {
              if (agentExecutionMode === "default") {
                const updates = buildSelectedModelConfigUpdates(modelName);
                const configApi = getRuntimeConfigApi();
                await persistSelectedModelConfig(configApi, modelName);
                setModeModelOverrides((current: ReplAgentExecutionModeModelOverrides) => {
                  const next = { ...current };
                  delete next.default;
                  return next;
                });
                applyRuntimeConfigState(
                  updates as unknown as Record<string, unknown>,
                );
                return;
              }

              const normalizedModel = normalizeModelId(modelName) ?? modelName;
              setModeModelOverrides((current: ReplAgentExecutionModeModelOverrides) => ({
                ...current,
                [agentExecutionMode]: normalizedModel,
              }));
              flashFooterStatus(
                `${
                  getAgentExecutionModeSelectionLabel(agentExecutionMode)
                } · ${formatExecutionModeModelDisplayName(normalizedModel)}`,
              );
            }}
          />
        )}

        {/* Model Setup Overlay (first-time AI model download) */}
        {activePanel === "model-setup" && init.modelToSetup && (
          <ModelSetupOverlay
            modelName={init.modelToSetup}
            onComplete={() => {
              setModelSetupHandled(true); // Prevent showing overlay again
              setActivePanel("none");
              // Add success message to history
              addHistoryEntry("", {
                success: true,
                value: `✓ AI model installed: ${init.modelToSetup}`,
                isCommandOutput: true,
              });
            }}
            onCancel={() => {
              setModelSetupHandled(true); // Prevent showing overlay again
              setActivePanel("none");
              // Add cancelled message to history
              addHistoryEntry("", {
                success: true,
                value:
                  `AI model setup cancelled. Run "hlvm ai pull ${init.modelToSetup}" to download later.`,
                isCommandOutput: true,
              });
            }}
          />
        )}

        {/* Conversation Panel */}
        {activePanel === "conversation" && (
          <Box flexDirection="column">
            <ConversationPanel
              items={conversation.items}
              width={Math.max(20, terminalWidth - 2)}
              streamingState={conversation.streamingState}
              activePlan={conversation.activePlan}
              todoState={conversation.todoState ?? conversation.planTodoState}
              pendingPlanReview={conversation.pendingPlanReview}
              latestCheckpoint={conversation.latestCheckpoint}
              allowToggleHotkeys={allowConversationToggleHotkeys}
              interactionRequest={pendingInteraction}
              interactionQueueLength={interactionQueue.length}
              onInteractionResponse={handleInteractionResponse}
            />
          </Box>
        )}
      {/* Input line (hidden when modal panels are open, but visible under overlay) */}
      {/* FRP: Input now gets history, bindings, signatures, docstrings from ReplContext */}
      {/* Note: CommandPalette, ConfigOverlay, and BackgroundTasksOverlay are true overlays, so Input stays visible underneath */}
      {isInputVisible &&
        (
          <Input
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            onCycleMode={cycleAgentMode}
            disabled={isInputDisabled}
            highlightMode={activePanel === "conversation" ? "chat" : "code"}
            promptLabel={activePanel === "conversation" &&
                pendingInteraction?.mode === "question"
              ? "answer>"
              : "hlvm>"}
          />
        )}

      {/* Footer hint (visible during normal mode, overlays, and conversation mode) */}
      {(isInputVisible || activePanel === "conversation") &&
        (
          <FooterHint
            terminalWidth={terminalWidth}
            modelName={footerModelName}
            modeLabel={getAgentExecutionModeBadge(agentExecutionMode)}
            statusMessage={footerStatusMessage}
            streamingState={activePanel === "conversation"
              ? conversation.streamingState
              : undefined}
            activeTool={activePanel === "conversation"
              ? conversation.activeTool
              : undefined}
            contextUsageLabel={activePanel === "conversation"
              ? footerContextUsageLabel
              : ""}
            checkpointLabel={activePanel === "conversation" &&
                conversation.latestCheckpoint &&
                !conversation.latestCheckpoint.restoredAt
              ? "/undo ready"
              : ""}
            interactionQueueLength={activePanel === "conversation"
              ? interactionQueue.length
              : 0}
            queuedUserTurnCount={activePanel === "conversation"
              ? pendingConversationQueue.length
              : 0}
            inConversation={activePanel === "conversation"}
            hasPendingPermission={activePanel === "conversation" &&
              pendingInteraction?.mode === "permission"}
            hasPendingQuestion={activePanel === "conversation" &&
              pendingInteraction?.mode === "question"}
          />
        )}

      {isEvaluating && activePanel !== "conversation" && (
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
