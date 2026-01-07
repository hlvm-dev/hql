/**
 * HQL Ink REPL - Input Component
 * Full keyboard handling with syntax highlighting, completions, history
 */

import React, { useState, useEffect, useCallback, useRef } from "npm:react@18";
import { Text, Box, useInput } from "npm:ink@5";
import { highlight, findMatchingParen, isBalanced } from "../../repl/syntax.ts";
import { getCompletions, getWordAtCursor, applyCompletion, type CompletionItem } from "../../repl/completer.ts";
import { findSuggestion, acceptSuggestion, type Suggestion } from "../../repl/suggester.ts";
import { shouldTabAcceptSuggestion } from "../../repl/tab-logic.ts";
import { searchFiles, unescapeShellPath, type FileMatch } from "../../repl/file-search.ts";
import { calculateWordBackPosition, calculateWordForwardPosition } from "../../repl/keyboard.ts";
import { isSupportedMedia, detectMimeType, getAttachmentType, getDisplayName, type Attachment } from "../../repl/attachment.ts";
import { useAttachments } from "../hooks/useAttachments.ts";

// Option+Enter detection timeout (ms)
// Terminal sends ESC (0x1b) followed by Enter (0x0d) for Option+Enter
const ESCAPE_MODIFIER_TIMEOUT = 100;

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
  onSubmit: (value: string, attachments?: Attachment[]) => void;
  jsMode?: boolean;
  disabled?: boolean;
  history: string[];
  userBindings: Set<string>;
  signatures: Map<string, string[]>;
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
}: InputProps): React.ReactElement {
  const [cursorPos, setCursorPos] = useState(value.length);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState("");

  // Completion state
  const [completions, setCompletions] = useState<CompletionItem[]>([]);
  const [completionIndex, setCompletionIndex] = useState(-1);
  const [showingCompletions, setShowingCompletions] = useState(false);
  const [completionStart, setCompletionStart] = useState(0);
  const [originalWord, setOriginalWord] = useState("");

  // Autosuggestion
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  // @mention file search state
  const [atMentionMode, setAtMentionMode] = useState(false);
  const [atMentionMatches, setAtMentionMatches] = useState<FileMatch[]>([]);
  const [atMentionIndex, setAtMentionIndex] = useState(0);
  const [atMentionStart, setAtMentionStart] = useState(0);
  const [atMentionLoading, setAtMentionLoading] = useState(false);

  // Attachment management
  const {
    attachments,
    addAttachmentWithId,
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

  // Update cursor pos when value changes externally
  useEffect(() => {
    if (cursorPos > value.length) {
      setCursorPos(value.length);
    }
  }, [value, cursorPos]);

  // Update suggestion when value changes
  useEffect(() => {
    if (cursorPos === value.length && value.length > 0 && !atMentionMode) {
      const found = findSuggestion(value, history, userBindings);
      setSuggestion(found);
    } else {
      setSuggestion(null);
    }
  }, [value, cursorPos, history, userBindings, atMentionMode]);


  // Detect @mention mode and search files
  useEffect(() => {
    // Find the last @ before cursor
    const beforeCursor = value.slice(0, cursorPos);
    const lastAt = beforeCursor.lastIndexOf("@");

    if (lastAt === -1) {
      if (atMentionMode) {
        setAtMentionMode(false);
        setAtMentionMatches([]);
      }
      return;
    }

    // Check if @ is followed by valid path characters
    const queryPart = beforeCursor.slice(lastAt + 1);

    // For absolute paths (starting with / or ~), allow spaces in filenames
    const isAbsolutePath = queryPart.startsWith("/") || queryPart.startsWith("~");

    // Exit @mention if:
    // - Not absolute path AND has space (regular query can't have spaces)
    // - Has ) or " (these end the @mention for code expressions)
    if ((!isAbsolutePath && queryPart.includes(" ")) || queryPart.includes(")") || queryPart.includes("\"")) {
      if (atMentionMode) {
        setAtMentionMode(false);
        setAtMentionMatches([]);
      }
      return;
    }

    // We're in @mention mode - search files
    setAtMentionMode(true);
    setAtMentionStart(lastAt);
    setAtMentionLoading(true);

    // Debounced search
    const timeoutId = setTimeout(async () => {
      try {
        const matches = await searchFiles(queryPart, 8);
        setAtMentionMatches(matches);
        setAtMentionIndex(0);
      } catch {
        // Keep previous matches on error (don't flash empty)
      } finally {
        setAtMentionLoading(false);
      }
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [value, cursorPos, atMentionMode]);

  // Helper: clear @mention state
  const clearAtMention = useCallback(() => {
    setAtMentionMode(false);
    setAtMentionMatches([]);
    setAtMentionIndex(0);
    setAtMentionStart(0);
    setAtMentionLoading(false);
  }, []);

  // Helper: apply @mention selection
  const applyAtMention = useCallback((match: FileMatch) => {
    // Unescape shell-escaped paths for actual file operations
    const cleanPath = unescapeShellPath(match.path);

    // Check if this is a media file
    if (isSupportedMedia(cleanPath)) {
      // ZERO-BLINK: Synchronously compute placeholder and insert it INSTANTLY
      // 1. Reserve ID synchronously
      const id = reserveNextId();
      // 2. Compute display name synchronously (no file I/O needed)
      const mimeType = detectMimeType(cleanPath);
      const type = getAttachmentType(mimeType);
      const displayName = getDisplayName(type, id);
      // 3. Insert placeholder IMMEDIATELY
      const newValue = value.slice(0, atMentionStart) + displayName + " " + value.slice(cursorPos);
      onChange(newValue);
      setCursorPos(atMentionStart + displayName.length + 1);
      // 4. Clear @mention state
      clearAtMention();
      // 5. Process file in background (fire-and-forget)
      addAttachmentWithId(cleanPath, id);
    } else {
      // Not a media file - use standard @path reference
      const newValue = value.slice(0, atMentionStart) + "@" + cleanPath + " " + value.slice(cursorPos);
      onChange(newValue);
      setCursorPos(atMentionStart + 1 + cleanPath.length + 1);
      clearAtMention();
    }
  }, [value, cursorPos, atMentionStart, onChange, clearAtMention, reserveNextId, addAttachmentWithId]);

  // Helper: check if in placeholder mode
  const isInPlaceholderMode = useCallback(() => {
    return placeholders.length > 0 && placeholderIndex >= 0;
  }, [placeholders, placeholderIndex]);

  // Helper: exit placeholder mode
  const exitPlaceholderMode = useCallback(() => {
    setPlaceholders([]);
    setPlaceholderIndex(-1);
  }, []);

  // Helper: exit placeholder mode AND remove untouched placeholders from value
  // Called when user types ')' or other exit-triggering characters
  const exitPlaceholderModeAndCleanup = useCallback(() => {
    if (placeholders.length === 0) {
      exitPlaceholderMode();
      return value;
    }

    // Remove all untouched placeholders from the value (from end to start to preserve indices)
    let newValue = value;
    let adjustment = 0;

    // Process placeholders in reverse order to maintain correct indices
    for (let i = placeholders.length - 1; i >= 0; i--) {
      const ph = placeholders[i];
      if (!ph.touched) {
        // Remove this untouched placeholder (and preceding space if exists)
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
  const enterPlaceholderMode = useCallback((params: string[], startPos: number) => {
    if (params.length === 0) return;

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
  }, []);

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

  // Helper: shift subsequent placeholder positions by delta (DRY - used in 3 places)
  const shiftPlaceholders = (arr: Placeholder[], fromIndex: number, delta: number): void => {
    for (let i = fromIndex; i < arr.length; i++) {
      arr[i] = { ...arr[i], start: arr[i].start + delta };
    }
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

      // Shift subsequent placeholders
      const delta = char.length - ph.length;
      shiftPlaceholders(updated, placeholderIndex + 1, delta);

      setPlaceholders(updated);
      setCursorPos(ph.start + char.length);
    } else {
      // Subsequent chars - insert at cursor within the placeholder
      const before = value.slice(0, cursorPos);
      const after = value.slice(cursorPos);
      onChange(before + char + after);

      // Update this placeholder's length
      updated[placeholderIndex] = { ...ph, length: ph.length + char.length };

      // Shift subsequent placeholders
      shiftPlaceholders(updated, placeholderIndex + 1, char.length);

      setPlaceholders(updated);
      setCursorPos(cursorPos + 1);
    }
  }, [placeholders, placeholderIndex, value, cursorPos, onChange]);

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

    // Update placeholder length
    const updated = [...placeholders];
    updated[placeholderIndex] = { ...ph, length: ph.length - 1, touched: true };

    // Shift subsequent placeholders
    shiftPlaceholders(updated, placeholderIndex + 1, -1);

    setPlaceholders(updated);
    setCursorPos(cursorPos - 1);

    // If placeholder is empty, keep in mode but mark as touched
    return true;
  }, [placeholders, placeholderIndex, value, cursorPos, onChange]);

  // Helper: insert text at cursor
  const insertAt = useCallback((text: string) => {
    const newValue = value.slice(0, cursorPos) + text + value.slice(cursorPos);
    onChange(newValue);
    setCursorPos(cursorPos + text.length);
    clearCompletions();
  }, [value, cursorPos, onChange]);

  // Helper: delete n chars before cursor
  const deleteBack = useCallback((n: number) => {
    if (cursorPos >= n) {
      const newValue = value.slice(0, cursorPos - n) + value.slice(cursorPos);
      onChange(newValue);
      setCursorPos(cursorPos - n);
      clearCompletions();
    }
  }, [value, cursorPos, onChange]);

  // Helper: clear completions
  const clearCompletions = useCallback(() => {
    setCompletions([]);
    setCompletionIndex(-1);
    setShowingCompletions(false);
    setCompletionStart(0);
    setOriginalWord("");
  }, []);

  // Helper: reset state after submit (DRY helper)
  const resetAfterSubmit = useCallback(() => {
    setHistoryIndex(-1);
    setTempInput("");
    clearCompletions();
    clearAtMention();
    clearAttachments();
  }, [clearCompletions, clearAtMention, clearAttachments]);

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

  // Helper: accept and apply suggestion (DRY helper)
  const acceptAndApplySuggestion = useCallback(() => {
    if (!suggestion) return false;
    const accepted = acceptSuggestion(suggestion);
    onChange(accepted);
    setCursorPos(accepted.length);
    setSuggestion(null);
    return true;
  }, [suggestion, onChange]);

  // Helper: delete word backward (Ctrl+W)
  const deleteWord = useCallback(() => {
    const before = value.slice(0, cursorPos);
    let pos = before.length;
    // Skip trailing whitespace
    while (pos > 0 && before[pos - 1] === " ") pos--;
    // Delete word
    while (pos > 0 && before[pos - 1] !== " ") pos--;
    const newValue = before.slice(0, pos) + value.slice(cursorPos);
    onChange(newValue);
    setCursorPos(pos);
    clearCompletions();
  }, [value, cursorPos, onChange, clearCompletions]);

  // Helper: move word backward (Option+Left on macOS, Ctrl+Left on Windows/Linux)
  const moveWordBack = useCallback(() => {
    setCursorPos(calculateWordBackPosition(value, cursorPos));
  }, [value, cursorPos]);

  // Helper: move word forward (Option+Right on macOS, Ctrl+Right on Windows/Linux)
  const moveWordForward = useCallback(() => {
    setCursorPos(calculateWordForwardPosition(value, cursorPos));
  }, [value, cursorPos]);

  // Helper: navigate history
  const navigateHistory = useCallback((direction: number) => {
    if (history.length === 0) return;

    if (direction < 0) {
      // Up arrow - go back in history
      if (historyIndex === -1) {
        // Save current input
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

  // Helper: handle tab completion
  const handleTab = useCallback(() => {
    if (showingCompletions) {
      // Cycle through completions
      const newIndex = (completionIndex + 1) % completions.length;
      setCompletionIndex(newIndex);

      // Restore original and apply new completion
      const restored = value.slice(0, completionStart) + originalWord + value.slice(cursorPos);
      const result = applyCompletion(restored, completionStart + originalWord.length, completions[newIndex]);
      onChange(result.line);
      setCursorPos(result.cursorPos);
    } else {
      // Start new completion
      const { word, start } = getWordAtCursor(value, cursorPos);

      // Param insertion ONLY when cursor is after space: (ask |
      // When there's a word like (ask|, it should cycle through completions instead
      if (word === '') {
        const beforeCursor = value.slice(0, cursorPos);
        // Match pattern: (funcName followed by whitespace at cursor position
        // Use [\w-]+ to support HQL identifiers with hyphens (e.g., map-indexed, take-while)
        const match = beforeCursor.match(/\(([\w-]+)\s+$/);
        if (match) {
          const funcName = match[1];
          if (signatures.has(funcName)) {
            const params = signatures.get(funcName)!;
            if (params.length > 0) {
              // Insert placeholders (no leading space - already have one)
              const paramsText = params.join(" ") + ")";
              const newValue = value.slice(0, cursorPos) + paramsText + value.slice(cursorPos);
              onChange(newValue);
              enterPlaceholderMode(params, cursorPos); // cursor is already after space
              return;
            }
          }
        }
      }

      const items = getCompletions(word, userBindings);

      if (items.length === 0) return;

      if (items.length === 1) {
        // Single match - apply directly
        const result = applyCompletion(value, cursorPos, items[0]);
        onChange(result.line + " ");
        setCursorPos(result.cursorPos + 1);
      } else {
        // Multiple matches - start cycling
        setCompletions(items);
        setCompletionIndex(0);
        setShowingCompletions(true);
        setCompletionStart(start);
        setOriginalWord(word);

        const result = applyCompletion(value, cursorPos, items[0]);
        onChange(result.line);
        setCursorPos(result.cursorPos);
      }
    }
  }, [value, cursorPos, userBindings, showingCompletions, completions, completionIndex, completionStart, originalWord, onChange, signatures, enterPlaceholderMode]);

  // Helper: handle shift+tab (reverse cycle)
  const handleShiftTab = useCallback(() => {
    if (showingCompletions && completions.length > 0) {
      const newIndex = (completionIndex - 1 + completions.length) % completions.length;
      setCompletionIndex(newIndex);

      // Restore original and apply new completion
      const restored = value.slice(0, completionStart) + originalWord + value.slice(cursorPos);
      const result = applyCompletion(restored, completionStart + originalWord.length, completions[newIndex]);
      onChange(result.line);
      setCursorPos(result.cursorPos);
    }
  }, [value, cursorPos, showingCompletions, completions, completionIndex, completionStart, originalWord, onChange]);

  // Main input handler
  useInput((input, key) => {
    if (disabled) return;

    // ============================================================
    // Word Navigation (Cross-Platform)
    // ============================================================
    // macOS: Option+Arrow sends ESC+b/f (input='b'/'f', meta=true)
    // Linux: Alt+Arrow sends ESC+b/f or modified arrows (meta=true)
    // Windows: Ctrl+Arrow sends ctrl=true with arrow keys
    // ============================================================

    // Ctrl+Arrow: Word navigation (Windows/Linux standard)
    if (key.ctrl) {
      if (key.leftArrow) {
        moveWordBack();
        return;
      }
      if (key.rightArrow) {
        moveWordForward();
        return;
      }
    }

    // Meta+key: Word navigation (macOS Option, Linux Alt)
    if (key.meta) {
      // ESC+b/f style (macOS Option+Arrow, Linux Alt+Arrow)
      if (input === 'b') {
        moveWordBack();
        return;
      }
      if (input === 'f') {
        moveWordForward();
        return;
      }
      // Modified arrow style (some terminals)
      if (key.leftArrow) {
        moveWordBack();
        return;
      }
      if (key.rightArrow) {
        moveWordForward();
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
      // In placeholder mode: ESC exits placeholder mode
      if (isInPlaceholderMode()) {
        exitPlaceholderMode();
        return;
      }
      // In @mention mode: ESC cancels @mention
      if (atMentionMode && atMentionMatches.length > 0) {
        clearAtMention();
        return;
      }
      // Start Option+key detection for NEXT event (two-event sequence)
      setEscapePressed(true);
      clearEscapeTimeout();
      escapeTimeoutRef.current = setTimeout(() => {
        setEscapePressed(false);
        escapeTimeoutRef.current = null;
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
        replaceCurrentPlaceholder(input);
        return;
      }
    }

    // @mention mode navigation
    if (atMentionMode && atMentionMatches.length > 0) {
      if (key.upArrow) {
        setAtMentionIndex((prev: number) => (prev - 1 + atMentionMatches.length) % atMentionMatches.length);
        return;
      }
      if (key.downArrow) {
        setAtMentionIndex((prev: number) => (prev + 1) % atMentionMatches.length);
        return;
      }
      // Tab: drill into directory (navigate deeper) or select file
      if (key.tab) {
        const match = atMentionMatches[atMentionIndex];
        if (match.isDirectory) {
          // Drill into directory: update input and trigger new search
          const newQuery = match.path;
          const newValue = value.slice(0, atMentionStart) + "@" + newQuery + value.slice(cursorPos);
          onChange(newValue);
          setCursorPos(atMentionStart + 1 + newQuery.length);
          // Don't clear @mention mode - let the effect trigger new search
          setAtMentionIndex(0); // Reset selection to first item
        } else {
          // File: apply and close dropdown
          applyAtMention(match);
        }
        return;
      }
      // Enter: always select item and complete @mention
      if (key.return) {
        applyAtMention(atMentionMatches[atMentionIndex]);
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
      }
      return;
    }

    // Tab - completion (only when not in @mention mode)
    if (key.tab && !atMentionMode) {
      if (key.shift) {
        handleShiftTab();
      } else {
        // Check if we're at a function parameter position (HIGHEST PRIORITY)
        const { word: tabWord, start: tabStart } = getWordAtCursor(value, cursorPos);

        // Case 1: (add3| - right after function name
        const isAtFuncPosition = tabStart > 0 && value[tabStart - 1] === '(' && signatures.has(tabWord);

        // Case 2: (add3 | - after space following function name
        let isAfterFuncSpace = false;
        if (tabWord === '') {
          const match = value.slice(0, cursorPos).match(/\((\w+)\s+$/);
          isAfterFuncSpace = match !== null && signatures.has(match[1]);
        }

        // Function param completion has priority over suggestion acceptance
        if (isAtFuncPosition || isAfterFuncSpace) {
          handleTab();  // Will handle function param insertion
        } else if (shouldTabAcceptSuggestion(suggestion, cursorPos, value.length, showingCompletions)) {
          acceptAndApplySuggestion();
        } else {
          handleTab();
        }
      }
      return;
    }

    // Clear completions on most keys (except Tab)
    if (!key.tab) {
      clearCompletions();
    }

    // Arrow keys
    if (key.upArrow) {
      navigateHistory(-1);
      return;
    }
    if (key.downArrow) {
      navigateHistory(1);
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
        case "w": // Delete word
          deleteWord();
          return;
        case "u": // Delete to start
          onChange(value.slice(cursorPos));
          setCursorPos(0);
          return;
        case "k": // Delete to end
          onChange(value.slice(0, cursorPos));
          return;
        case "d": // EOF on empty
          if (value === "") {
            // Would exit - handled by App
          }
          return;
      }
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        deleteBack(1);
      }
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      // INTERCEPT: Check if this is a pasted media file path (before it reaches state)
      // Paste is detected by: long input + absolute path + media extension
      if (input.length > 15) {
        const cleanInput = input.replace(/\\ /g, " ").replace(/\\'/g, "'").replace(/\\"/g, '"').trim();
        const isAbsolutePath = cleanInput.startsWith("/") || cleanInput.startsWith("~");

        if (isAbsolutePath && isSupportedMedia(cleanInput)) {
          // ZERO-BLINK: Synchronously compute placeholder and insert it INSTANTLY
          // 1. Reserve ID synchronously
          const id = reserveNextId();
          // 2. Compute display name synchronously (no file I/O needed)
          const mimeType = detectMimeType(cleanInput);
          const type = getAttachmentType(mimeType);
          const displayName = getDisplayName(type, id);
          // 3. Insert placeholder IMMEDIATELY - user sees [Image #1] instantly!
          insertAt(displayName + " ");
          // 4. Process file in background (fire-and-forget) - no await, no loading
          addAttachmentWithId(cleanInput, id);
          return; // Don't insert the raw path
        }
      }

      insertAt(input);
    }
  }, { isActive: !disabled });

  // Render with syntax highlighting
  const matchPos = cursorPos > 0 && cursorPos <= value.length
    ? findMatchingParen(value, cursorPos - 1)
    : null;

  const ghostText = suggestion ? suggestion.ghost : "";

  // ANSI colors for placeholder highlighting
  const CYAN = "\x1b[36m";
  const DIM_GRAY = "\x1b[90m";
  const RESET = "\x1b[0m";

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
            result += CYAN + phText + RESET;
          } else {
            result += DIM_GRAY + phText + RESET;
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

  // Render a single line with cursor if applicable
  const renderLine = (line: string, lineIndex: number, lineStartOffset: number): React.ReactNode => {
    const isCurrentLine = lineIndex === cursorLine;
    const prompt = lineIndex === 0 ? (jsMode ? "js>" : "hql>") : "...";

    if (!isCurrentLine) {
      // No cursor on this line
      return (
        <Box key={lineIndex}>
          <Text color="#663399" bold>{prompt} </Text>
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
        <Text color="#663399" bold>{prompt} </Text>
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

  return (
    <Box flexDirection="column">
      {/* Show attachment error only */}
      {attachmentError && (
        <Box>
          <Text color="red">⚠ {attachmentError.message}</Text>
        </Box>
      )}

      {/* Input lines */}
      {lineElements}

      {/* Placeholder mode hint */}
      {isInPlaceholderMode() && (
        <Box marginLeft={5}>
          <Text dimColor>Tab: next param • Shift+Tab: prev • Esc: exit</Text>
        </Box>
      )}

      {/* @mention dropdown */}
      {atMentionMode && (atMentionMatches.length > 0 || atMentionLoading) && (
        <Box flexDirection="column" marginLeft={5}>
          {atMentionLoading && atMentionMatches.length === 0 && (
            <Text dimColor>Searching...</Text>
          )}
          {atMentionMatches.map((match: FileMatch, i: number) => (
            <Box key={match.path}>
              <Text color={i === atMentionIndex ? "cyan" : undefined} inverse={i === atMentionIndex}>
                {match.isDirectory ? "📁 " : "📄 "}
                {match.path}
              </Text>
            </Box>
          ))}
          {atMentionMatches.length > 0 && (
            <Text dimColor>  ↑↓ navigate • Tab/Enter select • Esc cancel</Text>
          )}
        </Box>
      )}

    </Box>
  );
}
