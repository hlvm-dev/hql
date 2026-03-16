/**
 * Unified Completion System - Provider Logic
 *
 * Pure functions for filtering, ranking, and word extraction.
 * No side effects - easily testable.
 */

import {
  CONTEXT_AWARE_FORMS,
  RENDER_MAX_WIDTH,
  TYPE_ICONS,
  type ApplyContext,
  type ApplyResult,
  type CompletionAction,
  type CompletionContext,
  type CompletionItem,
  type CompletionType,
  type EnclosingForm,
  type ItemRenderSpec,
} from "./types.ts";
import { getWordAtCursor } from "../../repl/string-utils.ts";

// ============================================================
// String Context Detection
// ============================================================

import { isInsideString as isInsideStringFull } from "../../repl/syntax.ts";

/** Check if cursor is inside a double-quoted string literal. */
function isInsideString(text: string, cursorPosition: number): boolean {
  return isInsideStringFull(text, cursorPosition, '"');
}

// ============================================================
// Word Extraction
// ============================================================

// Note: getWordAtCursor is now imported from string-utils.ts (single source of truth)
// Re-export for consumers who import from this module
export { getWordAtCursor };

// ============================================================
// Enclosing Form Detection
// ============================================================

/**
 * Detect the enclosing S-expression form at cursor position.
 * Returns the form name and argument index for context-aware completions.
 *
 * Examples:
 *   (unbind sq|)     → { name: "unbind", argIndex: 0 }
 *   (map fn| coll)   → { name: "map", argIndex: 0 }
 *   (map fn coll|)   → { name: "map", argIndex: 1 }
 *   (let [x 1] |)    → { name: "let", argIndex: 1 }
 *   sq|              → undefined (no enclosing form)
 */
function detectEnclosingForm(text: string, cursorPosition: number): EnclosingForm | undefined {
  // Don't detect if inside a string
  if (isInsideString(text, cursorPosition)) {
    return undefined;
  }

  const textBefore = text.slice(0, cursorPosition);

  // Find the most recent unclosed opening paren
  let depth = 0;
  let openParenPos = -1;

  for (let i = textBefore.length - 1; i >= 0; i--) {
    const ch = textBefore[i];
    if (ch === ')' || ch === ']' || ch === '}') {
      depth++;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth === 0) {
        // Found the unclosed opening paren
        openParenPos = i;
        break;
      }
      depth--;
    }
  }

  if (openParenPos === -1) {
    // No enclosing form
    return undefined;
  }

  // Only consider ( forms, not [ or { (those are data structures)
  if (textBefore[openParenPos] !== '(') {
    return undefined;
  }

  // Extract the form name - first word after the opening paren
  const afterParen = textBefore.slice(openParenPos + 1);
  const nameMatch = afterParen.match(/^([a-zA-Z_][a-zA-Z0-9_?!-]*)/);

  if (!nameMatch) {
    // No valid identifier after opening paren
    return undefined;
  }

  const formName = nameMatch[1];
  const nameEndPos = openParenPos + 1 + nameMatch[1].length;

  // Count arguments between name end and cursor
  // An argument is a non-whitespace chunk separated by whitespace
  const argsSection = textBefore.slice(nameEndPos);

  let argIndex = 0;
  let inWord = false;

  for (let i = 0; i < argsSection.length; i++) {
    const ch = argsSection[i];
    const isWhitespace = ch === ' ' || ch === '\t' || ch === '\n';

    if (isWhitespace) {
      if (inWord) {
        // Ended a word - count it as an argument
        argIndex++;
        inWord = false;
      }
    } else if (ch === '(' || ch === '[' || ch === '{') {
      // Skip nested structures (count them as single argument)
      if (!inWord) inWord = true;
      let nestedDepth = 1;
      i++;
      while (i < argsSection.length && nestedDepth > 0) {
        const nch = argsSection[i];
        if (nch === '(' || nch === '[' || nch === '{') nestedDepth++;
        if (nch === ')' || nch === ']' || nch === '}') nestedDepth--;
        i++;
      }
      i--; // Back to correct position for loop
    } else if (ch === '"') {
      // Skip string literals
      if (!inWord) inWord = true;
      i++;
      while (i < argsSection.length && argsSection[i] !== '"') {
        if (argsSection[i] === '\\') i++; // Skip escaped chars
        i++;
      }
    } else {
      inWord = true;
    }
  }

  // If we're currently in a word, that's the current argument position
  // (cursor is at or within an argument being typed)

  return { name: formName, argIndex };
}

/**
 * Build a completion context from input state.
 */
export function buildContext(
  text: string,
  cursorPosition: number,
  userBindings: ReadonlySet<string>,
  signatures: ReadonlyMap<string, readonly string[]>,
  docstrings: ReadonlyMap<string, string> = new Map(),
  bindingNames: ReadonlySet<string> = new Set(),
  attachedPaths?: ReadonlySet<string>,
): CompletionContext {
  const { word, start } = getWordAtCursor(text, cursorPosition);

  return {
    text,
    cursorPosition,
    textBeforeCursor: text.slice(0, cursorPosition),
    currentWord: word,
    wordStart: start,
    userBindings,
    signatures,
    docstrings,
    isInsideString: isInsideString(text, cursorPosition),
    bindingNames,
    enclosingForm: detectEnclosingForm(text, cursorPosition),
    attachedPaths,
  };
}

// ============================================================
// Item Creation Helpers
// ============================================================

let itemIdCounter = 0;

/**
 * Generate a unique item ID.
 */
export function generateItemId(prefix: string = "item"): string {
  return `${prefix}-${++itemIdCounter}`;
}

/**
 * Reset item ID counter (for testing).
 */
export function resetItemIdCounter(): void {
  itemIdCounter = 0;
}

/** Options for creating completion items */
interface CreateItemOptions {
  readonly score?: number;
  readonly description?: string;
  readonly matchIndices?: readonly number[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Text to insert when selected (defaults to label) */
  readonly insertText?: string;
  /** Whether to add trailing space after insertion (default: true) */
  readonly addTrailingSpace?: boolean;
  // Action semantics
  readonly availableActions?: readonly CompletionAction[];
  readonly applyAction?: (action: CompletionAction, context: ApplyContext) => ApplyResult;
  readonly getRenderSpec?: () => ItemRenderSpec;
  // Optional overrides for getRenderSpec
  readonly truncate?: "start" | "end" | "none";
  readonly maxWidth?: number;
  readonly typeLabel?: string;
}

/**
 * Create a default applyAction that handles simple text insertion.
 */
function createDefaultApplyAction(
  label: string,
  insertText: string | undefined,
  addTrailingSpace: boolean
): (action: CompletionAction, context: ApplyContext) => ApplyResult {
  return (_action: CompletionAction, ctx: ApplyContext): ApplyResult => {
    const text = insertText ?? label;
    const suffix = addTrailingSpace ? " " : "";
    return {
      text: ctx.text.slice(0, ctx.anchorPosition) + text + suffix + ctx.text.slice(ctx.cursorPosition),
      cursorPosition: ctx.anchorPosition + text.length + suffix.length,
      closeDropdown: true,
    };
  };
}

/**
 * Create a default getRenderSpec for an item.
 */
function createDefaultRenderSpec(
  label: string,
  type: CompletionType,
  description: string | undefined,
  truncate: "start" | "end" | "none" = "end",
  maxWidth: number = RENDER_MAX_WIDTH.DEFAULT,
  typeLabel?: string
): () => ItemRenderSpec {
  return (): ItemRenderSpec => ({
    icon: TYPE_ICONS[type],
    label,
    truncate,
    maxWidth,
    description,
    typeLabel,
  });
}

/**
 * Create a completion item with defaults.
 * Provides default implementations for availableActions, applyAction, and getRenderSpec.
 */
export function createCompletionItem(
  label: string,
  type: CompletionType,
  options: CreateItemOptions = {}
): CompletionItem {
  const addTrailingSpace = options.addTrailingSpace ?? true;

  return {
    id: generateItemId(type),
    label,
    type,
    score: options.score ?? 100,
    description: options.description,
    matchIndices: options.matchIndices,
    metadata: options.metadata,
    // Action semantics with defaults
    availableActions: options.availableActions ?? ["SELECT"],
    applyAction: options.applyAction ?? createDefaultApplyAction(label, options.insertText, addTrailingSpace),
    getRenderSpec: options.getRenderSpec ?? createDefaultRenderSpec(
      label,
      type,
      options.description,
      options.truncate,
      options.maxWidth,
      options.typeLabel
    ),
  };
}

// ============================================================
// Provider Trigger Detection
// ============================================================

/**
 * Check if @ mention should be triggered.
 * Triggers when @ is typed:
 * - at start of line,
 * - after whitespace / list delimiters,
 * - or inline for explicit path forms like @~/, @/, @./
 */
export function shouldTriggerFileMention(context: CompletionContext): boolean {
  const { textBeforeCursor } = context;

  if (context.isInsideString) {
    return false;
  }

  // Find the last @ before cursor
  const lastAt = textBeforeCursor.lastIndexOf("@");
  if (lastAt === -1) {
    return false;
  }

  // Newline between @ and cursor means the mention ended on a previous line
  if (textBeforeCursor.indexOf("\n", lastAt) !== -1) {
    return false;
  }

  // Check what's before the @
  if (lastAt === 0) {
    return true; // @ at start
  }

  const charBefore = textBeforeCursor[lastAt - 1];
  if (charBefore === " " || charBefore === "\t" || charBefore === "\n" || charBefore === "\r" || charBefore === "(" || charBefore === "[") {
    return true;
  }

  // Allow inline explicit path mentions (e.g., t@~/desk) without enabling email-like mid-word mentions.
  const firstCharAfterAt = textBeforeCursor[lastAt + 1] ?? "";
  return firstCharAfterAt === "/" || firstCharAfterAt === "~" || firstCharAfterAt === ".";
}

/**
 * Extract the @ mention query (text after @).
 */
export function extractMentionQuery(context: CompletionContext): string | null {
  const { textBeforeCursor, cursorPosition, text } = context;

  const lastAt = textBeforeCursor.lastIndexOf("@");
  if (lastAt === -1) {
    return null;
  }

  // Get text between @ and cursor
  const query = text.slice(lastAt + 1, cursorPosition);

  // Exit if query contains newline, ) or " (expression/line boundaries)
  if (query.includes("\n") || query.includes(")") || query.includes('"')) {
    return null;
  }

  // For non-absolute paths, exit on space
  const isAbsolutePath = query.startsWith("/") || query.startsWith("~");
  if (!isAbsolutePath && query.includes(" ")) {
    return null;
  }

  return query;
}

/**
 * Check if slash command should be triggered.
 * Triggers when / is typed at start of input.
 */
export function shouldTriggerCommand(context: CompletionContext): boolean {
  const { textBeforeCursor } = context;
  const trimmed = textBeforeCursor.trimStart();

  // Must start with / and be the only thing on the line so far
  return trimmed.startsWith("/") && !trimmed.includes(" ");
}

/**
 * Extract the command query (text after /).
 */
export function extractCommandQuery(context: CompletionContext): string | null {
  const { textBeforeCursor } = context;
  const trimmed = textBeforeCursor.trimStart();

  if (!trimmed.startsWith("/")) {
    return null;
  }

  // Get text after /
  return trimmed.slice(1);
}

/**
 * Check if symbol completion should be triggered (Tab key).
 * Only if not in @ mention or / command mode.
 *
 * Triggers in these cases:
 * - Empty input (Tab should show all available completions)
 * - Cursor after whitespace (new token boundary, show all completions)
 * - There's a word to complete (e.g., "ad" -> complete "add")
 * - Cursor is after an opening paren/bracket (e.g., "(" -> show all functions)
 * - Cursor is inside a context-aware form (e.g., "(unbind |)" -> show binding names)
 */
export function shouldTriggerSymbol(context: CompletionContext): boolean {
  // Don't trigger inside string literals
  if (context.isInsideString) {
    return false;
  }

  // Don't trigger if in @ mention mode
  if (shouldTriggerFileMention(context)) {
    return false;
  }

  // Don't trigger if in command mode
  if (shouldTriggerCommand(context)) {
    return false;
  }

  // Trigger if there's a word being typed (at least 1 character)
  if (context.currentWord.length > 0) {
    return true;
  }

  // No word being typed - check for special contexts
  const { textBeforeCursor } = context;

  // Empty input - show all available symbols on explicit Tab.
  if (textBeforeCursor.length === 0) {
    return true;
  }

  // Cursor after whitespace means user is starting a new token.
  // Show all completions on explicit Tab.
  if (/\s$/.test(textBeforeCursor)) {
    return true;
  }

  // After opening paren/bracket - show available symbols
  const lastChar = textBeforeCursor[textBeforeCursor.length - 1];
  if (lastChar === "(" || lastChar === "[") {
    return true;
  }

  // CONTEXT-AWARE: Auto-trigger inside forms like (unbind |), (inspect |), (describe |)
  // Even after whitespace, show available options for these special forms
  if (context.enclosingForm && CONTEXT_AWARE_FORMS[context.enclosingForm.name]) {
    return true;
  }

  // After whitespace at end - don't show (normal case)
  if (lastChar === " " || lastChar === "\t" || lastChar === "\n") {
    return false;
  }

  return false;
}
