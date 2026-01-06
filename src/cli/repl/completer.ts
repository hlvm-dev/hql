/**
 * HQL REPL Completer - Tab Completion
 *
 * Provides completion candidates with type information.
 * Uses known identifiers from the language plus user bindings.
 */

import { getAllKnownIdentifiers } from "../../common/known-identifiers.ts";
import {
  PRIMITIVE_OPS,
  KERNEL_PRIMITIVES,
  DECLARATION_KEYWORDS,
  BINDING_KEYWORDS,
} from "../../transpiler/keyword/primitives.ts";
import {
  CONTROL_FLOW_KEYWORDS,
  THREADING_MACROS,
  extractMacroNames,
} from "../../common/known-identifiers.ts";

// ============================================================
// Types
// ============================================================

export type CompletionType =
  | "keyword"
  | "operator"
  | "macro"
  | "function"
  | "variable"
  | "file"
  | "directory";

export interface CompletionItem {
  /** The completion text */
  readonly text: string;
  /** Type of identifier */
  readonly type: CompletionType;
  /** Optional signature/description */
  readonly signature?: string;
}

// ============================================================
// Pre-computed Classification Sets
// ============================================================

const KEYWORD_SET: ReadonlySet<string> = new Set([
  ...CONTROL_FLOW_KEYWORDS,
  ...DECLARATION_KEYWORDS,
  ...BINDING_KEYWORDS,
  ...KERNEL_PRIMITIVES,
]);

const OPERATOR_SET: ReadonlySet<string> = PRIMITIVE_OPS;

const MACRO_SET: ReadonlySet<string> = new Set([
  ...THREADING_MACROS,
  ...extractMacroNames(),
]);

// ============================================================
// Completion Functions
// ============================================================

/**
 * Get the word at cursor position for completion.
 *
 * @param line - Current input line
 * @param cursorPos - Cursor position
 * @returns The word and its start position
 */
export function getWordAtCursor(
  line: string,
  cursorPos: number
): { word: string; start: number } {
  // Find start of word (scan backwards)
  let start = cursorPos;
  while (start > 0 && !isWordBoundary(line[start - 1])) {
    start--;
  }

  return {
    word: line.slice(start, cursorPos),
    start,
  };
}

/** Check if character is a word boundary (shared by completer and suggester) */
export function isWordBoundary(ch: string): boolean {
  return /[\s\(\)\[\]\{\}"',;]/.test(ch);
}

/**
 * Classify an identifier into a completion type.
 */
function classifyIdentifier(id: string, userBindings: ReadonlySet<string>): CompletionType {
  if (KEYWORD_SET.has(id)) return "keyword";
  if (OPERATOR_SET.has(id)) return "operator";
  if (MACRO_SET.has(id)) return "macro";
  if (userBindings.has(id)) return "variable";
  return "function"; // Default to function for stdlib
}

/**
 * Get completions for the given prefix.
 *
 * @param prefix - The prefix to complete
 * @param userBindings - User-defined bindings from ReplState
 * @returns Array of completion items, sorted alphabetically
 */
export function getCompletions(
  prefix: string,
  userBindings: ReadonlySet<string>
): CompletionItem[] {
  if (prefix.length === 0) return [];

  const allIdentifiers = getAllKnownIdentifiers();
  const results: CompletionItem[] = [];

  // Add matching known identifiers
  for (const id of allIdentifiers) {
    if (id.startsWith(prefix) && id !== prefix) {
      results.push({
        text: id,
        type: classifyIdentifier(id, userBindings),
      });
    }
  }

  // Add matching user bindings
  for (const binding of userBindings) {
    if (binding.startsWith(prefix) && binding !== prefix) {
      // Check if already added from known identifiers
      if (!results.some(r => r.text === binding)) {
        results.push({
          text: binding,
          type: "variable",
        });
      }
    }
  }

  // Sort alphabetically, then by type (keywords first)
  results.sort((a, b) => {
    // Keywords first
    if (a.type === "keyword" && b.type !== "keyword") return -1;
    if (a.type !== "keyword" && b.type === "keyword") return 1;
    // Then alphabetically
    return a.text.localeCompare(b.text);
  });

  // Limit results
  return results.slice(0, 15);
}

/**
 * Apply a completion to the input line.
 */
export function applyCompletion(
  line: string,
  cursorPos: number,
  completion: CompletionItem
): { line: string; cursorPos: number } {
  const { word } = getWordAtCursor(line, cursorPos);
  const suffix = completion.text.slice(word.length);
  return {
    line: line.slice(0, cursorPos) + suffix + line.slice(cursorPos),
    cursorPos: cursorPos + suffix.length,
  };
}
