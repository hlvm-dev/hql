import React from "react";
import { useTerminalSize } from "../hooks/useTerminalSize.ts";
import Box from "../ink/components/Box.tsx";
import useInput from "../ink/hooks/use-input.ts";
import TextInput from "../input/TextInput.tsx";
import type {
  PromptInputMode,
  QueuedCommand,
} from "../types/textInputTypes.ts";
import {
  getModeFromInput,
  getValueFromInput,
  isInputModeCharacter,
  prependModeCharacterToInput,
} from "./inputModes.ts";
import { PromptInputFooter } from "./PromptInputFooter.tsx";
import { PromptInputModeIndicator } from "./PromptInputModeIndicator.tsx";
import { PromptInputQueuedCommands } from "./PromptInputQueuedCommands.tsx";
import { PromptInputStashNotice } from "./PromptInputStashNotice.tsx";
import { usePromptInputPlaceholder } from "./usePromptInputPlaceholder.ts";

export type PromptSubmission = {
  mode: PromptInputMode;
  value: string;
};

export type PromptShellState = {
  mode: PromptInputMode;
  queuedCount: number;
  hasStash: boolean;
  historyCount: number;
  inputValue: string;
};

type Props = {
  focus: boolean;
  isLoading?: boolean;
  isSearching: boolean;
  footerLabel?: string;
  onSubmit: (submission: PromptSubmission) => boolean;
  onOpenSearch: () => void;
  onOpenPermission: () => void;
  onStateChange?: (state: PromptShellState) => void;
};

const MAX_VISIBLE_INPUT_LINES = 6;

export function PromptInput({
  focus,
  isLoading = false,
  isSearching,
  footerLabel,
  onSubmit,
  onOpenSearch,
  onOpenPermission,
  onStateChange,
}: Props): React.ReactNode {
  const { columns } = useTerminalSize();
  const inputColumns = Math.max(20, columns - 6);
  const [mode, setMode] = React.useState<PromptInputMode>("prompt");
  const [value, setValue] = React.useState("");
  const [cursorOffset, setCursorOffset] = React.useState(0);
  const [submitCount, setSubmitCount] = React.useState(0);
  const [history, setHistory] = React.useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = React.useState<number | null>(null);
  const [queuedCommands, setQueuedCommands] = React.useState<QueuedCommand[]>(
    [],
  );
  const [stashedInput, setStashedInput] = React.useState<string | null>(null);
  const drainingQueuedCommandIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    onStateChange?.({
      mode,
      queuedCount: queuedCommands.length,
      hasStash: stashedInput !== null,
      historyCount: history.length,
      inputValue: value,
    });
  }, [
    history.length,
    mode,
    onStateChange,
    queuedCommands.length,
    stashedInput,
    value,
  ]);

  const placeholder = usePromptInputPlaceholder({
    input: value,
    mode,
    submitCount,
    queuedCommands,
  });

  const loadSerializedInput = React.useCallback((serialized: string) => {
    const nextMode = getModeFromInput(serialized);
    const nextValue = getValueFromInput(serialized);
    setMode(nextMode);
    setValue(nextValue);
    setCursorOffset(nextValue.length);
    setHistoryIndex(null);
  }, []);

  const clearEditor = React.useCallback(() => {
    setValue("");
    setCursorOffset(0);
    setHistoryIndex(null);
  }, []);

  const cycleMode = React.useCallback(() => {
    setMode((current: PromptInputMode) =>
      current === "prompt" ? "bash" : "prompt"
    );
  }, []);

  const queueCurrentInput = React.useCallback(() => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;

    setQueuedCommands((current) => [
      ...current,
      {
        id: `queued-${Date.now()}-${current.length}`,
        mode,
        value: trimmed,
        createdAt: Date.now(),
      },
    ]);
    clearEditor();
  }, [clearEditor, mode, value]);

  const restoreStashIfPresent = React.useCallback(() => {
    if (!stashedInput) return false;
    loadSerializedInput(stashedInput);
    setStashedInput(null);
    return true;
  }, [loadSerializedInput, stashedInput]);

  const stashOrRestoreInput = React.useCallback(() => {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      setStashedInput(prependModeCharacterToInput(trimmed, mode));
      clearEditor();
      return;
    }

    restoreStashIfPresent();
  }, [clearEditor, mode, restoreStashIfPresent, value]);

  const editQueuedCommand = React.useCallback(() => {
    if (value.length > 0 || queuedCommands.length === 0) {
      return false;
    }

    const queued = queuedCommands.at(-1);
    if (!queued) return false;

    setQueuedCommands((current) => current.slice(0, -1));
    loadSerializedInput(
      prependModeCharacterToInput(
        queued.value,
        queued.mode === "task-notification" ? "prompt" : queued.mode,
      ),
    );
    return true;
  }, [loadSerializedInput, queuedCommands, value.length]);

  const navigateHistory = React.useCallback((direction: -1 | 1) => {
    if (history.length === 0) {
      return false;
    }

    const nextIndex = historyIndex === null
      ? direction < 0 ? 0 : history.length
      : historyIndex + direction;

    if (nextIndex < 0) {
      return false;
    }

    if (nextIndex >= history.length) {
      setHistoryIndex(null);
      clearEditor();
      return true;
    }

    setHistoryIndex(nextIndex);
    loadSerializedInput(history[nextIndex]!);
    return true;
  }, [clearEditor, history, historyIndex, loadSerializedInput]);

  const submitCurrentInput = React.useCallback(() => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return;
    }

    const serialized = prependModeCharacterToInput(trimmed, mode);
    const accepted = onSubmit({ mode, value: trimmed });
    if (!accepted) {
      queueCurrentInput();
      return;
    }

    setHistory((current) => {
      const next = current[0] === serialized
        ? current
        : [serialized, ...current];
      return next.slice(0, 100);
    });
    setSubmitCount((current) => current + 1);
    if (!restoreStashIfPresent()) {
      clearEditor();
    }
  }, [
    clearEditor,
    mode,
    onSubmit,
    queueCurrentInput,
    restoreStashIfPresent,
    value,
  ]);

  React.useEffect(() => {
    if (isLoading) {
      drainingQueuedCommandIdRef.current = null;
      return;
    }

    const nextQueued = queuedCommands[0];
    if (!nextQueued) {
      drainingQueuedCommandIdRef.current = null;
      return;
    }

    if (drainingQueuedCommandIdRef.current === nextQueued.id) {
      return;
    }

    drainingQueuedCommandIdRef.current = nextQueued.id;
    const accepted = onSubmit({
      mode: nextQueued.mode === "task-notification"
        ? "prompt"
        : nextQueued.mode,
      value: nextQueued.value,
    });
    if (!accepted) {
      drainingQueuedCommandIdRef.current = null;
      return;
    }

    setQueuedCommands((current) =>
      current[0]?.id === nextQueued.id ? current.slice(1) : current
    );
    setSubmitCount((current) => current + 1);
  }, [isLoading, onSubmit, queuedCommands]);

  const handleInputChange = React.useCallback((nextValue: string) => {
    setValue(nextValue);
    setHistoryIndex(null);
  }, []);

  const handleHistoryUp = React.useCallback(() => {
    if (editQueuedCommand()) return;
    navigateHistory(-1);
  }, [editQueuedCommand, navigateHistory]);

  const handleHistoryDown = React.useCallback(() => {
    navigateHistory(1);
  }, [navigateHistory]);

  const inputFilter = React.useCallback((input: string, key: {
    ctrl: boolean;
    meta: boolean;
    super: boolean;
    tab: boolean;
    shift: boolean;
  }) => {
    if (
      mode === "prompt" && value.length === 0 && cursorOffset === 0 &&
      input.length > 0 && !key.ctrl && !key.meta && !key.super &&
      isInputModeCharacter(input)
    ) {
      setMode("bash");
      return "";
    }

    if (key.ctrl && ["f", "p", "q", "s"].includes(input.toLowerCase())) {
      return "";
    }

    if (key.tab && key.shift) {
      return "";
    }

    return input;
  }, [cursorOffset, mode, value.length]);

  useInput((input, key, event) => {
    if (!focus || isSearching) {
      return;
    }

    if (key.ctrl && input.toLowerCase() === "f") {
      event.stopImmediatePropagation();
      onOpenSearch();
      return;
    }

    if (key.ctrl && input.toLowerCase() === "p") {
      event.stopImmediatePropagation();
      onOpenPermission();
      return;
    }

    if (key.ctrl && input.toLowerCase() === "q") {
      event.stopImmediatePropagation();
      queueCurrentInput();
      return;
    }

    if (key.ctrl && input.toLowerCase() === "s") {
      event.stopImmediatePropagation();
      stashOrRestoreInput();
      return;
    }

    if (key.tab && key.shift) {
      event.stopImmediatePropagation();
      cycleMode();
      return;
    }
  }, { isActive: focus && !isSearching });

  return (
    <Box flexDirection="column">
      <PromptInputQueuedCommands queuedCommands={queuedCommands} />

      <Box flexDirection="row" alignItems="flex-start">
        <PromptInputModeIndicator mode={mode} isLoading={isLoading} />
        <Box flexGrow={1} flexDirection="column">
          <TextInput
            focus={focus && !isSearching}
            showCursor={true}
            multiline={true}
            value={value}
            onChange={handleInputChange}
            onSubmit={submitCurrentInput}
            onHistoryUp={handleHistoryUp}
            onHistoryDown={handleHistoryDown}
            onHistoryReset={() => setHistoryIndex(null)}
            onClearInput={clearEditor}
            columns={inputColumns}
            maxVisibleLines={MAX_VISIBLE_INPUT_LINES}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            placeholder={placeholder}
            dimColor={isSearching}
            inputFilter={inputFilter}
          />
        </Box>
      </Box>

      <PromptInputStashNotice hasStash={stashedInput !== null} />

      <PromptInputFooter
        mode={mode}
        isLoading={isLoading}
        isSearching={isSearching}
        queuedCount={queuedCommands.length}
        hasStash={stashedInput !== null}
        historyCount={history.length}
        footerLabel={footerLabel}
      />
    </Box>
  );
}
