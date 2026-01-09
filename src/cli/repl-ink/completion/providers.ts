/**
 * Unified Completion System - Provider Logic
 *
 * Pure functions for filtering, ranking, and word extraction.
 * No side effects - easily testable.
 */

import type {
  CompletionItem,
  CompletionType,
  CompletionContext,
  CompletionAction,
  ApplyContext,
  ApplyResult,
  ItemRenderSpec,
} from "./types.ts";
import { TYPE_ICONS } from "./types.ts";
import { isWordBoundary } from "../../repl/string-utils.ts";

// ============================================================
// Word Extraction
// ============================================================

/**
 * Get the word at cursor position.
 * Used to determine what prefix to complete.
 *
 * @param text - Full input text
 * @param cursorPosition - Cursor position
 * @returns Current word and its start position
 */
export function getWordAtCursor(
  text: string,
  cursorPosition: number
): { word: string; start: number } {
  // Scan backwards to find word start
  let start = cursorPosition;
  while (start > 0 && !isWordBoundary(text[start - 1])) {
    start--;
  }

  return {
    word: text.slice(start, cursorPosition),
    start,
  };
}

/**
 * Build a completion context from input state.
 */
export function buildContext(
  text: string,
  cursorPosition: number,
  userBindings: ReadonlySet<string>,
  signatures: ReadonlyMap<string, readonly string[]>,
  docstrings: ReadonlyMap<string, string> = new Map()
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
  };
}

// ============================================================
// Filtering
// ============================================================

/**
 * Filter items by prefix (case-insensitive).
 *
 * @param items - Items to filter
 * @param prefix - Prefix to match
 * @returns Filtered items that start with prefix
 */
export function filterByPrefix(
  items: readonly CompletionItem[],
  prefix: string
): CompletionItem[] {
  if (!prefix) {
    return [];
  }

  const lowerPrefix = prefix.toLowerCase();
  return items.filter((item) =>
    item.label.toLowerCase().startsWith(lowerPrefix)
  );
}

/**
 * Filter items by substring match (case-insensitive).
 * Less strict than prefix matching.
 *
 * @param items - Items to filter
 * @param query - Query to match anywhere in label
 * @returns Filtered items containing query
 */
export function filterBySubstring(
  items: readonly CompletionItem[],
  query: string
): CompletionItem[] {
  if (!query) {
    return [];
  }

  const lowerQuery = query.toLowerCase();
  return items.filter((item) =>
    item.label.toLowerCase().includes(lowerQuery)
  );
}

// ============================================================
// Ranking
// ============================================================

/** Type priority for sorting (lower = higher priority) */
const TYPE_PRIORITY: Record<CompletionType, number> = {
  keyword: 1,
  macro: 2,
  function: 3,
  operator: 4,
  variable: 5,
  command: 6,
  directory: 7,
  file: 8,
};

/**
 * Rank completions by score first, then type, then alphabetically.
 *
 * Score is PRIMARY because:
 * - User bindings (score 110) should appear before stdlib (score 100)
 * - Exact/better matches can have higher scores
 *
 * @param items - Items to rank
 * @returns Sorted copy of items
 */
export function rankCompletions(
  items: readonly CompletionItem[]
): CompletionItem[] {
  return [...items].sort((a, b) => {
    // 1. By score (higher score first) - PRIMARY
    // User bindings (110) > stdlib (100) > exact matches (90)
    if (a.score !== b.score) {
      return b.score - a.score;
    }

    // 2. By type priority (keywords first) - SECONDARY
    const typeDiff = TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
    if (typeDiff !== 0) {
      return typeDiff;
    }

    // 3. Alphabetically - TERTIARY
    return a.label.localeCompare(b.label);
  });
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
export interface CreateItemOptions {
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
  maxWidth: number = 40,
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
 * Triggers when @ is typed at start of line, after whitespace, or after (
 */
export function shouldTriggerFileMention(context: CompletionContext): boolean {
  const { textBeforeCursor } = context;

  // Find the last @ before cursor
  const lastAt = textBeforeCursor.lastIndexOf("@");
  if (lastAt === -1) {
    return false;
  }

  // Check what's before the @
  if (lastAt === 0) {
    return true; // @ at start
  }

  const charBefore = textBeforeCursor[lastAt - 1];
  return charBefore === " " || charBefore === "\t" || charBefore === "(" || charBefore === "[";
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

  // Exit if query contains ) or " (code expression boundaries)
  if (query.includes(")") || query.includes('"')) {
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
 * - There's a word to complete (e.g., "ad" -> complete "add")
 * - Cursor is after an opening paren/bracket (e.g., "(" -> show all functions)
 * - Cursor is at start of input or after whitespace (show all completions)
 */
export function shouldTriggerSymbol(context: CompletionContext): boolean {
  // Don't trigger if in @ mention mode
  if (shouldTriggerFileMention(context)) {
    return false;
  }

  // Don't trigger if in command mode
  if (shouldTriggerCommand(context)) {
    return false;
  }

  // Trigger if there's a word being typed
  if (context.currentWord.length > 0) {
    return true;
  }

  // Allow empty prefix completion only in valid contexts
  const { textBeforeCursor } = context;

  // Don't trigger on empty input - user must type something first
  // (If they want to browse all symbols, they can press Tab after typing `(`)
  if (textBeforeCursor.length === 0) {
    return false;
  }

  // After opening paren/bracket - show available symbols
  const lastChar = textBeforeCursor[textBeforeCursor.length - 1];
  if (lastChar === "(" || lastChar === "[") {
    return true;
  }

  return false;
}

