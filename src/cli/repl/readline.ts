/**
 * HQL REPL Readline - Terminal input with multi-line S-expression support
 * Based on simple-readline.ts with added paren/bracket balancing
 */

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

// Character ranges
const PRINTABLE_START = 32;
const PRINTABLE_END = 127;

// ANSI escape sequences
const ANSI_CLEAR_LINE = "\x1b[K";
const ANSI_CARRIAGE_RETURN = "\r";
const ANSI_MOVE_LEFT = "\x1b[D";

// ANSI color codes
const DARK_PURPLE = "\x1b[38;2;128;54;146m";
const RESET = "\x1b[0m";

// HQL keywords for syntax highlighting
const KEYWORDS = [
  "fn", "function", "let", "var", "const", "if", "cond", "match",
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

export interface ReadlineOptions {
  prompt: string;
  continuationPrompt: string;
  history: string[];
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

  /**
   * Read a complete (possibly multi-line) input
   */
  async readline(options: ReadlineOptions): Promise<string | null> {
    this.currentPrompt = options.prompt;
    this.continuationPrompt = options.continuationPrompt;
    this.history = options.history;
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
    const buf = new Uint8Array(3);
    const n = await Deno.stdin.read(buf);
    return n === null ? null : buf.subarray(0, n);
  }

  private async handleKey(key: Uint8Array): Promise<KeyResult> {
    // Handle arrow keys first (3-byte sequences)
    if (this.isArrowKey(key)) {
      await this.handleArrowKey(String.fromCharCode(key[2]));
      return { action: KeyAction.Continue };
    }

    // Handle single-byte keys
    if (key.length !== 1) {
      return { action: KeyAction.Continue };
    }

    const code = key[0];

    // Ctrl+D (EOF)
    if (code === ControlChar.CTRL_D.charCodeAt(0)) {
      if (this.currentLine.length === 0 && this.lines.length === 0) {
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
      this.lines = [];
      return { action: KeyAction.Cancel };
    }

    // Reset Ctrl+C flag
    this.lastWasCtrlC = false;

    // Enter
    if (code === ControlChar.ENTER.charCodeAt(0)) {
      await this.write("\n");
      const line = this.currentLine;
      return { action: KeyAction.Submit, value: line };
    }

    // Control keys
    if (await this.handleControlKey(code)) {
      return { action: KeyAction.Continue };
    }

    // Printable characters
    if (this.isPrintable(code)) {
      await this.insertChar(String.fromCharCode(code));
    }

    return { action: KeyAction.Continue };
  }

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
    this.currentLine = this.currentLine.slice(this.cursorPos);
    this.cursorPos = 0;
    await this.redrawLine();
  }

  private async deleteToEnd(): Promise<void> {
    this.currentLine = this.currentLine.slice(0, this.cursorPos);
    await this.redrawLine();
  }

  private async deleteWord(): Promise<void> {
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
      this.currentLine =
        this.currentLine.slice(0, this.cursorPos - 1) +
        this.currentLine.slice(this.cursorPos);
      this.cursorPos--;
      await this.redrawLine();
    }
  }

  private async insertChar(char: string): Promise<void> {
    this.currentLine =
      this.currentLine.slice(0, this.cursorPos) +
      char +
      this.currentLine.slice(this.cursorPos);
    this.cursorPos++;
    await this.redrawLine();
  }

  private isArrowKey(key: Uint8Array): boolean {
    return key.length === 3 &&
           key[0] === ControlChar.ESCAPE.charCodeAt(0) &&
           key[1] === "[".charCodeAt(0);
  }

  private isPrintable(code: number): boolean {
    return code >= PRINTABLE_START && code < PRINTABLE_END;
  }

  private highlightSyntax(line: string): string {
    return line.replace(KEYWORD_REGEX, `${DARK_PURPLE}$1${RESET}`);
  }

  private async redrawLine(): Promise<void> {
    const prompt = this.lines.length > 0 ? this.continuationPrompt : this.currentPrompt;
    const highlighted = this.highlightSyntax(this.currentLine);
    const moveBack = this.currentLine.length - this.cursorPos;
    const cursorMove = moveBack > 0 ? `\x1b[${moveBack}D` : "";

    await this.write(
      `${ANSI_CARRIAGE_RETURN}${ANSI_CLEAR_LINE}${prompt}${highlighted}${cursorMove}`
    );
  }

  private async write(text: string): Promise<void> {
    await Deno.stdout.write(this.encoder.encode(text));
  }
}
