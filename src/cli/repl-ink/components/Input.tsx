/**
 * HQL Ink REPL - Input Component
 * Full keyboard handling with syntax highlighting, completions, history
 */

import React, { useState, useEffect, useCallback } from "npm:react@18";
import { Text, Box, useInput } from "npm:ink@5";
import { highlight, findMatchingParen } from "../../repl/syntax.ts";
import { isBalanced } from "../../repl/syntax.ts";
import { getCompletions, getWordAtCursor, applyCompletion, type CompletionItem } from "../../repl/completer.ts";
import { findSuggestion, acceptSuggestion, type Suggestion } from "../../repl/suggester.ts";
import { searchFiles, type FileMatch } from "../../repl/file-search.ts";

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
  onSubmit: (value: string) => void;
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

  // Placeholder mode state for function parameter completion
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [placeholderIndex, setPlaceholderIndex] = useState(-1);

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

    // Check if @ is followed by valid path characters (no spaces)
    const queryPart = beforeCursor.slice(lastAt + 1);
    if (queryPart.includes(" ") || queryPart.includes(")") || queryPart.includes("\"")) {
      if (atMentionMode) {
        setAtMentionMode(false);
        setAtMentionMatches([]);
      }
      return;
    }

    // We're in @mention mode - search files
    setAtMentionMode(true);
    setAtMentionStart(lastAt);

    // Debounced search
    const timeoutId = setTimeout(async () => {
      try {
        const matches = await searchFiles(queryPart, 8);
        setAtMentionMatches(matches);
        setAtMentionIndex(0);
      } catch {
        setAtMentionMatches([]);
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
  }, []);

  // Helper: apply @mention selection
  const applyAtMention = useCallback((match: FileMatch) => {
    const path = match.path;
    const newValue = value.slice(0, atMentionStart) + "@" + path + value.slice(cursorPos);
    onChange(newValue);
    setCursorPos(atMentionStart + 1 + path.length);
    clearAtMention();
  }, [value, cursorPos, atMentionStart, onChange, clearAtMention]);

  // Helper: check if in placeholder mode
  const isInPlaceholderMode = useCallback(() => {
    return placeholders.length > 0 && placeholderIndex >= 0;
  }, [placeholders, placeholderIndex]);

  // Helper: exit placeholder mode
  const exitPlaceholderMode = useCallback(() => {
    setPlaceholders([]);
    setPlaceholderIndex(-1);
  }, []);

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
      for (let i = placeholderIndex + 1; i < updated.length; i++) {
        updated[i] = { ...updated[i], start: updated[i].start + delta };
      }

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
      for (let i = placeholderIndex + 1; i < updated.length; i++) {
        updated[i] = { ...updated[i], start: updated[i].start + char.length };
      }

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
    for (let i = placeholderIndex + 1; i < updated.length; i++) {
      updated[i] = { ...updated[i], start: updated[i].start - 1 };
    }

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

  // Helper: move word backward (Alt+Left)
  const moveWordBack = useCallback(() => {
    let pos = cursorPos;
    // Skip whitespace
    while (pos > 0 && value[pos - 1] === " ") pos--;
    // Move to start of word
    while (pos > 0 && value[pos - 1] !== " ") pos--;
    setCursorPos(pos);
  }, [value, cursorPos]);

  // Helper: move word forward (Alt+Right)
  const moveWordForward = useCallback(() => {
    let pos = cursorPos;
    // Skip current word
    while (pos < value.length && value[pos] !== " ") pos++;
    // Skip whitespace
    while (pos < value.length && value[pos] === " ") pos++;
    setCursorPos(pos);
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

      // Case 1: (add3| - cursor right after function name with no space
      const isAtFunctionPosition = start > 0 && value[start - 1] === '(';

      if (isAtFunctionPosition && signatures.has(word)) {
        const params = signatures.get(word)!;
        if (params.length > 0) {
          // Insert function parameters as placeholders: (add4| → (add4 x y z a)
          const paramsText = " " + params.join(" ") + ")";
          const newValue = value.slice(0, cursorPos) + paramsText + value.slice(cursorPos);
          onChange(newValue);
          enterPlaceholderMode(params, cursorPos + 1); // +1 for leading space
          return;
        }
      }

      // Case 2: (add3 | - cursor after space, look back to find function name
      if (word === '') {
        const beforeCursor = value.slice(0, cursorPos);
        // Match pattern: (funcName followed by whitespace at cursor position
        const match = beforeCursor.match(/\((\w+)\s+$/);
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

    // Placeholder mode handling (highest priority)
    if (isInPlaceholderMode()) {
      // Escape exits placeholder mode
      if (key.escape) {
        exitPlaceholderMode();
        return;
      }

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
          onSubmit(value.trim());
          setHistoryIndex(-1);
          setTempInput("");
          clearCompletions();
          clearAtMention();
        }
        return;
      }

      // Backspace in placeholder mode
      if (key.backspace || key.delete) {
        if (backspaceInPlaceholder()) {
          return;
        }
      }

      // Character input replaces placeholder
      if (input && !key.ctrl && !key.meta) {
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
      if (key.tab || key.return) {
        applyAtMention(atMentionMatches[atMentionIndex]);
        return;
      }
      if (key.escape) {
        clearAtMention();
        return;
      }
    }

    // Enter - submit if balanced
    if (key.return) {
      if (value.trim() && isBalanced(value)) {
        onSubmit(value.trim());
        setHistoryIndex(-1);
        setTempInput("");
        clearCompletions();
        clearAtMention();
      }
      return;
    }

    // Tab - completion (only when not in @mention mode)
    if (key.tab && !atMentionMode) {
      if (key.shift) {
        handleShiftTab();
      } else {
        handleTab();
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
    if (key.leftArrow) {
      if (key.meta || key.ctrl) {
        // Alt/Ctrl + Left - word back
        moveWordBack();
      } else if (cursorPos > 0) {
        setCursorPos(cursorPos - 1);
      }
      return;
    }
    if (key.rightArrow) {
      if (key.meta || key.ctrl) {
        // Alt/Ctrl + Right - word forward
        moveWordForward();
      } else if (cursorPos < value.length) {
        setCursorPos(cursorPos + 1);
      } else if (suggestion && cursorPos === value.length) {
        // Accept suggestion
        const accepted = acceptSuggestion(value, suggestion);
        onChange(accepted);
        setCursorPos(accepted.length);
        setSuggestion(null);
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
            const accepted = acceptSuggestion(value, suggestion);
            onChange(accepted);
            setCursorPos(accepted.length);
            setSuggestion(null);
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
  const renderWithPlaceholders = (text: string, startOffset: number): string => {
    if (!isInPlaceholderMode() || placeholders.length === 0) {
      return highlight(text, startOffset === 0 ? matchPos : null);
    }

    let result = "";
    let pos = startOffset;
    let textPos = 0;

    while (textPos < text.length) {
      // Find if current position is inside a placeholder
      let foundPh: Placeholder | null = null;
      let foundPhIndex = -1;

      for (let i = 0; i < placeholders.length; i++) {
        const ph = placeholders[i];
        if (pos >= ph.start && pos < ph.start + ph.length) {
          foundPh = ph;
          foundPhIndex = i;
          break;
        }
      }

      if (foundPh) {
        // We're inside a placeholder - render with appropriate color
        const phStartInText = foundPh.start - startOffset;
        const phEndInText = foundPh.start + foundPh.length - startOffset;

        // Text before placeholder (if any)
        if (phStartInText > textPos) {
          result += highlight(text.slice(textPos, phStartInText), null);
        }

        // Placeholder text with styling
        const phTextStart = Math.max(0, phStartInText);
        const phTextEnd = Math.min(text.length, phEndInText);
        const phText = text.slice(phTextStart, phTextEnd);

        if (foundPh.touched) {
          result += highlight(phText, null);  // Normal highlighting for touched
        } else if (foundPhIndex === placeholderIndex) {
          result += CYAN + phText + RESET;    // Active = CYAN
        } else {
          result += DIM_GRAY + phText + RESET; // Inactive = DIM_GRAY
        }

        textPos = phTextEnd;
        pos = startOffset + textPos;
      } else {
        // Not in a placeholder - find next placeholder or end
        let nextPhStart = text.length + startOffset;
        for (const ph of placeholders) {
          if (ph.start > pos && ph.start < nextPhStart) {
            nextPhStart = ph.start;
          }
        }

        const endPos = Math.min(text.length, nextPhStart - startOffset);
        result += highlight(text.slice(textPos, endPos), textPos === 0 && startOffset === 0 ? matchPos : null);
        textPos = endPos;
        pos = startOffset + textPos;
      }
    }

    return result;
  };

  // Split at cursor position for cursor display
  const beforeCursor = value.slice(0, cursorPos);
  const afterCursor = value.slice(cursorPos);

  return (
    <Box flexDirection="column">
      {/* Input line */}
      <Box>
        <Text color="#663399" bold>{jsMode ? "js>" : "hql>"} </Text>
        <Text>{renderWithPlaceholders(beforeCursor, 0)}</Text>
        <Text backgroundColor="white" color="black">{afterCursor[0] || " "}</Text>
        <Text>{renderWithPlaceholders(afterCursor.slice(1), cursorPos + 1)}</Text>
        {ghostText && <Text dimColor>{ghostText}</Text>}
      </Box>

      {/* Placeholder mode hint */}
      {isInPlaceholderMode() && (
        <Box marginLeft={5}>
          <Text dimColor>Tab: next param • Shift+Tab: prev • Esc: exit</Text>
        </Box>
      )}

      {/* @mention dropdown */}
      {atMentionMode && atMentionMatches.length > 0 && (
        <Box flexDirection="column" marginLeft={5}>
          {atMentionMatches.map((match: FileMatch, i: number) => (
            <Box key={match.path}>
              <Text color={i === atMentionIndex ? "cyan" : undefined} inverse={i === atMentionIndex}>
                {match.isDirectory ? "📁 " : "📄 "}
                {match.path}
              </Text>
            </Box>
          ))}
          <Text dimColor>  ↑↓ navigate • Tab/Enter select • Esc cancel</Text>
        </Box>
      )}
    </Box>
  );
}
