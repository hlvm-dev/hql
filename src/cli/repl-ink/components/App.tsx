/**
 * HQL Ink REPL - Main App
 * Full-featured REPL with rich banner, keyboard shortcuts, completions
 */

import React, { useState, useCallback, useRef } from "npm:react@18";
import { Box, Text, useInput, useApp } from "npm:ink@5";
import { Input } from "./Input.tsx";
import { Output } from "./Output.tsx";
import { Banner } from "./Banner.tsx";
import { useRepl } from "../hooks/useRepl.ts";
import { useInitialization } from "../hooks/useInitialization.ts";
import type { EvalResult } from "../types.ts";
import { ReplState } from "../../repl/state.ts";
import { clearTerminal } from "../../ansi.ts";

interface HistoryEntry {
  id: number;
  input: string;
  result: EvalResult;
}

interface AppProps {
  jsMode?: boolean;
  showBanner?: boolean;
}

export function App({ jsMode: initialJsMode = false, showBanner = true }: AppProps): React.ReactElement {
  const { exit } = useApp();

  // Create shared ReplState for both initialization and evaluation
  const stateRef = useRef<ReplState>(new ReplState());
  const repl = useRepl({ jsMode: initialJsMode, state: stateRef.current });

  // Initialize: runtime, memory, AI
  const init = useInitialization(stateRef.current, initialJsMode);

  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [nextId, setNextId] = useState(1);
  const [clearKey, setClearKey] = useState(0); // Force re-render on clear

  const handleSubmit = useCallback(async (code: string) => {
    if (!code.trim()) return;
    setIsEvaluating(true);

    // Commands
    if (code.startsWith(".")) {
      const output = handleCommand(code, repl, exit);
      if (output !== null) {
        setHistory((prev: HistoryEntry[]) => [...prev, { id: nextId, input: code, result: { success: true, value: output } }]);
        setNextId((n: number) => n + 1);
      }
      setIsEvaluating(false);
      setInput("");
      return;
    }

    // Evaluate
    try {
      const result = await repl.evaluate(code);
      setHistory((prev: HistoryEntry[]) => [...prev, { id: nextId, input: code, result }]);
      setNextId((n: number) => n + 1);
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

  // Global shortcuts (Ctrl+C exit, Ctrl+L clear)
  // Note: Cmd+K is intercepted by terminal emulator, use Ctrl+L instead
  useInput((char, key) => {
    if (key.ctrl && char === "c") exit();
    if (key.ctrl && char === "l") {
      // Clear terminal first
      clearTerminal();
      // Then clear React state
      setHistory([]);
      setNextId(1);
      setClearKey(k => k + 1); // Force full re-render
    }
  });

  return (
    <Box key={clearKey} flexDirection="column" paddingX={1}>
      {/* Always show banner (not just when history.length === 0) */}
      {showBanner && (
        <Banner
          jsMode={repl.jsMode}
          loading={init.loading}
          memoryNames={init.memoryNames}
          aiExports={init.aiExports}
          readyTime={init.readyTime}
          errors={init.errors}
        />
      )}

      {/* History of inputs and outputs */}
      {history.map((entry: HistoryEntry) => (
        <Box key={entry.id} flexDirection="column" marginBottom={1}>
          <Box>
            <Text color="#663399" bold>{repl.jsMode ? "js>" : "hql>"} </Text>
            <Text>{entry.input}</Text>
          </Box>
          <Output result={entry.result} />
        </Box>
      ))}

      {/* Input line */}
      <Input
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        jsMode={repl.jsMode}
        disabled={isEvaluating || init.loading}
        history={stateRef.current.history}
        userBindings={new Set(stateRef.current.getBindings())}
        signatures={stateRef.current.getSignatures()}
      />

      {isEvaluating && <Text dimColor>...</Text>}
    </Box>
  );
}

function handleCommand(cmd: string, repl: ReturnType<typeof useRepl>, exit: () => void): string | null {
  switch (cmd.trim().toLowerCase()) {
    case ".help": return ".help .clear .reset .js .hql .exit";
    case ".clear": return null;
    case ".reset": repl.reset(); return "reset";
    case ".js": repl.setJsMode(true); return "js mode";
    case ".hql": repl.setJsMode(false); return "hql mode";
    case ".exit": case ".quit": exit(); return null;
    default: return `unknown: ${cmd}`;
  }
}
