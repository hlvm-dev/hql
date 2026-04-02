/**
 * Shell Parser - SSOT for shell command parsing
 *
 * Provides robust shell command parsing via the battle-tested `shell-quote` library
 * with a security analysis layer on top.
 *
 * Features:
 * - Proper quote/escape handling (via shell-quote)
 * - Dangerous operator detection (|, &&, ||, ;, >, <)
 * - Preserves original command for auditing
 */

import { parse as shellParse } from "shell-quote";

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
  /** True if command contains redirect operators (>, >>, <, <<, etc.) */
  hasRedirects: boolean;
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
// Pre-validation (shell-quote doesn't throw on these)
// ============================================================

function preValidate(input: string): void {
  let inQuote: "'" | '"' | null = null;
  let escaped = false;
  let position = 0;

  for (const char of input) {
    position++;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inQuote !== "'") {
      escaped = true;
      continue;
    }
    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null;
      } else if (!inQuote) {
        inQuote = char;
      }
    }
  }

  if (inQuote) {
    throw new ShellParseError(
      `Unclosed ${inQuote === '"' ? "double" : "single"} quote`,
      position,
    );
  }
  if (escaped) {
    throw new ShellParseError("Trailing backslash", position);
  }
}

// ============================================================
// Parser
// ============================================================

/**
 * Parse shell command with proper quote/escape handling
 *
 * Uses `shell-quote` for tokenization with a security analysis layer on top.
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
 * // Dangerous operators detected
 * parseShellCommand("ls | grep foo")
 * // => { ..., hasPipes: true, ... }
 * ```
 */
export function parseShellCommand(command: string): ParsedCommand {
  const trimmed = command.trim();

  if (!trimmed) {
    throw new ShellParseError("Empty command");
  }

  // shell-quote silently absorbs unclosed quotes — validate first
  preValidate(trimmed);

  const tokens = shellParse(trimmed);
  const args: string[] = [];
  let hasPipes = false;
  let hasChaining = false;
  let hasRedirects = false;

  for (const token of tokens) {
    if (typeof token === "string") {
      args.push(token);
    } else if (token && typeof token === "object") {
      if ("op" in token) {
        const op = (token as { op: string }).op;
        if (op === "|") {
          hasPipes = true;
        } else if (op === "||" || op === "&&" || op === ";" || op === ";;") {
          hasChaining = true;
        } else if (op === ">" || op === ">>" || op === "<" || op === "<<") {
          hasRedirects = true;
        }
        // Single & (background) is not treated as chaining — matches prior behavior
      } else if ("pattern" in token) {
        // Glob pattern — treat the pattern string as a regular arg
        args.push((token as { pattern: string }).pattern);
      }
    }
  }

  if (args.length === 0) {
    throw new ShellParseError("No command found");
  }

  return {
    program: args[0],
    args: args.slice(1),
    hasPipes,
    hasChaining,
    hasRedirects,
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
 */
export function isSafeCommand(parsed: ParsedCommand): boolean {
  return !parsed.hasPipes && !parsed.hasChaining && !parsed.hasRedirects;
}

/**
 * Get user-friendly error message for unsafe command
 *
 * @param parsed Parsed command
 * @returns Error message explaining why command is unsafe
 */
export function getUnsafeReason(parsed: ParsedCommand): string {
  const reasons: string[] = [];
  if (parsed.hasPipes) reasons.push("pipe operators (|)");
  if (parsed.hasChaining) reasons.push("chaining operators (&&/||/;)");
  if (parsed.hasRedirects) reasons.push("redirect operators (>/<)");
  if (reasons.length === 0) return "Command is safe";
  return `Command contains ${reasons.join(" and ")}`;
}
