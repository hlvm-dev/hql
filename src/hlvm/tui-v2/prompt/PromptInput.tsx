import React from "react";
import type { HistoryEntry } from "../../cli/repl/history-storage.ts";
import {
  type AnyAttachment,
  type Attachment,
  cloneAttachments,
  createTextAttachment,
  detectMimeType,
  filterReferencedAttachments,
  getAttachmentType,
  getDisplayName,
  getPastedTextPreviewLabel,
  isAttachment,
  isAutoAttachableConversationAttachmentPath,
  shouldCollapseText,
} from "../../cli/repl/attachment.ts";
import { OPEN_TO_CLOSE } from "../../cli/repl/syntax.ts";
import {
  buildContext as buildCompletionContext,
  findMentionTokenEnd,
  shouldTriggerCommand,
  shouldTriggerFileMention,
} from "../../cli/repl-ink/completion/providers.ts";
import type {
  ApplyResult,
  CompletionAction,
} from "../../cli/repl-ink/completion/types.ts";
import { useCompletion } from "../../cli/repl-ink/completion/useCompletion.ts";
import {
  shouldOpenMentionPickerOnTypedChar,
  shouldProcessComposerAutoTrigger,
} from "../../cli/repl-ink/input-auto-trigger.ts";
import { useAttachments } from "../../cli/repl-ink/hooks/useAttachments.ts";
import { useHistorySearch } from "../../cli/repl-ink/hooks/useHistorySearch.ts";
import {
  getConversationDraftPreview,
} from "../../cli/repl-ink/utils/conversation-queue.ts";
import { resolveCompletionPanelLayout } from "../../cli/repl-ink/utils/completion-layout.ts";
import {
  formatSubmitActionCue,
  resolveSubmitAction,
} from "../../cli/repl-ink/utils/submit-routing.ts";
import { normalizeComparableFilePath } from "../../cli/repl/file-search.ts";
import { isBalanced } from "../../cli/repl/syntax.ts";
import { useTerminalSize } from "../hooks/useTerminalSize.ts";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import useInput from "../ink/hooks/use-input.ts";
import TextInput from "../input/TextInput.tsx";
import { DONOR_INACTIVE } from "../theme/donorTheme.ts";
import type {
  PromptInputMode,
  QueuedCommand,
  TextHighlight,
} from "../types/textInputTypes.ts";
import { CompletionDropdown } from "./CompletionDropdown.tsx";
import { HistorySearchPrompt } from "./HistorySearchPrompt.tsx";
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
  attachments?: AnyAttachment[];
};

export type PromptShellState = {
  mode: PromptInputMode;
  queuedCount: number;
  hasStash: boolean;
  historyCount: number;
  inputValue: string;
};

type Placeholder = {
  start: number;
  length: number;
  text: string;
  touched: boolean;
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
const MAX_HISTORY_ENTRIES = 100;

function createQueuedCommand(
  mode: PromptInputMode,
  value: string,
  attachments: readonly AnyAttachment[],
  cursorOffset: number,
): QueuedCommand {
  return {
    id: `queued-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    mode,
    value,
    createdAt: Date.now(),
    attachments: cloneAttachments(attachments),
    cursorOffset,
  };
}

function attachmentSignature(
  attachments?: readonly AnyAttachment[],
): string {
  return attachments?.map((attachment) =>
    [
      attachment.id,
      "attachmentId" in attachment ? attachment.attachmentId : "",
      attachment.type,
      attachment.displayName,
    ].join(":")
  ).join("\u0001") ?? "";
}

function cloneQueuedCommands(
  commands: readonly QueuedCommand[],
): QueuedCommand[] {
  return commands.map((command) => ({
    ...command,
    attachments: command.attachments?.length
      ? cloneAttachments(command.attachments)
      : undefined,
  }));
}

function buildHistoryEntry(
  serialized: string,
  attachments: readonly AnyAttachment[],
): HistoryEntry {
  return {
    ts: Date.now(),
    cmd: serialized,
    source: "conversation",
    language: "chat",
    attachments: attachments.length > 0
      ? cloneAttachments(attachments)
      : undefined,
  };
}

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
  const [historyEntries, setHistoryEntries] = React.useState<HistoryEntry[]>(
    [],
  );
  const [historyIndex, setHistoryIndex] = React.useState<number | null>(null);
  const [queuedCommands, setQueuedCommands] = React.useState<QueuedCommand[]>(
    [],
  );
  const [stashedInput, setStashedInput] = React.useState<QueuedCommand | null>(
    null,
  );
  const [placeholders, setPlaceholders] = React.useState<Placeholder[]>([]);
  const [placeholderIndex, setPlaceholderIndex] = React.useState(-1);
  const [snippetExitCursor, setSnippetExitCursor] = React.useState<
    number | null
  >(
    null,
  );
  const attachmentState = useAttachments();
  const tempHistoryDraftRef = React.useRef<QueuedCommand | null>(null);
  const drainingQueuedCommandIdRef = React.useRef<string | null>(null);
  const pendingAttachmentOpsRef = React.useRef(0);
  const previousValueRef = React.useRef<string | null>(null);
  const expectedPlaceholderPrefixRef = React.useRef("");
  const previousPlaceholderCountRef = React.useRef(0);

  const emptyBindings = React.useMemo(() => new Set<string>(), []);
  const emptySignatures = React.useMemo(
    () => new Map<string, readonly string[]>(),
    [],
  );
  const emptyDocstrings = React.useMemo(() => new Map<string, string>(), []);
  const attachedPathsSet = React.useMemo(() => {
    const paths = new Set<string>();
    for (const attachment of attachmentState.attachments) {
      if ("path" in attachment) {
        paths.add(normalizeComparableFilePath(attachment.path));
      }
    }
    return paths;
  }, [attachmentState.attachments]);

  const completion = useCompletion({
    userBindings: emptyBindings,
    signatures: emptySignatures,
    docstrings: emptyDocstrings,
    bindingNames: emptyBindings,
    attachedPaths: attachedPathsSet,
    debounceMs: 50,
  });
  const historySearch = useHistorySearch(historyEntries);

  React.useEffect(() => {
    onStateChange?.({
      mode,
      queuedCount: queuedCommands.length,
      hasStash: stashedInput !== null,
      historyCount: historyEntries.length,
      inputValue: value,
    });
  }, [
    historyEntries.length,
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

  const completionPanelLayout = React.useMemo(
    () =>
      resolveCompletionPanelLayout({
        terminalWidth: columns,
        promptPrefixWidth: 2,
        anchorColumn: completion.renderProps?.anchorPosition ?? cursorOffset,
      }),
    [columns, completion.renderProps?.anchorPosition, cursorOffset],
  );

  const clearPlaceholderMode = React.useCallback(() => {
    setPlaceholders([]);
    setPlaceholderIndex(-1);
    setSnippetExitCursor(null);
  }, []);

  const shiftPlaceholders = React.useCallback((
    current: readonly Placeholder[],
    fromIndex: number,
    delta: number,
  ): Placeholder[] =>
    current.map((placeholder, index) =>
      index >= fromIndex
        ? { ...placeholder, start: placeholder.start + delta }
        : placeholder
    ), []);

  const cleanupPlaceholderMode = React.useCallback((
    removeAll = false,
  ): { text: string; cursor: number } => {
    if (placeholders.length === 0) {
      return { text: value, cursor: cursorOffset };
    }

    let nextValue = value;
    let nextCursor = cursorOffset;

    for (let index = placeholders.length - 1; index >= 0; index -= 1) {
      const placeholder = placeholders[index]!;
      if (!removeAll && placeholder.touched) {
        continue;
      }
      const removeStart = placeholder.start > 0 &&
          nextValue[placeholder.start - 1] === " "
        ? placeholder.start - 1
        : placeholder.start;
      const removeEnd = placeholder.start + placeholder.length;
      nextValue = nextValue.slice(0, removeStart) + nextValue.slice(removeEnd);
      if (removeStart < nextCursor) {
        nextCursor -= Math.min(
          nextCursor - removeStart,
          removeEnd - removeStart,
        );
      }
    }

    const exitCursor = snippetExitCursor ?? nextCursor;
    clearPlaceholderMode();
    return {
      text: nextValue,
      cursor: Math.max(0, Math.min(exitCursor, nextValue.length)),
    };
  }, [
    clearPlaceholderMode,
    cursorOffset,
    placeholders,
    snippetExitCursor,
    value,
  ]);

  const loadSerializedInput = React.useCallback((
    serialized: string,
    attachments?: readonly AnyAttachment[],
    nextCursorOffset?: number,
  ) => {
    const nextMode = getModeFromInput(serialized);
    const nextValue = getValueFromInput(serialized);
    setMode(nextMode);
    setValue(nextValue);
    attachmentState.replaceAttachments(cloneAttachments(attachments));
    clearPlaceholderMode();
    setCursorOffset(
      Math.max(
        0,
        Math.min(nextCursorOffset ?? nextValue.length, nextValue.length),
      ),
    );
    setHistoryIndex(null);
  }, [attachmentState, clearPlaceholderMode]);

  const clearEditor = React.useCallback((clearAttachments = true) => {
    setValue("");
    clearPlaceholderMode();
    setCursorOffset(0);
    setHistoryIndex(null);
    if (clearAttachments) {
      attachmentState.clearAttachments();
    }
  }, [attachmentState, clearPlaceholderMode]);

  const cycleMode = React.useCallback(() => {
    clearPlaceholderMode();
    setMode((current: PromptInputMode) =>
      current === "prompt" ? "bash" : "prompt"
    );
  }, [clearPlaceholderMode]);

  const replaceEditor = React.useCallback((
    nextValue: string,
    nextCursorOffset = nextValue.length,
  ) => {
    setValue(nextValue);
    setCursorOffset(
      Math.max(0, Math.min(nextCursorOffset, nextValue.length)),
    );
    setHistoryIndex(null);
  }, []);

  const placeholderModeActive = placeholders.length > 0 &&
    placeholderIndex >= 0;

  const moveToPlaceholder = React.useCallback((index: number) => {
    const nextPlaceholder = placeholders[index];
    if (!nextPlaceholder) return false;
    setPlaceholderIndex(index);
    setCursorOffset(
      nextPlaceholder.touched
        ? nextPlaceholder.start + nextPlaceholder.length
        : nextPlaceholder.start,
    );
    return true;
  }, [placeholders]);

  const nextPlaceholder = React.useCallback(() => {
    if (placeholderIndex < placeholders.length - 1) {
      return moveToPlaceholder(placeholderIndex + 1);
    }
    const cleaned = cleanupPlaceholderMode(false);
    replaceEditor(cleaned.text, cleaned.cursor);
    return false;
  }, [
    cleanupPlaceholderMode,
    moveToPlaceholder,
    placeholderIndex,
    placeholders.length,
    replaceEditor,
  ]);

  const previousPlaceholder = React.useCallback(() => {
    if (placeholderIndex <= 0) {
      return false;
    }
    return moveToPlaceholder(placeholderIndex - 1);
  }, [moveToPlaceholder, placeholderIndex]);

  const enterSnippetSession = React.useCallback((
    tabstops: readonly { start: number; end: number; text: string }[],
    exitCursor: number,
  ) => {
    if (tabstops.length === 0) {
      clearPlaceholderMode();
      return;
    }
    setPlaceholders(tabstops.map((tabstop) => ({
      start: tabstop.start,
      length: Math.max(0, tabstop.end - tabstop.start),
      text: tabstop.text,
      touched: false,
    })));
    setPlaceholderIndex(0);
    setSnippetExitCursor(exitCursor);
    setCursorOffset(tabstops[0]!.start);
  }, [clearPlaceholderMode]);

  const replaceCurrentPlaceholder = React.useCallback((text: string) => {
    const placeholder = placeholders[placeholderIndex];
    if (!placeholder) return false;
    if (
      cursorOffset < placeholder.start ||
      cursorOffset > placeholder.start + placeholder.length
    ) {
      const cleaned = cleanupPlaceholderMode(false);
      replaceEditor(cleaned.text, Math.min(cursorOffset, cleaned.text.length));
      return false;
    }

    if (!placeholder.touched) {
      const nextValue = value.slice(0, placeholder.start) + text +
        value.slice(placeholder.start + placeholder.length);
      const delta = text.length - placeholder.length;
      const updated = [...placeholders];
      updated[placeholderIndex] = {
        ...placeholder,
        length: text.length,
        touched: true,
      };
      setPlaceholders(shiftPlaceholders(updated, placeholderIndex + 1, delta));
      replaceEditor(nextValue, placeholder.start + text.length);
      return true;
    }

    const nextValue = value.slice(0, cursorOffset) + text +
      value.slice(cursorOffset);
    const updated = [...placeholders];
    updated[placeholderIndex] = {
      ...placeholder,
      length: placeholder.length + text.length,
      touched: true,
    };
    setPlaceholders(
      shiftPlaceholders(updated, placeholderIndex + 1, text.length),
    );
    replaceEditor(nextValue, cursorOffset + text.length);
    return true;
  }, [
    cleanupPlaceholderMode,
    cursorOffset,
    placeholderIndex,
    placeholders,
    replaceEditor,
    shiftPlaceholders,
    value,
  ]);

  const replaceCurrentPlaceholderWithPair = React.useCallback(
    (openChar: string) => {
      const closeChar = OPEN_TO_CLOSE[openChar];
      if (!closeChar) {
        return replaceCurrentPlaceholder(openChar);
      }

      const placeholder = placeholders[placeholderIndex];
      if (!placeholder) return false;
      const pair = `${openChar}${closeChar}`;

      if (!placeholder.touched) {
        const nextValue = value.slice(0, placeholder.start) + pair +
          value.slice(placeholder.start + placeholder.length);
        const delta = pair.length - placeholder.length;
        const updated = [...placeholders];
        updated[placeholderIndex] = {
          ...placeholder,
          length: pair.length,
          touched: true,
        };
        setPlaceholders(
          shiftPlaceholders(updated, placeholderIndex + 1, delta),
        );
        replaceEditor(nextValue, placeholder.start + 1);
        return true;
      }

      const nextValue = value.slice(0, cursorOffset) + pair +
        value.slice(cursorOffset);
      const updated = [...placeholders];
      updated[placeholderIndex] = {
        ...placeholder,
        length: placeholder.length + pair.length,
        touched: true,
      };
      setPlaceholders(
        shiftPlaceholders(updated, placeholderIndex + 1, pair.length),
      );
      replaceEditor(nextValue, cursorOffset + 1);
      return true;
    },
    [
      cursorOffset,
      placeholderIndex,
      placeholders,
      replaceCurrentPlaceholder,
      replaceEditor,
      shiftPlaceholders,
      value,
    ],
  );

  const backspaceInPlaceholder = React.useCallback(() => {
    const placeholder = placeholders[placeholderIndex];
    if (!placeholder) return false;
    if (cursorOffset <= placeholder.start || cursorOffset <= 0) {
      return false;
    }

    const nextValue = value.slice(0, cursorOffset - 1) +
      value.slice(cursorOffset);
    const updated = [...placeholders];
    updated[placeholderIndex] = {
      ...placeholder,
      length: Math.max(0, placeholder.length - 1),
      touched: true,
    };
    setPlaceholders(shiftPlaceholders(updated, placeholderIndex + 1, -1));
    replaceEditor(nextValue, cursorOffset - 1);
    return true;
  }, [
    cursorOffset,
    placeholderIndex,
    placeholders,
    replaceEditor,
    shiftPlaceholders,
    value,
  ]);

  const insertTextAtCursor = React.useCallback((text: string) => {
    const nextValue = value.slice(0, cursorOffset) + text +
      value.slice(cursorOffset);
    replaceEditor(nextValue, cursorOffset + text.length);
  }, [cursorOffset, replaceEditor, value]);

  const removeFailedAttachmentDisplayName = React.useCallback((
    displayName: string,
  ) => {
    replaceEditor(
      value.replace(`${displayName} `, "").replace(displayName, ""),
      Math.max(0, Math.min(cursorOffset, value.length)),
    );
  }, [cursorOffset, replaceEditor, value]);

  React.useEffect(() => {
    const nextAttachments = filterReferencedAttachments(
      value,
      attachmentState.attachments,
    );
    const matchesCurrent =
      nextAttachments.length === attachmentState.attachments.length &&
      nextAttachments.every((attachment, index) =>
        attachment.id === attachmentState.attachments[index]?.id
      );
    if (!matchesCurrent) {
      attachmentState.syncAttachments(nextAttachments);
    }
  }, [attachmentState, value]);

  const queueCurrentInput = React.useCallback(() => {
    const trimmed = value.trim();
    const attachments = trimmed.length > 0
      ? filterReferencedAttachments(value, attachmentState.attachments)
      : attachmentState.attachments;
    if (trimmed.length === 0 && attachments.length === 0) return;

    setQueuedCommands((current) => [
      ...current,
      createQueuedCommand(mode, trimmed, attachments, cursorOffset),
    ]);
    clearEditor();
  }, [attachmentState.attachments, clearEditor, cursorOffset, mode, value]);

  const restoreStashIfPresent = React.useCallback(() => {
    if (!stashedInput) return false;
    loadSerializedInput(
      prependModeCharacterToInput(stashedInput.value, stashedInput.mode),
      stashedInput.attachments,
      stashedInput.cursorOffset,
    );
    setStashedInput(null);
    return true;
  }, [loadSerializedInput, stashedInput]);

  const stashOrRestoreInput = React.useCallback(() => {
    const trimmed = value.trim();
    const attachments = trimmed.length > 0
      ? filterReferencedAttachments(value, attachmentState.attachments)
      : attachmentState.attachments;
    if (trimmed.length > 0 || attachments.length > 0) {
      setStashedInput(
        createQueuedCommand(mode, trimmed, attachments, cursorOffset),
      );
      clearEditor();
      return;
    }

    restoreStashIfPresent();
  }, [
    attachmentState.attachments,
    clearEditor,
    cursorOffset,
    mode,
    restoreStashIfPresent,
    value,
  ]);

  const editQueuedCommand = React.useCallback(() => {
    if (
      (value.length > 0 || attachmentState.attachments.length > 0) ||
      queuedCommands.length === 0
    ) {
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
      queued.attachments,
      queued.cursorOffset,
    );
    return true;
  }, [
    attachmentState.attachments.length,
    loadSerializedInput,
    queuedCommands,
    value.length,
  ]);

  const navigateHistory = React.useCallback((direction: -1 | 1) => {
    if (historyEntries.length === 0) {
      return false;
    }

    if (direction < 0) {
      if (historyIndex === null) {
        tempHistoryDraftRef.current = createQueuedCommand(
          mode,
          value,
          attachmentState.attachments,
          cursorOffset,
        );
        const nextIndex = historyEntries.length - 1;
        const entry = historyEntries[nextIndex]!;
        setHistoryIndex(nextIndex);
        loadSerializedInput(
          entry.cmd,
          entry.attachments,
          getValueFromInput(entry.cmd).length,
        );
        return true;
      }
      if (historyIndex > 0) {
        const nextIndex = historyIndex - 1;
        const entry = historyEntries[nextIndex]!;
        setHistoryIndex(nextIndex);
        loadSerializedInput(
          entry.cmd,
          entry.attachments,
          getValueFromInput(entry.cmd).length,
        );
        return true;
      }
      return false;
    }

    if (historyIndex === null) {
      return false;
    }

    if (historyIndex < historyEntries.length - 1) {
      const nextIndex = historyIndex + 1;
      const entry = historyEntries[nextIndex]!;
      setHistoryIndex(nextIndex);
      loadSerializedInput(
        entry.cmd,
        entry.attachments,
        getValueFromInput(entry.cmd).length,
      );
      return true;
    }

    setHistoryIndex(null);
    const draft = tempHistoryDraftRef.current;
    tempHistoryDraftRef.current = null;
    loadSerializedInput(
      prependModeCharacterToInput(draft?.value ?? "", draft?.mode ?? mode),
      draft?.attachments,
      draft?.cursorOffset,
    );
    return true;
  }, [
    attachmentState.attachments,
    cursorOffset,
    historyEntries,
    historyIndex,
    loadSerializedInput,
    mode,
    value,
  ]);

  const submitDraft = React.useCallback((
    nextMode: PromptInputMode,
    nextValue: string,
    attachments: readonly AnyAttachment[],
  ) => {
    const trimmed = nextValue.trim();
    if (trimmed.length === 0 && attachments.length === 0) {
      return false;
    }

    const accepted = onSubmit({
      mode: nextMode,
      value: trimmed,
      attachments: attachments.length > 0
        ? cloneAttachments(attachments)
        : undefined,
    });

    if (!accepted) {
      return false;
    }

    const serialized = prependModeCharacterToInput(trimmed, nextMode);
    setHistoryEntries((current) => {
      const last = current.at(-1);
      if (
        last?.cmd === serialized &&
        attachmentSignature(last.attachments) ===
          attachmentSignature(attachments)
      ) {
        return current;
      }
      const next = [...current, buildHistoryEntry(serialized, attachments)];
      return next.slice(-MAX_HISTORY_ENTRIES);
    });
    setSubmitCount((current) => current + 1);
    if (!restoreStashIfPresent()) {
      clearEditor();
    }
    return true;
  }, [clearEditor, onSubmit, restoreStashIfPresent]);

  const submitCurrentInput = React.useCallback(() => {
    if (pendingAttachmentOpsRef.current > 0) {
      return;
    }
    const attachments = value.trim().length > 0
      ? filterReferencedAttachments(value, attachmentState.attachments)
      : attachmentState.attachments;
    const trimmed = value.trim();

    if (trimmed.length === 0 && attachments.length === 0) {
      return;
    }

    if (mode !== "bash") {
      const submitAction = resolveSubmitAction({
        text: value,
        isBalanced: trimmed.length === 0 || isBalanced(trimmed),
        hasAttachments: attachments.length > 0,
        routeHint: "conversation",
      });
      if (submitAction === "continue-multiline") {
        const nextValue = value.slice(0, cursorOffset) + "\n" +
          value.slice(cursorOffset);
        replaceEditor(nextValue, cursorOffset + 1);
        return;
      }
    }

    const accepted = submitDraft(mode, value, attachments);
    if (!accepted) {
      setQueuedCommands((current) => [
        ...current,
        createQueuedCommand(mode, value.trim(), attachments, cursorOffset),
      ]);
      clearEditor();
    }
  }, [
    attachmentState.attachments,
    clearEditor,
    cursorOffset,
    mode,
    replaceEditor,
    submitDraft,
    value,
  ]);

  const applyCompletionResult = React.useCallback((result: ApplyResult) => {
    if (result.sideEffect?.type === "ADD_ATTACHMENT") {
      const id = attachmentState.reserveNextId();
      const mimeType = detectMimeType(result.sideEffect.path);
      const type = getAttachmentType(mimeType);
      const displayName = getDisplayName(type, id);
      const finalText = result.text.replace("{{ATTACHMENT}}", displayName);
      replaceEditor(
        finalText,
        result.cursorPosition - "{{ATTACHMENT}}".length + displayName.length,
      );
      pendingAttachmentOpsRef.current += 1;
      void attachmentState.addAttachmentWithId(result.sideEffect.path, id).then(
        (attachment) => {
          if (attachment === null) return;
          if (!isAttachment(attachment)) {
            removeFailedAttachmentDisplayName(displayName);
          }
        },
      ).finally(() => {
        pendingAttachmentOpsRef.current = Math.max(
          0,
          pendingAttachmentOpsRef.current - 1,
        );
      });
      return;
    }

    if (result.sideEffect?.type === "ENTER_SNIPPET_SESSION") {
      replaceEditor(result.text, result.cursorPosition);
      enterSnippetSession(
        result.sideEffect.tabstops,
        result.sideEffect.exitCursor,
      );
      completion.close();
      return;
    }

    replaceEditor(result.text, result.cursorPosition);

    if (result.sideEffect?.type === "EXECUTE") {
      queueMicrotask(() => {
        const attachments = result.text.trim().length > 0
          ? filterReferencedAttachments(
            result.text,
            attachmentState.attachments,
          )
          : attachmentState.attachments;
        const accepted = submitDraft("prompt", result.text, attachments);
        if (accepted) {
          clearEditor();
        }
      });
    }
  }, [
    attachmentState,
    clearEditor,
    completion,
    enterSnippetSession,
    replaceEditor,
    removeFailedAttachmentDisplayName,
    submitDraft,
  ]);

  const handlePaste = React.useCallback((text: string) => {
    const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const cleanText = normalizedText.replace(/\\ /g, " ").replace(
      /\\'/g,
      "'",
    ).replace(/\\"/g, '"').trim();
    const isAbsolutePath = cleanText.startsWith("/") ||
      cleanText.startsWith("~");

    if (
      isAbsolutePath &&
      isAutoAttachableConversationAttachmentPath(cleanText)
    ) {
      const id = attachmentState.reserveNextId();
      const mimeType = detectMimeType(cleanText);
      const type = getAttachmentType(mimeType);
      const displayName = getDisplayName(type, id);
      insertTextAtCursor(displayName + " ");
      pendingAttachmentOpsRef.current += 1;
      void attachmentState.addAttachmentWithId(cleanText, id).then(
        (attachment) => {
          if (attachment === null) return;
          if (!isAttachment(attachment)) {
            removeFailedAttachmentDisplayName(displayName);
          }
        },
      ).finally(() => {
        pendingAttachmentOpsRef.current = Math.max(
          0,
          pendingAttachmentOpsRef.current - 1,
        );
      });
      return;
    }

    if (shouldCollapseText(normalizedText)) {
      const id = attachmentState.reserveNextId();
      const displayName = getPastedTextPreviewLabel(id, normalizedText);
      insertTextAtCursor(displayName + " ");
      pendingAttachmentOpsRef.current += 1;
      void attachmentState.addTextAttachmentWithId(normalizedText, id).then((
        attachment,
      ) => {
        if (attachment === null) return;
        if (!attachment || !("attachmentId" in attachment)) {
          removeFailedAttachmentDisplayName(displayName);
        }
      }).finally(() => {
        pendingAttachmentOpsRef.current = Math.max(
          0,
          pendingAttachmentOpsRef.current - 1,
        );
      });
      return;
    }

    insertTextAtCursor(normalizedText);
  }, [attachmentState, insertTextAtCursor, removeFailedAttachmentDisplayName]);

  const handleInputChange = React.useCallback((nextValue: string) => {
    setValue(nextValue);
    setHistoryIndex(null);
  }, []);

  React.useEffect(() => {
    if (placeholders.length === 0) {
      expectedPlaceholderPrefixRef.current = "";
      previousPlaceholderCountRef.current = 0;
      return;
    }

    const firstPlaceholder = placeholders[0]!;
    const lastPlaceholder = placeholders[placeholders.length - 1]!;

    if (previousPlaceholderCountRef.current === 0) {
      expectedPlaceholderPrefixRef.current = value.slice(
        0,
        firstPlaceholder.start,
      );
      previousPlaceholderCountRef.current = placeholders.length;
      return;
    }

    const minRequiredLength = lastPlaceholder.start + lastPlaceholder.length;
    if (value.length < minRequiredLength) {
      clearPlaceholderMode();
      expectedPlaceholderPrefixRef.current = "";
      previousPlaceholderCountRef.current = 0;
      return;
    }

    const currentPrefix = value.slice(0, firstPlaceholder.start);
    if (
      expectedPlaceholderPrefixRef.current &&
      currentPrefix !== expectedPlaceholderPrefixRef.current
    ) {
      clearPlaceholderMode();
      expectedPlaceholderPrefixRef.current = "";
      previousPlaceholderCountRef.current = 0;
      return;
    }

    previousPlaceholderCountRef.current = placeholders.length;
  }, [clearPlaceholderMode, placeholders, value]);

  const handleHistoryUp = React.useCallback(() => {
    if (historySearch.state.isSearching) {
      return;
    }
    if (completion.isVisible) {
      completion.navigateUp();
      return;
    }
    if (editQueuedCommand()) return;
    navigateHistory(-1);
  }, [
    completion,
    editQueuedCommand,
    historySearch.state.isSearching,
    navigateHistory,
  ]);

  const handleHistoryDown = React.useCallback(() => {
    if (historySearch.state.isSearching) {
      return;
    }
    if (completion.isVisible) {
      completion.navigateDown();
      return;
    }
    navigateHistory(1);
  }, [completion, historySearch.state.isSearching, navigateHistory]);

  const confirmHistorySearch = React.useCallback(() => {
    const selected = historySearch.actions.confirm();
    if (!selected) return;
    loadSerializedInput(
      selected.cmd,
      selected.attachments,
      getValueFromInput(selected.cmd).length,
    );
  }, [historySearch.actions, loadSerializedInput]);

  React.useEffect(() => {
    const previousValue = previousValueRef.current;
    previousValueRef.current = value;

    if (historySearch.state.isSearching) {
      completion.close();
      clearPlaceholderMode();
      return;
    }

    const context = buildCompletionContext(
      value,
      cursorOffset,
      emptyBindings,
      emptySignatures,
      emptyDocstrings,
      emptyBindings,
      attachedPathsSet,
    );

    if (
      !shouldProcessComposerAutoTrigger(
        previousValue,
        value,
        completion.isVisible,
      )
    ) {
      return;
    }

    if (completion.isVisible) {
      const textBeforeCursor = value.slice(0, cursorOffset);
      const trimmedBefore = textBeforeCursor.trimStart();
      const lastAt = textBeforeCursor.lastIndexOf("@");
      const afterAt = lastAt >= 0 ? textBeforeCursor.slice(lastAt + 1) : "";
      const isInMention = lastAt >= 0 &&
        !afterAt.includes(" ") && !afterAt.includes("\n");
      const isInCommand = trimmedBefore.startsWith("/") &&
        !trimmedBefore.includes(" ");
      const activeProvider = completion.renderProps?.providerId;
      const shouldAutoClose = context.currentWord.length === 0 &&
        !isInMention &&
        !isInCommand &&
        activeProvider !== "symbol";
      if (shouldAutoClose) {
        completion.close();
        return;
      }
      void completion.triggerCompletion(value, cursorOffset, false);
      return;
    }

    if (shouldTriggerCommand(context)) {
      void completion.triggerCompletion(value, cursorOffset, false);
      return;
    }
  }, [
    attachedPathsSet,
    completion,
    cursorOffset,
    emptyBindings,
    emptyDocstrings,
    emptySignatures,
    clearPlaceholderMode,
    historySearch.state.isSearching,
    value,
  ]);

  const inputFilter = React.useCallback((input: string, key: {
    ctrl: boolean;
    meta: boolean;
    super: boolean;
    tab: boolean;
    shift: boolean;
    escape?: boolean;
    backspace?: boolean;
    delete?: boolean;
    return?: boolean;
  }) => {
    if (
      mode === "prompt" && value.length === 0 && cursorOffset === 0 &&
      input.length > 0 && !key.ctrl && !key.meta && !key.super &&
      isInputModeCharacter(input)
    ) {
      setMode("bash");
      return "";
    }

    if (
      key.ctrl && ["f", "p", "q", "r", "s", "d"].includes(input.toLowerCase())
    ) {
      return "";
    }

    if (placeholderModeActive) {
      if (
        key.escape || key.backspace || key.delete || key.return || key.tab ||
        input === "\t"
      ) {
        return "";
      }
      if (input.length > 0 && !key.ctrl && !key.meta && !key.super) {
        return "";
      }
    }

    if (key.tab || input === "\t") {
      return "";
    }

    return input;
  }, [cursorOffset, mode, placeholderModeActive, value.length]);

  useInput((input, key, event) => {
    if (!focus || isSearching) {
      return;
    }

    const isTabKey = key.tab || input === "\t";

    if (placeholderModeActive) {
      if (key.escape) {
        event.stopImmediatePropagation();
        const cleaned = cleanupPlaceholderMode(false);
        replaceEditor(cleaned.text, cleaned.cursor);
        return;
      }
      if (isTabKey && key.shift) {
        event.stopImmediatePropagation();
        previousPlaceholder();
        return;
      }
      if (isTabKey) {
        event.stopImmediatePropagation();
        nextPlaceholder();
        return;
      }
      if (key.return) {
        event.stopImmediatePropagation();
        const cleaned = cleanupPlaceholderMode(false);
        const referencedAttachments = cleaned.text.trim().length > 0
          ? filterReferencedAttachments(
            cleaned.text,
            attachmentState.attachments,
          )
          : attachmentState.attachments;
        replaceEditor(cleaned.text, cleaned.cursor);
        void submitDraft(mode, cleaned.text, referencedAttachments);
        return;
      }
      if (key.backspace || key.delete) {
        event.stopImmediatePropagation();
        backspaceInPlaceholder();
        return;
      }
      if (input.length > 0 && !key.ctrl && !key.meta && !key.super) {
        event.stopImmediatePropagation();
        if (input === ")") {
          const cleaned = cleanupPlaceholderMode(false);
          replaceEditor(cleaned.text, cleaned.cursor);
          return;
        }
        if (OPEN_TO_CLOSE[input]) {
          replaceCurrentPlaceholderWithPair(input);
          return;
        }
        replaceCurrentPlaceholder(input);
        return;
      }
    }

    if (historySearch.state.isSearching) {
      event.stopImmediatePropagation();
      if (key.escape) {
        historySearch.actions.cancelSearch();
        return;
      }
      if (key.return) {
        confirmHistorySearch();
        return;
      }
      if (key.backspace) {
        historySearch.actions.backspace();
        return;
      }
      if (key.ctrl && input.toLowerCase() === "r") {
        historySearch.actions.selectNext();
        return;
      }
      if (key.ctrl && input.toLowerCase() === "s") {
        historySearch.actions.selectPrev();
        return;
      }
      if (input.length > 0 && !key.ctrl && !key.meta && !key.super) {
        historySearch.actions.appendToQuery(input);
      }
      return;
    }

    if (completion.isVisible) {
      const selected = completion.selectedItem;

      if ((key.ctrl && input.toLowerCase() === "d") || input === "\x04") {
        event.stopImmediatePropagation();
        completion.toggleDocPanel();
        return;
      }
      if (key.upArrow) {
        event.stopImmediatePropagation();
        completion.navigateUp();
        return;
      }
      if (key.downArrow || (isTabKey && !key.shift)) {
        event.stopImmediatePropagation();
        completion.navigateDown();
        return;
      }
      if (key.return) {
        event.stopImmediatePropagation();
        const result = completion.confirmSelected();
        if (result) {
          applyCompletionResult(result);
        }
        return;
      }
      if (key.escape) {
        event.stopImmediatePropagation();
        completion.close();
        return;
      }
      if (key.leftArrow) {
        event.stopImmediatePropagation();
        if (completion.activeProviderId === "file") {
          const textBefore = value.slice(0, cursorOffset);
          const atIndex = textBefore.lastIndexOf("@");
          if (atIndex >= 0) {
            const mentionEnd = findMentionTokenEnd(
              value,
              Math.max(cursorOffset, atIndex + 1),
            );
            const mentionPath = value.slice(atIndex + 1, mentionEnd);
            const trimmedMentionPath = mentionPath.endsWith("/")
              ? mentionPath.slice(0, -1)
              : mentionPath;
            const lastSlashIndex = trimmedMentionPath.lastIndexOf("/");

            if (lastSlashIndex >= 0) {
              const parentPath = `@${
                trimmedMentionPath.slice(0, lastSlashIndex + 1)
              }`;
              const nextValue = value.slice(0, atIndex) + parentPath +
                value.slice(mentionEnd);
              replaceEditor(nextValue, atIndex + parentPath.length);
              void completion.triggerCompletion(
                nextValue,
                atIndex + parentPath.length,
                true,
              );
              return;
            }
          }
        }
        completion.close();
        if (cursorOffset > 0) {
          setCursorOffset(cursorOffset - 1);
        }
        return;
      }
      if (key.rightArrow) {
        event.stopImmediatePropagation();
        if (completion.activeProviderId !== "file" || !selected) {
          completion.close();
          if (cursorOffset < value.length) {
            setCursorOffset(cursorOffset + 1);
          }
          return;
        }
        const context = completion.getApplyContext();
        if (!context) {
          completion.close();
          return;
        }
        if (selected.availableActions.includes("DRILL")) {
          const drillResult = selected.applyAction("DRILL", context);
          applyCompletionResult(drillResult);
          void completion.triggerCompletion(
            drillResult.text,
            drillResult.cursorPosition,
            true,
          );
        } else {
          const result = completion.confirmSelected();
          if (result) {
            applyCompletionResult(result);
          }
        }
        return;
      }
      if (isTabKey && key.shift) {
        event.stopImmediatePropagation();
        const context = completion.getApplyContext();
        if (!context || !selected) {
          completion.close();
          return;
        }
        if (selected.availableActions.includes("DRILL")) {
          const drillResult = selected.applyAction("DRILL", context);
          applyCompletionResult(drillResult);
          void completion.triggerCompletion(
            drillResult.text,
            drillResult.cursorPosition,
            true,
          );
          return;
        }
        completion.close();
        return;
      }
    }

    if (key.ctrl && input.toLowerCase() === "f") {
      event.stopImmediatePropagation();
      clearPlaceholderMode();
      onOpenSearch();
      return;
    }

    if (key.ctrl && input.toLowerCase() === "p") {
      event.stopImmediatePropagation();
      clearPlaceholderMode();
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

    if (key.ctrl && input.toLowerCase() === "r") {
      event.stopImmediatePropagation();
      clearPlaceholderMode();
      historySearch.actions.startSearch();
      return;
    }

    if (
      input === "@" &&
      !key.ctrl &&
      !key.meta &&
      !key.super &&
      mode === "prompt"
    ) {
      const nextValue = value.slice(0, cursorOffset) + "@" +
        value.slice(cursorOffset);
      const nextCursorOffset = cursorOffset + 1;
      const nextContext = buildCompletionContext(
        nextValue,
        nextCursorOffset,
        emptyBindings,
        emptySignatures,
        emptyDocstrings,
        emptyBindings,
        attachedPathsSet,
      );
      if (
        shouldOpenMentionPickerOnTypedChar(
          "@",
          completion.isVisible,
          nextContext.isInsideString,
          nextContext,
        ) &&
        shouldTriggerFileMention(nextContext)
      ) {
        queueMicrotask(() => {
          void completion.triggerCompletion(
            nextValue,
            nextCursorOffset,
            false,
          );
        });
      }
    }

    if (isTabKey && key.shift) {
      event.stopImmediatePropagation();
      cycleMode();
      return;
    }

    if (isTabKey) {
      event.stopImmediatePropagation();
      void completion.triggerCompletion(value, cursorOffset, true);
      return;
    }
  }, { isActive: focus && !isSearching });

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
    const accepted = submitDraft(
      nextQueued.mode === "task-notification" ? "prompt" : nextQueued.mode,
      nextQueued.value,
      nextQueued.attachments ?? [],
    );
    if (!accepted) {
      drainingQueuedCommandIdRef.current = null;
      return;
    }

    setQueuedCommands((current) =>
      current[0]?.id === nextQueued.id ? current.slice(1) : current
    );
  }, [isLoading, queuedCommands, submitDraft]);

  const visibleAttachments = attachmentState.attachments;
  const submitActionCue = React.useMemo(() => {
    if (mode === "bash") {
      return formatSubmitActionCue("run-command");
    }

    const trimmed = value.trim();
    const submitAction = resolveSubmitAction({
      text: value,
      isBalanced: trimmed.length === 0 || isBalanced(trimmed),
      hasAttachments: visibleAttachments.length > 0,
      routeHint: "conversation",
    });

    return formatSubmitActionCue(submitAction, "conversation");
  }, [mode, value, visibleAttachments.length]);
  const inputHighlights = React.useMemo<TextHighlight[] | undefined>(() => {
    if (!placeholderModeActive) {
      return undefined;
    }
    const highlights = placeholders
      .filter((placeholder) => placeholder.length > 0)
      .map((placeholder, index) => ({
        start: placeholder.start,
        end: placeholder.start + placeholder.length,
        color: index === placeholderIndex ? "white" : DONOR_INACTIVE,
        dimColor: index !== placeholderIndex,
        inverse: index === placeholderIndex,
        priority: index === placeholderIndex ? 3 : 2,
      }));
    return highlights.length > 0 ? highlights : undefined;
  }, [placeholderIndex, placeholderModeActive, placeholders]);
  const resolvedFooterLabel = placeholderModeActive
    ? `snippet ${
      placeholderIndex + 1
    }/${placeholders.length} · Tab next · Shift+Tab prev · Enter send`
    : footerLabel ?? submitActionCue;

  return (
    <Box flexDirection="column">
      <PromptInputQueuedCommands queuedCommands={queuedCommands} />

      {attachmentState.lastError && (
        <Box marginBottom={1}>
          <Text color="red">⚠ {attachmentState.lastError.message}</Text>
        </Box>
      )}

      {visibleAttachments.length > 0 && (
        <Box marginBottom={1} flexDirection="column" paddingLeft={2}>
          {visibleAttachments.slice(0, 4).map((attachment) => (
            <Text
              key={`${attachment.id}:${attachment.displayName}`}
              color={DONOR_INACTIVE}
            >
              {attachment.displayName}
            </Text>
          ))}
          {visibleAttachments.length > 4 && (
            <Text color={DONOR_INACTIVE}>
              +{visibleAttachments.length - 4} more attachments
            </Text>
          )}
        </Box>
      )}

      <Box flexDirection="row" alignItems="flex-start">
        <PromptInputModeIndicator mode={mode} isLoading={isLoading} />
        <Box flexGrow={1} flexDirection="column">
          <TextInput
            focus={focus && !isSearching && !historySearch.state.isSearching}
            showCursor={true}
            multiline={true}
            value={value}
            onChange={handleInputChange}
            onSubmit={submitCurrentInput}
            onHistoryUp={handleHistoryUp}
            onHistoryDown={handleHistoryDown}
            onHistoryReset={() => setHistoryIndex(null)}
            onClearInput={() => clearEditor(true)}
            onPaste={handlePaste}
            columns={inputColumns}
            maxVisibleLines={MAX_VISIBLE_INPUT_LINES}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            placeholder={placeholder}
            dimColor={isSearching}
            inputFilter={inputFilter}
            disableCursorMovementForUpDownKeys={completion.isVisible}
            highlights={inputHighlights}
          />
        </Box>
      </Box>

      <PromptInputStashNotice hasStash={stashedInput !== null} />

      <HistorySearchPrompt state={historySearch.state} />

      {completion.renderProps && (
        <CompletionDropdown
          items={completion.renderProps.items}
          selectedIndex={completion.renderProps.selectedIndex}
          helpText={completion.renderProps.helpText}
          isLoading={completion.renderProps.isLoading}
          providerId={completion.renderProps.providerId}
          marginLeft={completionPanelLayout.marginLeft}
          width={completionPanelLayout.maxWidth}
          showDocPanel={completion.renderProps.showDocPanel}
        />
      )}

      <PromptInputFooter
        mode={mode}
        isLoading={isLoading}
        isSearching={isSearching || historySearch.state.isSearching}
        queuedCount={queuedCommands.length}
        hasStash={stashedInput !== null}
        historyCount={historyEntries.length}
        footerLabel={resolvedFooterLabel}
      />
    </Box>
  );
}

function resultCursor(
  item: {
    applyAction: (
      action: CompletionAction,
      context: { text: string; cursorPosition: number; anchorPosition: number },
    ) => ApplyResult;
  },
  context: { text: string; cursorPosition: number; anchorPosition: number },
): number {
  const result = item.applyAction("DRILL", context);
  return result.cursorPosition;
}
