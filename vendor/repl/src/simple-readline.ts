import {
  deleteWordLeft,
  deleteWordRight,
  findWordBoundaryLeft,
  findWordBoundaryRight,
} from "./text-buffer.ts";
import type { CompletionItem, CompletionRequest } from "./plugin-interface.ts";

export type CompletionProvider = (
  request: CompletionRequest,
) => Promise<CompletionItem[]> | CompletionItem[];

/**
 * Simple readline implementation using Deno's raw stdin
 * Supports arrow key history navigation without Node.js dependencies
 */

// Control characters
const enum ControlChar {
  ESCAPE = "\x1b",
  BACKSPACE = "\x7f",
  CTRL_A = "\x01",
  CTRL_C = "\x03",
  CTRL_D = "\x04",
  CTRL_E = "\x05",
  CTRL_G = "\x07",
  CTRL_K = "\x0b",
  CTRL_U = "\x15",
  CTRL_W = "\x17",
  CTRL_R = "\x12",
  TAB = "\t",
  ENTER = "\r",
}

// Character ranges
const PRINTABLE_START = 32;
const PRINTABLE_END = 127;

// ANSI escape sequences
const ANSI_CLEAR_LINE = "\x1b[K";
const ANSI_CARRIAGE_RETURN = "\r";
const ANSI_MOVE_LEFT = "\x1b[D";
const ANSI_MOVE_RIGHT = "\x1b[C";

// ANSI color codes
const DARK_PURPLE = "\x1b[38;2;128;54;146m";
const DIM = "\x1b[90m";
const RESET = "\x1b[0m";

function escapeKeyword(keyword: string): string {
  return keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CompletionSession {
  suggestions: CompletionItem[];
  index: number;
  base: string;
  suffix: string;
}

// Key action results
const enum KeyAction {
  Continue, // Keep reading
  Submit, // Submit line
  Exit, // Exit REPL
  Cancel, // Cancel current line
}

interface KeyResult {
  action: KeyAction;
  value?: string;
}

export class SimpleReadline {
  private historyBuffer: string[] = [];
  private historyStart = 0;
  private historyCount = 0;
  private historyIndex = -1;
  private currentLine = "";
  private cursorPos = 0;
  private lastWasCtrlC = false;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private currentPrompt = "";
  private completionProvider?: CompletionProvider;
  private completionSession: CompletionSession | null = null;
  private previewLength = 0;
  private pendingSubmit: string | null = null;
  private keywordRegex: RegExp | null = null;
  private searchQuery = "";
  private searchMatch = "";
  private searchIndex = -1;
  private readonly historyLimit = 1000;

  constructor(keywords: string[] = []) {
    this.setKeywords(keywords);
  }

  private pushHistory(line: string): void {
    const writeIndex = (this.historyStart + this.historyCount) % this.historyLimit;
    this.historyBuffer[writeIndex] = line;
    if (this.historyCount < this.historyLimit) {
      this.historyCount++;
    } else {
      this.historyStart = (this.historyStart + 1) % this.historyLimit;
    }
  }

  private getHistoryAt(index: number): string {
    if (index < 0 || index >= this.historyCount) return "";
    const physicalIndex = (this.historyStart + index) % this.historyLimit;
    return this.historyBuffer[physicalIndex] ?? "";
  }

  private getHistoryLength(): number {
    return this.historyCount;
  }

  async readline(prompt: string, seed = ""): Promise<string | null> {
    this.currentPrompt = prompt;
    this.reset(seed);
    await this.write(prompt + " ");
    if (seed) {
      await this.write(this.highlightSyntax(seed));
    }
    Deno.stdin.setRaw(true);

    try {
      return await this.readLoop();
    } finally {
      Deno.stdin.setRaw(false);
    }
  }

  /**
   * Reset state for new input
   */
  private reset(seed = ""): void {
    this.currentLine = seed;
    this.cursorPos = seed.length;
    this.historyIndex = -1;
    this.completionSession = null;
    this.previewLength = 0;
    this.pendingSubmit = null;
  }

  setCompletionProvider(provider: CompletionProvider): void {
    this.completionProvider = provider;
  }

  getHistory(): string[] {
    const result: string[] = [];
    for (let i = 0; i < this.historyCount; i++) {
      result.push(this.getHistoryAt(i));
    }
    return result;
  }

  setKeywords(keywords: string[]): void {
    if (!keywords || keywords.length === 0) {
      this.keywordRegex = null;
      return;
    }
    const escaped = keywords.map(escapeKeyword).join("|");
    this.keywordRegex = new RegExp(`\\b(${escaped})\\b`, "g");
  }

  /**
   * Main read loop
   */
  private async readLoop(): Promise<string | null> {
    while (true) {
      const key = await this.readKey();
      if (!key) return null; // EOF from stdin

      const result = await this.handleKey(key);

      switch (result.action) {
        case KeyAction.Submit:
          return result.value || "";
        case KeyAction.Exit:
          return null;
        case KeyAction.Cancel:
          return "";
        case KeyAction.Continue:
          continue;
      }
    }
  }

  /**
   * Read a single key press
   */
  private async readKey(): Promise<Uint8Array | null> {
    const buf = new Uint8Array(16);
    const n = await Deno.stdin.read(buf);
    return n === null ? null : buf.subarray(0, n);
  }

  /**
   * Handle a key press
   */
  private async handleKey(key: Uint8Array): Promise<KeyResult> {
    if (key.length === 0) return { action: KeyAction.Continue };

    // Handle escape sequences (arrows, Home/End, Option modifiers, etc.)
    if (key[0] === ControlChar.ESCAPE.charCodeAt(0)) {
      const handled = await this.handleEscapeSequence(key);
      if (this.pendingSubmit !== null) {
        const value = this.pendingSubmit;
        this.pendingSubmit = null;
        return { action: KeyAction.Submit, value };
      }
      if (handled) {
        return { action: KeyAction.Continue };
      }
    }

    // Tab completion
    if (key.length === 1 && key[0] === ControlChar.TAB.charCodeAt(0)) {
      await this.cycleCompletion(false);
      return { action: KeyAction.Continue };
    }

    // Handle single-byte keys
    if (key.length !== 1) {
      return { action: KeyAction.Continue };
    }

    const code = key[0];

    // Ctrl+D (EOF)
    if (code === ControlChar.CTRL_D.charCodeAt(0)) {
      if (this.currentLine.length === 0) {
        await this.write("\n");
        return { action: KeyAction.Exit };
      }
      return { action: KeyAction.Continue };
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
      return { action: KeyAction.Cancel };
    }

    // Reset Ctrl+C flag
    this.lastWasCtrlC = false;

    // Enter
    if (code === ControlChar.ENTER.charCodeAt(0)) {
      if (this.completionSession && this.previewLength > 0) {
        await this.acceptCompletion();
        return { action: KeyAction.Continue };
      }
      await this.write("\n");
      const line = this.currentLine;
      if (line.trim()) {
        this.pushHistory(line);
      }
      this.clearCompletionSession();
      return { action: KeyAction.Submit, value: line };
    }

    // Control keys
    if (await this.handleControlKey(code)) {
      return { action: KeyAction.Continue };
    }

    // Printable characters
    if (this.isPrintable(code)) {
      await this.insertChar(String.fromCharCode(code));
      await this.updateLiveCompletion();
    }

    return { action: KeyAction.Continue };
  }

  /**
   * Handle control character keys
   * @returns true if handled, false otherwise
   */
  private async handleControlKey(code: number): Promise<boolean> {
    switch (code) {
      case ControlChar.CTRL_A.charCodeAt(0):
        await this.jumpToStart();
        return true;

      case ControlChar.CTRL_E.charCodeAt(0):
        await this.jumpToEnd();
        return true;

      case ControlChar.CTRL_U.charCodeAt(0):
        await this.deleteToStart();
        return true;

      case ControlChar.CTRL_K.charCodeAt(0):
        await this.deleteToEnd();
        return true;

      case ControlChar.CTRL_W.charCodeAt(0):
        await this.deleteWordBackward();
        return true;

      case ControlChar.BACKSPACE.charCodeAt(0):
        await this.handleBackspace();
        return true;

      case ControlChar.CTRL_R.charCodeAt(0):
        await this.startReverseSearch();
        return true;

      default:
        return false;
    }
  }

  /**
   * Handle escape sequences (arrows, word navigation, Home/End, etc.)
   */
  private async handleEscapeSequence(sequence: Uint8Array): Promise<boolean> {
    if (sequence.length === 1) {
      return false;
    }

    const text = this.decoder.decode(sequence);
    if (text === "\x1b[13;2~" || text === "\x1b[13;2u") {
      await this.handleShiftEnter();
      return true;
    }

    const isShiftTab = text === "\x1b[Z";
    const isArrowRight = text === "\x1b[C";
    if (!isShiftTab && !isArrowRight) {
      this.clearCompletionSession();
    }

    if (text === "\x1b[H" || text === "\x1bOH") {
      await this.jumpToStart();
      return true;
    }

    if (text === "\x1b[F" || text === "\x1bOF") {
      await this.jumpToEnd();
      return true;
    }

    if (isArrowRight) {
      if (
        this.cursorPos === this.currentLine.length && this.completionSession &&
        this.previewLength > 0
      ) {
        await this.acceptCompletion();
        return true;
      }
      await this.moveCursorRight();
      return true;
    }

    if (text === "\x1b[3~") {
      await this.deleteForwardChar();
      return true;
    }

    if (text === "\x1b[3;3~") {
      await this.deleteWordForward();
      return true;
    }

    if (text === "\x1b[Z") {
      await this.cycleCompletion(true);
      return true;
    }

    if (text === "\x1b\x7f") {
      await this.deleteWordBackward();
      return true;
    }

    if (text === "\x1bb") {
      await this.moveCursorWordLeft();
      return true;
    }

    if (text === "\x1bf") {
      await this.moveCursorWordRight();
      return true;
    }

    if (text === "\x1bd") {
      await this.deleteWordForward();
      return true;
    }

    if (text.startsWith("\x1b[")) {
      const finalChar = text.slice(-1);
      const params = text.slice(2, -1);
      const altModifier = params.includes(";3");
      const shouldClear = !isShiftTab && finalChar !== "C" && finalChar !== "D";
      if (shouldClear) {
        this.clearCompletionSession();
      }

      switch (finalChar) {
        case "A":
          await this.navigateHistory(-1);
          return true;
        case "B":
          await this.navigateHistory(1);
          return true;
        case "C":
          if (altModifier) {
            await this.moveCursorWordRight();
          } else {
            await this.moveCursorRight();
          }
          return true;
        case "D":
          if (altModifier) {
            await this.moveCursorWordLeft();
          } else {
            await this.moveCursorLeft();
          }
          return true;
        case "~":
          if (params === "3") {
            await this.deleteForwardChar();
            return true;
          }
          if (params === "3;3") {
            await this.deleteWordForward();
            return true;
          }
          break;
      }
    }

    return false;
  }

  /**
   * Navigate command history
   */
  private async navigateHistory(direction: number): Promise<void> {
    const len = this.getHistoryLength();
    if (len === 0) return;

    if (direction < 0) {
      // Up arrow
      this.historyIndex = this.historyIndex === -1
        ? len - 1
        : Math.max(0, this.historyIndex - 1);
      this.currentLine = this.getHistoryAt(this.historyIndex);
    } else {
      // Down arrow
      if (this.historyIndex === -1) return;

      this.historyIndex++;
      if (this.historyIndex >= len) {
        this.historyIndex = -1;
        this.currentLine = "";
      } else {
        this.currentLine = this.getHistoryAt(this.historyIndex);
      }
    }

    this.cursorPos = this.currentLine.length;
    await this.redrawLine();
  }

  /**
   * Move cursor left
   */
  private async moveCursorLeft(): Promise<void> {
    if (this.cursorPos > 0) {
      this.cursorPos--;
      await this.write(ANSI_MOVE_LEFT);
    }
  }

  /**
   * Move cursor right
   */
  private async moveCursorRight(): Promise<void> {
    if (this.cursorPos < this.currentLine.length) {
      this.cursorPos++;
      await this.write(ANSI_MOVE_RIGHT);
    }
  }

  /**
   * Jump cursor to start of line
   */
  private async jumpToStart(): Promise<void> {
    this.cursorPos = 0;
    await this.redrawLine();
  }

  /**
   * Jump cursor to end of line
   */
  private async jumpToEnd(): Promise<void> {
    this.cursorPos = this.currentLine.length;
    await this.redrawLine();
  }

  /**
   * Delete from cursor to start of line
   */
  private async deleteToStart(): Promise<void> {
    this.currentLine = this.currentLine.slice(this.cursorPos);
    this.cursorPos = 0;
    await this.redrawLine();
  }

  /**
   * Delete from cursor to end of line
   */
  private async deleteToEnd(): Promise<void> {
    this.currentLine = this.currentLine.slice(0, this.cursorPos);
    await this.redrawLine();
  }

  /**
   * Delete word backward from cursor
   */
  private async deleteWordBackward(): Promise<void> {
    if (this.cursorPos === 0) return;
    const { line, cursor } = deleteWordLeft(this.currentLine, this.cursorPos);
    this.currentLine = line;
    this.cursorPos = cursor;
    await this.redrawLine();
  }

  /**
   * Delete word forward from cursor
   */
  private async deleteWordForward(): Promise<void> {
    if (this.cursorPos >= this.currentLine.length) return;
    const { line } = deleteWordRight(this.currentLine, this.cursorPos);
    this.currentLine = line;
    await this.redrawLine();
  }

  /**
   * Delete single character forward (Delete key)
   */
  private async deleteForwardChar(): Promise<void> {
    if (this.cursorPos >= this.currentLine.length) return;
    this.currentLine = this.currentLine.slice(0, this.cursorPos) +
      this.currentLine.slice(this.cursorPos + 1);
    await this.redrawLine();
  }

  /**
   * Handle Backspace key
   */
  private async handleBackspace(): Promise<void> {
    if (this.cursorPos > 0) {
      this.currentLine = this.currentLine.slice(0, this.cursorPos - 1) +
        this.currentLine.slice(this.cursorPos);
      this.cursorPos--;
      await this.redrawLine();
      await this.updateLiveCompletion();
    }
  }

  /**
   * Insert character at cursor position
   */
  private async insertChar(char: string): Promise<void> {
    this.currentLine = this.currentLine.slice(0, this.cursorPos) +
      char +
      this.currentLine.slice(this.cursorPos);
    this.cursorPos++;
    await this.redrawLine();
  }

  private clearCompletionSession(): void {
    this.completionSession = null;
    this.previewLength = 0;
  }

  /**
   * Move cursor left by one word
   */
  private async moveCursorWordLeft(): Promise<void> {
    const target = findWordBoundaryLeft(this.currentLine, this.cursorPos);
    if (target === this.cursorPos) return;
    this.cursorPos = target;
    await this.redrawLine();
  }

  /**
   * Move cursor right by one word
   */
  private async moveCursorWordRight(): Promise<void> {
    const target = findWordBoundaryRight(this.currentLine, this.cursorPos);
    if (target === this.cursorPos) return;
    this.cursorPos = target;
    await this.redrawLine();
  }

  /**
   * Check if character code is printable
   */
  private isPrintable(code: number): boolean {
    return code >= PRINTABLE_START && code < PRINTABLE_END;
  }

  /**
   * Highlight HQL keywords in line
   */
  private highlightSyntax(line: string): string {
    if (!this.keywordRegex) return line;
    return line.replace(this.keywordRegex, `${DARK_PURPLE}$1${RESET}`);
  }

  /**
   * Redraw current line with syntax highlighting
   */
  private async redrawLine(): Promise<void> {
    const highlighted = this.highlightSyntax(this.currentLine);
    let preview = "";
    this.previewLength = 0;
    if (this.completionSession && this.cursorPos === this.currentLine.length) {
      const item =
        this.completionSession.suggestions[this.completionSession.index];
      if (item) {
        const baseLength = this.completionSession.base.length;
        const visibleLength = this.currentLine.length - baseLength -
          this.completionSession.suffix.length;
        const text = item.snippet
          ? this.expandSnippet(item.snippet).text
          : item.label;
        const remaining = text.slice(visibleLength);
        if (
          remaining &&
          this.cursorPos >=
            this.currentLine.length - this.completionSession.suffix.length
        ) {
          preview = `${DIM}${remaining}${RESET}`;
          this.previewLength = remaining.length;
        }
      }
    }
    const moveBack = this.currentLine.length - this.cursorPos;
    const cursorMove = (this.previewLength + moveBack) > 0
      ? `\x1b[${this.previewLength + moveBack}D`
      : "";

    await this.write(
      `${ANSI_CARRIAGE_RETURN}${ANSI_CLEAR_LINE}${this.currentPrompt} ${highlighted}${preview}${cursorMove}`,
    );
  }

  /**
   * Write text to stdout
   */
  private async write(text: string): Promise<void> {
    await Deno.stdout.write(this.encoder.encode(text));
  }

  private getCompletionTarget(): { start: number; prefix: string } {
    let start = findWordBoundaryLeft(this.currentLine, this.cursorPos);
    if (start > 0 && this.currentLine[start - 1] === ".") {
      start -= 1;
    }
    const prefix = this.currentLine.slice(start, this.cursorPos);
    return { start, prefix };
  }

  private async cycleCompletion(reverse: boolean): Promise<void> {
    if (!this.completionProvider) return;

    if (!this.completionSession) {
      const initialized = await this.updateLiveCompletion();
      if (!initialized) return;
    }

    if (
      !this.completionSession || this.completionSession.suggestions.length === 0
    ) {
      return;
    }

    const { suggestions } = this.completionSession;
    const direction = reverse ? -1 : 1;
    this.completionSession.index =
      (this.completionSession.index + direction + suggestions.length) %
      suggestions.length;
    await this.redrawLine();
  }

  private async updateLiveCompletion(): Promise<boolean> {
    if (!this.completionProvider) {
      this.clearCompletionSession();
      return false;
    }

    if (this.cursorPos < this.currentLine.length) {
      this.clearCompletionSession();
      await this.redrawLine();
      return false;
    }

    const { start, prefix } = this.getCompletionTarget();

    const suggestions = await this.completionProvider({
      line: this.currentLine,
      cursor: this.cursorPos,
      prefix,
    }) ?? [];

    if (suggestions.length === 0) {
      this.clearCompletionSession();
      await this.redrawLine();
      return false;
    }

    this.completionSession = {
      suggestions,
      index: 0,
      base: this.currentLine.slice(0, start),
      suffix: this.currentLine.slice(this.cursorPos),
    };
    await this.redrawLine();
    return true;
  }

  private async acceptCompletion(): Promise<void> {
    if (!this.completionSession) return;
    const { suggestions, index, base, suffix } = this.completionSession;
    if (suggestions.length === 0) return;
    const choice = suggestions[index];
    if (choice.snippet) {
      const { text, cursor } = this.expandSnippet(choice.snippet);
      this.currentLine = `${base}${text}${suffix}`;
      this.cursorPos = base.length + cursor;
    } else {
      this.currentLine = `${base}${choice.label}${suffix}`;
      this.cursorPos = base.length + choice.label.length;
    }
    this.clearCompletionSession();
    await this.redrawLine();
  }

  private async handleShiftEnter(): Promise<void> {
    if (this.completionSession && this.previewLength > 0) {
      await this.acceptCompletion();
    }
    await this.write("\n");
    const line = this.currentLine;
    if (line.trim()) {
      this.pushHistory(line);
    }
    this.clearCompletionSession();
    this.pendingSubmit = line;
  }

  private async startReverseSearch(): Promise<void> {
    if (this.getHistoryLength() === 0) return;
    const originalLine = this.currentLine;
    const originalCursor = this.cursorPos;
    this.searchQuery = "";
    this.searchIndex = this.getHistoryLength();
    this.searchMatch = "";
    await this.renderSearchPrompt();
    while (true) {
      const key = await this.readKey();
      if (!key) break;
      const action = this.handleReverseSearchKey(key);
      if (action === "continue") {
        continue;
      }
      if (action === "accept") {
        if (this.searchMatch) {
          this.currentLine = this.searchMatch;
          this.cursorPos = this.currentLine.length;
        }
        break;
      }
      if (action === "cancel") {
        this.currentLine = originalLine;
        this.cursorPos = originalCursor;
        break;
      }
    }
    await this.write(`${ANSI_CARRIAGE_RETURN}${ANSI_CLEAR_LINE}`);
    await this.redrawLine();
  }

  private handleReverseSearchKey(key: Uint8Array): "continue" | "accept" | "cancel" | "none" {
    if (key.length !== 1) return "none";
    const code = key[0];
    if (code === ControlChar.CTRL_R.charCodeAt(0)) {
      this.advanceReverseSearch();
      this.renderSearchPrompt();
      return "continue";
    }
    if (
      code === ControlChar.ENTER.charCodeAt(0) ||
      code === ControlChar.CTRL_E.charCodeAt(0)
    ) {
      return "accept";
    }
    if (
      code === ControlChar.CTRL_G.charCodeAt(0) ||
      code === ControlChar.ESCAPE.charCodeAt(0) ||
      code === ControlChar.CTRL_C.charCodeAt(0)
    ) {
      return "cancel";
    }
    if (code === ControlChar.BACKSPACE.charCodeAt(0)) {
      if (this.searchQuery.length > 0) {
        this.searchQuery = this.searchQuery.slice(0, -1);
        this.searchIndex = this.getHistoryLength();
        this.searchMatch = "";
        this.advanceReverseSearch();
      }
      this.renderSearchPrompt();
      return "continue";
    }
    if (code === ControlChar.CTRL_W.charCodeAt(0)) {
      if (this.searchQuery.length > 0) {
        const boundary = findWordBoundaryLeft(
          this.searchQuery,
          this.searchQuery.length,
        );
        this.searchQuery = this.searchQuery.slice(0, boundary);
        this.searchIndex = this.getHistoryLength();
        this.searchMatch = "";
        this.advanceReverseSearch();
        this.renderSearchPrompt();
      }
      return "continue";
    }
    if (code === ControlChar.CTRL_U.charCodeAt(0)) {
      this.searchQuery = "";
      this.searchIndex = this.getHistoryLength();
      this.searchMatch = "";
      this.advanceReverseSearch();
      this.renderSearchPrompt();
      return "continue";
    }
    if (this.isPrintable(code)) {
      this.searchQuery += String.fromCharCode(code);
      this.searchIndex = this.getHistoryLength();
      this.searchMatch = "";
      this.advanceReverseSearch();
      this.renderSearchPrompt();
      return "continue";
    }
    return "none";
  }

  private advanceReverseSearch(): void {
    const { index, value } = this.findReverseMatch(
      this.searchQuery,
      this.searchIndex,
    );
    this.searchIndex = index;
    this.searchMatch = value;
  }

  private findReverseMatch(
    query: string,
    start: number,
  ): { index: number; value: string } {
    const len = this.getHistoryLength();
    if (len === 0) {
      return { index: -1, value: "" };
    }
    let idx = Math.min(start - 1, len - 1);
    if (start === len) {
      idx = len - 1;
    }
    for (let i = idx; i >= 0; i--) {
      const entry = this.getHistoryAt(i);
      if (!query || entry.includes(query)) {
        return { index: i, value: entry };
      }
    }
    return { index: -1, value: "" };
  }

  private async renderSearchPrompt(): Promise<void> {
    const query = this.searchQuery;
    const match = this.searchMatch;
    const display = `(reverse-i-search) '${query}': ${match}`;
    await this.write(
      `${ANSI_CARRIAGE_RETURN}${ANSI_CLEAR_LINE}${DIM}${display}${RESET}`,
    );
  }

  private expandSnippet(snippet: string): { text: string; cursor: number } {
    const regex = /\$\{(\d+):([^}]+)\}/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    let text = "";
    let cursor = text.length;
    let firstPlaceholderIndex: number | null = null;

    while ((match = regex.exec(snippet))) {
      text += snippet.slice(lastIndex, match.index) + match[2];
      const placeholderIndex = Number(match[1]);
      if (
        firstPlaceholderIndex === null ||
        placeholderIndex < firstPlaceholderIndex
      ) {
        cursor = text.length - match[2].length;
        firstPlaceholderIndex = placeholderIndex;
      }
      lastIndex = regex.lastIndex;
    }
    text += snippet.slice(lastIndex);
    if (firstPlaceholderIndex === null) {
      cursor = text.length;
    }
    return { text, cursor };
  }
}
