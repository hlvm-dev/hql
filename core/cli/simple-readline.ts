/**
 * Simple readline implementation using Deno's raw stdin
 * Supports arrow key history navigation without Node.js dependencies
 */
import { ANSI_COLORS } from "./ansi.ts";

const { DARK_PURPLE, RESET } = ANSI_COLORS;

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
  ENTER = "\r",
}

// Bracketed paste mode sequences
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const ENABLE_BRACKETED_PASTE = "\x1b[?2004h";
const DISABLE_BRACKETED_PASTE = "\x1b[?2004l";

// Character ranges
const PRINTABLE_START = 32;
const PRINTABLE_END = 127;

// ANSI escape sequences
const ANSI_CLEAR_LINE = "\x1b[K";
const ANSI_CARRIAGE_RETURN = "\r";
const ANSI_MOVE_LEFT = "\x1b[D";
const ANSI_MOVE_RIGHT = "\x1b[C";

// HQL keywords for syntax highlighting
const KEYWORDS = [
  "fn", "function", "defn", "let", "var", "if", "cond", "match",
  "for", "while", "loop", "recur", "do", "class", "import", "export",
  "try", "catch", "throw", "await", "async", "return", "break", "continue"
];

// Pre-compile keyword regex for performance
const KEYWORD_REGEX = new RegExp(`\\b(${KEYWORDS.join("|")})\\b`, "g");

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

export class SimpleReadline {
  private history: string[] = [];
  private historyIndex = -1;
  private currentLine = "";
  private cursorPos = 0;
  private lastWasCtrlC = false;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private currentPrompt = "";

  async readline(prompt: string): Promise<string | null> {
    this.currentPrompt = prompt;
    await this.write(prompt + " ");

    this.reset();
    Deno.stdin.setRaw(true);
    await this.write(ENABLE_BRACKETED_PASTE); // Enable paste mode

    try {
      return await this.readLoop();
    } finally {
      await this.write(DISABLE_BRACKETED_PASTE); // Disable paste mode
      Deno.stdin.setRaw(false);
    }
  }

  /**
   * Reset state for new input
   */
  private reset(): void {
    this.currentLine = "";
    this.cursorPos = 0;
    this.historyIndex = -1;
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
   * Read a single key press or paste sequence
   */
  private async readKey(): Promise<Uint8Array | null> {
    const buf = new Uint8Array(1024); // Support larger paste operations
    const n = await Deno.stdin.read(buf);
    return n === null ? null : buf.subarray(0, n);
  }

  /**
   * Handle a key press
   */
  private async handleKey(key: Uint8Array): Promise<KeyResult> {
    const keyStr = this.decoder.decode(key);

    // Handle bracketed paste
    if (keyStr.startsWith(BRACKETED_PASTE_START)) {
      await this.handlePaste(keyStr);
      return { action: KeyAction.Continue };
    }

    // Handle arrow keys (3-byte sequences)
    if (this.isArrowKey(key)) {
      await this.handleArrowKey(String.fromCharCode(key[2]));
      return { action: KeyAction.Continue };
    }

    // Fallback: handle multi-byte UTF-8 sequences or fast typing
    if (key.length !== 1) {
      await this.insertText(keyStr);
      return { action: KeyAction.Continue };
    }

    return await this.handleSingleByte(key[0]);
  }

  /**
   * Handle a single byte input (prints, control keys, etc.)
   */
  private async handleSingleByte(code: number): Promise<KeyResult> {
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
      await this.write("\n");
      const line = this.currentLine;
      if (line.trim()) {
        this.history.push(line);
      }
      return { action: KeyAction.Submit, value: line };
    }

    // Control keys
    if (await this.handleControlKey(code)) {
      return { action: KeyAction.Continue };
    }

    // Printable characters
    if (this.isPrintable(code)) {
      await this.insertText(String.fromCharCode(code));
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
        await this.deleteWord();
        return true;

      case ControlChar.BACKSPACE.charCodeAt(0):
        await this.handleBackspace();
        return true;

      default:
        return false;
    }
  }

  /**
   * Handle pasted text (bracketed paste mode)
   */
  private async handlePaste(input: string): Promise<void> {
    // Remove the bracketed paste markers and extract the text
    let text = input.slice(BRACKETED_PASTE_START.length);

    // Check if we have the end marker in this chunk
    const endIndex = text.indexOf(BRACKETED_PASTE_END);

    if (endIndex !== -1) {
      // We have the complete paste in one chunk
      text = text.slice(0, endIndex);
    } else {
      // Paste spans multiple reads - keep reading until we find the end marker
      while (true) {
        const key = await this.readKey();
        if (!key) break;

        const chunk = this.decoder.decode(key);
        const chunkEndIndex = chunk.indexOf(BRACKETED_PASTE_END);

        if (chunkEndIndex !== -1) {
          text += chunk.slice(0, chunkEndIndex);
          break;
        } else {
          text += chunk;
        }
      }
    }

    // Insert the pasted text at cursor position
    // Replace newlines with spaces (single-line REPL)
    text = text.replace(/[\r\n]+/g, " ");

    await this.insertText(text);
  }

  /**
   * Handle arrow key navigation
   */
  private async handleArrowKey(key: string): Promise<void> {
    switch (key) {
      case ArrowKey.Up:
        await this.navigateHistory(-1);
        break;

      case ArrowKey.Down:
        await this.navigateHistory(1);
        break;

      case ArrowKey.Right:
        await this.moveCursorRight();
        break;

      case ArrowKey.Left:
        await this.moveCursorLeft();
        break;
    }
  }

  /**
   * Navigate command history
   */
  private async navigateHistory(direction: number): Promise<void> {
    if (this.history.length === 0) return;
    let nextLine: string;

    if (direction < 0) {
      // Up arrow
      this.historyIndex = this.historyIndex === -1
        ? this.history.length - 1
        : Math.max(0, this.historyIndex - 1);
      nextLine = this.history[this.historyIndex];
    } else {
      // Down arrow
      if (this.historyIndex === -1) return;

      this.historyIndex++;
      if (this.historyIndex >= this.history.length) {
        this.historyIndex = -1;
        nextLine = "";
      } else {
        nextLine = this.history[this.historyIndex];
      }
    }

    await this.setLine(nextLine);
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
    await this.setLine(this.currentLine, 0);
  }

  /**
   * Jump cursor to end of line
   */
  private async jumpToEnd(): Promise<void> {
    await this.setLine(this.currentLine, this.currentLine.length);
  }

  /**
   * Delete from cursor to start of line
   */
  private async deleteToStart(): Promise<void> {
    await this.setLine(this.currentLine.slice(this.cursorPos), 0);
  }

  /**
   * Delete from cursor to end of line
   */
  private async deleteToEnd(): Promise<void> {
    await this.setLine(this.currentLine.slice(0, this.cursorPos), this.cursorPos);
  }

  /**
   * Delete word backward from cursor
   */
  private async deleteWord(): Promise<void> {
    const before = this.currentLine.slice(0, this.cursorPos);
    const after = this.currentLine.slice(this.cursorPos);

    // Skip trailing spaces, then delete word
    let pos = before.length;
    while (pos > 0 && before[pos - 1] === " ") pos--;
    while (pos > 0 && before[pos - 1] !== " ") pos--;

    await this.setLine(before.slice(0, pos) + after, pos);
  }

  /**
   * Handle Backspace key
   */
  private async handleBackspace(): Promise<void> {
    if (this.cursorPos > 0) {
      const newCursor = this.cursorPos - 1;
      const newLine =
        this.currentLine.slice(0, newCursor) +
        this.currentLine.slice(this.cursorPos);
      await this.setLine(newLine, newCursor);
    }
  }

  /**
   * Insert text at cursor position
   */
  private async insertText(text: string): Promise<void> {
    if (!text) return;
    const newCursor = this.cursorPos + text.length;
    const newLine =
      this.currentLine.slice(0, this.cursorPos) +
      text +
      this.currentLine.slice(this.cursorPos);
    await this.setLine(newLine, newCursor);
  }

  /**
   * Set current line value and cursor position
   */
  private async setLine(line: string, cursorPos = line.length): Promise<void> {
    this.currentLine = line;
    this.cursorPos = Math.max(0, Math.min(cursorPos, line.length));
    await this.redrawLine();
  }

  /**
   * Check if key sequence is an arrow key
   */
  private isArrowKey(key: Uint8Array): boolean {
    return key.length === 3 &&
           key[0] === ControlChar.ESCAPE.charCodeAt(0) &&
           key[1] === "[".charCodeAt(0);
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
    return line.replace(KEYWORD_REGEX, `${DARK_PURPLE}$1${RESET}`);
  }

  /**
   * Redraw current line with syntax highlighting
   */
  private async redrawLine(): Promise<void> {
    const highlighted = this.highlightSyntax(this.currentLine);
    const moveBack = this.currentLine.length - this.cursorPos;
    const cursorMove = moveBack > 0 ? `\x1b[${moveBack}D` : "";

    await this.write(
      `${ANSI_CARRIAGE_RETURN}${ANSI_CLEAR_LINE}${this.currentPrompt} ${highlighted}${cursorMove}`
    );
  }

  /**
   * Write text to stdout
   */
  private async write(text: string): Promise<void> {
    await Deno.stdout.write(this.encoder.encode(text));
  }
}
