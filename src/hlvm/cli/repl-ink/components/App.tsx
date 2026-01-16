/**
 * HLVM Ink REPL - Main App
 * Full-featured REPL with rich banner, keyboard shortcuts, completions
 */

import React, { useState, useCallback, useRef, useEffect } from "npm:react@18";
import { Box, Text, useInput, useApp } from "npm:ink@5";
import { Input } from "./Input.tsx";
import { Output } from "./Output.tsx";
import { Banner } from "./Banner.tsx";
import { SessionPicker } from "./SessionPicker.tsx";
import { ConfigOverlay, type ConfigOverlayState } from "./ConfigOverlay.tsx";
import { CommandPaletteOverlay, type PaletteState, type KeyCombo } from "./CommandPaletteOverlay.tsx";
import { BackgroundTasksOverlay } from "./BackgroundTasksOverlay.tsx";
import { ModelBrowser } from "./ModelBrowser.tsx";
import { ModelSetupOverlay } from "./ModelSetupOverlay.tsx";
import { FooterHint } from "./FooterHint.tsx";
import type { KeybindingAction } from "../keybindings/index.ts";
import { executeHandler, refreshKeybindingLookup } from "../keybindings/index.ts";
import { useRepl } from "../hooks/useRepl.ts";
import { useInitialization } from "../hooks/useInitialization.ts";
import type { EvalResult } from "../types.ts";
import { ReplState } from "../../repl/state.ts";
import { clearTerminal } from "../../ansi.ts";
import { useTheme } from "../../theme/index.ts";
import type { AnyAttachment } from "../hooks/useAttachments.ts";
import { resetContext } from "../../repl/context.ts";
import { isCommand, runCommand } from "../../repl/commands.ts";
import type { Session, SessionInitOptions, SessionMeta, SessionMessage } from "../../repl/session/types.ts";
import { SessionManager } from "../../repl/session/manager.ts";
import { ReplProvider, useReplContext } from "../context/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";

interface HistoryEntry {
  id: number;
  input: string;
  result: EvalResult;
}

interface CurrentEval {
  code: string;
  controller: AbortController;
  attachmentPaths: string[];
  backgrounded: boolean;
  cancelled?: boolean;
  taskId?: string;
  historyId?: number;
}

interface AppProps {
  jsMode?: boolean;
  showBanner?: boolean;
  sessionOptions?: SessionInitOptions;
}

/** Convert session messages to history entries for display */
function convertMessagesToHistory(
  messages: readonly SessionMessage[],
  startId: number
): { entries: HistoryEntry[]; nextId: number } {
  const entries: HistoryEntry[] = [];
  let id = startId;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user") {
      // Look for following assistant message
      const nextMsg = messages[i + 1];
      const hasAssistant = nextMsg && nextMsg.role === "assistant";

      entries.push({
        id: id++,
        input: msg.content,
        result: hasAssistant
          ? { success: true, value: nextMsg.content }
          : { success: true, value: undefined },
      });

      // Skip the assistant message we consumed
      if (hasAssistant) i++;
    }
  }

  return { entries, nextId: id };
}

function isAsyncIterable(value: unknown): value is AsyncIterableIterator<string> {
  return !!value && typeof value === "object" && Symbol.asyncIterator in (value as object);
}

function stringifyOutput(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "";
    }
  }
}

/**
 * App wrapper - provides ReplContext for FRP state management
 */
export function App({ jsMode: initialJsMode = false, showBanner = true, sessionOptions }: AppProps): React.ReactElement {
  const stateRef = useRef<ReplState>(new ReplState());

  return (
    <ReplProvider replState={stateRef.current}>
      <AppContent
        jsMode={initialJsMode}
        showBanner={showBanner}
        sessionOptions={sessionOptions}
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
function AppContent({ jsMode: initialJsMode = false, showBanner = true, sessionOptions, replState }: AppContentProps): React.ReactElement {
  const { exit } = useApp();

  // Get reactive state from context (bindings, docstrings, memoryNames auto-update)
  const { memoryNames } = useReplContext();

  const repl = useRepl({ jsMode: initialJsMode, state: replState });

  // Initialize: runtime, memory, AI
  const init = useInitialization(replState, initialJsMode);

  // Session management
  const sessionManagerRef = useRef<SessionManager | null>(null);
  const [currentSession, setCurrentSession] = useState<SessionMeta | null>(null);

  // Initialize session manager
  useEffect(() => {
    const initSession = async () => {
      const manager = new SessionManager(Deno.cwd());
      sessionManagerRef.current = manager;

      // SSOT: Register with session API
      try {
        const { setSessionManager } = await import("../../../api/session.ts");
        setSessionManager(manager);
      } catch {
        // API module may not be loaded yet - session works via ref fallback
      }

      try {
        const session = await manager.initialize(sessionOptions);
        setCurrentSession(session);

        // Auto-open picker if --resume was passed without ID
        if (sessionOptions?.openPicker) {
          const sessions = await manager.list(20);
          if (sessions.length > 0) {
            setPickerSessions(sessions);
            setActivePanel("picker");
          }
        }
      } catch (error) {
        // Session initialization failed - continue without sessions
        console.error("Session init failed:", error);
      }
    };

    initSession();

    return () => {
      sessionManagerRef.current?.close();
    };
  }, [sessionOptions]);

  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  // Ref to avoid stale closure in useInput callback
  const isEvaluatingRef = useRef(false);
  useEffect(() => { isEvaluatingRef.current = isEvaluating; }, [isEvaluating]);
  const [nextId, setNextId] = useState(1);
  const [clearKey, setClearKey] = useState(0); // Force re-render on clear
  const [hasBeenCleared, setHasBeenCleared] = useState(false); // Hide banner after Ctrl+L

  // Task manager for background evaluation
  const { createEvalTask, completeEvalTask, failEvalTask, updateEvalOutput, cancel } = useTaskManager();

  // Track current evaluation for Ctrl+B to push to background
  // AbortController enables true cancellation of async operations (AI calls, fetch, etc.)
  const currentEvalRef = useRef<CurrentEval | null>(null);

  // Unified panel state - only one panel can be open at a time
  // "palette", "config-overlay", and "tasks-overlay" are overlays (input visible but disabled), others hide input entirely
  type ActivePanel = "none" | "picker" | "config-overlay" | "tasks-overlay" | "models" | "palette" | "model-setup";
  const [activePanel, setActivePanel] = useState<ActivePanel>("none");

  // Track where ModelBrowser was opened from (for back navigation)
  const [modelBrowserParent, setModelBrowserParent] = useState<ActivePanel>("none");

  // Track if model setup has been handled (completed or cancelled) to prevent infinite loop
  const [modelSetupHandled, setModelSetupHandled] = useState(false);

  // Debounce ref for panel toggles - prevents rapid open/close during streaming re-renders
  const lastPanelToggleRef = useRef<number>(0);

  // Session picker data (separate from panel state)
  const [pickerSessions, setPickerSessions] = useState<SessionMeta[]>([]);
  const [pendingResumeInput, setPendingResumeInput] = useState<string | null>(null);

  // Command palette persistent state (survives open/close)
  const [paletteState, setPaletteState] = useState<PaletteState>({
    query: "",
    cursorPos: 0,
    selectedIndex: 0,
    scrollOffset: 0,
  });

  // Config overlay persistent state (survives open/close)
  const [configOverlayState, setConfigOverlayState] = useState<ConfigOverlayState>({
    selectedIndex: 0,
  });

  // Theme from context (auto-updates when theme changes)
  const { color } = useTheme();

  // Show model setup overlay if default model needs to be downloaded (only once)
  useEffect(() => {
    if (init.ready && init.needsModelSetup && activePanel === "none" && !modelSetupHandled) {
      setActivePanel("model-setup");
    }
  }, [init.ready, init.needsModelSetup, activePanel, modelSetupHandled]);

  // Helper to add history entry and increment ID (DRY pattern used 8+ times)
  const addHistoryEntry = useCallback((input: string, result: EvalResult) => {
    setHistory((prev: HistoryEntry[]) => [...prev, { id: nextId, input, result }]);
    setNextId((n: number) => n + 1);
  }, [nextId]);

  // Session picker handlers
  const handlePickerSelect = useCallback(async (session: SessionMeta) => {
    // SSOT: Try session.resume() API only
    const sessionApi = (globalThis as Record<string, unknown>).session as {
      resume: (id: string) => Promise<Session | null>;
    } | undefined;

    let loaded: Session | null = null;
    if (sessionApi?.resume) {
      loaded = await sessionApi.resume(session.id);
    }

    if (loaded) {
      // Convert messages to history entries and restore conversation
      const { entries, nextId: newNextId } = convertMessagesToHistory(loaded.messages, 1);

      // Restore the conversation history
      setHistory(entries);
      setCurrentSession(loaded.meta);

      // Add "Resumed" notification at the end
      setHistory((prev: HistoryEntry[]) => [...prev, {
        id: newNextId,
        input: pendingResumeInput || "/resume",
        result: { success: true, value: `Resumed: ${loaded.meta.title} (${loaded.meta.messageCount} messages)` },
      }]);
      setNextId(newNextId + 1);
    } else {
      // Session file not found or corrupted
      addHistoryEntry(pendingResumeInput || "/resume", { success: false, error: new Error(`Session not found: ${session.title}`) });
    }
    setPendingResumeInput(null);
    setActivePanel("none");
  }, [nextId, pendingResumeInput, addHistoryEntry]);

  const handlePickerCancel = useCallback(() => {
    // Add history entry showing command was cancelled (only if user typed /resume)
    if (pendingResumeInput) {
      addHistoryEntry(pendingResumeInput, { success: true, value: "Cancelled" });
      setPendingResumeInput(null);
    }
    setActivePanel("none");
  }, [pendingResumeInput, addHistoryEntry]);

  const recordSessionTurn = useCallback(async (inputCode: string, attachmentPaths: string[], outputStr: string) => {
    const sessionApi = (globalThis as Record<string, unknown>).session as {
      record: (role: "user" | "assistant", content: string, attachments?: string[]) => Promise<void>;
      current: () => { id: string } | null;
    } | undefined;

    if (!sessionApi?.record) return;

    try {
      await sessionApi.record(
        "user",
        inputCode,
        attachmentPaths.length > 0 ? attachmentPaths : undefined
      );
      if (outputStr) {
        await sessionApi.record("assistant", outputStr);
      }
      const session = sessionApi.current();
      if (session) setCurrentSession(session);
    } catch {
      // Session recording failed - continue without sessions
    }
  }, [setCurrentSession]);

  const suppressHistoryOutput = useCallback((historyId: number) => {
    setHistory((prev: HistoryEntry[]) => prev.map((entry: HistoryEntry) => {
      if (entry.id !== historyId) return entry;
      return {
        ...entry,
        result: { ...entry.result, suppressOutput: true },
      };
    }));
  }, []);

  const streamEvalToTask = useCallback((
    taskId: string,
    iterator: AsyncIterableIterator<string>,
    controller: AbortController,
    evalState: CurrentEval,
    inputCode: string,
    attachmentPaths: string[]
  ) => {
    const renderInterval = 100;
    let buffer = "";
    let lastUpdate = 0;
    let pendingUpdate: number | null = null;

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
      }, renderInterval - elapsed) as unknown as number;
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
        void recordSessionTurn(inputCode, attachmentPaths, buffer);
      } catch (err) {
        const isAbort = controller.signal.aborted || (err instanceof Error && err.name === "AbortError");
        if (isAbort) {
          cancel(taskId);
          return;
        }
        const error = err instanceof Error ? err : new Error(String(err));
        failEvalTask(taskId, error);
      } finally {
        finalizeForeground();
      }
    })();
  }, [updateEvalOutput, completeEvalTask, failEvalTask, cancel, recordSessionTurn]);

  const handleSubmit = useCallback(async (code: string, attachments?: AnyAttachment[]) => {
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
    const trimmedLower = code.trim().toLowerCase();
    const normalized = trimmedLower.startsWith(".") ? "/" + trimmedLower.slice(1) : trimmedLower;

    // Handle /config command - show floating overlay
    if (normalized === "/config") {
      setActivePanel("config-overlay");
      return;
    }

    // Handle /tasks command - show background tasks overlay
    if (normalized === "/tasks") {
      setActivePanel("tasks-overlay");
      return;
    }

    // Handle /bg command - push current evaluation to background
    if (normalized === "/bg") {
      const activeEval = currentEvalRef.current;
      if (activeEval && !activeEval.backgrounded) {
        activeEval.backgrounded = true;
        const taskId = activeEval.taskId ?? createEvalTask(activeEval.code, activeEval.controller);
        activeEval.taskId = taskId;

        if (activeEval.historyId != null) {
          suppressHistoryOutput(activeEval.historyId);
        }

        currentEvalRef.current = null;
        setIsEvaluating(false);

        const preview = activeEval.code.length > 40 ? activeEval.code.slice(0, 37) + "..." : activeEval.code;
        addHistoryEntry("/bg", {
          success: true,
          value: `⏳ Pushed to background (Task ${taskId.slice(0, 8)})\n   ${preview}\n   Use /tasks to view`,
        });
      } else {
        addHistoryEntry("/bg", { success: false, error: new Error("No running evaluation to background") });
      }
      return;
    }

    // Handle /resume command
    if (normalized === "/resume") {
      // SSOT: Try session.list() API (sessions are global now)
      const sessionApi = (globalThis as Record<string, unknown>).session as {
        list: (options?: { limit?: number }) => Promise<SessionMeta[]>;
      } | undefined;

      let sessions: SessionMeta[] = [];
      if (sessionApi?.list) {
        sessions = await sessionApi.list({ limit: 20 });
      } else {
        addHistoryEntry(code, { success: true, value: "Session management not available" });
        return;
      }

      if (sessions.length === 0) {
        addHistoryEntry(code, { success: true, value: "No sessions found" });
      } else {
        setPendingResumeInput(code);  // Store command for history
        setPickerSessions(sessions);
        setActivePanel("picker");
      }
      return;
    }

    // Handle /clear command - clear screen and history (fallback for Cmd+K)
    if (normalized === "/clear") {
      clearTerminal();
      setHistory([]);
      setNextId(1);
      setHasBeenCleared(true);
      setClearKey((k: number) => k + 1);
      return;
    }

    // Commands (supports both /command and .command)
    if (isCommand(code)) {
      const output = await handleCommand(code, repl, exit, replState);
      if (output !== null) {
        addHistoryEntry(code, { success: true, value: output, isCommandOutput: true });
      }
      // FRP: memoryNames auto-update via ReplContext when bindings change
      return;
    }

    if (currentEvalRef.current && !currentEvalRef.current.backgrounded) {
      addHistoryEntry(code, { success: false, error: new Error("Evaluation already running. Use /bg or Esc.") });
      return;
    }

    setIsEvaluating(true);

    // Extract attachment paths for session recording (only file attachments have paths)
    const attachmentPaths = attachments
      ?.filter((a): a is Exclude<AnyAttachment, { type: "text" }> => a.type !== "text")
      .map((a) => a.path) ?? [];

    // Evaluate (with optional attachments)
    // Use expandedCode which has text attachment placeholders replaced with actual content
    // Create AbortController for true cancellation support
    const controller = new AbortController();
    const evalPromise = repl.evaluate(expandedCode, { attachments, signal: controller.signal });
    const evalState: CurrentEval = {
      code,
      controller,
      attachmentPaths,
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
      const err = error instanceof Error ? error : new Error(String(error));
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
        code,
        attachmentPaths
      );

      if (!evalState.backgrounded) {
        const historyId = nextId;
        addHistoryEntry(code, { success: true, streamTaskId: taskId });
        evalState.historyId = historyId;
      }

      return;
    }

    const outputStr = stringifyOutput(result.value);

    if (evalState.backgrounded || evalState.taskId) {
      const taskId = evalState.taskId ?? createEvalTask(code, controller);
      evalState.taskId = taskId;
      completeEvalTask(taskId, result.value);
      void recordSessionTurn(code, attachmentPaths, outputStr);
    } else {
      addHistoryEntry(code, result);
      void recordSessionTurn(code, attachmentPaths, outputStr);
    }

    finalizeForeground();
  }, [
    repl,
    exit,
    addHistoryEntry,
    createEvalTask,
    completeEvalTask,
    failEvalTask,
    suppressHistoryOutput,
    streamEvalToTask,
    recordSessionTurn,
    nextId,
  ]);

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

    // Save to config via API (SSOT)
    const configApi = (globalThis as Record<string, unknown>).config as {
      keybindings: { set: (id: string, combo: string) => Promise<void> };
    } | undefined;

    if (configApi?.keybindings?.set) {
      configApi.keybindings.set(keybindingId, keyComboStr).then(() => {
        // Refresh keybinding lookup to use new binding immediately
        refreshKeybindingLookup();
      });
    }
  }, []);

  // Global shortcuts (Ctrl+C exit, Ctrl+L/Cmd+K clear, Ctrl+P palette, Ctrl+B tasks, ESC cancel)
  useInput((char, key) => {
    if (key.ctrl && char === "c") {
      replState.flushHistorySync();
      exit();
    }
    if (key.ctrl && char === "p") {
      // Debounce: prevent rapid toggles during streaming re-renders
      const now = Date.now();
      if (now - lastPanelToggleRef.current < 150) {
        return; // Ignore if toggled within 150ms
      }
      lastPanelToggleRef.current = now;
      // Toggle palette
      setActivePanel((prev: ActivePanel) => prev === "palette" ? "none" : "palette");
      return;
    }
    // Ctrl+B: Toggle Background Tasks Overlay
    if (key.ctrl && char === "b") {
      const now = Date.now();
      if (now - lastPanelToggleRef.current < 150) {
        return;
      }
      lastPanelToggleRef.current = now;
      setActivePanel((prev: ActivePanel) => prev === "tasks-overlay" ? "none" : "tasks-overlay");
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
        addHistoryEntry(evalState.code, { success: true, value: "[Cancelled]" });
      }

      currentEvalRef.current = null;
      setIsEvaluating(false);
    }
  });

  return (
    <Box key={clearKey} flexDirection="column" paddingX={1}>
      {/* Show banner only after init complete (prevents double render), hide after Ctrl+L */}
      {showBanner && !hasBeenCleared && (
        init.ready ? (
          <Banner
            jsMode={repl.jsMode}
            loading={false}
            memoryNames={memoryNames}
            aiExports={init.aiExports}
            readyTime={init.readyTime}
            errors={init.errors}
            session={currentSession}
          />
        ) : (
          <Text dimColor>Loading HLVM...</Text>
        )
      )}

      {/* History of inputs and outputs */}
      {history.map((entry: HistoryEntry) => (
        <Box key={entry.id} flexDirection="column" marginBottom={1}>
          <Box>
            <Text color={color("primary")} bold>{repl.jsMode ? "js>" : "hlvm>"} </Text>
            <Text>{entry.input}</Text>
          </Box>
          <Output result={entry.result} />
        </Box>
      ))}

      {/* Session Picker */}
      {activePanel === "picker" && (
        <SessionPicker
          sessions={pickerSessions}
          currentSessionId={currentSession?.id}
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
          initialState={configOverlayState}
          onStateChange={setConfigOverlayState}
        />
      )}

      {/* Background Tasks Overlay (True Floating Overlay) */}
      {activePanel === "tasks-overlay" && (
        <BackgroundTasksOverlay onClose={() => setActivePanel("none")} />
      )}

      {/* Model Browser Panel */}
      {activePanel === "models" && (
        <ModelBrowser
          onClose={() => {
            setActivePanel(modelBrowserParent);
            setModelBrowserParent("none");
          }}
          onSelectModel={async (modelName: string) => {
            // Update config with selected model (prefixed with ollama/)
            const fullModelName = modelName.startsWith("ollama/") ? modelName : `ollama/${modelName}`;
            // SSOT: Use config API only
            const configApi = (globalThis as Record<string, unknown>).config as {
              set: (key: string, value: unknown) => Promise<unknown>;
            } | undefined;

            if (configApi?.set) {
              await configApi.set("model", fullModelName);
            }
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
              value: `✓ AI model ready: ${init.modelToSetup}`,
              isCommandOutput: true,
            });
          }}
          onCancel={() => {
            setModelSetupHandled(true); // Prevent showing overlay again
            setActivePanel("none");
            // Add cancelled message to history
            addHistoryEntry("", {
              success: true,
              value: `AI model setup cancelled. Run (ai.models.pull "${init.modelToSetup}") to download later.`,
              isCommandOutput: true,
            });
          }}
        />
      )}

      {/* Input line (hidden when modal panels are open, but visible under overlay) */}
      {/* FRP: Input now gets history, bindings, signatures, docstrings from ReplContext */}
      {/* Note: CommandPalette, ConfigOverlay, and BackgroundTasksOverlay are true overlays, so Input stays visible underneath */}
      {(activePanel === "none" || activePanel === "palette" || activePanel === "config-overlay" || activePanel === "tasks-overlay") && (
        <Input
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          jsMode={repl.jsMode}
          disabled={init.loading || activePanel === "palette" || activePanel === "config-overlay" || activePanel === "tasks-overlay"}
        />
      )}

      {/* Footer hint (show when input is visible, overlay draws on top) */}
      {(activePanel === "none" || activePanel === "palette" || activePanel === "config-overlay" || activePanel === "tasks-overlay") && !isEvaluating && (
        <FooterHint />
      )}

      {isEvaluating && <Text dimColor>...</Text>}
    </Box>
  );
}

async function handleCommand(
  cmd: string,
  repl: ReturnType<typeof useRepl>,
  exit: () => void,
  state: ReplState
): Promise<string | null> {
  const trimmed = cmd.trim().toLowerCase();

  // Normalize dot prefix to slash
  const normalized = trimmed.startsWith(".") ? "/" + trimmed.slice(1) : trimmed;

  // Commands that need React state (not in commands.ts)
  switch (normalized) {
    case "/js":
      repl.setJsMode(true);
      return "Switched to JavaScript mode";
    case "/hql":
      repl.setJsMode(false);
      return "Switched to HQL mode";
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

  // Delegate to centralized command handler (captures console output)
  const originalLog = console.log;
  const outputs: string[] = [];
  console.log = (...args: unknown[]) => {
    outputs.push(args.map(a => String(a)).join(" "));
  };

  try {
    await runCommand(cmd, state);
    return outputs.join("\n").replace(/\x1b\[[0-9;]*m/g, "") || null; // Strip ANSI
  } finally {
    console.log = originalLog;
  }
}
