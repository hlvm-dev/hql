/**
 * HQL REPL Readline - Terminal input with multi-line S-expression support
 * With modern UX: syntax highlighting, autosuggestions, tab completion, paren matching
 */

import { ANSI_COLORS } from "../ansi.ts";
import { highlight, findMatchingParen } from "./syntax.ts";
import { findSuggestion, acceptSuggestion, type Suggestion } from "./suggester.ts";
import {
  getCompletions,
  getWordAtCursor,
  applyCompletion,
  formatCompletionItem,
  type CompletionItem,
} from "./completer.ts";

const { DIM_GRAY, CYAN, RESET } = ANSI_COLORS;

// Control characters
const enum ControlChar {
  ESCAPE = "\x1b",
  BACKSPACE = "\x7f",
  CTRL_A = "\x01",
  CTRL_C = "\x03",
  CTRL_D = "\x04",
  CTRL_E = "\x05",
  CTRL_K = "\x0b",
  CTRL_U = "\x15",
  CTRL_W = "\x17",
  TAB = "\x09",
  ENTER = "\r",
}

// Character ranges
const PRINTABLE_START = 32;
const PRINTABLE_END = 127;

// ANSI escape sequences
const ANSI_CLEAR_LINE = "\x1b[K";
const ANSI_CARRIAGE_RETURN = "\r";
const ANSI_MOVE_LEFT = "\x1b[D";

// Arrow key codes
const enum ArrowKey {
  Up = "A",
  Down = "B",
  Right = "C",
  Left = "D"
}

// Key action results
const enum KeyAction {
  Continue,     // Keep reading
  Submit,       // Submit line
  Exit,         // Exit REPL
  Cancel        // Cancel current line
}

interface KeyResult {
  action: KeyAction;
  value?: string;
}

export interface ReadlineOptions {
  prompt: string;
  continuationPrompt: string;
  history: string[];
  userBindings?: Set<string>;
  signatures?: Map<string, string[]>;
}

/**
 * Check if S-expression input is balanced (all parens/brackets closed)
 */
export function isBalanced(input: string): boolean {
  let parens = 0, brackets = 0, braces = 0;
  let inString = false, escape = false;

  for (const ch of input) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    // Skip line comments
    if (ch === ';') {
      const idx = input.indexOf('\n', input.indexOf(ch));
      if (idx === -1) break; // Rest is comment
      continue;
    }

    if (ch === '(') parens++;
    if (ch === ')') parens--;
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
    if (ch === '{') braces++;
    if (ch === '}') braces--;
  }

  return parens === 0 && brackets === 0 && braces === 0;
}

export class Readline {
  private history: string[] = [];
  private historyIndex = -1;
  private lines: string[] = [];
  private currentLine = "";
  private cursorPos = 0;
  private lastWasCtrlC = false;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private currentPrompt = "";
  private continuationPrompt = "";

  // New: Autosuggestion state
  private suggestion: Suggestion | null = null;

  // New: Tab completion state
  private completions: CompletionItem[] = [];
  private completionIndex = -1;
  private showingCompletions = false;
  private userBindings: Set<string> = new Set();
  private signatures: Map<string, string[]> = new Map();
  private completionStart = 0;    // Where the completing word starts
  private originalWord = "";      // Original word before completion

  // Placeholder mode state (for function argument hints)
  private placeholders: Array<{ start: number; length: number; text: string; touched: boolean }> = [];
  private placeholderIndex = -1;

  /**
   * Read a complete (possibly multi-line) input
   */
  async readline(options: ReadlineOptions): Promise<string | null> {
    this.currentPrompt = options.prompt;
    this.continuationPrompt = options.continuationPrompt;
    this.history = options.history;
    this.userBindings = options.userBindings || new Set();
    this.signatures = options.signatures || new Map();
    this.lines = [];

    // Check if stdin is a terminal
    if (!Deno.stdin.isTerminal()) {
      return await this.readSimple(options);
    }

    await this.write(options.prompt);
    this.reset();
    Deno.stdin.setRaw(true);

    try {
      return await this.readLoop();
    } finally {
      Deno.stdin.setRaw(false);
    }
  }

  /**
   * Simple line-based reading for non-TTY (piped) input
   */
  private async readSimple(_options: ReadlineOptions): Promise<string | null> {
    const buf = new Uint8Array(4096);
    let accumulated = "";

    while (true) {
      const n = await Deno.stdin.read(buf);
      if (n === null) {
        // EOF - return what we have if balanced, else null
        const trimmed = accumulated.trim();
        return trimmed || null;
      }

      accumulated += this.decoder.decode(buf.subarray(0, n));

      // Check if we have complete input (balanced parens)
      if (isBalanced(accumulated.trim())) {
        return accumulated.trim();
      }
    }
  }

  private reset(): void {
    this.currentLine = "";
    this.cursorPos = 0;
    this.historyIndex = -1;
    this.suggestion = null;
    this.clearCompletions();
    this.exitPlaceholderMode();
  }

  // ============================================================
  // Placeholder Mode (for function argument hints)
  // ============================================================

  private isInPlaceholderMode(): boolean {
    return this.placeholders.length > 0 &&
           this.placeholderIndex >= 0 &&
           this.placeholderIndex < this.placeholders.length;
  }

  private enterPlaceholderMode(funcName: string, params: string[], startPos: number): void {
    this.placeholders = [];
    let pos = startPos;

    for (const param of params) {
      this.placeholders.push({
        start: pos,
        length: param.length,
        text: param,
        touched: false  // Track if user has started typing in this placeholder
      });
      pos += param.length + 1; // +1 for space between params
    }

    this.placeholderIndex = 0;
    // Position cursor at first placeholder
    if (this.placeholders.length > 0) {
      this.cursorPos = this.placeholders[0].start;
    }
  }

  private exitPlaceholderMode(): void {
    this.placeholders = [];
    this.placeholderIndex = -1;
  }

  private nextPlaceholder(): boolean {
    if (!this.isInPlaceholderMode()) {
      this.exitPlaceholderMode();
      return false;
    }

    if (this.placeholderIndex < this.placeholders.length - 1) {
      this.placeholderIndex++;
      const ph = this.placeholders[this.placeholderIndex];
      // Position at start of placeholder, or at end if it's been touched
      this.cursorPos = ph.touched ? ph.start + ph.length : ph.start;
      return true;
    } else {
      // Last placeholder - exit and move cursor to end
      this.exitPlaceholderMode();
      this.cursorPos = this.currentLine.length;
      return false;
    }
  }

  private replaceCurrentPlaceholder(char: string): void {
    if (!this.isInPlaceholderMode()) return;

    const ph = this.placeholders[this.placeholderIndex];

    if (!ph.touched) {
      // FIRST char in this placeholder - replace entire placeholder content
      const before = this.currentLine.slice(0, ph.start);
      const after = this.currentLine.slice(ph.start + ph.length);
      this.currentLine = before + char + after;

      // Update subsequent placeholder positions
      const delta = char.length - ph.length;
      for (let i = this.placeholderIndex + 1; i < this.placeholders.length; i++) {
        this.placeholders[i].start += delta;
      }

      ph.length = char.length;
      ph.touched = true;
      this.cursorPos = ph.start + char.length;
    } else {
      // SUBSEQUENT chars - append at cursor position (normal insertion)
      const before = this.currentLine.slice(0, this.cursorPos);
      const after = this.currentLine.slice(this.cursorPos);
      this.currentLine = before + char + after;

      // Update this placeholder's length
      ph.length += char.length;

      // Update subsequent placeholder positions
      for (let i = this.placeholderIndex + 1; i < this.placeholders.length; i++) {
        this.placeholders[i].start += char.length;
      }

      this.cursorPos++;
    }
  }

  private async readLoop(): Promise<string | null> {
    while (true) {
      const key = await this.readKey();
      if (!key) return null; // EOF from stdin

      const result = await this.handleKey(key);

      switch (result.action) {
        case KeyAction.Submit: {
          const fullInput = [...this.lines, result.value || ""].join("\n");

          // Check if balanced
          if (!isBalanced(fullInput)) {
            // Need more input - add to lines and continue
            this.lines.push(result.value || "");
            await this.write(this.continuationPrompt);
            this.reset();
            continue;
          }

          return fullInput;
        }
        case KeyAction.Exit:
          return null;
        case KeyAction.Cancel:
          this.lines = [];
          return "";
        case KeyAction.Continue:
          continue;
      }
    }
  }

  private async readKey(): Promise<Uint8Array | null> {
    const buf = new Uint8Array(4096);  // Large buffer for paste support
    const n = await Deno.stdin.read(buf);
    return n === null ? null : buf.subarray(0, n);
  }

  private async handleKey(key: Uint8Array): Promise<KeyResult> {
    // Handle multi-byte input (paste, arrow keys, etc.)
    return await this.processKeyBytes(key, 0);
  }

  private async processKeyBytes(key: Uint8Array, offset: number): Promise<KeyResult> {
    if (offset >= key.length) {
      return { action: KeyAction.Continue };
    }

    const code = key[offset];

    // Handle escape sequences (arrow keys: ESC [ A/B/C/D)
    if (code === 0x1b && offset + 2 < key.length && key[offset + 1] === 0x5b) {
      await this.handleArrowKey(String.fromCharCode(key[offset + 2]));
      // Process remaining bytes after escape sequence
      return await this.processKeyBytes(key, offset + 3);
    }

    // Skip lone escape
    if (code === 0x1b) {
      return await this.processKeyBytes(key, offset + 1);
    }

    // Ctrl+D (EOF)
    if (code === ControlChar.CTRL_D.charCodeAt(0)) {
      if (this.currentLine.length === 0 && this.lines.length === 0) {
        await this.write("\n");
        return { action: KeyAction.Exit };
      }
      return await this.processKeyBytes(key, offset + 1);
    }

    // Ctrl+C
    if (code === ControlChar.CTRL_C.charCodeAt(0)) {
      if (this.lastWasCtrlC) {
        await this.write("\n");
        return { action: KeyAction.Exit };
      }
      await this.write("^C\n");
      this.currentLine = "";
      this.cursorPos = 0;
      this.lastWasCtrlC = true;
      this.lines = [];
      return { action: KeyAction.Cancel };
    }

    // Reset Ctrl+C flag
    this.lastWasCtrlC = false;

    // Clear completions on any key except Tab
    if (code !== ControlChar.TAB.charCodeAt(0)) {
      this.clearCompletions();
    }

    // Enter - exit placeholder mode and submit
    // For paste with newlines, submit current line and stop processing
    if (code === ControlChar.ENTER.charCodeAt(0) || code === 0x0a) {
      this.exitPlaceholderMode();
      await this.write("\n");
      const line = this.currentLine;
      return { action: KeyAction.Submit, value: line };
    }

    // Control keys
    if (await this.handleControlKey(code)) {
      return await this.processKeyBytes(key, offset + 1);
    }

    // Printable characters (including pasted text)
    if (this.isPrintable(code)) {
      await this.insertChar(String.fromCharCode(code));
    }

    // Process remaining bytes (for paste support)
    return await this.processKeyBytes(key, offset + 1);
  }

  private async handleControlKey(code: number): Promise<boolean> {
    switch (code) {
      case ControlChar.CTRL_A.charCodeAt(0):
        this.exitPlaceholderMode();
        await this.jumpToStart();
        return true;

      case ControlChar.CTRL_E.charCodeAt(0):
        this.exitPlaceholderMode();
        // Accept suggestion if available, then jump to end
        if (this.suggestion && this.cursorPos === this.currentLine.length) {
          this.currentLine = acceptSuggestion(this.currentLine, this.suggestion);
          this.cursorPos = this.currentLine.length;
          this.suggestion = null;
        }
        await this.jumpToEnd();
        return true;

      case ControlChar.CTRL_U.charCodeAt(0):
        await this.deleteToStart();
        return true;

      case ControlChar.CTRL_K.charCodeAt(0):
        await this.deleteToEnd();
        return true;

      case ControlChar.CTRL_W.charCodeAt(0):
        await this.deleteWord();
        return true;

      case ControlChar.BACKSPACE.charCodeAt(0):
        await this.handleBackspace();
        return true;

      case ControlChar.TAB.charCodeAt(0):
        await this.handleTab();
        return true;

      default:
        return false;
    }
  }

  private async handleArrowKey(key: string): Promise<void> {
    // Exit placeholder mode on arrow keys
    this.exitPlaceholderMode();

    switch (key) {
      case ArrowKey.Up:
        await this.navigateHistory(-1);
        break;

      case ArrowKey.Down:
        await this.navigateHistory(1);
        break;

      case ArrowKey.Right:
        // Accept suggestion if at end of line
        if (this.cursorPos >= this.currentLine.length && this.suggestion) {
          this.currentLine = acceptSuggestion(this.currentLine, this.suggestion);
          this.cursorPos = this.currentLine.length;
          this.suggestion = null;
          await this.redrawLine();
        } else {
          await this.moveCursorRight();
        }
        break;

      case ArrowKey.Left:
        await this.moveCursorLeft();
        break;
    }
  }

  private async navigateHistory(direction: number): Promise<void> {
    if (this.history.length === 0) return;

    if (direction < 0) {
      // Up arrow
      this.historyIndex = this.historyIndex === -1
        ? this.history.length - 1
        : Math.max(0, this.historyIndex - 1);
      this.currentLine = this.history[this.historyIndex];
    } else {
      // Down arrow
      if (this.historyIndex === -1) return;

      this.historyIndex++;
      if (this.historyIndex >= this.history.length) {
        this.historyIndex = -1;
        this.currentLine = "";
      } else {
        this.currentLine = this.history[this.historyIndex];
      }
    }

    this.cursorPos = this.currentLine.length;
    await this.redrawLine();
  }

  private async moveCursorLeft(): Promise<void> {
    if (this.cursorPos > 0) {
      this.cursorPos--;
      await this.write(ANSI_MOVE_LEFT);
    }
  }

  private async moveCursorRight(): Promise<void> {
    if (this.cursorPos < this.currentLine.length) {
      this.cursorPos++;
      await this.write("\x1b[C");
    }
  }

  private async jumpToStart(): Promise<void> {
    this.cursorPos = 0;
    await this.redrawLine();
  }

  private async jumpToEnd(): Promise<void> {
    this.cursorPos = this.currentLine.length;
    await this.redrawLine();
  }

  private async deleteToStart(): Promise<void> {
    this.exitPlaceholderMode();
    this.currentLine = this.currentLine.slice(this.cursorPos);
    this.cursorPos = 0;
    await this.redrawLine();
  }

  private async deleteToEnd(): Promise<void> {
    this.exitPlaceholderMode();
    this.currentLine = this.currentLine.slice(0, this.cursorPos);
    await this.redrawLine();
  }

  private async deleteWord(): Promise<void> {
    this.exitPlaceholderMode();
    const before = this.currentLine.slice(0, this.cursorPos);
    const after = this.currentLine.slice(this.cursorPos);

    let pos = before.length;
    while (pos > 0 && before[pos - 1] === " ") pos--;
    while (pos > 0 && before[pos - 1] !== " ") pos--;

    this.currentLine = before.slice(0, pos) + after;
    this.cursorPos = pos;
    await this.redrawLine();
  }

  private async handleBackspace(): Promise<void> {
    if (this.cursorPos > 0) {
      // In placeholder mode, handle backspace specially
      if (this.isInPlaceholderMode()) {
        const ph = this.placeholders[this.placeholderIndex];
        if (this.cursorPos > ph.start) {
          // Delete within current placeholder
          this.currentLine =
            this.currentLine.slice(0, this.cursorPos - 1) +
            this.currentLine.slice(this.cursorPos);
          this.cursorPos--;
          ph.length--;

          // Update subsequent placeholder positions
          for (let i = this.placeholderIndex + 1; i < this.placeholders.length; i++) {
            this.placeholders[i].start--;
          }

          // If placeholder is empty, exit placeholder mode
          if (ph.length <= 0) {
            this.exitPlaceholderMode();
          }
        } else {
          // Cursor at start of placeholder - exit placeholder mode
          this.exitPlaceholderMode();
        }
        await this.redrawLine();
        return;
      }

      this.currentLine =
        this.currentLine.slice(0, this.cursorPos - 1) +
        this.currentLine.slice(this.cursorPos);
      this.cursorPos--;
      await this.redrawLine();
    }
  }

  private async insertChar(char: string): Promise<void> {
    // In placeholder mode, replace current placeholder
    if (this.isInPlaceholderMode()) {
      this.replaceCurrentPlaceholder(char);
      await this.redrawLine();
      return;
    }

    this.currentLine =
      this.currentLine.slice(0, this.cursorPos) +
      char +
      this.currentLine.slice(this.cursorPos);
    this.cursorPos++;
    await this.redrawLine();
  }

  // ============================================================
  // Tab Completion
  // ============================================================

  private async handleTab(): Promise<void> {
    // Handle placeholder mode navigation
    if (this.isInPlaceholderMode()) {
      this.nextPlaceholder();
      await this.redrawLine();
      return;
    }

    if (this.showingCompletions) {
      // Check if current word is a function - if so, insert placeholders instead of cycling
      const { word } = getWordAtCursor(this.currentLine, this.cursorPos);
      if (this.userBindings.has(word)) {
        const signature = this.signatures.get(word);
        if (signature && signature.length > 0) {
          this.clearCompletions();
          await this.insertFunctionWithPlaceholders(word, signature);
          return;
        }
      }

      // Otherwise, cycle through completions
      this.completionIndex = (this.completionIndex + 1) % this.completions.length;
      await this.applyCycledCompletion();
    } else {
      // Start new completion
      const { word, start } = getWordAtCursor(this.currentLine, this.cursorPos);

      // FIRST: Check if word is an exact match function - insert placeholders immediately
      // This takes priority over finding longer completions (e.g., "add" vs "adder")
      if (word.length > 0 && this.userBindings.has(word)) {
        const signature = this.signatures.get(word);
        if (signature && signature.length > 0) {
          await this.insertFunctionWithPlaceholders(word, signature);
          return;
        }
      }

      this.completions = getCompletions(word, this.userBindings);

      if (this.completions.length === 0) {
        // No completions for this prefix
        if (word.length > 0 && this.userBindings.has(word)) {
          // Word is exact match non-function - just add space
          await this.insertChar(" ");
          return;
        }

        // Only cycle through bindings if we're at FUNCTION position (right after open paren)
        // NOT in argument position (after function name + space)
        const isAtFunctionPosition = start > 0 && this.currentLine[start - 1] === '(';

        if (isAtFunctionPosition && this.userBindings.size > 0) {
          // Cycle through all user bindings - user is choosing a function to call
          this.completions = [...this.userBindings].sort().map(name => ({
            text: name,
            type: "variable" as const,
          }));
          if (this.completions.length > 0) {
            this.showingCompletions = true;
            this.completionIndex = 0;
            this.completionStart = start;
            this.originalWord = word;
            await this.applySelectedCompletion(this.completions[0]);
          }
        } else {
          // In argument position with empty word - check if function has signature
          // Look backward to find the function name: matches "(funcname " pattern
          const beforeCursor = this.currentLine.slice(0, start);
          const funcMatch = beforeCursor.match(/\((\S+)\s+$/);
          if (funcMatch) {
            const funcName = funcMatch[1];
            const signature = this.signatures.get(funcName);
            if (signature && signature.length > 0) {
              // Insert placeholders for function arguments
              await this.insertArgumentPlaceholders(signature);
              return;
            }
          }
        }
        return;
      }

      if (this.completions.length === 1) {
        // Single match - check if it's a function with signature
        const funcName = this.completions[0].text;
        const signature = this.signatures.get(funcName);

        await this.applySelectedCompletion(this.completions[0]);

        if (signature && signature.length > 0) {
          // Insert function with placeholder params
          await this.insertFunctionWithPlaceholders(funcName, signature);
        } else {
          // Just add space for non-function bindings
          await this.insertChar(" ");
        }
        this.clearCompletions();
      } else {
        // Multiple matches - try common prefix first
        const commonPrefix = this.findCommonPrefix(this.completions.map(c => c.text));

        if (commonPrefix.length > word.length) {
          // Complete to common prefix first (don't start cycling yet)
          const partialItem = { text: commonPrefix, type: this.completions[0].type } as CompletionItem;
          await this.applySelectedCompletion(partialItem);
          // Don't set showingCompletions - next Tab will re-evaluate
        } else {
          // Already at common prefix - start cycling through options
          this.showingCompletions = true;
          this.completionIndex = 0;
          this.completionStart = start;
          this.originalWord = word;
          await this.applySelectedCompletion(this.completions[0]);
        }
      }
    }
  }

  /**
   * Insert function name with placeholder arguments
   */
  private async insertFunctionWithPlaceholders(funcName: string, params: string[]): Promise<void> {
    // Build the placeholder text: "param1 param2)"
    const paramsText = params.join(" ") + ")";
    const startPos = this.cursorPos + 1; // +1 for the space we're about to insert

    // Insert space and params
    this.currentLine =
      this.currentLine.slice(0, this.cursorPos) +
      " " + paramsText +
      this.currentLine.slice(this.cursorPos);

    // Enter placeholder mode
    this.enterPlaceholderMode(funcName, params, startPos);
    await this.redrawLine();
  }

  /**
   * Insert just argument placeholders (when function name already typed)
   * For case: (ask |) → Tab → (ask prompt)
   */
  private async insertArgumentPlaceholders(params: string[]): Promise<void> {
    // Build the placeholder text: "param1 param2)"
    const paramsText = params.join(" ") + ")";
    const startPos = this.cursorPos; // Cursor is already after space

    // Insert params at cursor
    this.currentLine =
      this.currentLine.slice(0, this.cursorPos) +
      paramsText +
      this.currentLine.slice(this.cursorPos);

    // Enter placeholder mode
    this.enterPlaceholderMode("", params, startPos);
    await this.redrawLine();
  }

  /**
   * Find longest common prefix among strings
   */
  private findCommonPrefix(strings: string[]): string {
    if (strings.length === 0) return "";
    if (strings.length === 1) return strings[0];

    let prefix = strings[0];
    for (let i = 1; i < strings.length; i++) {
      while (!strings[i].startsWith(prefix)) {
        prefix = prefix.slice(0, -1);
        if (prefix === "") return "";
      }
    }
    return prefix;
  }

  private async applyCycledCompletion(): Promise<void> {
    // Replace current completion with next one
    const item = this.completions[this.completionIndex];
    // Restore to original state then apply new completion
    this.currentLine =
      this.currentLine.slice(0, this.completionStart) +
      this.originalWord +
      this.currentLine.slice(this.cursorPos);
    this.cursorPos = this.completionStart + this.originalWord.length;
    // Now apply the new completion
    await this.applySelectedCompletion(item);
  }

  private async applySelectedCompletion(item: CompletionItem): Promise<void> {
    const result = applyCompletion(this.currentLine, this.cursorPos, item);
    this.currentLine = result.line;
    this.cursorPos = result.cursorPos;
    // Don't clear completions here - let Tab cycle continue
    // Completions are cleared when user presses any non-Tab key
    await this.redrawLine();
  }

  private clearCompletions(): void {
    this.completions = [];
    this.completionIndex = -1;
    this.showingCompletions = false;
    this.completionStart = 0;
    this.originalWord = "";
  }

  // ============================================================
  // Core Display
  // ============================================================

  private isArrowKey(key: Uint8Array): boolean {
    return key.length === 3 &&
           key[0] === ControlChar.ESCAPE.charCodeAt(0) &&
           key[1] === "[".charCodeAt(0);
  }

  private isPrintable(code: number): boolean {
    return code >= PRINTABLE_START && code < PRINTABLE_END;
  }

  /**
   * Get highlighted line with paren matching and placeholder rendering
   */
  private getHighlightedLine(): string {
    // If in placeholder mode, render placeholders in gray
    if (this.isInPlaceholderMode()) {
      return this.getHighlightedLineWithPlaceholders();
    }

    // Find matching paren if cursor is after a closing delimiter
    let matchPos: number | null = null;
    if (this.cursorPos > 0) {
      matchPos = findMatchingParen(this.currentLine, this.cursorPos - 1);
    }
    return highlight(this.currentLine, matchPos);
  }

  /**
   * Get highlighted line with placeholders shown in gray
   */
  private getHighlightedLineWithPlaceholders(): string {
    const line = this.currentLine;
    let result = "";
    let lastEnd = 0;

    // Process placeholders in order (they should already be sorted by position)
    for (let i = 0; i < this.placeholders.length; i++) {
      const ph = this.placeholders[i];

      // Safety check for valid placeholder bounds
      if (ph.start < 0 || ph.start > line.length || ph.length < 0) {
        continue;
      }

      // Add highlighted text before placeholder
      if (ph.start > lastEnd) {
        result += highlight(line.slice(lastEnd, ph.start), null);
      }

      // Add placeholder with styling
      const endPos = Math.min(ph.start + ph.length, line.length);
      const phText = line.slice(ph.start, endPos);
      const isActive = i === this.placeholderIndex;

      if (ph.touched) {
        // Touched placeholder: render normally (user has typed here)
        result += highlight(phText, null);
      } else if (isActive) {
        // Active untouched placeholder: cyan to show it's selected
        result += CYAN + phText + RESET;
      } else {
        // Inactive untouched placeholder: gray
        result += DIM_GRAY + phText + RESET;
      }

      lastEnd = endPos;
    }

    // Add remaining text after last placeholder
    if (lastEnd < line.length) {
      result += highlight(line.slice(lastEnd), null);
    }

    return result;
  }

  private async redrawLine(): Promise<void> {
    const prompt = this.lines.length > 0 ? this.continuationPrompt : this.currentPrompt;
    const highlighted = this.getHighlightedLine();

    // Update autosuggestion (only when cursor at end of line)
    let ghostText = "";
    if (this.cursorPos === this.currentLine.length) {
      this.suggestion = findSuggestion(this.currentLine, this.history);
      if (this.suggestion) {
        ghostText = DIM_GRAY + this.suggestion.ghost + RESET;
      }
    } else {
      this.suggestion = null;
    }

    // Calculate cursor movement
    const displayLength = this.currentLine.length + (this.suggestion?.ghost.length || 0);
    const moveBack = displayLength - this.cursorPos;
    const cursorMove = moveBack > 0 ? `\x1b[${moveBack}D` : "";

    await this.write(
      `${ANSI_CARRIAGE_RETURN}${ANSI_CLEAR_LINE}${prompt}${highlighted}${ghostText}${cursorMove}`
    );
  }

  private async write(text: string): Promise<void> {
    await Deno.stdout.write(this.encoder.encode(text));
  }
}
