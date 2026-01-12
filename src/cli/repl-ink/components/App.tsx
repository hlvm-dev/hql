/**
 * HQL Ink REPL - Main App
 * Full-featured REPL with rich banner, keyboard shortcuts, completions
 */

import React, { useState, useCallback, useRef, useEffect } from "npm:react@18";
import { Box, Text, useInput, useApp } from "npm:ink@5";
import { Input } from "./Input.tsx";
import { Output } from "./Output.tsx";
import { Banner } from "./Banner.tsx";
import { SessionPicker } from "./SessionPicker.tsx";
import { ConfigPanel } from "./ConfigPanel.tsx";
import { ConfigOverlay, type ConfigOverlayState } from "./ConfigOverlay.tsx";
import { CommandPaletteOverlay, type PaletteState, type KeyCombo } from "./CommandPaletteOverlay.tsx";
import { BackgroundTasks } from "./BackgroundTasks.tsx";
import { ModelBrowser } from "./ModelBrowser.tsx";
import { FooterHint } from "./FooterHint.tsx";
import type { KeybindingAction } from "../keybindings/index.ts";
import { executeHandler, refreshKeybindingLookup } from "../keybindings/index.ts";
import { updateKeybindingRuntime } from "../../../common/config/index.ts";
import { useRepl } from "../hooks/useRepl.ts";
import { useInitialization } from "../hooks/useInitialization.ts";
import type { EvalResult } from "../types.ts";
import { ReplState } from "../../repl/state.ts";
import { clearTerminal } from "../../ansi.ts";
import { useTheme } from "../../theme/index.ts";
import type { AnyAttachment } from "../hooks/useAttachments.ts";
import { resetContext } from "../../repl/context.ts";
import { isCommand, runCommand } from "../../repl/commands.ts";
import { clearMemory } from "../../repl/memory.ts";
import type { SessionInitOptions, SessionMeta, SessionMessage } from "../../repl/session/types.ts";
import { SessionManager } from "../../repl/session/manager.ts";
import { ReplProvider, useReplContext } from "../context/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";

interface HistoryEntry {
  id: number;
  input: string;
  result: EvalResult;
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

      try {
        const session = await manager.initialize(sessionOptions);
        setCurrentSession(session);

        // Auto-open picker if --resume was passed without ID
        if (sessionOptions?.openPicker) {
          const sessions = await manager.listForProject(20);
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
  const [nextId, setNextId] = useState(1);
  const [clearKey, setClearKey] = useState(0); // Force re-render on clear
  const [hasBeenCleared, setHasBeenCleared] = useState(false); // Hide banner after Ctrl+L

  // Task manager for background evaluation
  const { createEvalTask, completeEvalTask, failEvalTask } = useTaskManager();

  // Track current evaluation for Ctrl+B to push to background
  // AbortController enables true cancellation of async operations (AI calls, fetch, etc.)
  const currentEvalRef = useRef<{
    promise: Promise<EvalResult>;
    code: string;
    controller: AbortController;
  } | null>(null);

  // Unified panel state - only one panel can be open at a time
  // "palette" and "config-overlay" are overlays (input visible but disabled), others hide input entirely
  type ActivePanel = "none" | "picker" | "config" | "config-overlay" | "tasks" | "models" | "palette";
  const [activePanel, setActivePanel] = useState<ActivePanel>("none");

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

  // Helper to add history entry and increment ID (DRY pattern used 8+ times)
  const addHistoryEntry = useCallback((input: string, result: EvalResult) => {
    setHistory((prev: HistoryEntry[]) => [...prev, { id: nextId, input, result }]);
    setNextId((n: number) => n + 1);
  }, [nextId]);

  // Session picker handlers
  const handlePickerSelect = useCallback(async (session: SessionMeta) => {
    if (sessionManagerRef.current) {
      const loaded = await sessionManagerRef.current.resumeSession(session.id);
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

  const handleSubmit = useCallback(async (code: string, attachments?: AnyAttachment[]) => {
    if (!code.trim()) return;
    setIsEvaluating(true);

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
      setIsEvaluating(false);
      setInput("");
      return;
    }

    // Handle /resume command
    if (normalized === "/resume") {
      if (!sessionManagerRef.current) {
        addHistoryEntry(code, { success: true, value: "Session management not available" });
      } else {
        const sessions = await sessionManagerRef.current.listForProject(20);
        if (sessions.length === 0) {
          addHistoryEntry(code, { success: true, value: "No sessions found" });
        } else {
          setPendingResumeInput(code);  // Store command for history
          setPickerSessions(sessions);
          setActivePanel("picker");
        }
      }
      setIsEvaluating(false);
      setInput("");
      return;
    }

    // Handle /clear command - clear screen and history (fallback for Cmd+K)
    if (normalized === "/clear") {
      clearTerminal();
      setHistory([]);
      setNextId(1);
      setHasBeenCleared(true);
      setClearKey((k: number) => k + 1);
      setIsEvaluating(false);
      setInput("");
      return;
    }

    // Commands (supports both /command and .command)
    if (isCommand(code)) {
      const output = await handleCommand(code, repl, exit, replState);
      if (output !== null) {
        addHistoryEntry(code, { success: true, value: output, isCommandOutput: true });
      }
      // FRP: memoryNames auto-update via ReplContext when bindings change
      setIsEvaluating(false);
      setInput("");
      return;
    }

    // Extract attachment paths for session recording (only file attachments have paths)
    const attachmentPaths = attachments
      ?.filter((a): a is Exclude<AnyAttachment, { type: "text" }> => a.type !== "text")
      .map((a) => a.path) ?? [];

    // Evaluate (with optional attachments)
    // Use expandedCode which has text attachment placeholders replaced with actual content
    // Create AbortController for true cancellation support
    const controller = new AbortController();
    const evalPromise = repl.evaluate(expandedCode, { attachments, signal: controller.signal });
    currentEvalRef.current = { promise: evalPromise, code, controller };

    try {
      const result = await evalPromise;

      // Check if we were pushed to background (currentEvalRef cleared)
      if (!currentEvalRef.current) {
        // Evaluation was pushed to background, don't add to history here
        return;
      }

      // Show original code in history (with placeholders) for cleaner display
      addHistoryEntry(code, result);

      // Auto-save to session (only for non-error results)
      if (sessionManagerRef.current && result.success) {
        try {
          // Record user input
          await sessionManagerRef.current.recordMessage(
            "user",
            code,
            attachmentPaths.length > 0 ? attachmentPaths : undefined
          );

          // Record assistant output (stringify the value)
          const outputStr = result.value !== undefined
            ? (typeof result.value === "string" ? result.value : JSON.stringify(result.value))
            : "";
          if (outputStr) {
            await sessionManagerRef.current.recordMessage("assistant", outputStr);
          }

          // Update current session state
          const session = sessionManagerRef.current.getCurrentSession();
          if (session) setCurrentSession(session);
        } catch {
          // Session recording failed - continue without sessions
        }
      }

      // FRP: memoryNames auto-update via ReplContext when bindings change
    } catch (error) {
      // Check if we were pushed to background
      if (!currentEvalRef.current) {
        return;
      }
      addHistoryEntry(code, { success: false, error: error instanceof Error ? error : new Error(String(error)) });
    } finally {
      currentEvalRef.current = null;
    }

    setIsEvaluating(false);
    setInput("");
  }, [repl, exit, addHistoryEntry]);

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

    // Save to config
    updateKeybindingRuntime(keybindingId, keyComboStr);

    // Refresh keybinding lookup to use new binding immediately
    refreshKeybindingLookup();
  }, []);

  // Global shortcuts (Ctrl+C exit, Ctrl+L/Cmd+K clear, Ctrl+P palette, Ctrl+B tasks, ESC cancel)
  useInput((char, key) => {
    if (key.ctrl && char === "c") exit();
    if (key.ctrl && char === "p") {
      setActivePanel("palette");
      return;
    }
    // Ctrl+B: Push evaluation to background, or toggle tasks panel
    if (key.ctrl && char === "b") {
      // If currently evaluating, push to background
      if (isEvaluating && currentEvalRef.current) {
        const { promise, code, controller } = currentEvalRef.current;

        // Create background task with AbortController for true cancellation
        const taskId = createEvalTask(code, controller);

        // Let promise continue in background, update task when done
        promise
          .then((result: EvalResult) => completeEvalTask(taskId, result))
          .catch((error: unknown) => failEvalTask(taskId, error instanceof Error ? error : new Error(String(error))));

        // Immediately unblock UI
        currentEvalRef.current = null;
        setIsEvaluating(false);

        // Show confirmation in history
        const preview = code.length > 40 ? code.slice(0, 37) + "..." : code;
        addHistoryEntry(code, {
          success: true,
          value: `⏳ Pushed to background (Task ${taskId.slice(0, 8)})\n   ${preview}`,
        });

        return;
      }

      // Otherwise, toggle tasks panel
      setActivePanel((prev: ActivePanel) => prev === "tasks" ? "none" : "tasks");
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
    if (key.escape && isEvaluating && currentEvalRef.current) {
      const { code, controller } = currentEvalRef.current;

      // Abort the evaluation (will cause AbortError in async operations)
      controller.abort();

      // Clear ref so handleSubmit knows we cancelled
      currentEvalRef.current = null;
      setIsEvaluating(false);

      // Show cancellation
      const preview = code.length > 40 ? code.slice(0, 37) + "..." : code;
      addHistoryEntry(code, {
        success: true,
        value: `✗ Cancelled\n   ${preview}`,
      });
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
          <Text dimColor>Loading HQL...</Text>
        )
      )}

      {/* History of inputs and outputs */}
      {history.map((entry: HistoryEntry) => (
        <Box key={entry.id} flexDirection="column" marginBottom={1}>
          <Box>
            <Text color={color("primary")} bold>{repl.jsMode ? "js>" : "hql>"} </Text>
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

      {/* Config Panel */}
      {activePanel === "config" && (
        <ConfigPanel
          onClose={() => setActivePanel("none")}
          onOpenModelBrowser={() => setActivePanel("models")}
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
          onOpenModelBrowser={() => setActivePanel("models")}
          initialState={configOverlayState}
          onStateChange={setConfigOverlayState}
        />
      )}

      {/* Background Tasks Panel */}
      {activePanel === "tasks" && (
        <BackgroundTasks onClose={() => setActivePanel("none")} />
      )}

      {/* Model Browser Panel */}
      {activePanel === "models" && (
        <ModelBrowser
          onClose={() => setActivePanel("none")}
          onSelectModel={(modelName: string) => {
            // Update config with selected model (prefixed with ollama/)
            const fullModelName = modelName.startsWith("ollama/") ? modelName : `ollama/${modelName}`;
            import("../../../common/config/index.ts").then(({ updateConfigRuntime }) => {
              updateConfigRuntime("model", fullModelName);
            });
          }}
        />
      )}

      {/* Input line (hidden when modal panels are open, but visible under overlay) */}
      {/* FRP: Input now gets history, bindings, signatures, docstrings from ReplContext */}
      {/* Note: CommandPalette and ConfigOverlay are true overlays, so Input stays visible underneath */}
      {(activePanel === "none" || activePanel === "palette" || activePanel === "config-overlay") && (
        <Input
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          jsMode={repl.jsMode}
          disabled={isEvaluating || init.loading || activePanel === "palette" || activePanel === "config-overlay"}
        />
      )}

      {/* Footer hint (show when input is visible, overlay draws on top) */}
      {(activePanel === "none" || activePanel === "palette" || activePanel === "config-overlay") && !isEvaluating && (
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
      exit();
      return null;
    case "/reset":
      repl.reset();
      resetContext();
      await clearMemory();
      return "REPL state reset. All bindings and memory cleared.";
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
