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
import { useRepl } from "../hooks/useRepl.ts";
import { useInitialization } from "../hooks/useInitialization.ts";
import type { EvalResult } from "../types.ts";
import { ReplState } from "../../repl/state.ts";
import { clearTerminal } from "../../ansi.ts";
import { useTheme } from "../../theme/index.ts";
import type { AnyAttachment } from "../hooks/useAttachments.ts";
import { resetContext } from "../../repl/context.ts";
import { isCommand, runCommand } from "../../repl/commands.ts";
import type { SessionInitOptions, SessionMeta } from "../../repl/session/types.ts";
import { SessionManager } from "../../repl/session/manager.ts";

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

export function App({ jsMode: initialJsMode = false, showBanner = true, sessionOptions }: AppProps): React.ReactElement {
  const { exit } = useApp();

  // Create shared ReplState for both initialization and evaluation
  const stateRef = useRef<ReplState>(new ReplState());
  const repl = useRepl({ jsMode: initialJsMode, state: stateRef.current });

  // Initialize: runtime, memory, AI
  const init = useInitialization(stateRef.current, initialJsMode);

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
            setShowPicker(true);
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

  // Session picker state
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSessions, setPickerSessions] = useState<SessionMeta[]>([]);
  const [pendingResumeInput, setPendingResumeInput] = useState<string | null>(null);

  // Config panel state
  const [showConfigPanel, setShowConfigPanel] = useState(false);

  // Theme from context (auto-updates when theme changes)
  const { color } = useTheme();

  // Session picker handlers
  const handlePickerSelect = useCallback(async (session: SessionMeta) => {
    if (sessionManagerRef.current) {
      await sessionManagerRef.current.resumeSession(session.id);
      setCurrentSession(session);
      setHistory((prev: HistoryEntry[]) => [...prev, {
        id: nextId,
        input: pendingResumeInput || "/resume",
        result: { success: true, value: `Resumed: ${session.title} (${session.messageCount} messages)` },
      }]);
      setNextId((n: number) => n + 1);
    }
    setPendingResumeInput(null);
    setShowPicker(false);
  }, [nextId, pendingResumeInput]);

  const handlePickerCancel = useCallback(() => {
    // Add history entry showing command was cancelled (only if user typed /resume)
    if (pendingResumeInput) {
      setHistory((prev: HistoryEntry[]) => [...prev, {
        id: nextId,
        input: pendingResumeInput,
        result: { success: true, value: "Cancelled" },
      }]);
      setNextId((n: number) => n + 1);
      setPendingResumeInput(null);
    }
    setShowPicker(false);
  }, [nextId, pendingResumeInput]);

  const handleSubmit = useCallback(async (code: string, attachments?: AnyAttachment[]) => {
    if (!code.trim()) return;
    setIsEvaluating(true);

    // Handle commands that need React state (pickers/panels)
    const trimmedLower = code.trim().toLowerCase();
    const normalized = trimmedLower.startsWith(".") ? "/" + trimmedLower.slice(1) : trimmedLower;

    // Handle /config command - show interactive panel
    if (normalized === "/config") {
      setShowConfigPanel(true);
      setIsEvaluating(false);
      setInput("");
      return;
    }

    // Handle /resume command
    if (normalized === "/resume") {
      if (!sessionManagerRef.current) {
        setHistory((prev: HistoryEntry[]) => [...prev, { id: nextId, input: code, result: { success: true, value: "Session management not available" } }]);
        setNextId((n: number) => n + 1);
      } else {
        const sessions = await sessionManagerRef.current.listForProject(20);
        if (sessions.length === 0) {
          setHistory((prev: HistoryEntry[]) => [...prev, { id: nextId, input: code, result: { success: true, value: "No sessions found" } }]);
          setNextId((n: number) => n + 1);
        } else {
          setPendingResumeInput(code);  // Store command for history
          setPickerSessions(sessions);
          setShowPicker(true);
        }
      }
      setIsEvaluating(false);
      setInput("");
      return;
    }

    // Commands (supports both /command and .command)
    if (isCommand(code)) {
      const output = await handleCommand(code, repl, exit, stateRef.current);
      if (output !== null) {
        setHistory((prev: HistoryEntry[]) => [...prev, { id: nextId, input: code, result: { success: true, value: output, isCommandOutput: true } }]);
        setNextId((n: number) => n + 1);
      }
      setIsEvaluating(false);
      setInput("");
      return;
    }

    // Extract attachment paths for session recording (only file attachments have paths)
    const attachmentPaths = attachments
      ?.filter((a): a is Exclude<AnyAttachment, { type: "text" }> => a.type !== "text")
      .map((a) => a.path) ?? [];

    // Evaluate (with optional attachments)
    try {
      const result = await repl.evaluate(code, attachments);
      setHistory((prev: HistoryEntry[]) => [...prev, { id: nextId, input: code, result }]);
      setNextId((n: number) => n + 1);

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
    } catch (error) {
      setHistory((prev: HistoryEntry[]) => [...prev, {
        id: nextId,
        input: code,
        result: { success: false, error: error instanceof Error ? error : new Error(String(error)) },
      }]);
      setNextId((n: number) => n + 1);
    }

    setIsEvaluating(false);
    setInput("");
  }, [repl, nextId, exit]);

  // Global shortcuts (Ctrl+C exit, Ctrl+L clear, ESC cancel)
  // Note: Cmd+K is intercepted by terminal emulator, use Ctrl+L instead
  useInput((char, key) => {
    if (key.ctrl && char === "c") exit();
    if (key.ctrl && char === "l") {
      // Clear terminal first
      clearTerminal();
      // Then clear React state
      setHistory([]);
      setNextId(1);
      setHasBeenCleared(true); // Hide banner after clear
      setClearKey((k: number) => k + 1); // Force full re-render
    }
    // ESC during evaluation: cancel/interrupt (Claude Code behavior)
    if (key.escape && isEvaluating) {
      setIsEvaluating(false);
      // Note: The actual async evaluation may continue in background
      // but UI will be responsive again
    }
  });

  return (
    <Box key={clearKey} flexDirection="column" paddingX={1}>
      {/* Show banner only initially, hide after Ctrl+L clear */}
      {showBanner && !hasBeenCleared && (
        <Banner
          jsMode={repl.jsMode}
          loading={init.loading}
          memoryNames={init.memoryNames}
          aiExports={init.aiExports}
          readyTime={init.readyTime}
          errors={init.errors}
          session={currentSession}
        />
      )}

      {/* History of inputs and outputs */}
      {history.map((entry: HistoryEntry) => (
        <Box key={entry.id} flexDirection="column">
          <Box>
            <Text color={color("primary")} bold>{repl.jsMode ? "js>" : "hql>"} </Text>
            <Text>{entry.input}</Text>
          </Box>
          <Output result={entry.result} />
        </Box>
      ))}

      {/* Session Picker */}
      {showPicker && (
        <SessionPicker
          sessions={pickerSessions}
          currentSessionId={currentSession?.id}
          onSelect={handlePickerSelect}
          onCancel={handlePickerCancel}
        />
      )}

      {/* Config Panel */}
      {showConfigPanel && (
        <ConfigPanel onClose={() => setShowConfigPanel(false)} />
      )}

      {/* Input line (hidden when picker or config panel is open) */}
      {!showPicker && !showConfigPanel && (
        <Input
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          jsMode={repl.jsMode}
          disabled={isEvaluating || init.loading}
          history={stateRef.current.history}
          userBindings={stateRef.current.getBindingsSet()}
          signatures={stateRef.current.getSignatures()}
          docstrings={stateRef.current.getDocstrings()}
        />
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
      return "REPL state reset";
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
