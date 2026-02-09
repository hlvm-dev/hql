/**
 * Shell Parser - SSOT for shell command parsing
 *
 * Provides robust shell command parsing with proper quote/escape handling.
 * Fixes naive whitespace-split approach that breaks on quoted arguments.
 *
 * Replaces:
 * - shell-tools.ts:133 (naive split)
 *
 * Features:
 * - Single/double quote handling
 * - Backslash escape sequences
 * - Dangerous operator detection (|, &&, ||, ;)
 * - Preserves original command for auditing
 */

// ============================================================
// Types
// ============================================================

/**
 * Parsed shell command with security metadata
 */
export interface ParsedCommand {
  /** Program/executable name (first argument) */
  program: string;
  /** Parsed arguments (excluding program) */
  args: string[];
  /** True if command contains pipe operators (|) */
  hasPipes: boolean;
  /** True if command contains chaining operators (&&, ||, ;) */
  hasChaining: boolean;
  /** Original unparsed command string */
  raw: string;
}

/**
 * Error thrown when parsing fails
 */
export class ShellParseError extends Error {
  constructor(message: string, position?: number) {
    super(position !== undefined
      ? `${message} at position ${position}`
      : message
    );
    this.name = "ShellParseError";
  }
}

// ============================================================
// Parser
// ============================================================

/**
 * Parse shell command with proper quote/escape handling
 *
 * Handles:
 * - Single quotes: Literal strings, no escapes processed
 * - Double quotes: Allows escapes like \", \\, \n
 * - Backslash: Escapes next character outside quotes
 * - Whitespace: Argument delimiter outside quotes
 * - Pipes/chaining: Detected and flagged (not parsed)
 *
 * Security:
 * - Detects dangerous shell operators
 * - Returns flags for risk assessment
 * - Preserves original for auditing
 *
 * Limitations:
 * - No variable expansion ($VAR)
 * - No glob expansion (*.txt)
 * - No subshell execution ($(cmd))
 * - Single command only (pipes detected but not parsed)
 *
 * @param command Shell command string to parse
 * @returns Parsed command with security metadata
 * @throws ShellParseError if parsing fails (unclosed quotes, etc.)
 *
 * @example
 * ```ts
 * // Simple command
 * parseShellCommand("ls -la /tmp")
 * // => { program: "ls", args: ["-la", "/tmp"], ... }
 *
 * // Quoted arguments
 * parseShellCommand('git commit -m "fix: bug #123"')
 * // => { program: "git", args: ["commit", "-m", "fix: bug #123"], ... }
 *
 * // Escaped quotes
 * parseShellCommand('echo "He said \\"Hello\\""')
 * // => { program: "echo", args: ['He said "Hello"'], ... }
 *
 * // Dangerous operators detected
 * parseShellCommand("ls | grep foo")
 * // => { ..., hasPipes: true, ... }
 * ```
 */
export function parseShellCommand(command: string): ParsedCommand {
  const args: string[] = [];
  let current = "";
  let inQuote: "'" | '"' | null = null;
  let escaped = false;
  let hasPipes = false;
  let hasChaining = false;
  let position = 0;
  let pendingPipe = false;
  let pendingAmp = false;

  // Trim leading/trailing whitespace
  const trimmed = command.trim();

  // Empty command
  if (!trimmed) {
    throw new ShellParseError("Empty command");
  }

  for (const char of trimmed) {
    position++;

    // Handle escape sequences
    if (escaped) {
      // In single quotes, backslash is literal
      if (inQuote === "'") {
        current += "\\" + char;
      } else {
        // Process common escape sequences
        switch (char) {
          case "n":
            current += "\n";
            break;
          case "t":
            current += "\t";
            break;
          case "r":
            current += "\r";
            break;
          case " ": // Escaped space
          case "\\":
          case '"':
          case "'":
            current += char;
            break;
          default:
            // Unknown escape - preserve backslash
            current += "\\" + char;
        }
      }
      escaped = false;
      continue;
    }

    // Backslash initiates escape sequence (not in single quotes)
    if (char === "\\" && inQuote !== "'") {
      escaped = true;
      continue;
    }

    // Quote handling
    if (char === '"' || char === "'") {
      if (inQuote === char) {
        // Close matching quote
        inQuote = null;
      } else if (!inQuote) {
        // Open new quote
        inQuote = char;
      } else {
        // Different quote inside quotes - treat as literal
        current += char;
      }
      continue;
    }

    // Inside quotes - add all chars literally
    if (inQuote) {
      current += char;
      continue;
    }

    // Outside quotes - detect special operators using pending-state pattern.
    // A single | or & could be the start of || or && respectively, so we defer
    // the decision until we see the next character.

    // Resolve any pending operator that the current char may continue
    let consumed = false;
    if (pendingPipe) {
      if (char === "|") {
        // || is a chaining operator, not a pipe
        hasChaining = true;
        consumed = true;
      } else {
        // Previous | was a standalone pipe
        hasPipes = true;
      }
      pendingPipe = false;
    }
    if (pendingAmp) {
      if (char === "&") {
        hasChaining = true;
        consumed = true;
      }
      // Single & at end: not a recognized multi-char operator
      pendingAmp = false;
    }

    // Start new pending operators (only if char wasn't consumed as part of a multi-char op)
    if (!consumed) {
      if (char === "|") {
        pendingPipe = true;
      } else if (char === "&") {
        pendingAmp = true;
      } else if (char === ";") {
        hasChaining = true;
      }
    }

    // Whitespace delimiter outside quotes
    if (char === " " || char === "\t") {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    // Regular character
    current += char;
  }

  // Resolve any pending operators at end of input
  if (pendingPipe) {
    hasPipes = true;
  }
  // pendingAmp at end: single trailing & is not &&, so we don't set hasChaining

  // Check for unclosed quotes
  if (inQuote) {
    throw new ShellParseError(`Unclosed ${inQuote === '"' ? "double" : "single"} quote`, position);
  }

  // Check for trailing backslash
  if (escaped) {
    throw new ShellParseError("Trailing backslash", position);
  }

  // Add final argument
  if (current) {
    args.push(current);
  }

  // Empty result
  if (args.length === 0) {
    throw new ShellParseError("No command found");
  }

  return {
    program: args[0],
    args: args.slice(1),
    hasPipes,
    hasChaining,
    raw: command,
  };
}

// ============================================================
// Validation Helpers
// ============================================================

/**
 * Check if command is safe for execution
 *
 * Safe commands:
 * - No pipes or chaining
 * - No dangerous characters in arguments
 *
 * @param parsed Parsed command to check
 * @returns True if command appears safe
 *
 * @example
 * ```ts
 * const cmd = parseShellCommand("ls -la");
 * if (isSafeCommand(cmd)) {
 *   // Execute command
 * }
 * ```
 */
export function isSafeCommand(parsed: ParsedCommand): boolean {
  return !parsed.hasPipes && !parsed.hasChaining;
}

/**
 * Get user-friendly error message for unsafe command
 *
 * @param parsed Parsed command
 * @returns Error message explaining why command is unsafe
 *
 * @example
 * ```ts
 * const cmd = parseShellCommand("ls | grep foo");
 * if (!isSafeCommand(cmd)) {
 *   console.error(getUnsafeReason(cmd));
 *   // => "Command contains pipe operators (|)"
 * }
 * ```
 */
export function getUnsafeReason(parsed: ParsedCommand): string {
  if (parsed.hasPipes && parsed.hasChaining) {
    return "Command contains both pipe operators (|) and chaining operators (&&/||/;)";
  }
  if (parsed.hasPipes) {
    return "Command contains pipe operators (|)";
  }
  if (parsed.hasChaining) {
    return "Command contains chaining operators (&&/||/;)";
  }
  return "Command is safe";
}
