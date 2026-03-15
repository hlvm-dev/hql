/**
 * HLVM Ink REPL - Input Component
 * Full keyboard handling with syntax highlighting, completions, history
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Text, useInput, useStdout } from "ink";
import {
  AUTO_PAIR_CHARS,
  backwardSexp,
  backwardUpSexp,
  deleteBackWithPairSupport,
  findMatchingParen,
  forwardDownSexp,
  forwardSexp,
  highlight,
  isBalanced,
  isInsideEmptyQuotePair,
  isInsideString,
  OPEN_TO_CLOSE,
} from "../../repl/syntax.ts";
import {
  barfBackward,
  barfForward,
  killSexp,
  type PareditResult,
  raiseSexp,
  slurpBackward,
  slurpForward,
  spliceSexp,
  transposeSexp,
  wrapSexp,
} from "../../repl/paredit.ts";
import {
  findSuggestion,
  resolveSuggestionValue,
  type Suggestion,
} from "../../repl/suggester.ts";
import {
  calculateWordBackPosition,
  calculateWordForwardPosition,
} from "../../repl/keyboard.ts";
import {
  detectMimeType,
  getAttachmentType,
  getDisplayName,
  isSupportedConversationMedia,
  shouldCollapseText,
} from "../../repl/attachment.ts";
import { type AnyAttachment, useAttachments } from "../hooks/useAttachments.ts";
import { useHistorySearch } from "../hooks/useHistorySearch.ts";
import { HistorySearchPrompt } from "./HistorySearchPrompt.tsx";
import { ANSI_COLORS, getThemedAnsi } from "../../ansi.ts";
import { useTheme } from "../../theme/index.ts";
import type {
  ConversationComposerDraft,
  ConversationQueueEditBinding,
} from "../utils/conversation-queue.ts";
import {
  createConversationComposerDraft,
  trimConversationDraftText,
} from "../utils/conversation-queue.ts";

// Unified Completion System
import {
  ATTACHMENT_PLACEHOLDER,
  buildContext as buildCompletionContext,
  type CompletionAction,
  type CompletionItem,
  Dropdown,
  extractMentionQuery,
  getWordAtCursor,
  shouldTriggerCommand,
  shouldTriggerFileMention,
  useCompletion,
} from "../completion/index.ts";
import { MAX_VISIBLE_ITEMS } from "../completion/types.ts";

// FRP Context - reactive state
import { useReplContext } from "../context/index.ts";
import { deleteWordPreservingDelimiters } from "../utils/text-editing.ts";

// Handler Registry - for palette/keybinding execution
import {
  executeHandler,
  HandlerIds,
  inspectHandlerKeybinding,
  registerHandler,
  unregisterHandler,
} from "../keybindings/index.ts";

// Helper: apply a paredit operation and return new value/cursor
// Shared by handler registry, useInput, and Option+key handler
type PareditFn = (input: string, pos: number) => PareditResult | null;

// ESC disambiguation timeout:
// Some terminals send Option/Alt chords as ESC-prefixed sequences (ESC + key).
// Delay pure ESC handling briefly so modified chords (e.g., Option+Enter) are not swallowed.
const ESC_SEQUENCE_TIMEOUT_MS = 120;
const INPUT_KEYBINDING_CATEGORIES = [
  "Editing",
  "Navigation",
  "Completion",
  "History",
  "Paredit",
] as const;
const COMPOSER_KEYBINDING_CATEGORIES = ["Composer"] as const;

// Paste detection: only buffer when we have definite paste indicators
// Multi-char input or newlines START buffering
// Rapid input CONTINUES buffering for char-by-char pastes
// Single char typing is ALWAYS immediate (never buffered)
//
// Two thresholds for different purposes:
// - CONTINUE: Detect if input is part of ongoing paste (char-by-char paste detection)
// - PROCESS_DELAY: Wait for more chunks before processing (terminal paste timing varies)
const PASTE_CONTINUE_THRESHOLD_MS = 100; // Char-by-char paste arrives < 100ms apart (increased for slow terminals)
const PASTE_PROCESS_DELAY_MS = 300; // Wait 300ms for more chunks before processing (increased for slow terminals)
const CTRL_ENTER_CSI_U_REGEX = new RegExp("^\u001b\\[13;(\\d+)u$");
const CTRL_ENTER_LEGACY_REGEX = new RegExp("^\u001b\\[27;(\\d+);13~$");

// ANSI Reset constant
const { RESET } = ANSI_COLORS;

// Fast newline check - avoids regex compilation on every keystroke
function hasNewlineChars(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    if (ch === 10 || ch === 13) return true; // \n or \r
  }
  return false;
}

// Placeholder for function parameter completion
interface Placeholder {
  start: number; // Position in value string
  length: number; // Current length of placeholder text
  text: string; // Original param name (e.g., "x")
  touched: boolean; // Has user typed in this placeholder?
}

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string, attachments?: AnyAttachment[]) => void;
  /** Force-submit: abort current agent and send immediately (Ctrl+Enter) */
  onForceSubmit?: (value: string, attachments?: AnyAttachment[]) => void;
  /** Interrupt the currently running chat task (Esc) */
  onInterruptRunningTask?: () => void;
  /** Queue the current chat draft without sending it immediately */
  onQueueDraft?: (draft: ConversationComposerDraft) => void;
  /** Restore the most recently queued draft into the composer */
  onEditLastQueuedDraft?: () => void;
  /** Active binding for edit-last-queued-draft */
  queueEditBinding?: ConversationQueueEditBinding;
  /** Whether a queued draft exists to restore */
  canEditQueuedDraft?: boolean;
  /** Whether the conversation task is currently running */
  isConversationTaskRunning?: boolean;
  /** Notify parent when attachment state changes */
  onAttachmentsChange?: (attachments: AnyAttachment[]) => void;
  /** Restore attachment state from an external draft snapshot */
  restoredAttachments?: AnyAttachment[];
  /** Cursor position to restore alongside restoredAttachments */
  restoredCursorOffset?: number;
  /** Monotonic token to apply restored draft state exactly once per restore */
  restoredDraftRevision?: number;
  onCycleMode?: () => void;
  disabled?: boolean;
  /** "chat" disables code token coloring for natural-language turns */
  highlightMode?: "code" | "chat";
  /** Override first-line prompt label (e.g. "answer>") */
  promptLabel?: string;
  // FRP: history, bindings, signatures, docstrings now come from ReplContext
}

function shouldApplyRestoredDraft(
  lastAppliedRevision: number | null,
  restoredDraftRevision?: number,
): restoredDraftRevision is number {
  return restoredDraftRevision != null &&
    restoredDraftRevision !== lastAppliedRevision;
}

function getInputPromptPrefix(
  promptLabel: string,
  lineIndex: number,
): string {
  const prompt = lineIndex === 0 ? promptLabel : " ".repeat(promptLabel.length);
  return `${prompt} `;
}

export interface EscapeKeyInfo {
  escape?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  return?: boolean;
}

export function isPureEscKeyEvent(input: string, key: EscapeKeyInfo): boolean {
  return !!key.escape &&
    !key.ctrl &&
    !key.meta &&
    !key.return &&
    (!input || input.length === 0 || input === "\x1b");
}

export function shouldInterruptConversationOnEsc(
  input: string,
  key: EscapeKeyInfo,
  options: {
    highlightMode: "code" | "chat";
    isConversationTaskRunning: boolean;
    hasInterruptHandler: boolean;
  },
): boolean {
  return options.highlightMode === "chat" &&
    options.isConversationTaskRunning &&
    options.hasInterruptHandler &&
    isPureEscKeyEvent(input, key);
}

export function Input({
  value,
  onChange,
  onSubmit,
  onForceSubmit,
  onInterruptRunningTask,
  onQueueDraft,
  onEditLastQueuedDraft,
  queueEditBinding = "alt-up",
  canEditQueuedDraft = false,
  isConversationTaskRunning = false,
  onAttachmentsChange,
  restoredAttachments,
  restoredCursorOffset,
  restoredDraftRevision,
  onCycleMode,
  disabled = false,
  highlightMode = "code",
  promptLabel = "hlvm>",
}: InputProps): React.ReactElement {
  // FRP: Get all reactive state from context
  const {
    bindings: userBindings,
    signatures,
    docstrings,
    history,
    bindingNames,
  } = useReplContext();
  const [cursorPos, setCursorPos] = useState(value.length);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState("");

  // Theme from context
  const { color } = useTheme();
  const { stdout } = useStdout();

  // Autosuggestion (ghost text - separate from completion)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  // Memoize bindingNames Set to avoid recreation on every render
  const bindingNamesSet = useMemo(() => new Set(bindingNames), [bindingNames]);

  // Unified Completion System (replaces legacy completion + @mention state)
  // Includes bindingNames for context-aware completions (e.g., unbind only shows binding items)
  const completion = useCompletion({
    userBindings,
    signatures,
    docstrings,
    bindingNames: bindingNamesSet,
    debounceMs: 50,
  });

  // Ctrl+R History Search
  const historySearch = useHistorySearch(history);

  // Attachment management
  const {
    attachments,
    addAttachmentWithId,
    addTextAttachment,
    replaceAttachments,
    reserveNextId,
    clearAttachments,
    lastError: attachmentError,
  } = useAttachments();

  // Placeholder mode state for function parameter completion
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [placeholderIndex, setPlaceholderIndex] = useState(-1);

  // Paste detection: buffer rapid inputs and process together
  const pasteBufferRef = useRef<string>("");
  const pasteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInputTimeRef = useRef<number>(0);

  // Undo/redo stacks (refs to avoid re-render on push)
  const undoStackRef = useRef<Array<{ value: string; cursorPos: number }>>([]);
  const redoStackRef = useRef<Array<{ value: string; cursorPos: number }>>([]);
  // Async operation guards
  const pendingAttachmentOpsRef = useRef(0);
  const escSequenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastEscPrefixAtRef = useRef(0);
  const appliedRestoreRevisionRef = useRef<number | null>(null);

  // Track if text change was from cycling (Up/Down) vs typing
  // When cycling, we don't want to re-filter the dropdown
  const textChangeFromCyclingRef = useRef(false);

  // Ref for disabled prop to avoid stale closure in useInput
  const disabledRef = useRef(disabled);

  // Sync disabled ref to avoid stale closure in useInput
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    onAttachmentsChange?.(attachments);
  }, [attachments, onAttachmentsChange]);

  useEffect(() => {
    if (
      !shouldApplyRestoredDraft(
        appliedRestoreRevisionRef.current,
        restoredDraftRevision,
      )
    ) {
      return;
    }
    appliedRestoreRevisionRef.current = restoredDraftRevision;
    pendingAttachmentOpsRef.current = 0;
    replaceAttachments(restoredAttachments ?? []);
    setCursorPos(
      Math.max(
        0,
        Math.min(restoredCursorOffset ?? value.length, value.length),
      ),
    );
  }, [
    replaceAttachments,
    restoredAttachments,
    restoredCursorOffset,
    restoredDraftRevision,
    value.length,
  ]);

  // Update cursor pos when value changes externally
  useEffect(() => {
    if (cursorPos > value.length) {
      setCursorPos(value.length);
    }
  }, [value, cursorPos]);

  // Track expected prefix (text before first placeholder) to detect external changes
  const expectedPrefixRef = useRef<string>("");
  const prevPlaceholdersLengthRef = useRef<number>(0);

  // Validate placeholder state when value changes
  // Exit placeholder mode if placeholders become invalid (text deleted, etc.)
  useEffect(() => {
    if (placeholders.length > 0) {
      const firstPh = placeholders[0];
      const lastPh = placeholders[placeholders.length - 1];

      // Initialize expected prefix when ENTERING placeholder mode (placeholders went from 0 to >0)
      if (prevPlaceholdersLengthRef.current === 0) {
        expectedPrefixRef.current = value.slice(0, firstPh.start);
        prevPlaceholdersLengthRef.current = placeholders.length;
        return; // Don't validate on first run
      }

      // Check 1: Value too short for placeholders
      const minRequiredLength = lastPh.start + lastPh.length;
      if (value.length < minRequiredLength) {
        setPlaceholders([]);
        setPlaceholderIndex(-1);
        expectedPrefixRef.current = "";
        prevPlaceholdersLengthRef.current = 0;
        return;
      }

      // Check 2: Prefix (function name area) changed unexpectedly
      // This catches cases like Ctrl+W, paste, or other external modifications
      const currentPrefix = value.slice(0, firstPh.start);
      if (
        expectedPrefixRef.current && currentPrefix !== expectedPrefixRef.current
      ) {
        // Function name was modified externally - exit placeholder mode
        // Note: We can't remove placeholder text here (would cause infinite loop)
        // But the placeholder positions are now invalid anyway
        setPlaceholders([]);
        setPlaceholderIndex(-1);
        expectedPrefixRef.current = "";
        prevPlaceholdersLengthRef.current = 0;
        return;
      }

      prevPlaceholdersLengthRef.current = placeholders.length;
    } else {
      // Clear when exiting placeholder mode
      expectedPrefixRef.current = "";
      prevPlaceholdersLengthRef.current = 0;
    }
  }, [value, placeholders]);

  // Update suggestion when value changes
  useEffect(() => {
    // Don't show ghost text suggestion when completion dropdown is visible
    if (
      cursorPos === value.length && value.length > 0 && !completion.isVisible
    ) {
      const found = findSuggestion(value, history, userBindings);
      setSuggestion(found);
    } else {
      setSuggestion(null);
    }
  }, [value, cursorPos, history, userBindings, completion.isVisible]);

  // Cleanup paste timeout on unmount
  useEffect(() => {
    return () => {
      if (pasteTimeoutRef.current) {
        clearTimeout(pasteTimeoutRef.current);
      }
      if (escSequenceTimerRef.current) {
        clearTimeout(escSequenceTimerRef.current);
      }
    };
  }, []);

  // FIX H2: Reset textChangeFromCyclingRef when completion dropdown closes
  // This ensures completion re-triggers after cycling then cancel
  useEffect(() => {
    if (!completion.isVisible) {
      textChangeFromCyclingRef.current = false;
    }
  }, [completion.isVisible]);

  // NOTE: Placeholder validation is handled by explicit exit paths (Escape, backspace, character input)
  // which now cleanup untouched placeholders. No need for useEffect validation.

  // Auto-trigger completion for @mention and /command
  // KEY FIX: Skip during active session to allow Tab cycling without interference
  // NOTE: We use refs/stable callbacks to avoid infinite loops from state changes
  const triggerCompletionRef = useRef(completion.triggerCompletion);
  triggerCompletionRef.current = completion.triggerCompletion;

  useEffect(() => {
    // FIX H3: Don't trigger completion during history search
    if (historySearch.state.isSearching) return;

    // Skip re-trigger if text changed due to Up/Down cycling
    if (textChangeFromCyclingRef.current) {
      textChangeFromCyclingRef.current = false;
      return;
    }

    // Don't auto-trigger in placeholder mode (user is filling in arguments)
    if (placeholders.length > 0 && placeholderIndex >= 0) {
      return;
    }

    const textBefore = value.slice(0, cursorPos);
    const inString = isInsideString(value, cursorPos, '"') ||
      isInsideString(value, cursorPos, "'");

    if (inString) {
      if (completion.isVisible) {
        completion.close();
      }
      return;
    }

    const { word } = getWordAtCursor(textBefore, cursorPos);
    const trimmedBefore = textBefore.trimStart();
    const lastAt = textBefore.lastIndexOf("@");
    const isInMention = lastAt >= 0 &&
      !textBefore.slice(lastAt + 1).includes(" ");
    const isInCommand = trimmedBefore.startsWith("/") &&
      !trimmedBefore.includes(" ");

    // GENERIC: Re-trigger for ANY provider when dropdown is already open (live filtering).
    // IMPORTANT: symbol provider intentionally supports empty/whitespace contexts on explicit Tab.
    // Do not auto-close symbol dropdown when word.length === 0.
    if (completion.isVisible) {
      const activeProvider = completion.renderProps?.providerId;
      const shouldAutoClose = word.length === 0 &&
        !isInMention &&
        !isInCommand &&
        activeProvider !== "symbol";
      if (shouldAutoClose) {
        completion.close();
        return;
      }
      triggerCompletionRef.current(value, cursorPos);
      return;
    }

    const completionContext = buildCompletionContext(
      value,
      cursorPos,
      userBindings,
      signatures,
      docstrings,
      bindingNamesSet,
    );

    // @mention auto-trigger uses provider SSOT trigger/query rules.
    if (
      shouldTriggerFileMention(completionContext) &&
      extractMentionQuery(completionContext) !== null
    ) {
      triggerCompletionRef.current(value, cursorPos);
      return;
    }

    // /command auto-trigger uses provider SSOT trigger rules.
    if (shouldTriggerCommand(completionContext)) {
      triggerCompletionRef.current(value, cursorPos);
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    value,
    cursorPos,
    historySearch.state.isSearching,
    placeholders,
    placeholderIndex,
    userBindings,
    signatures,
    docstrings,
    bindingNamesSet,
  ]);

  // Helper: check if in placeholder mode
  const isInPlaceholderMode = useCallback(() => {
    return placeholders.length > 0 && placeholderIndex >= 0;
  }, [placeholders, placeholderIndex]);

  // FIX M4: Helper to safely get current placeholder with bounds check
  const getCurrentPlaceholder = useCallback((): Placeholder | null => {
    if (placeholderIndex < 0 || placeholderIndex >= placeholders.length) {
      return null;
    }
    return placeholders[placeholderIndex];
  }, [placeholders, placeholderIndex]);

  // Helper: exit placeholder mode
  const exitPlaceholderMode = useCallback(() => {
    setPlaceholders([]);
    setPlaceholderIndex(-1);
  }, []);

  // Helper: exit placeholder mode AND remove untouched placeholders from value
  // Called when user types ')' or other exit-triggering characters
  const exitPlaceholderModeAndCleanup = useCallback(
    (removeAll: boolean = false) => {
      if (placeholders.length === 0) {
        exitPlaceholderMode();
        return value;
      }

      // Remove placeholders from the value (from end to start to preserve indices)
      // If removeAll=true, remove ALL placeholders (when deleting function name)
      // If removeAll=false, only remove untouched placeholders (normal exit)
      let newValue = value;
      let adjustment = 0;

      // Process placeholders in reverse order to maintain correct indices
      for (let i = placeholders.length - 1; i >= 0; i--) {
        const ph = placeholders[i];
        // Remove if: removeAll is true, OR placeholder is untouched
        if (removeAll || !ph.touched) {
          // Remove this placeholder (and preceding space if exists)
          const removeStart = ph.start > 0 && newValue[ph.start - 1] === " "
            ? ph.start - 1
            : ph.start;
          const removeEnd = ph.start + ph.length;
          newValue = newValue.slice(0, removeStart) + newValue.slice(removeEnd);
          if (i <= placeholderIndex) {
            adjustment += removeEnd - removeStart;
          }
        }
      }

      exitPlaceholderMode();
      return newValue;
    },
    [value, placeholders, placeholderIndex, exitPlaceholderMode],
  );

  // Helper: enter placeholder mode after completing a function
  // FIX C2: Close completion dropdown when entering placeholder mode
  const enterPlaceholderMode = useCallback(
    (params: string[], startPos: number) => {
      if (params.length === 0) return;

      // Close completion dropdown when entering placeholder mode
      completion.close();

      const newPlaceholders: Placeholder[] = [];
      let pos = startPos;

      for (const param of params) {
        newPlaceholders.push({
          start: pos,
          length: param.length,
          text: param,
          touched: false,
        });
        pos += param.length + 1; // +1 for space between params
      }

      setPlaceholders(newPlaceholders);
      setPlaceholderIndex(0);
      setCursorPos(newPlaceholders[0].start);
    },
    [completion],
  );

  // Helper: push current state to undo stack (call BEFORE each mutation)
  const pushUndo = useCallback(() => {
    const stack = undoStackRef.current;
    const last = stack[stack.length - 1];
    if (last && last.value === value && last.cursorPos === cursorPos) return;
    stack.push({ value, cursorPos });
    if (stack.length > 100) stack.shift();
    redoStackRef.current = []; // new mutation kills redo branch
  }, [value, cursorPos]);

  // Helper: undo last edit
  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const entry = stack.pop()!;
    redoStackRef.current.push({ value, cursorPos });
    onChange(entry.value);
    setCursorPos(entry.cursorPos);
  }, [value, cursorPos, onChange]);

  // Helper: redo last undone edit
  const redo = useCallback(() => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const entry = stack.pop()!;
    undoStackRef.current.push({ value, cursorPos });
    onChange(entry.value);
    setCursorPos(entry.cursorPos);
  }, [value, cursorPos, onChange]);

  // Helper: execute completion action (GENERIC - uses item.applyAction)
  // This replaces the old applyCompletionSelection with provider-defined behavior
  const executeCompletionAction = useCallback(
    (item: CompletionItem, action: CompletionAction) => {
      const context = completion.getApplyContext();
      if (!context) return; // No active completion session

      pushUndo();

      // Let the item define how to apply the action
      const result = item.applyAction(action, context);

      // Handle side effects from providers
      if (result.sideEffect?.type === "ADD_ATTACHMENT") {
        // Media file attachment
        pendingAttachmentOpsRef.current += 1;
        const id = reserveNextId();
        const mimeType = detectMimeType(result.sideEffect.path);
        const type = getAttachmentType(mimeType);
        const displayName = getDisplayName(type, id);
        // Replace placeholder with actual display name
        const finalText = result.text.replace(
          ATTACHMENT_PLACEHOLDER,
          displayName,
        );
        onChange(finalText);
        const placeholderLen = ATTACHMENT_PLACEHOLDER.length;
        setCursorPos(
          result.cursorPosition - placeholderLen + displayName.length,
        );
        void addAttachmentWithId(result.sideEffect.path, id).finally(() => {
          pendingAttachmentOpsRef.current = Math.max(
            0,
            pendingAttachmentOpsRef.current - 1,
          );
        });
      } else if (result.sideEffect?.type === "ENTER_PLACEHOLDER_MODE") {
        // Function param completion
        onChange(result.text);
        enterPlaceholderMode(
          result.sideEffect.params,
          result.sideEffect.startPos,
        );
      } else if (result.sideEffect?.type === "EXECUTE") {
        // Command execution - close dropdown and submit immediately (single Enter)
        completion.close();
        const finalText = result.text.trim();
        onSubmit(finalText, attachments.length > 0 ? attachments : undefined);
        pendingAttachmentOpsRef.current = 0;
        onChange("");
        setCursorPos(0);
        setHistoryIndex(-1);
        setTempInput("");
        clearAttachments();
        return; // Early return - already closed dropdown
      } else {
        // Normal completion
        onChange(result.text);
        setCursorPos(result.cursorPosition);
      }

      // Close dropdown if instructed
      if (result.closeDropdown) {
        completion.close();
      }
    },
    [
      completion,
      onChange,
      onSubmit,
      attachments,
      reserveNextId,
      addAttachmentWithId,
      enterPlaceholderMode,
      pushUndo,
      clearAttachments,
    ],
  );

  // Helper: move to next placeholder (Tab)
  const nextPlaceholder = useCallback(() => {
    if (placeholderIndex < placeholders.length - 1) {
      const newIndex = placeholderIndex + 1;
      setPlaceholderIndex(newIndex);
      const ph = placeholders[newIndex];
      setCursorPos(ph.touched ? ph.start + ph.length : ph.start);
      return true;
    } else {
      // Last placeholder - exit mode, move cursor to end
      exitPlaceholderMode();
      setCursorPos(value.length);
      return false;
    }
  }, [placeholders, placeholderIndex, value, exitPlaceholderMode]);

  // Helper: move to previous placeholder (Shift+Tab)
  const previousPlaceholder = useCallback(() => {
    if (placeholderIndex > 0) {
      const newIndex = placeholderIndex - 1;
      setPlaceholderIndex(newIndex);
      const ph = placeholders[newIndex];
      setCursorPos(ph.touched ? ph.start + ph.length : ph.start);
      return true;
    }
    return false;
  }, [placeholders, placeholderIndex]);

  // FIX NEW-6: Helper returns new array instead of mutating (pure function)
  // Shifts subsequent placeholder positions by delta - used in 3 places
  const shiftPlaceholders = (
    arr: Placeholder[],
    fromIndex: number,
    delta: number,
  ): Placeholder[] => {
    return arr.map((ph, i) =>
      i >= fromIndex ? { ...ph, start: ph.start + delta } : ph
    );
  };

  // Helper: replace current placeholder with typed character
  const replaceCurrentPlaceholder = useCallback((char: string) => {
    if (placeholderIndex < 0 || placeholderIndex >= placeholders.length) return;

    const ph = placeholders[placeholderIndex];
    const updated = [...placeholders];

    if (!ph.touched) {
      // First char - replace entire placeholder
      const before = value.slice(0, ph.start);
      const after = value.slice(ph.start + ph.length);
      const newValue = before + char + after;
      onChange(newValue);

      // Update this placeholder
      updated[placeholderIndex] = { ...ph, length: char.length, touched: true };

      // Shift subsequent placeholders (use return value from pure function)
      const delta = char.length - ph.length;
      const shifted = shiftPlaceholders(updated, placeholderIndex + 1, delta);

      setPlaceholders(shifted);
      setCursorPos(ph.start + char.length);
    } else {
      // Subsequent chars - insert at cursor within the placeholder
      const before = value.slice(0, cursorPos);
      const after = value.slice(cursorPos);
      onChange(before + char + after);

      // Update this placeholder's length
      updated[placeholderIndex] = { ...ph, length: ph.length + char.length };

      // Shift subsequent placeholders (use return value from pure function)
      const shifted = shiftPlaceholders(
        updated,
        placeholderIndex + 1,
        char.length,
      );

      setPlaceholders(shifted);
      setCursorPos(cursorPos + 1);
    }
  }, [placeholders, placeholderIndex, value, cursorPos, onChange]);

  // Helper: replace current placeholder with auto-close pair (e.g., () [] {})
  // Type ( in placeholder mode → replace placeholder with (), cursor inside
  const replaceCurrentPlaceholderWithPair = useCallback((openChar: string) => {
    if (placeholderIndex < 0 || placeholderIndex >= placeholders.length) return;

    const closeChar = OPEN_TO_CLOSE[openChar];
    if (!closeChar) {
      replaceCurrentPlaceholder(openChar);
      return;
    }

    const ph = placeholders[placeholderIndex];
    const updated = [...placeholders];
    const pair = openChar + closeChar;

    if (!ph.touched) {
      // First char - replace entire placeholder with pair
      const before = value.slice(0, ph.start);
      const after = value.slice(ph.start + ph.length);
      const newValue = before + pair + after;
      onChange(newValue);

      // Update this placeholder to span the pair content (between open and close)
      updated[placeholderIndex] = { ...ph, length: pair.length, touched: true };

      // Shift subsequent placeholders
      const delta = pair.length - ph.length;
      const shifted = shiftPlaceholders(updated, placeholderIndex + 1, delta);

      setPlaceholders(shifted);
      setCursorPos(ph.start + 1); // Cursor between the pair
    } else {
      // Subsequent chars - insert pair at cursor within the placeholder
      const before = value.slice(0, cursorPos);
      const after = value.slice(cursorPos);
      onChange(before + pair + after);

      // Update this placeholder's length
      updated[placeholderIndex] = { ...ph, length: ph.length + pair.length };

      // Shift subsequent placeholders
      const shifted = shiftPlaceholders(
        updated,
        placeholderIndex + 1,
        pair.length,
      );

      setPlaceholders(shifted);
      setCursorPos(cursorPos + 1); // Cursor between the pair
    }
  }, [
    placeholders,
    placeholderIndex,
    value,
    cursorPos,
    onChange,
    replaceCurrentPlaceholder,
  ]);

  // Helper: handle backspace in placeholder mode
  const backspaceInPlaceholder = useCallback(() => {
    if (placeholderIndex < 0 || placeholderIndex >= placeholders.length) {
      return false;
    }
    if (cursorPos <= 0) return false;

    const ph = placeholders[placeholderIndex];

    // Don't allow deleting before the placeholder start
    if (cursorPos <= ph.start) return false;

    // Delete one character
    const newValue = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
    onChange(newValue);

    // FIX: Exit placeholder mode if value becomes empty or just parens/whitespace
    const trimmedNew = newValue.replace(/[\s()]/g, "");
    if (trimmedNew.length === 0) {
      setPlaceholders([]);
      setPlaceholderIndex(-1);
      setCursorPos(cursorPos - 1);
      return true;
    }

    // Update placeholder length
    const updated = [...placeholders];
    updated[placeholderIndex] = { ...ph, length: ph.length - 1, touched: true };

    // Shift subsequent placeholders (use return value from pure function)
    const shifted = shiftPlaceholders(updated, placeholderIndex + 1, -1);

    setPlaceholders(shifted);
    setCursorPos(cursorPos - 1);

    // If placeholder is empty, keep in mode but mark as touched
    return true;
  }, [placeholders, placeholderIndex, value, cursorPos, onChange]);

  // Helper: insert text at cursor
  const insertAt = useCallback((text: string) => {
    pushUndo();
    const newValue = value.slice(0, cursorPos) + text + value.slice(cursorPos);
    onChange(newValue);
    setCursorPos(cursorPos + text.length);
  }, [value, cursorPos, onChange, pushUndo]);

  // Note: deleteBack was removed - now using deleteBackWithPairSupport() from syntax.ts

  // Helper: reset state after submit (DRY helper)
  const resetAfterSubmit = useCallback(() => {
    pendingAttachmentOpsRef.current = 0;
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryIndex(-1);
    setTempInput("");
    completion.close();
    clearAttachments();
  }, [completion, clearAttachments]);

  const cycleComposerMode = useCallback(() => {
    onCycleMode?.();
  }, [onCycleMode]);

  const forceSubmitCurrentDraft = useCallback(() => {
    if (!onForceSubmit) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    onForceSubmit(
      trimmed,
      attachments.length > 0 ? attachments : undefined,
    );
    resetAfterSubmit();
  }, [attachments, onForceSubmit, resetAfterSubmit, value]);

  const queueCurrentDraft = useCallback(() => {
    if (!onQueueDraft) return false;
    if (pendingAttachmentOpsRef.current > 0) return true;

    const finalValue = resolveSuggestionValue(value, suggestion, "submit");
    const trimmedDraft = trimConversationDraftText(finalValue, cursorPos);
    const hasAttachments = attachments.length > 0;
    if (!trimmedDraft.text && !hasAttachments) {
      return false;
    }

    onQueueDraft(
      createConversationComposerDraft(
        trimmedDraft.text,
        attachments.length > 0 ? attachments : [],
        trimmedDraft.cursorOffset,
      ),
    );
    onChange("");
    setCursorPos(0);
    resetAfterSubmit();
    return true;
  }, [
    attachments,
    cursorPos,
    onChange,
    onQueueDraft,
    resetAfterSubmit,
    suggestion,
    value,
  ]);

  // FIX H4: Helper to clear paste buffer on mode transitions
  // This prevents paste data from corrupting history entries or mode state
  const clearPasteBuffer = useCallback(() => {
    if (pasteTimeoutRef.current) {
      clearTimeout(pasteTimeoutRef.current);
      pasteTimeoutRef.current = null;
    }
    pasteBufferRef.current = "";
  }, []);

  // Helper: cancel pending pure-ESC action (used when ESC is actually a prefix)
  const cancelPendingEsc = useCallback(() => {
    if (escSequenceTimerRef.current) {
      clearTimeout(escSequenceTimerRef.current);
      escSequenceTimerRef.current = null;
    }
  }, []);

  // Helper: schedule pure ESC handling after a short timeout.
  // If a follow-up key arrives, we cancel and treat ESC as a prefix.
  const schedulePureEscAction = useCallback((action: () => void) => {
    cancelPendingEsc();
    escSequenceTimerRef.current = setTimeout(() => {
      escSequenceTimerRef.current = null;
      action();
    }, ESC_SEQUENCE_TIMEOUT_MS);
  }, [cancelPendingEsc]);

  const clearCurrentDraft = useCallback(() => {
    pendingAttachmentOpsRef.current = 0;
    undoStackRef.current = [];
    redoStackRef.current = [];
    clearPasteBuffer();
    cancelPendingEsc();
    completion.close();
    historySearch.actions.cancelSearch();
    exitPlaceholderMode();
    setSuggestion(null);
    setHistoryIndex(-1);
    setTempInput("");
    onChange("");
    setCursorPos(0);
    clearAttachments();
  }, [
    cancelPendingEsc,
    clearAttachments,
    clearPasteBuffer,
    completion,
    exitPlaceholderMode,
    historySearch.actions,
    onChange,
  ]);

  // Helper: accept and apply suggestion (DRY helper)
  const acceptAndApplySuggestion = useCallback(() => {
    if (!suggestion) return false;
    const accepted = resolveSuggestionValue(value, suggestion, "accept");
    onChange(accepted);
    setCursorPos(accepted.length);
    setSuggestion(null);
    return true;
  }, [value, suggestion, onChange]);

  // Helper: check if character is a word boundary (LISP structural editing)
  // This is a SUBSET of string-utils.ts:WORD_BOUNDARY_CHARS - intentionally.
  // For Ctrl+W, we exclude quotes/comma/semicolon so strings and data structures
  // are treated as atomic units. See string-utils.ts header for full explanation.
  const isWordBoundaryChar = (ch: string): boolean => {
    return ch === " " || ch === "\t" || ch === "(" || ch === ")" ||
      ch === "[" || ch === "]" || ch === "{" || ch === "}";
  };

  // Helper: insert auto-closing delimiter pair
  // Type ( → () or " → "" with cursor in middle
  // Uses AUTO_PAIR_CHARS from syntax.ts (includes quotes)
  const insertAutoClosePair = useCallback((openChar: string) => {
    const closeChar = AUTO_PAIR_CHARS[openChar];
    if (!closeChar) {
      insertAt(openChar);
      return;
    }
    pushUndo();
    const newValue = value.slice(0, cursorPos) + openChar + closeChar +
      value.slice(cursorPos);
    onChange(newValue);
    setCursorPos(cursorPos + 1); // Cursor between the pair
  }, [value, cursorPos, onChange, insertAt, pushUndo]);

  // Helper: delete word backward (Ctrl+W)
  // Accepts optional parameters to work on any value (for placeholder cleanup)
  // LISP-aware: treats parens/brackets as word boundaries
  const deleteWord = useCallback(
    (targetValue?: string, targetCursor?: number) => {
      pushUndo();
      const v = targetValue ?? value;
      const c = targetCursor ?? cursorPos;

      // Check if inside paired delimiters first — uses shared implementation from text-editing.ts
      const delimResult = deleteWordPreservingDelimiters(v, c);
      if (delimResult) {
        onChange(delimResult.value);
        setCursorPos(delimResult.cursor);
        return;
      }

      // LISP-aware word deletion
      const before = v.slice(0, c);
      let pos = before.length;
      const originalPos = pos;
      // Skip trailing whitespace (but not parens/brackets - they're significant)
      while (
        pos > 0 && isWordBoundaryChar(before[pos - 1]) &&
        before[pos - 1] !== "(" && before[pos - 1] !== "[" &&
        before[pos - 1] !== "{"
      ) {
        pos--;
      }
      // Delete word (stop at word boundary including parens)
      while (pos > 0 && !isWordBoundaryChar(before[pos - 1])) {
        pos--;
      }
      // If nothing was deleted and there's a paren/bracket, delete that single char
      // This handles: (| → Ctrl+W → empty
      if (pos === originalPos && pos > 0) {
        const ch = before[pos - 1];
        if (
          ch === "(" || ch === "[" || ch === "{" || ch === ")" || ch === "]" ||
          ch === "}"
        ) {
          pos--;
        }
      }
      onChange(before.slice(0, pos) + v.slice(c));
      setCursorPos(pos);
    },
    [value, cursorPos, onChange, pushUndo],
  );

  // Helper: get value with placeholders cleaned up (DRY for Ctrl+W/U/K)
  const getCleanedValue = useCallback((): { v: string; c: number } => {
    if (isInPlaceholderMode()) {
      const cleaned = exitPlaceholderModeAndCleanup(true);
      return { v: cleaned, c: Math.min(cursorPos, cleaned.length) };
    }
    return { v: value, c: cursorPos };
  }, [isInPlaceholderMode, exitPlaceholderModeAndCleanup, value, cursorPos]);

  // Helper: move word backward (Option+Left on macOS, Ctrl+Left on Windows/Linux)
  const moveWordBack = useCallback(() => {
    setCursorPos(calculateWordBackPosition(value, cursorPos));
  }, [value, cursorPos]);

  // Helper: move word forward (Option+Right on macOS, Ctrl+Right on Windows/Linux)
  const moveWordForward = useCallback(() => {
    setCursorPos(calculateWordForwardPosition(value, cursorPos));
  }, [value, cursorPos]);

  // Helper: navigate history
  // FIX H4: Clear paste buffer when navigating history
  // FIX H5: Capture value directly to avoid stale closure
  const navigateHistory = useCallback((direction: number) => {
    if (history.length === 0) return;

    pushUndo();

    // Clear paste buffer to prevent data corruption
    if (pasteTimeoutRef.current) {
      clearTimeout(pasteTimeoutRef.current);
      pasteTimeoutRef.current = null;
    }
    pasteBufferRef.current = "";

    if (direction < 0) {
      // Up arrow - go back in history
      if (historyIndex === -1) {
        // FIX H5: Save current input value directly (captured at call time)
        setTempInput(value);
        setHistoryIndex(history.length - 1);
        onChange(history[history.length - 1]);
        setCursorPos(history[history.length - 1].length);
      } else if (historyIndex > 0) {
        setHistoryIndex(historyIndex - 1);
        onChange(history[historyIndex - 1]);
        setCursorPos(history[historyIndex - 1].length);
      }
    } else {
      // Down arrow - go forward in history
      if (historyIndex === -1) return;

      if (historyIndex < history.length - 1) {
        setHistoryIndex(historyIndex + 1);
        onChange(history[historyIndex + 1]);
        setCursorPos(history[historyIndex + 1].length);
      } else {
        // Restore temp input
        setHistoryIndex(-1);
        onChange(tempInput);
        setCursorPos(tempInput.length);
      }
    }
  }, [history, historyIndex, tempInput, value, onChange, pushUndo]);

  // Helper: Tab completion toggle.
  // Behavior: open dropdown when closed, close it when open.
  // FIX: Use triggerCompletionRef to avoid stale closure issues with completion object
  const handleTab = useCallback(async () => {
    // Toggle behavior: if dropdown is open, Tab closes it (never auto-select on Tab).
    if (completion.isVisible) {
      completion.close();
      return;
    }

    // Trigger completion and open dropdown (first item may be selected visually, never applied on Tab).
    // Use ref to ensure we always have the latest triggerCompletion function
    await triggerCompletionRef.current(value, cursorPos, true);
  }, [value, cursorPos, completion]);

  // ============================================================
  // Handler Registry Registration
  // Register handlers for palette/keybinding execution
  // ============================================================
  useEffect(() => {
    // Paredit helper using current value/cursorPos closure (with undo)
    const applyParedit = (fn: PareditFn) => {
      const result = fn(value, cursorPos);
      if (result) {
        pushUndo();
        onChange(result.newValue);
        setCursorPos(result.newCursor);
      }
    };

    // Editing handlers
    registerHandler(HandlerIds.EDIT_JUMP_START, () => setCursorPos(0), "Input");
    registerHandler(HandlerIds.EDIT_JUMP_END, () => {
      if (suggestion && cursorPos === value.length) {
        acceptAndApplySuggestion();
      } else {
        setCursorPos(value.length);
      }
    }, "Input");
    registerHandler(HandlerIds.EDIT_DELETE_TO_START, () => {
      pushUndo();
      const { v, c } = getCleanedValue();
      onChange(v.slice(c));
      setCursorPos(0);
    }, "Input");
    registerHandler(HandlerIds.EDIT_DELETE_TO_END, () => {
      pushUndo();
      const { v, c } = getCleanedValue();
      onChange(v.slice(0, c));
    }, "Input");
    registerHandler(HandlerIds.EDIT_DELETE_WORD_BACK, () => {
      pushUndo();
      const { v, c } = getCleanedValue();
      deleteWord(v, c);
    }, "Input");
    registerHandler(HandlerIds.EDIT_UNDO, undo, "Input");
    registerHandler(HandlerIds.EDIT_REDO, redo, "Input");

    // Navigation handlers
    registerHandler(HandlerIds.NAV_WORD_BACK, moveWordBack, "Input");
    registerHandler(HandlerIds.NAV_WORD_FORWARD, moveWordForward, "Input");
    registerHandler(HandlerIds.NAV_SEXP_BACK, () => {
      const newPos = backwardSexp(value, cursorPos);
      if (newPos !== cursorPos) setCursorPos(newPos);
    }, "Input");
    registerHandler(HandlerIds.NAV_SEXP_FORWARD, () => {
      const newPos = forwardSexp(value, cursorPos);
      if (newPos !== cursorPos) setCursorPos(newPos);
    }, "Input");
    registerHandler(HandlerIds.NAV_SEXP_UP, () => {
      const newPos = backwardUpSexp(value, cursorPos);
      if (newPos !== cursorPos) setCursorPos(newPos);
    }, "Input");
    registerHandler(HandlerIds.NAV_SEXP_DOWN, () => {
      const newPos = forwardDownSexp(value, cursorPos);
      if (newPos !== cursorPos) setCursorPos(newPos);
    }, "Input");
    registerHandler(
      HandlerIds.NAV_INSERT_NEWLINE,
      () => insertAt("\n"),
      "Input",
    );

    // Completion handlers
    registerHandler(HandlerIds.COMPLETION_ACCEPT, handleTab, "Input");
    registerHandler(
      HandlerIds.COMPLETION_TOGGLE_DOCS,
      () => completion.toggleDocPanel(),
      "Input",
    );
    registerHandler(
      HandlerIds.COMPLETION_CANCEL,
      () => completion.close(),
      "Input",
    );

    // History handlers
    registerHandler(HandlerIds.HISTORY_SEARCH, () => {
      completion.close();
      exitPlaceholderMode();
      clearPasteBuffer();
      historySearch.actions.startSearch();
    }, "Input");

    // Composer handlers
    registerHandler(
      HandlerIds.COMPOSER_CYCLE_MODE,
      cycleComposerMode,
      "Input",
    );
    registerHandler(
      HandlerIds.COMPOSER_CLEAR,
      clearCurrentDraft,
      "Input",
    );
    registerHandler(
      HandlerIds.COMPOSER_FORCE_SUBMIT,
      forceSubmitCurrentDraft,
      "Input",
    );

    // Paredit handlers
    registerHandler(
      HandlerIds.PAREDIT_SLURP_FORWARD,
      () => applyParedit(slurpForward),
      "Input",
    );
    registerHandler(
      HandlerIds.PAREDIT_SLURP_BACKWARD,
      () => applyParedit(slurpBackward),
      "Input",
    );
    registerHandler(
      HandlerIds.PAREDIT_BARF_FORWARD,
      () => applyParedit(barfForward),
      "Input",
    );
    registerHandler(
      HandlerIds.PAREDIT_BARF_BACKWARD,
      () => applyParedit(barfBackward),
      "Input",
    );
    registerHandler(
      HandlerIds.PAREDIT_WRAP,
      () => applyParedit(wrapSexp),
      "Input",
    );
    registerHandler(
      HandlerIds.PAREDIT_SPLICE,
      () => applyParedit(spliceSexp),
      "Input",
    );
    registerHandler(
      HandlerIds.PAREDIT_RAISE,
      () => applyParedit(raiseSexp),
      "Input",
    );
    registerHandler(
      HandlerIds.PAREDIT_TRANSPOSE,
      () => applyParedit(transposeSexp),
      "Input",
    );
    registerHandler(
      HandlerIds.PAREDIT_KILL,
      () => applyParedit(killSexp),
      "Input",
    );

    // Cleanup on unmount or when dependencies change
    return () => {
      // Editing
      unregisterHandler(HandlerIds.EDIT_JUMP_START);
      unregisterHandler(HandlerIds.EDIT_JUMP_END);
      unregisterHandler(HandlerIds.EDIT_DELETE_TO_START);
      unregisterHandler(HandlerIds.EDIT_DELETE_TO_END);
      unregisterHandler(HandlerIds.EDIT_DELETE_WORD_BACK);
      unregisterHandler(HandlerIds.EDIT_UNDO);
      unregisterHandler(HandlerIds.EDIT_REDO);
      // Navigation
      unregisterHandler(HandlerIds.NAV_WORD_BACK);
      unregisterHandler(HandlerIds.NAV_WORD_FORWARD);
      unregisterHandler(HandlerIds.NAV_SEXP_BACK);
      unregisterHandler(HandlerIds.NAV_SEXP_FORWARD);
      unregisterHandler(HandlerIds.NAV_SEXP_UP);
      unregisterHandler(HandlerIds.NAV_SEXP_DOWN);
      unregisterHandler(HandlerIds.NAV_INSERT_NEWLINE);
      // Completion
      unregisterHandler(HandlerIds.COMPLETION_ACCEPT);
      unregisterHandler(HandlerIds.COMPLETION_TOGGLE_DOCS);
      unregisterHandler(HandlerIds.COMPLETION_CANCEL);
      // History
      unregisterHandler(HandlerIds.HISTORY_SEARCH);
      // Composer
      unregisterHandler(HandlerIds.COMPOSER_CYCLE_MODE);
      unregisterHandler(HandlerIds.COMPOSER_CLEAR);
      unregisterHandler(HandlerIds.COMPOSER_FORCE_SUBMIT);
      // Paredit
      unregisterHandler(HandlerIds.PAREDIT_SLURP_FORWARD);
      unregisterHandler(HandlerIds.PAREDIT_SLURP_BACKWARD);
      unregisterHandler(HandlerIds.PAREDIT_BARF_FORWARD);
      unregisterHandler(HandlerIds.PAREDIT_BARF_BACKWARD);
      unregisterHandler(HandlerIds.PAREDIT_WRAP);
      unregisterHandler(HandlerIds.PAREDIT_SPLICE);
      unregisterHandler(HandlerIds.PAREDIT_RAISE);
      unregisterHandler(HandlerIds.PAREDIT_TRANSPOSE);
      unregisterHandler(HandlerIds.PAREDIT_KILL);
    };
  }, [
    value,
    cursorPos,
    suggestion,
    placeholders,
    placeholderIndex,
    onChange,
    moveWordBack,
    moveWordForward,
    deleteWord,
    handleTab,
    completion,
    historySearch.actions,
    exitPlaceholderMode,
    cycleComposerMode,
    clearCurrentDraft,
    forceSubmitCurrentDraft,
    getCleanedValue,
    insertAt,
    acceptAndApplySuggestion,
    clearPasteBuffer,
    undo,
    redo,
    pushUndo,
  ]);

  // Main input handler
  useInput((input, key) => {
    const isPureEscPrefixEvent = isPureEscKeyEvent(input, key);

    if (
      shouldInterruptConversationOnEsc(input, key, {
        highlightMode,
        isConversationTaskRunning,
        hasInterruptHandler: typeof onInterruptRunningTask === "function",
      })
    ) {
      cancelPendingEsc();
      lastEscPrefixAtRef.current = 0;
      onInterruptRunningTask?.();
      return;
    }

    // Use ref to avoid stale closure - disabled prop can change during evaluation
    if (disabledRef.current) return;
    // CSI-u Ctrl+Enter: modifier 5/6/7 (Ctrl, Ctrl+Shift, Ctrl+Alt)
    const isCtrlEnterProtocol = (() => {
      if (!input) return false;
      const csiuMatch = input.match(CTRL_ENTER_CSI_U_REGEX);
      const legacyMatch = input.match(CTRL_ENTER_LEGACY_REGEX);
      const mod = parseInt(csiuMatch?.[1] ?? legacyMatch?.[1] ?? "0", 10);
      return mod === 5 || mod === 6 || mod === 7;
    })();

    // Any non-pure-ESC event means previous ESC was a prefix (Alt/Option sequence), not a standalone ESC press.
    if (!isPureEscPrefixEvent) {
      cancelPendingEsc();
    }

    // Some terminals emit raw \t for Tab without setting key.tab.
    // Others emit Ctrl+I (ASCII 9). Treat all forms as Tab for deterministic toggle behavior.
    const inputCharCode = input?.charCodeAt(0) ?? 0;
    const isTabKey = key.tab || input === "\t" || inputCharCode === 9 ||
      (key.ctrl && input === "i");

    // Ctrl+Enter: force-submit via CSI-u protocol only (kitty/WezTerm/Ghostty).
    // Most terminals can't distinguish Ctrl+Enter from Ctrl+J, so we don't
    // use Ctrl+J for force-submit — it's reserved for newline insertion.
    if (onForceSubmit && (isCtrlEnterProtocol || (key.return && key.ctrl))) {
      void executeHandler(HandlerIds.COMPOSER_FORCE_SUBMIT);
      return;
    }

    if (
      highlightMode === "chat" &&
      queueEditBinding === "shift-left" &&
      key.shift &&
      key.leftArrow &&
      canEditQueuedDraft &&
      onEditLastQueuedDraft
    ) {
      onEditLastQueuedDraft();
      return;
    }

    if (
      highlightMode === "chat" &&
      isConversationTaskRunning &&
      !key.shift &&
      !completion.isVisible &&
      isTabKey &&
      queueCurrentDraft()
    ) {
      return;
    }

    // ============================================================
    // HISTORY SEARCH MODE (Ctrl+R)
    // Intercept all input when in search mode
    // ============================================================
    if (historySearch.state.isSearching) {
      // Escape: cancel search
      if (key.escape) {
        historySearch.actions.cancelSearch();
        return;
      }

      // Enter: confirm selection
      if (key.return) {
        const selected = historySearch.actions.confirm();
        if (selected !== null) {
          pushUndo();
          onChange(selected);
          setCursorPos(selected.length);
        }
        return;
      }

      // Ctrl+R: select next match
      if (key.ctrl && input === "r") {
        historySearch.actions.selectNext();
        return;
      }

      // Ctrl+S: select previous match
      if (key.ctrl && input === "s") {
        historySearch.actions.selectPrev();
        return;
      }

      // Ctrl+U: clear query (standard readline)
      if (key.ctrl && input === "u") {
        historySearch.actions.setQuery("");
        return;
      }

      // Ctrl+W: delete word backward (simplified - operates from end)
      if (key.ctrl && input === "w") {
        const query = historySearch.state.query;
        if (query.length > 0) {
          // Skip trailing whitespace, then delete word
          let pos = query.length;
          while (pos > 0 && query[pos - 1] === " ") pos--;
          while (pos > 0 && query[pos - 1] !== " ") pos--;
          historySearch.actions.setQuery(query.slice(0, pos));
        }
        return;
      }

      // Ctrl+A: move to start (clear query acts as "start" for search)
      if (key.ctrl && input === "a") {
        historySearch.actions.setQuery("");
        return;
      }

      // Backspace/Delete: remove last char from query
      // FIX NEW-2: Support both Backspace and Delete keys
      if (key.backspace || key.delete) {
        if (historySearch.state.query.length > 0) {
          historySearch.actions.backspace();
        } else {
          historySearch.actions.cancelSearch();
        }
        return;
      }

      // Regular character: append to query
      // Note: Check !key.escape to avoid Option+key on macOS (sends ESC+char)
      if (
        input && input.length === 1 && !key.ctrl && !key.meta && !key.escape
      ) {
        historySearch.actions.appendToQuery(input);
        return;
      }

      // Ignore other keys during search
      return;
    }

    // Preserve explicit Ctrl+J newline insertion, but allow bare \n to behave
    // like Enter for terminals/automation layers that normalize Return to LF.
    if (input === "\n" && !key.return && key.ctrl) {
      insertAt("\n");
      return;
    }

    const isEnterLikeInput = key.return || input === "\r" ||
      (input === "\n" && !key.ctrl);

    // ============================================================
    // CUSTOM KEYBINDING INTERCEPTION
    // Check custom bindings FIRST, before all hardcoded handlers.
    // This makes rebinding work - new keys trigger actions, old keys stop working.
    // ============================================================
    const handlerBinding = inspectHandlerKeybinding(input, key, {
      categories: INPUT_KEYBINDING_CATEGORIES,
    });
    if (
      handlerBinding.kind === "handler" && handlerBinding.source === "custom"
    ) {
      executeHandler(handlerBinding.id);
      return;
    }

    if (
      handlerBinding.kind === "disabled-default" ||
      handlerBinding.kind === "shadowed"
    ) {
      return;
    }

    // Ctrl+R: start history search (when not in search mode)
    // FIX H1: Close dropdown and exit placeholder mode when entering history search
    // FIX H4: Clear paste buffer to prevent data corruption
    // CROSS-PLATFORM: Check both key.ctrl flag AND control code (ASCII 18 = Ctrl+R)
    if ((key.ctrl && input === "r") || input === "\x12") {
      completion.close();
      exitPlaceholderMode();
      clearPasteBuffer();
      historySearch.actions.startSearch();
      return;
    }

    // ============================================================
    // FAST PATH: Single character typing (most common case)
    // Skip ALL checks for simple character input - maximum speed
    // IMPORTANT: Exclude control characters (0-31) - they are Ctrl+key combos
    // that need special handling (paredit, etc.) even if key.ctrl is not set
    // ============================================================
    const charCode = input.length === 1 ? input.charCodeAt(0) : -1;
    const isControlChar = charCode >= 0 && charCode <= 31;
    if (
      input &&
      input.length === 1 &&
      !isControlChar && // Ctrl+] sends code 29, Ctrl+\ sends code 28, etc.
      !key.ctrl &&
      !key.meta &&
      !key.escape &&
      !key.return &&
      !isTabKey &&
      !key.backspace &&
      !key.delete &&
      !key.upArrow &&
      !key.downArrow &&
      !key.leftArrow &&
      !key.rightArrow &&
      pasteBufferRef.current.length === 0
    ) {
      // Placeholder mode: replace placeholder with typed char
      if (placeholders.length > 0 && placeholderIndex >= 0) {
        if (input === ")") {
          const cleanedValue = exitPlaceholderModeAndCleanup();
          const closingParenPos = cleanedValue.lastIndexOf(")");
          onChange(cleanedValue);
          setCursorPos(closingParenPos + 1);
        } else if (input in OPEN_TO_CLOSE) {
          // Auto-close in placeholder mode: e.g., type ( → ()
          replaceCurrentPlaceholderWithPair(input);
        } else {
          replaceCurrentPlaceholder(input);
        }
        return;
      }

      // Smart over-type: if typing closing delimiter that's already at cursor, skip over it
      const closingDelimiters = [")", "]", "}", '"', "'"];
      if (closingDelimiters.includes(input) && value[cursorPos] === input) {
        lastInputTimeRef.current = Date.now();
        setCursorPos(cursorPos + 1);
        return;
      }

      // Smart quote handling: " → "" or ' → '' with cursor between (unless inside string)
      if (input === '"' || input === "'") {
        lastInputTimeRef.current = Date.now();
        if (isInsideString(value, cursorPos, input)) {
          // Inside a string of the same quote type - just insert the character
          insertAt(input);
        } else {
          // Not inside string - auto-pair
          insertAutoClosePair(input);
        }
        return;
      }

      // Auto-close delimiters: ( → (), [ → [], { → {}
      if (input in OPEN_TO_CLOSE) {
        lastInputTimeRef.current = Date.now();
        insertAutoClosePair(input);
        return;
      }
      // Normal typing: direct insert, no paste detection needed
      lastInputTimeRef.current = Date.now();
      insertAt(input);
      return;
    }

    // ============================================================
    // Word Navigation (Cross-Platform)
    // ============================================================
    // macOS: Option+Arrow sends ESC+b/f (input='b'/'f', meta=true)
    // Linux: Alt+Arrow sends ESC+b/f or modified arrows (meta=true)
    // Windows: Ctrl+Arrow sends ctrl=true with arrow keys
    // ============================================================

    // Ctrl+Arrow: Word navigation (Windows/Linux standard)
    // Ctrl+Up/Down: S-expression navigation (LISP structural editing)
    if (key.ctrl) {
      if (key.leftArrow) {
        moveWordBack();
        return;
      }
      if (key.rightArrow) {
        moveWordForward();
        return;
      }
      // Ctrl+Up: backward-up-sexp (move to opening paren of enclosing list)
      if (key.upArrow) {
        const newPos = backwardUpSexp(value, cursorPos);
        if (newPos !== cursorPos) {
          setCursorPos(newPos);
        }
        return;
      }
      // Ctrl+Down: forward-down-sexp (move into next list)
      if (key.downArrow) {
        const newPos = forwardDownSexp(value, cursorPos);
        if (newPos !== cursorPos) {
          setCursorPos(newPos);
        }
        return;
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // OPTION/META KEY: All Option+key handling consolidated here
    // macOS Terminal sends ESC sequences for Option key (key.escape or key.meta)
    // This handles BOTH key.escape AND key.meta since macOS Terminal sends ESC sequences
    // IMPORTANT: Skip this block if Ctrl is pressed to let Ctrl handler run
    if ((key.escape || key.meta) && !key.ctrl) {
      // Paredit helper using current value/cursorPos closure (with undo)
      const applyParedit = (fn: PareditFn) => {
        const result = fn(value, cursorPos);
        if (result) {
          pushUndo();
          onChange(result.newValue);
          setCursorPos(result.newCursor);
        }
      };

      // Option+Backspace: delete word backward (same as Ctrl+W)
      if (key.backspace || key.delete) {
        pushUndo();
        const { v, c } = getCleanedValue();
        deleteWord(v, c);
        return;
      }

      // Check for ESC/Option + arrow (word/sexp navigation)
      if (key.leftArrow) {
        moveWordBack();
        return;
      }
      if (key.rightArrow) {
        moveWordForward();
        return;
      }
      if (key.upArrow) {
        if (
          highlightMode === "chat" &&
          queueEditBinding === "alt-up" &&
          canEditQueuedDraft &&
          onEditLastQueuedDraft
        ) {
          onEditLastQueuedDraft();
          return;
        }
        const newPos = backwardSexp(value, cursorPos);
        if (newPos !== cursorPos) setCursorPos(newPos);
        return;
      }
      if (key.downArrow) {
        const newPos = forwardSexp(value, cursorPos);
        if (newPos !== cursorPos) setCursorPos(newPos);
        return;
      }

      // Check for ESC/Option + Enter (insert newline).
      // Some terminals send raw \r/\n here without key.return=true.
      if (key.return || input === "\r" || input === "\n") {
        insertAt("\n");
        return;
      }

      // Handle ESC/Option + letter
      switch (input) {
        // Word navigation (Option+B/F) - standard Emacs
        case "b":
          moveWordBack();
          return;
        case "f":
          moveWordForward();
          return;

        // ═══════════════════════════════════════════════════════════════
        // PAREDIT: Option+lowercase (reliable on macOS/Linux/Windows)
        // Option sends ESC sequence, lowercase avoids Unicode issues
        //
        // Mnemonics (all left-hand friendly):
        //   Option+s = Slurp forward   (S for Slurp)
        //   Option+a = Slurp backward  (A left of S)
        //   Option+x = Barf forward    (X for eXpel)
        //   Option+z = Undo            (reassigned from barf-backward)
        //   Option+w = Wrap            (W for Wrap)
        //   Option+u = Unwrap/Splice   (U for Unwrap)
        //   Option+r = Raise           (R for Raise)
        //   Option+t = Transpose       (T for Transpose)
        //   Option+k = Kill            (K for Kill)
        // ═══════════════════════════════════════════════════════════════
        case "s":
          applyParedit(slurpForward);
          return; // Opt+S: (a|) b → (a| b)
        case "a":
          applyParedit(slurpBackward);
          return; // Opt+A: a (|b) → (a |b)
        case "x":
          applyParedit(barfForward);
          return; // Opt+X: (a| b) → (a|) b
        case "z":
          undo();
          return; // Alt+Z: Undo
        case "Z":
          redo();
          return; // Alt+Shift+Z: Redo
        case "w":
          applyParedit(wrapSexp);
          return; // Opt+W: |foo → (|foo)
        case "u":
          applyParedit(spliceSexp);
          return; // Opt+U: ((|a)) → (|a)
        case "r":
          applyParedit(raiseSexp);
          return; // Opt+R: (x (|y)) → (|y)
        case "t":
          applyParedit(transposeSexp);
          return; // Opt+T: (a |b) → (b |a)
        case "k":
          applyParedit(killSexp);
          return; // Opt+K: (a |b c) → (a |)
      }

      // Treat pure ESC as a potential prefix first; only run ESC action if no follow-up key arrives.
      if (isPureEscPrefixEvent) {
        lastEscPrefixAtRef.current = Date.now();
        schedulePureEscAction(() => {
        lastEscPrefixAtRef.current = 0;
          if (
            highlightMode === "chat" &&
            isConversationTaskRunning &&
            onInterruptRunningTask
          ) {
            onInterruptRunningTask();
            return;
          }
          // Pure ESC key: close dropdown first (do not clear input).
          if (completion.isVisible) {
            completion.close();
            return;
          }

          // Exit placeholder mode
          if (isInPlaceholderMode()) {
            exitPlaceholderModeAndCleanup();
          }

          // Clear input
          pendingAttachmentOpsRef.current = 0;
          pushUndo();
          onChange("");
          setCursorPos(0);
          clearAttachments();
        });
      }
      return;
    }

    // Placeholder mode handling (highest priority)
    if (isInPlaceholderMode()) {
      // Tab navigates placeholders
      if (isTabKey) {
        if (key.shift) {
          previousPlaceholder();
        } else {
          nextPlaceholder();
        }
        return;
      }

      // Enter submits (exits placeholder mode)
      if (key.return) {
        if (value.trim() && isBalanced(value)) {
          exitPlaceholderMode();
          onSubmit(
            value.trim(),
            attachments.length > 0 ? attachments : undefined,
          );
          resetAfterSubmit();
        }
        return;
      }

      // Backspace in placeholder mode
      if (key.backspace || key.delete) {
        pushUndo();
        if (backspaceInPlaceholder()) {
          return;
        }
        // FIX: If backspace is outside placeholder bounds, cleanup placeholders
        // Determine if cursor is before first placeholder (function name area)
        // If so, user is deleting the function name - remove ALL placeholders
        const firstPh = placeholders[0];
        const isDeletingFunctionName = firstPh && cursorPos <= firstPh.start;

        // removeAll=true when deleting function name, false otherwise (only remove untouched)
        const cleanedValue = exitPlaceholderModeAndCleanup(
          isDeletingFunctionName,
        );

        // Adjust cursor position for cleaned value
        const newCursor = Math.min(cursorPos, cleanedValue.length);

        // Perform backspace on cleaned value
        if (newCursor > 0) {
          const afterBackspace = cleanedValue.slice(0, newCursor - 1) +
            cleanedValue.slice(newCursor);
          onChange(afterBackspace);
          setCursorPos(newCursor - 1);
        } else {
          onChange(cleanedValue);
          setCursorPos(0);
        }
        return;
      }

      // Character input in placeholder mode
      if (input && !key.ctrl && !key.meta) {
        // Special case: ')' exits placeholder mode and removes untouched placeholders
        // The closing ')' was already inserted when entering placeholder mode
        if (input === ")") {
          const cleanedValue = exitPlaceholderModeAndCleanup();
          // Find the position of the existing ')' - it's right after the last content
          // After cleanup, untouched placeholders are removed but ')' remains
          const closingParenPos = cleanedValue.lastIndexOf(")");
          onChange(cleanedValue);
          setCursorPos(closingParenPos + 1);
          return;
        }

        // FIX: Check if cursor is within the current placeholder bounds
        // If not, cleanup untouched placeholders (they're hints, not real text) and insert normally
        const ph = placeholders[placeholderIndex];
        const cursorInPlaceholder = ph && cursorPos >= ph.start &&
          cursorPos <= ph.start + ph.length;
        if (!cursorInPlaceholder) {
          const cleanedValue = exitPlaceholderModeAndCleanup();
          // Adjust cursor for cleaned value and insert character
          const newCursor = Math.min(cursorPos, cleanedValue.length);
          // Handle auto-close pairs even when exiting placeholder mode
          if (input in OPEN_TO_CLOSE) {
            const closeChar = OPEN_TO_CLOSE[input];
            const newValue = cleanedValue.slice(0, newCursor) + input +
              closeChar + cleanedValue.slice(newCursor);
            onChange(newValue);
            setCursorPos(newCursor + 1); // Cursor between the pair
          } else {
            const newValue = cleanedValue.slice(0, newCursor) + input +
              cleanedValue.slice(newCursor);
            onChange(newValue);
            setCursorPos(newCursor + input.length);
          }
          return;
        } else if (input in OPEN_TO_CLOSE) {
          // Auto-close in placeholder mode: e.g., type ( → ()
          replaceCurrentPlaceholderWithPair(input);
          return;
        } else {
          replaceCurrentPlaceholder(input);
          return;
        }
      }
    }

    // Completion dropdown navigation (unified for @mention, symbols, commands)
    // GENERIC: Uses item.availableActions and executeCompletionAction
    if (completion.isVisible) {
      const selectedItem = completion.selectedItem;

      // Ctrl+D: Toggle documentation panel
      // CROSS-PLATFORM: Check both key.ctrl flag AND control code (ASCII 4 = Ctrl+D)
      if ((key.ctrl && input === "d") || input === "\x04") {
        completion.toggleDocPanel();
        return;
      }

      if (key.upArrow) {
        // Navigate UP - encapsulated cycling behavior in hook
        const result = completion.navigateUp();
        if (result) {
          textChangeFromCyclingRef.current = true; // Mark as cycling, not typing
          onChange(result.text);
          setCursorPos(result.cursorPosition);
        }
        return;
      }
      if (key.downArrow) {
        // Navigate DOWN - encapsulated cycling behavior in hook
        const result = completion.navigateDown();
        if (result) {
          textChangeFromCyclingRef.current = true; // Mark as cycling, not typing
          onChange(result.text);
          setCursorPos(result.cursorPosition);
        }
        return;
      }
      if (key.leftArrow) {
        completion.close();
        if (cursorPos > 0) setCursorPos(cursorPos - 1);
        return;
      }
      if (key.rightArrow) {
        completion.close();
        if (cursorPos < value.length) {
          setCursorPos(cursorPos + 1);
        } else if (suggestion) {
          acceptAndApplySuggestion();
        }
        return;
      }
      if (key.escape) {
        // Cancel and close dropdown
        completion.close();
        return;
      }
      // Tab behavior in dropdown:
      // - Shift+Tab on directory => DRILL (continue browsing)
      // - Tab => toggle close/open (never auto-select)
      // - Selection remains explicit via Enter
      if (isTabKey) {
        if (key.shift && selectedItem?.availableActions.includes("DRILL")) {
          executeCompletionAction(selectedItem, "DRILL");
          return;
        }
        handleTab();
        return;
      }

      // Enter confirms selection (SELECT).
      // Modified enter (Shift/Alt/Cmd+Enter) is handled earlier as newline.
      if ((key.return || input === "\r" || input === "\n") && selectedItem) {
        executeCompletionAction(selectedItem, "SELECT");
        return;
      }
    }

    const composerBinding = inspectHandlerKeybinding(input, key, {
      categories: COMPOSER_KEYBINDING_CATEGORIES,
    });
    if (composerBinding.kind === "handler") {
      void executeHandler(composerBinding.id);
      return;
    }
    if (
      composerBinding.kind === "disabled-default" ||
      composerBinding.kind === "shadowed"
    ) {
      return;
    }

    // Enter (0x0D) - submit if balanced. Ctrl+J (0x0A) is newline, handled above.
    if (isEnterLikeInput) {
      // Wait for async attachment resolution before submit so placeholders map to real attachments.
      if (pendingAttachmentOpsRef.current > 0) {
        return;
      }

      const finalValue = resolveSuggestionValue(value, suggestion, "submit");

      // Backslash-Enter: replace trailing \ with newline for explicit multi-line
      const charBeforeCursor = cursorPos > 0 ? finalValue[cursorPos - 1] : "";
      if (charBeforeCursor === "\\") {
        pushUndo();
        const before = finalValue.slice(0, cursorPos - 1);
        const after = finalValue.slice(cursorPos);
        onChange(before + "\n" + after);
        setCursorPos(cursorPos); // cursor at same offset (now after the \n)
        return;
      }

      const trimmed = finalValue.trim();

      // Allow submission for @mention queries without balanced parens check
      const hasAtMention = trimmed.startsWith("@") || trimmed.includes(" @");
      // Allow submission if we have attachments (e.g., "[Image #1] describe this")
      const hasAttachments = attachments.length > 0;
      if (trimmed && (isBalanced(trimmed) || hasAtMention || hasAttachments)) {
        onSubmit(trimmed, attachments.length > 0 ? attachments : undefined);
        resetAfterSubmit();
      } else if (trimmed && !isBalanced(trimmed)) {
        // Unbalanced brackets: enter continuation mode (insert newline)
        // This allows multi-line input for incomplete expressions
        insertAt("\n");
      }
      return;
    }

    // Tab always controls completion dropdown visibility.
    // It never accepts ghost text directly.
    if (isTabKey) {
      // Open dropdown (Shift+Tab same as Tab when dropdown not visible)
      // or close it if already visible (toggle behavior in handleTab).
      handleTab();
      return;
    }

    // Arrow keys (when dropdown not visible)
    // Multiline: move between lines. Single-line: jump to edge then history.
    if (key.upArrow) {
      const lines = value.split("\n");
      if (lines.length > 1) {
        // Find current line and column from cursor position
        let pos = 0;
        let lineIdx = 0;
        for (let i = 0; i < lines.length; i++) {
          if (pos + lines[i].length >= cursorPos) {
            lineIdx = i;
            break;
          }
          pos += lines[i].length + 1; // +1 for \n
        }
        const col = cursorPos - pos;
        if (lineIdx > 0) {
          // Move to same column on previous line (clamped)
          const prevLineStart = pos - lines[lineIdx - 1].length - 1;
          setCursorPos(
            prevLineStart + Math.min(col, lines[lineIdx - 1].length),
          );
        } else {
          // Already on first line: navigate history
          navigateHistory(-1);
        }
      } else if (cursorPos > 0) {
        setCursorPos(0);
      } else {
        navigateHistory(-1);
      }
      return;
    }
    if (key.downArrow) {
      const lines = value.split("\n");
      if (lines.length > 1) {
        let pos = 0;
        let lineIdx = 0;
        for (let i = 0; i < lines.length; i++) {
          if (pos + lines[i].length >= cursorPos) {
            lineIdx = i;
            break;
          }
          pos += lines[i].length + 1;
        }
        const col = cursorPos - pos;
        if (lineIdx < lines.length - 1) {
          // Move to same column on next line (clamped)
          const nextLineStart = pos + lines[lineIdx].length + 1;
          setCursorPos(
            nextLineStart + Math.min(col, lines[lineIdx + 1].length),
          );
        } else {
          // Already on last line: navigate history
          navigateHistory(1);
        }
      } else if (cursorPos < value.length) {
        setCursorPos(value.length);
      } else {
        navigateHistory(1);
      }
      return;
    }
    // Left/Right arrows (simple movement - modifiers handled earlier)
    if (key.leftArrow) {
      if (cursorPos > 0) setCursorPos(cursorPos - 1);
      return;
    }
    if (key.rightArrow) {
      if (cursorPos < value.length) {
        setCursorPos(cursorPos + 1);
      } else if (suggestion) {
        // At end with suggestion: accept ghost text
        acceptAndApplySuggestion();
      }
      return;
    }

    // Standard readline Ctrl+key shortcuts
    // CROSS-PLATFORM: Handle both key.ctrl flag AND bare control codes
    // Some terminals set key.ctrl=true, others just send the control code (ASCII 1-26)
    const ctrlCode = input?.charCodeAt(0) ?? 0;
    const isCtrlCode = ctrlCode >= 1 && ctrlCode <= 26;

    if (key.ctrl || isCtrlCode) {
      // Paredit helper using current value/cursorPos closure (with undo)
      const applyParedit = (fn: PareditFn) => {
        const result = fn(value, cursorPos);
        if (result) {
          pushUndo();
          onChange(result.newValue);
          setCursorPos(result.newCursor);
        }
      };

      // Normalize: convert control code to lowercase letter
      // Control codes: A=1, B=2, ... Z=26
      const normalizedInput = isCtrlCode
        ? String.fromCharCode(ctrlCode + 96) // Convert control code to lowercase letter
        : input?.toLowerCase() ?? "";

      switch (normalizedInput) {
        case "a": // Ctrl+A = Start of line
          setCursorPos(0);
          return;
        case "e": // Ctrl+E = End of line (also accept suggestion)
          if (suggestion && cursorPos === value.length) {
            acceptAndApplySuggestion();
          } else {
            setCursorPos(value.length);
          }
          return;
        case "w": { // Ctrl+W = Delete word backward
          const { v, c } = getCleanedValue();
          deleteWord(v, c);
          return;
        }
        case "u": { // Ctrl+U = Delete to start of line
          pushUndo();
          const { v, c } = getCleanedValue();
          onChange(v.slice(c));
          setCursorPos(0);
          return;
        }
        case "k": { // Ctrl+K = Delete to end of line
          pushUndo();
          const { v, c } = getCleanedValue();
          onChange(v.slice(0, c));
          return;
        }

        // ═══════════════════════════════════════════════════════════════
        // PAREDIT: Ctrl+letter (cross-platform, reliable)
        //
        // Left-hand keys (QWERTY):
        //   Ctrl+G = Wrap        |foo     →  (|foo)
        //   Ctrl+F = Slurp →     (a|) b   →  (a| b)
        //   Ctrl+V = Slurp ←     a (|b)   →  (a |b)
        //   Ctrl+X = Barf →      (a| b)   →  (a|) b
        //   Ctrl+Q = Barf ←      (a |b)   →  a (|b)
        //
        // Right-hand keys:
        //   Ctrl+Y = Splice      ((|a))   →  (|a)
        //   Ctrl+L = Raise       (x (|y)) →  (|y)
        //   Ctrl+O = Kill        (a |b c) →  (a |)
        // ═══════════════════════════════════════════════════════════════
        case "g":
          applyParedit(wrapSexp);
          return; // Ctrl+G = Wrap
        case "f":
          applyParedit(slurpForward);
          return; // Ctrl+F = Slurp forward
        case "v":
          applyParedit(slurpBackward);
          return; // Ctrl+V = Slurp backward
        case "x":
          applyParedit(barfForward);
          return; // Ctrl+X = Barf forward
        case "q":
          applyParedit(barfBackward);
          return; // Ctrl+Q = Barf backward
        case "y":
          applyParedit(spliceSexp);
          return; // Ctrl+Y = Splice
        case "l":
          applyParedit(raiseSexp);
          return; // Ctrl+L = Raise
        case "o":
          applyParedit(killSexp);
          return; // Ctrl+O = Kill

        case "j": // Ctrl+J = insert newline (universal terminal convention)
          insertAt("\n");
          return;

          // Note: Ctrl+P = Command Palette (handled in App.tsx)
          // Note: Ctrl+D = EOF (handled in App.tsx)
          // Note: Ctrl+B = Tasks Panel (handled in App.tsx)
          // Note: Ctrl+R = History Search (handled above)
      }
      return;
    }

    // Backspace - uses encapsulated helper from syntax.ts
    // Auto-pair deletion is handled by deleteBackWithPairSupport() for ()[]{}
    // Quote pair deletion is handled by isInsideEmptyQuotePair() for ""''
    // Dropdown close is handled by the auto-trigger useEffect (single responsibility)
    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        pushUndo();
        // Check for empty quote pair first: "|" or '|'
        if (isInsideEmptyQuotePair(value, cursorPos)) {
          const newValue = value.slice(0, cursorPos - 1) +
            value.slice(cursorPos + 1);
          onChange(newValue);
          setCursorPos(cursorPos - 1);
          return;
        }
        // Regular pair deletion for ()[]{}
        const { newValue, newCursor } = deleteBackWithPairSupport(
          value,
          cursorPos,
        );
        onChange(newValue);
        setCursorPos(newCursor);
      }
      return;
    }

    // Regular character input with paste detection
    if (input && !key.ctrl && !key.meta) {
      // For symbol provider: keep dropdown open, it will re-filter via useEffect
      // For @mention and /command: also handled by auto-trigger useEffect

      const now = Date.now();
      const timeSinceLastInput = now - lastInputTimeRef.current;
      lastInputTimeRef.current = now;

      // Helper: process text that might need collapsing
      const processTextInput = (text: string) => {
        // Normalize line endings: \r\n -> \n, \r -> \n
        // Terminal.app sends \r for newlines in paste, which would overwrite text!
        const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

        // Check for media file path
        const cleanText = normalizedText.replace(/\\ /g, " ").replace(
          /\\'/g,
          "'",
        ).replace(/\\"/g, '"').trim();
        const isAbsolutePath = cleanText.startsWith("/") ||
          cleanText.startsWith("~");

        if (isAbsolutePath && isSupportedConversationMedia(cleanText)) {
          const id = reserveNextId();
          const mimeType = detectMimeType(cleanText);
          const type = getAttachmentType(mimeType);
          const displayName = getDisplayName(type, id);
          insertAt(displayName + " ");
          addAttachmentWithId(cleanText, id);
          return;
        }

        // Check for large text paste that should collapse
        if (shouldCollapseText(normalizedText)) {
          const textAttachment = addTextAttachment(normalizedText);
          insertAt(textAttachment.displayName + " ");
          return;
        }

        // Normal text - insert directly
        insertAt(normalizedText);
      };

      // Helper: process accumulated paste buffer
      const processPasteBuffer = () => {
        const buffer = pasteBufferRef.current;
        pasteBufferRef.current = "";
        if (buffer) {
          processTextInput(buffer);
        }
      };

      // Paste detection - ONLY buffer on definite paste indicators:
      // - Multi-char input (terminal sent batch) → START buffer
      // - Has newlines (definitely paste) → START buffer
      // - Already buffering + rapid input (< 30ms) → CONTINUE buffer
      // Single char typing is ALWAYS immediate (never triggers buffering)
      const hasNewlines = hasNewlineChars(input);
      const isMultiChar = input.length > 1;
      const isBuffering = pasteBufferRef.current.length > 0;
      const isRapidInput = timeSinceLastInput < PASTE_CONTINUE_THRESHOLD_MS;

      // START buffer only on definite paste, CONTINUE only if rapid
      const shouldStartBuffer = hasNewlines || isMultiChar;
      const shouldContinueBuffer = isBuffering && isRapidInput;
      const shouldBuffer = shouldStartBuffer || shouldContinueBuffer;

      if (shouldBuffer) {
        // Accumulate in paste buffer
        pasteBufferRef.current += input;

        // Clear existing timeout
        if (pasteTimeoutRef.current) {
          clearTimeout(pasteTimeoutRef.current);
        }

        // Set new debounce timeout - wait for more chunks before processing
        pasteTimeoutRef.current = setTimeout(() => {
          pasteTimeoutRef.current = null;
          processPasteBuffer();
        }, PASTE_PROCESS_DELAY_MS);

        return;
      }

      // Not buffering - but clear any STALE buffer content first!
      // This can happen if paste was interrupted or timed out incorrectly
      if (pasteBufferRef.current) {
        // Discard stale buffer (it's corrupted/incomplete from failed paste)
        pasteBufferRef.current = "";
        if (pasteTimeoutRef.current) {
          clearTimeout(pasteTimeoutRef.current);
          pasteTimeoutRef.current = null;
        }
      }

      // Single character - insert directly
      insertAt(input);
    }
  }); // Note: disabled check is via disabledRef.current at top of callback (avoids stale closure)

  // Render with syntax highlighting
  // Paren matching: highlight BOTH brackets of a pair when cursor is ON/NEAR any delimiter
  // Returns array of [cursorBracketPos, matchingBracketPos] for pair highlighting
  const bracketPair = useMemo(() => {
    // Check if cursor is ON a bracket (opening or closing)
    if (cursorPos < value.length) {
      const ch = value[cursorPos];
      if ("()[]{}".includes(ch)) {
        const matchPos = findMatchingParen(value, cursorPos);
        if (matchPos !== null) {
          return [cursorPos, matchPos]; // Both brackets of the pair
        }
      }
    }
    // Check if cursor is just AFTER a closing bracket
    if (cursorPos > 0) {
      const ch = value[cursorPos - 1];
      if (")]}".includes(ch)) {
        const matchPos = findMatchingParen(value, cursorPos - 1);
        if (matchPos !== null) {
          return [cursorPos - 1, matchPos]; // Both brackets of the pair
        }
      }
    }
    return null;
  }, [value, cursorPos]);

  const rawGhostText = suggestion ? suggestion.ghost : "";
  // Truncate ghost text to fit on one line — prevents multiline wrap from jumping the input bar
  const ghostText = useMemo(() => {
    if (!rawGhostText) return "";
    const termCols = stdout?.columns ?? 80;
    const valueLines = value.split("\n");
    const lastLine = valueLines[valueLines.length - 1] ?? "";
    const promptLen =
      getInputPromptPrefix(promptLabel, valueLines.length - 1).length;
    const usedCols = promptLen + lastLine.length;
    const available = Math.max(0, termCols - usedCols - 1);
    return rawGhostText.length <= available
      ? rawGhostText
      : rawGhostText.slice(0, Math.max(0, available - 1)) + "…";
  }, [rawGhostText, stdout?.columns, value, promptLabel]);

  // Helper: get bracket positions adjusted for a text slice
  // Returns positions relative to the slice, filtering out positions outside the range
  const getBracketPositionsForSlice = (
    sliceStart: number,
    sliceEnd: number,
  ): number[] | null => {
    if (!bracketPair) return null;
    const positions: number[] = [];
    for (const pos of bracketPair) {
      if (pos >= sliceStart && pos < sliceEnd) {
        positions.push(pos - sliceStart); // Convert to slice-relative
      }
    }
    return positions.length > 0 ? positions : null;
  };

  // Helper: render text with placeholder highlighting
  // OPTIMIZED: O(n) single pass instead of O(n²) nested loops
  const renderWithPlaceholders = (
    text: string,
    startOffset: number,
  ): string => {
    const renderHighlighted = (
      chunk: string,
      bracketPositions: number[] | null,
    ): string =>
      highlightMode === "chat" ? chunk : highlight(chunk, bracketPositions);

    const sliceBrackets = getBracketPositionsForSlice(
      startOffset,
      startOffset + text.length,
    );

    if (!isInPlaceholderMode() || placeholders.length === 0) {
      return renderHighlighted(text, sliceBrackets);
    }

    // Filter placeholders that overlap with this text range [startOffset, startOffset + text.length)
    const endOffset = startOffset + text.length;
    const relevantPhs = placeholders
      .map((ph: Placeholder, idx: number) => ({ ph, idx }))
      .filter(({ ph }: { ph: Placeholder }) =>
        ph.start < endOffset && ph.start + ph.length > startOffset
      );

    if (relevantPhs.length === 0) {
      return renderHighlighted(text, sliceBrackets);
    }

    // Build result in single pass through text, iterating placeholders once
    let result = "";
    let textPos = 0;
    let phIdx = 0;

    while (textPos < text.length) {
      const pos = startOffset + textPos;

      // Skip placeholders that end before current position
      while (
        phIdx < relevantPhs.length &&
        relevantPhs[phIdx].ph.start + relevantPhs[phIdx].ph.length <= pos
      ) {
        phIdx++;
      }

      // Check if current position is inside a placeholder
      if (phIdx < relevantPhs.length) {
        const { ph, idx: originalIdx } = relevantPhs[phIdx];

        if (pos >= ph.start && pos < ph.start + ph.length) {
          // Inside placeholder - render text before it first (if any)
          const phStartInText = Math.max(0, ph.start - startOffset);
          if (phStartInText > textPos) {
            const chunkStart = startOffset + textPos;
            const chunkEnd = startOffset + phStartInText;
            const chunkBrackets = getBracketPositionsForSlice(
              chunkStart,
              chunkEnd,
            );
            // Adjust positions to be relative to the slice being highlighted
            const adjustedBrackets = chunkBrackets?.map((p) => p - textPos) ??
              null;
            result += renderHighlighted(
              text.slice(textPos, phStartInText),
              adjustedBrackets,
            );
          }

          // Render placeholder text with styling
          const phEndInText = Math.min(
            text.length,
            ph.start + ph.length - startOffset,
          );
          const phText = text.slice(
            Math.max(textPos, phStartInText),
            phEndInText,
          );

          if (ph.touched) {
            result += renderHighlighted(phText, null);
          } else if (originalIdx === placeholderIndex) {
            result += getThemedAnsi().accent + phText + RESET;
          } else {
            result += getThemedAnsi().muted + phText + RESET;
          }

          textPos = phEndInText;
          continue;
        }

        // Not in placeholder - render text up to next placeholder
        const nextPhStart = Math.min(text.length, ph.start - startOffset);
        const chunkStart = startOffset + textPos;
        const chunkEnd = startOffset + nextPhStart;
        const chunkBrackets = getBracketPositionsForSlice(chunkStart, chunkEnd);
        const adjustedBrackets = chunkBrackets?.map((p) => p - textPos) ?? null;
        result += renderHighlighted(
          text.slice(textPos, nextPhStart),
          adjustedBrackets,
        );
        textPos = nextPhStart;
      } else {
        // No more placeholders - render rest of text
        const chunkStart = startOffset + textPos;
        const chunkEnd = startOffset + text.length;
        const chunkBrackets = getBracketPositionsForSlice(chunkStart, chunkEnd);
        const adjustedBrackets = chunkBrackets?.map((p) => p - textPos) ?? null;
        result += renderHighlighted(text.slice(textPos), adjustedBrackets);
        break;
      }
    }

    return result;
  };

  // Multi-line support: split value by newlines
  const lines = value.split("\n");

  // Calculate cursor line and column
  let cursorLine = 0;
  let cursorCol = cursorPos;
  let charCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineLen = lines[i].length;
    if (charCount + lineLen >= cursorPos) {
      cursorLine = i;
      cursorCol = cursorPos - charCount;
      break;
    }
    charCount += lineLen + 1; // +1 for newline
  }

  // Render a single line with cursor if applicable
  const renderLine = (
    line: string,
    lineIndex: number,
    lineStartOffset: number,
  ): React.ReactNode => {
    const isCurrentLine = lineIndex === cursorLine;
    const promptText = lineIndex === 0
      ? promptLabel
      : " ".repeat(promptLabel.length);

    if (!isCurrentLine) {
      // No cursor on this line
      return (
        <Box key={lineIndex}>
          <Text color={color("primary")} bold>{promptText}</Text>
          <Text>{" "}{renderWithPlaceholders(line, lineStartOffset)}</Text>
        </Box>
      );
    }

    // This line has the cursor
    const beforeCursor = line.slice(0, cursorCol);
    const charAtCursor = line[cursorCol] || " ";
    const afterCursor = line.slice(cursorCol + 1);

    return (
      <Box key={lineIndex}>
        <Text color={color("primary")} bold>{promptText}</Text>
        <Text>
          {" "}
          {renderWithPlaceholders(beforeCursor, lineStartOffset)}
        </Text>
        <Text backgroundColor="white" color="black">{charAtCursor}</Text>
        <Text>
          {renderWithPlaceholders(afterCursor, lineStartOffset + cursorCol + 1)}
        </Text>
        {lineIndex === lines.length - 1 && ghostText && (
          <Text dimColor>{ghostText}</Text>
        )}
      </Box>
    );
  };

  // Calculate line start offsets
  let offset = 0;
  const lineElements: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    lineElements.push(renderLine(lines[i], i, offset));
    offset += lines[i].length + 1; // +1 for newline
  }

  // ============================================================
  // FIX C1: Unified mode guard - ensure only ONE overlay at a time
  // Priority: history search > placeholder > completion
  // This prevents UI corruption from overlapping overlays
  // ============================================================
  const activeOverlay = useMemo(
    (): "history" | "placeholder" | "completion" | "none" => {
      if (historySearch.state.isSearching) return "history";
      if (isInPlaceholderMode()) return "placeholder";
      if (completion.renderProps) return "completion";
      return "none";
    },
    [
      historySearch.state.isSearching,
      placeholders,
      placeholderIndex,
      completion.renderProps,
    ],
  );

  const completionReservedRows = activeOverlay === "completion" &&
      completion.renderProps
    ? MAX_VISIBLE_ITEMS + 3 + (completion.renderProps.showDocPanel ? 14 : 0)
    : 0;
  const layoutRows = lineElements.length + (attachmentError ? 1 : 0) +
    (activeOverlay === "placeholder" ? 1 : 0) +
    (activeOverlay === "history" ? 2 : 0) +
    completionReservedRows;

  return (
    <Box flexDirection="column">
      {/* Show attachment error only */}
      {attachmentError && (
        <Box>
          <Text color={color("error")}>⚠ {attachmentError.message}</Text>
        </Box>
      )}

      {/* Input lines */}
      {lineElements}

      {/* Placeholder mode hint - shows current parameter context */}
      {/* FIX M4: Use getCurrentPlaceholder for safe bounds-checked access */}
      {activeOverlay === "placeholder" && (() => {
        const currentPh = getCurrentPlaceholder();
        return (
          <Box marginLeft={5}>
            <Text dimColor>
              {currentPh && (
                <Text color={color("accent")}>{currentPh.text}</Text>
              )}
              {currentPh && " "}
              ({placeholderIndex + 1}/{placeholders.length}) • Tab: next •
              Shift+Tab: prev • Esc: exit
            </Text>
          </Box>
        );
      })()}

      {/* Ctrl+R history search prompt */}
      {activeOverlay === "history" && (
        <HistorySearchPrompt state={historySearch.state} />
      )}

      {/* Unified completion dropdown (@mention, symbols, commands) */}
      {activeOverlay === "completion" && completion.renderProps && (
        <Dropdown
          items={completion.renderProps.items}
          selectedIndex={completion.renderProps.selectedIndex}
          helpText={completion.renderProps.helpText}
          isLoading={completion.renderProps.isLoading}
          showDocPanel={completion.renderProps.showDocPanel}
        />
      )}
    </Box>
  );
}
