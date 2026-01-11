/**
 * HQL Ink REPL - Input Component
 * Full keyboard handling with syntax highlighting, completions, history
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from "npm:react@18";
import { Text, Box, useInput } from "npm:ink@5";
import {
  highlight,
  findMatchingParen,
  isBalanced,
  getUnclosedDepth,
  forwardSexp,
  backwardSexp,
  backwardUpSexp,
  forwardDownSexp,
  OPEN_TO_CLOSE,
  deleteBackWithPairSupport,
} from "../../repl/syntax.ts";
import { findSuggestion, acceptSuggestion, type Suggestion } from "../../repl/suggester.ts";
import { shouldTabAcceptSuggestion } from "../../repl/tab-logic.ts";
import { calculateWordBackPosition, calculateWordForwardPosition } from "../../repl/keyboard.ts";
import { isSupportedMedia, detectMimeType, getAttachmentType, getDisplayName, shouldCollapseText } from "../../repl/attachment.ts";
import { useAttachments, type AnyAttachment } from "../hooks/useAttachments.ts";
import { useHistorySearch } from "../hooks/useHistorySearch.ts";
import { HistorySearchPrompt } from "./HistorySearchPrompt.tsx";
import { ANSI_COLORS, getThemedAnsi } from "../../ansi.ts";
import { useTheme } from "../../theme/index.ts";

// Unified Completion System
import {
  useCompletion,
  Dropdown,
  ATTACHMENT_PLACEHOLDER,
  getWordAtCursor,
  type CompletionItem,
  type CompletionAction,
} from "../completion/index.ts";

// Option+Enter detection timeout (ms)
// Terminal sends ESC (0x1b) followed by Enter (0x0d) for Option+Enter
// ESC sequences arrive within ~5-10ms, so 25ms is enough to detect them
// while feeling instant to humans (perception threshold is ~50-100ms)
const ESCAPE_MODIFIER_TIMEOUT = 25;

// Paste detection: only buffer when we have definite paste indicators
// Multi-char input or newlines START buffering
// Rapid input CONTINUES buffering for char-by-char pastes
// Single char typing is ALWAYS immediate (never buffered)
//
// Two thresholds for different purposes:
// - CONTINUE: Detect if input is part of ongoing paste (char-by-char paste detection)
// - PROCESS_DELAY: Wait for more chunks before processing (terminal paste timing varies)
const PASTE_CONTINUE_THRESHOLD_MS = 100;  // Char-by-char paste arrives < 100ms apart (increased for slow terminals)
const PASTE_PROCESS_DELAY_MS = 300;       // Wait 300ms for more chunks before processing (increased for slow terminals)

// ANSI Reset constant
const { RESET } = ANSI_COLORS;

// Fast newline check - avoids regex compilation on every keystroke
function hasNewlineChars(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    if (ch === 10 || ch === 13) return true;  // \n or \r
  }
  return false;
}

// Placeholder for function parameter completion
interface Placeholder {
  start: number;    // Position in value string
  length: number;   // Current length of placeholder text
  text: string;     // Original param name (e.g., "x")
  touched: boolean; // Has user typed in this placeholder?
}

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string, attachments?: AnyAttachment[]) => void;
  jsMode?: boolean;
  disabled?: boolean;
  history: string[];
  userBindings: ReadonlySet<string>;
  signatures: Map<string, string[]>;
  docstrings: ReadonlyMap<string, string>;
}

export function Input({
  value,
  onChange,
  onSubmit,
  jsMode = false,
  disabled = false,
  history,
  userBindings,
  signatures,
  docstrings,
}: InputProps): React.ReactElement {
  const [cursorPos, setCursorPos] = useState(value.length);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState("");

  // Theme from context
  const { color } = useTheme();

  // Autosuggestion (ghost text - separate from completion)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  // Unified Completion System (replaces legacy completion + @mention state)
  const completion = useCompletion({
    userBindings,
    signatures,
    docstrings,
    debounceMs: 50,
  });

  // Ctrl+R History Search
  const historySearch = useHistorySearch(history);

  // Attachment management
  const {
    attachments,
    addAttachmentWithId,
    addTextAttachment,
    reserveNextId,
    clearAttachments,
    lastError: attachmentError,
  } = useAttachments();


  // Placeholder mode state for function parameter completion
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [placeholderIndex, setPlaceholderIndex] = useState(-1);

  // Option+Enter detection: ESC followed by Enter within timeout
  const [escapePressed, setEscapePressed] = useState(false);
  const escapeTimeoutRef = useRef<number | null>(null);

  // Paste detection: buffer rapid inputs and process together
  const pasteBufferRef = useRef<string>("");
  const pasteTimeoutRef = useRef<number | null>(null);
  const lastInputTimeRef = useRef<number>(0);

  // Track if text change was from cycling (Up/Down) vs typing
  // When cycling, we don't want to re-filter the dropdown
  const textChangeFromCyclingRef = useRef(false);

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
      if (expectedPrefixRef.current && currentPrefix !== expectedPrefixRef.current) {
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
    if (cursorPos === value.length && value.length > 0 && !completion.isVisible) {
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

    // GENERIC: Re-trigger for ANY provider when dropdown is already open (live filtering)
    // This enables VS Code-like behavior where typing filters the dropdown items
    // The completion system will close dropdown if no items match
    if (completion.isVisible) {
      triggerCompletionRef.current(value, cursorPos);
      return;
    }

    // @mention triggers FileProvider
    const lastAt = textBefore.lastIndexOf("@");
    if (lastAt >= 0) {
      const queryPart = textBefore.slice(lastAt + 1);
      const isAbsolutePath = queryPart.startsWith("/") || queryPart.startsWith("~");
      // Valid @mention context: no spaces (unless absolute path), no ) or "
      if ((!queryPart.includes(" ") || isAbsolutePath) && !queryPart.includes(")") && !queryPart.includes("\"")) {
        const charBefore = lastAt === 0 ? " " : textBefore[lastAt - 1];
        if (charBefore === " " || charBefore === "\t" || charBefore === "(" || charBefore === "[" || lastAt === 0) {
          triggerCompletionRef.current(value, cursorPos);
          return;
        }
      }
    }

    // /command triggers CommandProvider (only at start)
    if (textBefore.trimStart().startsWith("/") && !textBefore.includes(" ")) {
      triggerCompletionRef.current(value, cursorPos);
      return;
    }

    // AUTO-POPUP: Symbol completions when typing 1+ characters
    // This enables VS Code-like IntelliSense behavior
    const { word } = getWordAtCursor(textBefore, cursorPos);
    if (word.length >= 1) {
      // Only trigger if not inside a string literal
      // Simple heuristic: count quotes before cursor
      const quoteCount = (textBefore.match(/"/g) || []).length;
      if (quoteCount % 2 === 0) {
        triggerCompletionRef.current(value, cursorPos);
        return;
      }
    }

    // AUTO-CLOSE: Close dropdown when no meaningful word to complete
    // Single responsibility: this useEffect controls ALL dropdown open/close for symbols
    if (completion.isVisible && word.length === 0) {
      // Check if we're NOT in @mention or /command mode (they have their own rules)
      const lastAt = textBefore.lastIndexOf("@");
      const isInMention = lastAt >= 0 && !textBefore.slice(lastAt + 1).includes(" ");
      const isInCommand = textBefore.trimStart().startsWith("/") && !textBefore.includes(" ");

      if (!isInMention && !isInCommand) {
        completion.close();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, cursorPos, historySearch.state.isSearching, placeholders, placeholderIndex]);

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
  const exitPlaceholderModeAndCleanup = useCallback((removeAll: boolean = false) => {
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
        const removeStart = ph.start > 0 && newValue[ph.start - 1] === ' ' ? ph.start - 1 : ph.start;
        const removeEnd = ph.start + ph.length;
        newValue = newValue.slice(0, removeStart) + newValue.slice(removeEnd);
        if (i <= placeholderIndex) {
          adjustment += (removeEnd - removeStart);
        }
      }
    }

    exitPlaceholderMode();
    return newValue;
  }, [value, placeholders, placeholderIndex, exitPlaceholderMode]);

  // Helper: enter placeholder mode after completing a function
  // FIX C2: Close completion dropdown when entering placeholder mode
  const enterPlaceholderMode = useCallback((params: string[], startPos: number) => {
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
  }, [completion]);

  // Helper: execute completion action (GENERIC - uses item.applyAction)
  // This replaces the old applyCompletionSelection with provider-defined behavior
  const executeCompletionAction = useCallback((item: CompletionItem, action: CompletionAction) => {
    const context = completion.getApplyContext();
    if (!context) return; // No active completion session

    // Let the item define how to apply the action
    const result = item.applyAction(action, context);

    // Handle side effects from providers
    if (result.sideEffect?.type === "ADD_ATTACHMENT") {
      // Media file attachment
      const id = reserveNextId();
      const mimeType = detectMimeType(result.sideEffect.path);
      const type = getAttachmentType(mimeType);
      const displayName = getDisplayName(type, id);
      // Replace placeholder with actual display name
      const finalText = result.text.replace(ATTACHMENT_PLACEHOLDER, displayName);
      onChange(finalText);
      const placeholderLen = ATTACHMENT_PLACEHOLDER.length;
      setCursorPos(result.cursorPosition - placeholderLen + displayName.length);
      addAttachmentWithId(result.sideEffect.path, id);
    } else if (result.sideEffect?.type === "ENTER_PLACEHOLDER_MODE") {
      // Function param completion
      onChange(result.text);
      enterPlaceholderMode(result.sideEffect.params, result.sideEffect.startPos);
    } else if (result.sideEffect?.type === "EXECUTE") {
      // Command execution - close dropdown and submit immediately (single Enter)
      completion.close();
      const finalText = result.text.trim();
      onSubmit(finalText, attachments.length > 0 ? attachments : undefined);
      onChange("");
      setCursorPos(0);
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
  }, [completion, onChange, onSubmit, attachments, clearAttachments, reserveNextId, addAttachmentWithId, enterPlaceholderMode]);

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
  const shiftPlaceholders = (arr: Placeholder[], fromIndex: number, delta: number): Placeholder[] => {
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
      const shifted = shiftPlaceholders(updated, placeholderIndex + 1, char.length);

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
      const shifted = shiftPlaceholders(updated, placeholderIndex + 1, pair.length);

      setPlaceholders(shifted);
      setCursorPos(cursorPos + 1); // Cursor between the pair
    }
  }, [placeholders, placeholderIndex, value, cursorPos, onChange, replaceCurrentPlaceholder]);

  // Helper: handle backspace in placeholder mode
  const backspaceInPlaceholder = useCallback(() => {
    if (placeholderIndex < 0 || placeholderIndex >= placeholders.length) return false;
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
    const newValue = value.slice(0, cursorPos) + text + value.slice(cursorPos);
    onChange(newValue);
    setCursorPos(cursorPos + text.length);
  }, [value, cursorPos, onChange]);

  // Note: deleteBack was removed - now using deleteBackWithPairSupport() from syntax.ts

  // Helper: reset state after submit (DRY helper)
  const resetAfterSubmit = useCallback(() => {
    setHistoryIndex(-1);
    setTempInput("");
    completion.close();
    clearAttachments();
  }, [completion, clearAttachments]);

  // Helper: clear escape timeout (DRY helper)
  const clearEscapeTimeout = useCallback(() => {
    if (escapeTimeoutRef.current) {
      clearTimeout(escapeTimeoutRef.current);
      escapeTimeoutRef.current = null;
    }
  }, []);

  // Helper: reset escape state (DRY helper)
  const resetEscapeState = useCallback(() => {
    setEscapePressed(false);
    clearEscapeTimeout();
  }, [clearEscapeTimeout]);

  // FIX H4: Helper to clear paste buffer on mode transitions
  // This prevents paste data from corrupting history entries or mode state
  const clearPasteBuffer = useCallback(() => {
    if (pasteTimeoutRef.current) {
      clearTimeout(pasteTimeoutRef.current);
      pasteTimeoutRef.current = null;
    }
    pasteBufferRef.current = '';
  }, []);

  // Helper: accept and apply suggestion (DRY helper)
  const acceptAndApplySuggestion = useCallback(() => {
    if (!suggestion) return false;
    const accepted = acceptSuggestion(suggestion);
    onChange(accepted);
    setCursorPos(accepted.length);
    setSuggestion(null);
    return true;
  }, [suggestion, onChange]);

  // Helper: check if character is a word boundary (LISP structural editing)
  // This is a SUBSET of string-utils.ts:WORD_BOUNDARY_CHARS - intentionally.
  // For Ctrl+W, we exclude quotes/comma/semicolon so strings and data structures
  // are treated as atomic units. See string-utils.ts header for full explanation.
  const isWordBoundaryChar = (ch: string): boolean => {
    return ch === " " || ch === "\t" || ch === "(" || ch === ")" ||
           ch === "[" || ch === "]" || ch === "{" || ch === "}";
  };

  // Helper: insert auto-closing delimiter pair
  // Type ( → () with cursor in middle
  // Uses OPEN_TO_CLOSE from syntax.ts (single source of truth for delimiter pairs)
  const insertAutoClosePair = useCallback((openChar: string) => {
    const closeChar = OPEN_TO_CLOSE[openChar];
    if (!closeChar) {
      insertAt(openChar);
      return;
    }
    const newValue = value.slice(0, cursorPos) + openChar + closeChar + value.slice(cursorPos);
    onChange(newValue);
    setCursorPos(cursorPos + 1); // Cursor between the pair
  }, [value, cursorPos, onChange, insertAt]);

  // Helper: delete word backward (Ctrl+W)
  // Accepts optional parameters to work on any value (for placeholder cleanup)
  // LISP-aware: treats parens/brackets as word boundaries
  const deleteWord = useCallback((targetValue?: string, targetCursor?: number) => {
    const v = targetValue ?? value;
    const c = targetCursor ?? cursorPos;
    const before = v.slice(0, c);
    let pos = before.length;
    const originalPos = pos;
    // Skip trailing whitespace (but not parens/brackets - they're significant)
    while (pos > 0 && isWordBoundaryChar(before[pos - 1]) && before[pos - 1] !== "(" && before[pos - 1] !== "[" && before[pos - 1] !== "{") {
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
      if (ch === "(" || ch === "[" || ch === "{" || ch === ")" || ch === "]" || ch === "}") {
        pos--;
      }
    }
    onChange(before.slice(0, pos) + v.slice(c));
    setCursorPos(pos);
  }, [value, cursorPos, onChange]);

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

    // Clear paste buffer to prevent data corruption
    if (pasteTimeoutRef.current) {
      clearTimeout(pasteTimeoutRef.current);
      pasteTimeoutRef.current = null;
    }
    pasteBufferRef.current = '';

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
  }, [history, historyIndex, tempInput, value, onChange]);

  // Helper: handle tab completion when dropdown is NOT visible
  // Opens dropdown and selects first item (no auto-apply - use Tab again to confirm)
  // FIX: Use triggerCompletionRef to avoid stale closure issues with completion object
  const handleTab = useCallback(async () => {
    // Special case: Param insertion when cursor is after function name + space: (ask |
    const beforeCursor = value.slice(0, cursorPos);
    const match = beforeCursor.match(/\(([\w-]+)\s+$/);
    if (match) {
      const funcName = match[1];
      if (signatures.has(funcName)) {
        const params = signatures.get(funcName)!;
        if (params.length > 0) {
          const paramsText = params.join(" ") + ")";
          const newValue = value.slice(0, cursorPos) + paramsText + value.slice(cursorPos);
          onChange(newValue);
          enterPlaceholderMode(params, cursorPos);
          return;
        }
      }
    }

    // Trigger completion and open dropdown (first item selected, NOT applied)
    // User must press Tab again to confirm and apply the selection
    // Use ref to ensure we always have the latest triggerCompletion function
    await triggerCompletionRef.current(value, cursorPos, true);
  }, [value, cursorPos, signatures, onChange, enterPlaceholderMode]);

  // Main input handler
  useInput((input, key) => {
    if (disabled) return;

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
          onChange(selected);
          setCursorPos(selected.length);
        }
        return;
      }

      // Ctrl+R: select next match
      if (key.ctrl && input === 'r') {
        historySearch.actions.selectNext();
        return;
      }

      // Ctrl+S: select previous match
      if (key.ctrl && input === 's') {
        historySearch.actions.selectPrev();
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
      if (input && input.length === 1 && !key.ctrl && !key.meta && !key.escape) {
        historySearch.actions.appendToQuery(input);
        return;
      }

      // Ignore other keys during search
      return;
    }

    // Ctrl+R: start history search (when not in search mode)
    // FIX H1: Close dropdown and exit placeholder mode when entering history search
    // FIX H4: Clear paste buffer to prevent data corruption
    // FIX NEW-1/3: Clear ESC timeout to prevent race condition
    if (key.ctrl && input === 'r') {
      // CRITICAL: Clear escape timeout first to prevent it firing after entering history search
      if (escapeTimeoutRef.current) {
        clearTimeout(escapeTimeoutRef.current);
        escapeTimeoutRef.current = null;
      }
      setEscapePressed(false);

      completion.close();
      exitPlaceholderMode();
      clearPasteBuffer();
      historySearch.actions.startSearch();
      return;
    }

    // ============================================================
    // FAST PATH: Single character typing (most common case)
    // Skip ALL checks for simple character input - maximum speed
    // ============================================================
    if (input &&
        input.length === 1 &&
        !key.ctrl &&
        !key.meta &&
        !key.escape &&
        !key.return &&
        !key.tab &&
        !key.backspace &&
        !key.delete &&
        !key.upArrow &&
        !key.downArrow &&
        !key.leftArrow &&
        !key.rightArrow &&
        !escapePressed &&
        pasteBufferRef.current.length === 0) {
      // Placeholder mode: replace placeholder with typed char
      if (placeholders.length > 0 && placeholderIndex >= 0) {
        if (input === ')') {
          const cleanedValue = exitPlaceholderModeAndCleanup();
          const closingParenPos = cleanedValue.lastIndexOf(')');
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

    // Meta+key: Word navigation (macOS Option, Linux Alt)
    // Also: Alt+Arrow for sexp navigation
    if (key.meta) {
      // ESC+b/f style (macOS Option+Arrow, Linux Alt+Arrow) - word navigation
      if (input === 'b') {
        moveWordBack();
        return;
      }
      if (input === 'f') {
        moveWordForward();
        return;
      }
      // Modified arrow style (some terminals) - word navigation
      if (key.leftArrow) {
        moveWordBack();
        return;
      }
      if (key.rightArrow) {
        moveWordForward();
        return;
      }
      // Alt+Up: backward sexp (paredit-style)
      if (key.upArrow) {
        const newPos = backwardSexp(value, cursorPos);
        if (newPos !== cursorPos) {
          setCursorPos(newPos);
        }
        return;
      }
      // Alt+Down: forward sexp (paredit-style)
      if (key.downArrow) {
        const newPos = forwardSexp(value, cursorPos);
        if (newPos !== cursorPos) {
          setCursorPos(newPos);
        }
        return;
      }
      // Option+Enter / Alt+Enter: insert newline (multi-line input)
      if (key.return) {
        insertAt("\n");
        return;
      }
    }

    // ESC-based sequences (FALLBACK for some terminals)
    // Some terminals may send ESC sequences instead of meta

    // CASE 1: ESC + key in SAME event (key.escape true with other keys/input)
    if (key.escape) {
      // Check for ESC + arrow in same event (Option+Arrow)
      if (key.leftArrow) {
        moveWordBack();
        return;
      }
      if (key.rightArrow) {
        moveWordForward();
        return;
      }
      // Check for ESC + b/f in same event (readline-style word nav)
      if (input === 'b') {
        moveWordBack();
        return;
      }
      if (input === 'f') {
        moveWordForward();
        return;
      }
      // Check for ESC + Enter in same event (Option+Enter)
      if (key.return) {
        insertAt("\n");
        return;
      }

      // Pure ESC key (no combination) - handle special modes or start detection
      // In placeholder mode: ESC exits AND removes untouched placeholders (they're hints, not real text)
      if (isInPlaceholderMode()) {
        const cleanedValue = exitPlaceholderModeAndCleanup();
        onChange(cleanedValue);
        setCursorPos(Math.min(cursorPos, cleanedValue.length));
        return;
      }
      // In completion mode: ESC closes dropdown
      if (completion.isVisible) {
        completion.close();
        return;
      }
      // Start Option+key detection for NEXT event (two-event sequence)
      // If no follow-up key within timeout, clear input (Claude Code behavior)
      setEscapePressed(true);
      clearEscapeTimeout();
      escapeTimeoutRef.current = setTimeout(() => {
        setEscapePressed(false);
        escapeTimeoutRef.current = null;
        // FIX NEW-1: Guard against mode changes - don't clear if history search started
        // ESC alone (no follow-up key) → clear input like Claude Code
        // But only if not in history search mode (user might have pressed Ctrl+R after ESC)
        if (!historySearch.state.isSearching && value.length > 0) {
          onChange("");
          setCursorPos(0);
          completion.close();
          clearAttachments();
        }
      }, ESCAPE_MODIFIER_TIMEOUT) as unknown as number;
      return;
    }

    // CASE 2: ESC was pressed in PREVIOUS event (two-event sequence)
    if (escapePressed) {
      // Option+Left: word back
      if (key.leftArrow) {
        resetEscapeState();
        moveWordBack();
        return;
      }
      // Option+Right: word forward
      if (key.rightArrow) {
        resetEscapeState();
        moveWordForward();
        return;
      }
      // Readline-style ESC+b: word back
      if (input === 'b') {
        resetEscapeState();
        moveWordBack();
        return;
      }
      // Readline-style ESC+f: word forward
      if (input === 'f') {
        resetEscapeState();
        moveWordForward();
        return;
      }
      // Option+Enter: insert newline
      if (key.return) {
        resetEscapeState();
        insertAt("\n");
        return;
      }
      // Clear escape state on any other key
      resetEscapeState();
    }

    // Placeholder mode handling (highest priority)
    if (isInPlaceholderMode()) {
      // Tab navigates placeholders
      if (key.tab) {
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
          onSubmit(value.trim(), attachments.length > 0 ? attachments : undefined);
          resetAfterSubmit();
        }
        return;
      }

      // Backspace in placeholder mode
      if (key.backspace || key.delete) {
        if (backspaceInPlaceholder()) {
          return;
        }
        // FIX: If backspace is outside placeholder bounds, cleanup placeholders
        // Determine if cursor is before first placeholder (function name area)
        // If so, user is deleting the function name - remove ALL placeholders
        const firstPh = placeholders[0];
        const isDeletingFunctionName = firstPh && cursorPos <= firstPh.start;

        // removeAll=true when deleting function name, false otherwise (only remove untouched)
        const cleanedValue = exitPlaceholderModeAndCleanup(isDeletingFunctionName);

        // Adjust cursor position for cleaned value
        const newCursor = Math.min(cursorPos, cleanedValue.length);

        // Perform backspace on cleaned value
        if (newCursor > 0) {
          const afterBackspace = cleanedValue.slice(0, newCursor - 1) + cleanedValue.slice(newCursor);
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
        if (input === ')') {
          const cleanedValue = exitPlaceholderModeAndCleanup();
          // Find the position of the existing ')' - it's right after the last content
          // After cleanup, untouched placeholders are removed but ')' remains
          const closingParenPos = cleanedValue.lastIndexOf(')');
          onChange(cleanedValue);
          setCursorPos(closingParenPos + 1);
          return;
        }

        // FIX: Check if cursor is within the current placeholder bounds
        // If not, cleanup untouched placeholders (they're hints, not real text) and insert normally
        const ph = placeholders[placeholderIndex];
        const cursorInPlaceholder = ph && cursorPos >= ph.start && cursorPos <= ph.start + ph.length;
        if (!cursorInPlaceholder) {
          const cleanedValue = exitPlaceholderModeAndCleanup();
          // Adjust cursor for cleaned value and insert character
          const newCursor = Math.min(cursorPos, cleanedValue.length);
          // Handle auto-close pairs even when exiting placeholder mode
          if (input in OPEN_TO_CLOSE) {
            const closeChar = OPEN_TO_CLOSE[input];
            const newValue = cleanedValue.slice(0, newCursor) + input + closeChar + cleanedValue.slice(newCursor);
            onChange(newValue);
            setCursorPos(newCursor + 1); // Cursor between the pair
          } else {
            const newValue = cleanedValue.slice(0, newCursor) + input + cleanedValue.slice(newCursor);
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
      // Some terminals send 'd', others send EOF character (ASCII 4)
      if (key.ctrl && (input === 'd' || input === '\x04')) {
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
      if (key.escape) {
        // Cancel and close dropdown
        completion.close();
        return;
      }

      // Tab: DRILL if available, else SELECT
      // - Directories: drill in (keep dropdown open)
      // - Functions with params: select + params (enter placeholder mode)
      // - Others: simple select
      if (key.tab && selectedItem) {
        const action: CompletionAction = selectedItem.availableActions.includes("DRILL")
          ? "DRILL"
          : "SELECT";
        executeCompletionAction(selectedItem, action);
        return;
      }

      // Enter: always SELECT (choose and close)
      if (key.return && selectedItem) {
        executeCompletionAction(selectedItem, "SELECT");
        return;
      }
    }

    // Enter - submit if balanced OR if it's an @mention query
    if (key.return) {
      const trimmed = value.trim();

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

    // Tab - open completion dropdown (when not already visible)
    if (key.tab) {
      // Ghost text suggestion takes priority when at end of line
      if (shouldTabAcceptSuggestion(suggestion, cursorPos, value.length, completion.isVisible)) {
        acceptAndApplySuggestion();
      } else {
        // Open dropdown (Shift+Tab same as Tab when dropdown not visible)
        handleTab();
      }
      return;
    }

    // Arrow keys (when dropdown not visible) - Claude Code style navigation
    // Priority: move cursor to edge first, then history at edges
    if (key.upArrow) {
      if (cursorPos > 0) {
        // Cursor not at beginning: move to beginning first
        setCursorPos(0);
      } else {
        // Cursor already at beginning: navigate to previous history
        navigateHistory(-1);
      }
      return;
    }
    if (key.downArrow) {
      if (cursorPos < value.length) {
        // Cursor not at end: move to end first
        setCursorPos(value.length);
      } else {
        // Cursor already at end: navigate to next history
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

    // Control keys
    if (key.ctrl) {
      switch (input) {
        case "a": // Start of line
          setCursorPos(0);
          return;
        case "e": // End of line (also accept suggestion)
          if (suggestion && cursorPos === value.length) {
            acceptAndApplySuggestion();
          } else {
            setCursorPos(value.length);
          }
          return;
        case "w": { // Delete word (with placeholder cleanup)
          const { v, c } = getCleanedValue();
          deleteWord(v, c);
          return;
        }
        case "u": { // Delete to start (with placeholder cleanup)
          const { v, c } = getCleanedValue();
          onChange(v.slice(c));
          setCursorPos(0);
          return;
        }
        case "k": { // Delete to end (with placeholder cleanup)
          const { v, c } = getCleanedValue();
          onChange(v.slice(0, c));
          return;
        }
        // Note: Ctrl+D (EOF) is handled at the App level, not here
      }
      return;
    }

    // Backspace - uses encapsulated helper from syntax.ts
    // Auto-pair deletion is handled by deleteBackWithPairSupport()
    // Dropdown close is handled by the auto-trigger useEffect (single responsibility)
    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        const { newValue, newCursor } = deleteBackWithPairSupport(value, cursorPos);
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
        const cleanText = normalizedText.replace(/\\ /g, " ").replace(/\\'/g, "'").replace(/\\"/g, '"').trim();
        const isAbsolutePath = cleanText.startsWith("/") || cleanText.startsWith("~");

        if (isAbsolutePath && isSupportedMedia(cleanText)) {
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
        }, PASTE_PROCESS_DELAY_MS) as unknown as number;

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
  }, { isActive: !disabled });

  // Render with syntax highlighting
  // Paren matching: highlight matching paren when cursor is ON any delimiter
  // Check both cursor position and position before cursor (for just-after-close case)
  const matchPos = (() => {
    // Check if cursor is ON a paren (opening or closing)
    if (cursorPos < value.length) {
      const ch = value[cursorPos];
      if ("()[]{}".includes(ch)) {
        return findMatchingParen(value, cursorPos);
      }
    }
    // Check if cursor is just AFTER a paren (legacy behavior for closing parens)
    if (cursorPos > 0) {
      const ch = value[cursorPos - 1];
      if (")]}".includes(ch)) {
        return findMatchingParen(value, cursorPos - 1);
      }
    }
    return null;
  })();

  const ghostText = suggestion ? suggestion.ghost : "";

  // Helper: render text with placeholder highlighting
  // OPTIMIZED: O(n) single pass instead of O(n²) nested loops
  const renderWithPlaceholders = (text: string, startOffset: number): string => {
    if (!isInPlaceholderMode() || placeholders.length === 0) {
      return highlight(text, startOffset === 0 ? matchPos : null);
    }

    // Filter placeholders that overlap with this text range [startOffset, startOffset + text.length)
    const endOffset = startOffset + text.length;
    const relevantPhs = placeholders
      .map((ph: Placeholder, idx: number) => ({ ph, idx }))
      .filter(({ ph }: { ph: Placeholder }) => ph.start < endOffset && ph.start + ph.length > startOffset);

    if (relevantPhs.length === 0) {
      return highlight(text, startOffset === 0 ? matchPos : null);
    }

    // Build result in single pass through text, iterating placeholders once
    let result = "";
    let textPos = 0;
    let phIdx = 0;

    while (textPos < text.length) {
      const pos = startOffset + textPos;

      // Skip placeholders that end before current position
      while (phIdx < relevantPhs.length &&
             relevantPhs[phIdx].ph.start + relevantPhs[phIdx].ph.length <= pos) {
        phIdx++;
      }

      // Check if current position is inside a placeholder
      if (phIdx < relevantPhs.length) {
        const { ph, idx: originalIdx } = relevantPhs[phIdx];

        if (pos >= ph.start && pos < ph.start + ph.length) {
          // Inside placeholder - render text before it first (if any)
          const phStartInText = Math.max(0, ph.start - startOffset);
          if (phStartInText > textPos) {
            result += highlight(text.slice(textPos, phStartInText), textPos === 0 && startOffset === 0 ? matchPos : null);
          }

          // Render placeholder text with styling
          const phEndInText = Math.min(text.length, ph.start + ph.length - startOffset);
          const phText = text.slice(Math.max(textPos, phStartInText), phEndInText);

          if (ph.touched) {
            result += highlight(phText, null);
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
        result += highlight(text.slice(textPos, nextPhStart), textPos === 0 && startOffset === 0 ? matchPos : null);
        textPos = nextPhStart;
      } else {
        // No more placeholders - render rest of text
        result += highlight(text.slice(textPos), textPos === 0 && startOffset === 0 ? matchPos : null);
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

  // Calculate unclosed depth for continuation prompt (memoized per render)
  const unclosedDepth = lines.length > 1 ? getUnclosedDepth(value) : 0;

  // Render a single line with cursor if applicable
  const renderLine = (line: string, lineIndex: number, lineStartOffset: number): React.ReactNode => {
    const isCurrentLine = lineIndex === cursorLine;
    // Show depth indicator on continuation lines: "..1>" or "..2>" etc.
    const prompt = lineIndex === 0
      ? (jsMode ? "js>" : "hql>")
      : (unclosedDepth > 0 ? `..${unclosedDepth}>` : "...>");

    if (!isCurrentLine) {
      // No cursor on this line
      return (
        <Box key={lineIndex}>
          <Text color={color("primary")} bold>{prompt} </Text>
          <Text>{renderWithPlaceholders(line, lineStartOffset)}</Text>
        </Box>
      );
    }

    // This line has the cursor
    const beforeCursor = line.slice(0, cursorCol);
    const charAtCursor = line[cursorCol] || " ";
    const afterCursor = line.slice(cursorCol + 1);

    return (
      <Box key={lineIndex}>
        <Text color={color("primary")} bold>{prompt} </Text>
        <Text>{renderWithPlaceholders(beforeCursor, lineStartOffset)}</Text>
        <Text backgroundColor="white" color="black">{charAtCursor}</Text>
        <Text>{renderWithPlaceholders(afterCursor, lineStartOffset + cursorCol + 1)}</Text>
        {lineIndex === lines.length - 1 && ghostText && <Text dimColor>{ghostText}</Text>}
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
  const activeOverlay = useMemo((): 'history' | 'placeholder' | 'completion' | 'none' => {
    if (historySearch.state.isSearching) return 'history';
    if (isInPlaceholderMode()) return 'placeholder';
    if (completion.renderProps) return 'completion';
    return 'none';
  }, [historySearch.state.isSearching, placeholders, placeholderIndex, completion.renderProps]);

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
      {activeOverlay === 'placeholder' && (() => {
        const currentPh = getCurrentPlaceholder();
        return (
          <Box marginLeft={5}>
            <Text dimColor>
              {currentPh && (
                <Text color={color("accent")}>{currentPh.text}</Text>
              )}
              {currentPh && " "}
              ({placeholderIndex + 1}/{placeholders.length}) • Tab: next • Shift+Tab: prev • Esc: exit
            </Text>
          </Box>
        );
      })()}

      {/* Ctrl+R history search prompt */}
      {activeOverlay === 'history' && (
        <HistorySearchPrompt state={historySearch.state} />
      )}

      {/* Unified completion dropdown (@mention, symbols, commands) */}
      {activeOverlay === 'completion' && completion.renderProps && (
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
