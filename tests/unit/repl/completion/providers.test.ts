/**
 * Unit tests for Unified Completion System - Provider Logic
 *
 * Tests filtering, ranking, word extraction, and trigger detection.
 */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  getWordAtCursor,
  buildContext,
  rankCompletions,
  generateItemId,
  resetItemIdCounter,
  createCompletionItem,
  shouldTriggerFileMention,
  extractMentionQuery,
  shouldTriggerCommand,
  extractCommandQuery,
  shouldTriggerSymbol,
} from "../../../../src/cli/repl-ink/completion/providers.ts";
import type {
  CompletionAction,
  CompletionItem,
  CompletionContext,
  CompletionType,
  ApplyResult,
  ApplyContext,
  ItemRenderSpec,
} from "../../../../src/cli/repl-ink/completion/types.ts";
import { TYPE_ICONS } from "../../../../src/cli/repl-ink/completion/types.ts";

// ============================================================
// Test Data
// ============================================================

/** Create a mock CompletionItem with all required properties for testing */
function createMockItem(
  id: string,
  label: string,
  type: CompletionType,
  score: number,
  options: { insertText?: string; addTrailingSpace?: boolean; description?: string } = {}
): CompletionItem {
  const insertText = options.insertText ?? label;
  const addTrailingSpace = options.addTrailingSpace ?? true;
  const suffix = addTrailingSpace ? " " : "";

  return {
    id,
    label,
    type,
    score,
    description: options.description,
    availableActions: ["SELECT"],
    applyAction: (_action: CompletionAction, context: ApplyContext): ApplyResult => ({
      text: context.text.slice(0, context.anchorPosition) + insertText + suffix + context.text.slice(context.cursorPosition),
      cursorPosition: context.anchorPosition + insertText.length + suffix.length,
      closeDropdown: true,
    }),
    getRenderSpec: (): ItemRenderSpec => ({
      icon: TYPE_ICONS[type],
      label,
      truncate: "end",
      maxWidth: 40,
      description: options.description,
    }),
  };
}

function createContext(
  text: string,
  cursorPosition: number
): CompletionContext {
  return buildContext(text, cursorPosition, new Set(), new Map());
}

// ============================================================
// getWordAtCursor Tests
// ============================================================

Deno.test("Providers: getWordAtCursor extracts word at cursor", () => {
  const result = getWordAtCursor("hello world", 5);

  assertEquals(result.word, "hello");
  assertEquals(result.start, 0);
});

Deno.test("Providers: getWordAtCursor handles middle of word", () => {
  const result = getWordAtCursor("hello world", 8);

  // cursor at position 8 means "wo" (indices 6,7 = 'w','o')
  assertEquals(result.word, "wo");
  assertEquals(result.start, 6);
});

Deno.test("Providers: getWordAtCursor handles cursor at end", () => {
  const result = getWordAtCursor("hello world", 11);

  assertEquals(result.word, "world");
  assertEquals(result.start, 6);
});

Deno.test("Providers: getWordAtCursor handles empty position", () => {
  const result = getWordAtCursor("hello world", 6);

  assertEquals(result.word, "");
  assertEquals(result.start, 6);
});

Deno.test("Providers: getWordAtCursor handles parens as boundaries", () => {
  const result = getWordAtCursor("(define foo)", 7);

  assertEquals(result.word, "define");
  assertEquals(result.start, 1);
});

Deno.test("Providers: getWordAtCursor handles brackets as boundaries", () => {
  // "[1 2 3]" - at position 4, we're after "2" started
  const result = getWordAtCursor("[1 2 3]", 4);

  assertEquals(result.word, "2");
  assertEquals(result.start, 3);
});

// ============================================================
// buildContext Tests
// ============================================================

Deno.test("Providers: buildContext creates full context", () => {
  const ctx = createContext("(def foo)", 5);

  assertEquals(ctx.text, "(def foo)");
  assertEquals(ctx.cursorPosition, 5);
  assertEquals(ctx.textBeforeCursor, "(def ");
  assertEquals(ctx.currentWord, "");
  assertEquals(ctx.wordStart, 5);
});

// ============================================================
// rankCompletions Tests
// ============================================================

Deno.test("Providers: rankCompletions sorts by type priority first", () => {
  const items: CompletionItem[] = [
    createMockItem("1", "alpha", "function", 100),
    createMockItem("2", "beta", "keyword", 100),
  ];

  const result = rankCompletions(items);

  assertEquals(result[0].label, "beta"); // keyword first
  assertEquals(result[1].label, "alpha"); // function second
});

Deno.test("Providers: rankCompletions sorts by score second", () => {
  const items: CompletionItem[] = [
    createMockItem("1", "low", "function", 50),
    createMockItem("2", "high", "function", 100),
  ];

  const result = rankCompletions(items);

  assertEquals(result[0].label, "high"); // higher score first
  assertEquals(result[1].label, "low");
});

Deno.test("Providers: rankCompletions sorts alphabetically third", () => {
  const items: CompletionItem[] = [
    createMockItem("1", "zebra", "function", 100),
    createMockItem("2", "apple", "function", 100),
  ];

  const result = rankCompletions(items);

  assertEquals(result[0].label, "apple");
  assertEquals(result[1].label, "zebra");
});

Deno.test("Providers: rankCompletions does not mutate original", () => {
  const items: CompletionItem[] = [
    createMockItem("1", "b", "function", 100),
    createMockItem("2", "a", "function", 100),
  ];

  rankCompletions(items);

  assertEquals(items[0].label, "b"); // original unchanged
});

// ============================================================
// generateItemId / resetItemIdCounter Tests
// ============================================================

Deno.test("Providers: generateItemId creates unique IDs", () => {
  resetItemIdCounter();

  const id1 = generateItemId("test");
  const id2 = generateItemId("test");

  assert(id1 !== id2);
  assertEquals(id1, "test-1");
  assertEquals(id2, "test-2");
});

Deno.test("Providers: resetItemIdCounter resets the counter", () => {
  resetItemIdCounter();
  generateItemId("a");
  generateItemId("a");
  resetItemIdCounter();

  const id = generateItemId("a");
  assertEquals(id, "a-1");
});

// ============================================================
// createCompletionItem Tests
// ============================================================

Deno.test("Providers: createCompletionItem creates item with defaults", () => {
  resetItemIdCounter();
  const item = createCompletionItem("test", "function");

  assertEquals(item.label, "test");
  assertEquals(item.type, "function");
  assertEquals(item.score, 100);
  assert(item.id.startsWith("function-"));
  // Default addTrailingSpace: true is reflected in applyAction
  const result = item.applyAction("SELECT", { text: "te", cursorPosition: 2, anchorPosition: 0 });
  assertEquals(result.text, "test "); // Has trailing space
});

Deno.test("Providers: createCompletionItem accepts custom options", () => {
  resetItemIdCounter();
  const item = createCompletionItem("test", "keyword", {
    score: 50,
    description: "A test item",
    addTrailingSpace: false,
  });

  assertEquals(item.score, 50);
  assertEquals(item.description, "A test item");
  // addTrailingSpace: false is reflected in applyAction
  const result = item.applyAction("SELECT", { text: "te", cursorPosition: 2, anchorPosition: 0 });
  assertEquals(result.text, "test"); // No trailing space
});

// ============================================================
// shouldTriggerFileMention Tests
// ============================================================

Deno.test("Providers: shouldTriggerFileMention triggers at line start", () => {
  const ctx = createContext("@", 1);
  assert(shouldTriggerFileMention(ctx));
});

Deno.test("Providers: shouldTriggerFileMention triggers after space", () => {
  const ctx = createContext("hello @", 7);
  assert(shouldTriggerFileMention(ctx));
});

Deno.test("Providers: shouldTriggerFileMention triggers after paren", () => {
  const ctx = createContext("(@file)", 6);
  assert(shouldTriggerFileMention(ctx));
});

Deno.test("Providers: shouldTriggerFileMention triggers after bracket", () => {
  const ctx = createContext("[@file]", 6);
  assert(shouldTriggerFileMention(ctx));
});

Deno.test("Providers: shouldTriggerFileMention does not trigger mid-word", () => {
  const ctx = createContext("email@domain", 12);
  assert(!shouldTriggerFileMention(ctx));
});

Deno.test("Providers: shouldTriggerFileMention does not trigger without @", () => {
  const ctx = createContext("hello", 5);
  assert(!shouldTriggerFileMention(ctx));
});

// ============================================================
// extractMentionQuery Tests
// ============================================================

Deno.test("Providers: extractMentionQuery extracts query after @", () => {
  const ctx = createContext("@src/file", 9);
  assertEquals(extractMentionQuery(ctx), "src/file");
});

Deno.test("Providers: extractMentionQuery handles empty query", () => {
  const ctx = createContext("@", 1);
  assertEquals(extractMentionQuery(ctx), "");
});

Deno.test("Providers: extractMentionQuery stops at closing paren", () => {
  const ctx = createContext("(@file)", 7);
  assertEquals(extractMentionQuery(ctx), null); // Contains )
});

Deno.test("Providers: extractMentionQuery stops at quote", () => {
  const ctx = createContext('@file"', 6);
  assertEquals(extractMentionQuery(ctx), null); // Contains "
});

Deno.test("Providers: extractMentionQuery handles absolute paths with spaces", () => {
  const ctx = createContext("@/Users/test/My Documents/file.ts", 33);
  assertEquals(extractMentionQuery(ctx), "/Users/test/My Documents/file.ts");
});

Deno.test("Providers: extractMentionQuery stops at space for relative paths", () => {
  // Cursor at position 13 means query = "src/file and" which contains space
  const ctx = createContext("@src/file and more", 13);
  // Relative path with space returns null
  assertEquals(extractMentionQuery(ctx), null);
});

// ============================================================
// shouldTriggerCommand Tests
// ============================================================

Deno.test("Providers: shouldTriggerCommand triggers at start with /", () => {
  const ctx = createContext("/help", 5);
  assert(shouldTriggerCommand(ctx));
});

Deno.test("Providers: shouldTriggerCommand triggers with leading whitespace", () => {
  const ctx = createContext("  /clear", 8);
  assert(shouldTriggerCommand(ctx));
});

Deno.test("Providers: shouldTriggerCommand does not trigger after text", () => {
  const ctx = createContext("hello /cmd", 10);
  assert(!shouldTriggerCommand(ctx));
});

Deno.test("Providers: shouldTriggerCommand does not trigger with space after", () => {
  const ctx = createContext("/cmd arg", 8);
  assert(!shouldTriggerCommand(ctx));
});

// ============================================================
// extractCommandQuery Tests
// ============================================================

Deno.test("Providers: extractCommandQuery extracts command name", () => {
  const ctx = createContext("/help", 5);
  assertEquals(extractCommandQuery(ctx), "help");
});

Deno.test("Providers: extractCommandQuery handles empty after slash", () => {
  const ctx = createContext("/", 1);
  assertEquals(extractCommandQuery(ctx), "");
});

Deno.test("Providers: extractCommandQuery handles leading whitespace", () => {
  const ctx = createContext("   /clear", 9);
  assertEquals(extractCommandQuery(ctx), "clear");
});

Deno.test("Providers: extractCommandQuery returns null without slash", () => {
  const ctx = createContext("help", 4);
  assertEquals(extractCommandQuery(ctx), null);
});

// ============================================================
// shouldTriggerSymbol Tests
// ============================================================

Deno.test("Providers: shouldTriggerSymbol triggers when word exists", () => {
  const ctx = createContext("(def", 4);
  assert(shouldTriggerSymbol(ctx));
});

Deno.test("Providers: shouldTriggerSymbol does NOT trigger on empty input", () => {
  const ctx = createContext("", 0);
  // Empty input should NOT trigger - requires at least 1 character
  assert(!shouldTriggerSymbol(ctx));
});

Deno.test("Providers: shouldTriggerSymbol does not trigger in @ mode", () => {
  const ctx = createContext("@file", 5);
  assert(!shouldTriggerSymbol(ctx));
});

Deno.test("Providers: shouldTriggerSymbol does not trigger in / mode", () => {
  const ctx = createContext("/help", 5);
  assert(!shouldTriggerSymbol(ctx));
});

// ============================================================
// applyAction Tests
// ============================================================

Deno.test("Providers: applyAction inserts text at anchor", () => {
  const item = createMockItem("1", "define", "keyword", 100, { addTrailingSpace: true });

  const result = item.applyAction("SELECT", { text: "(def", cursorPosition: 4, anchorPosition: 1 });

  assertEquals(result.text, "(define ");
  assertEquals(result.cursorPosition, 8);
});

Deno.test("Providers: applyAction uses insertText when provided", () => {
  const item = createMockItem("1", "defn", "keyword", 100, { insertText: "(defn [] )", addTrailingSpace: false });

  const result = item.applyAction("SELECT", { text: "(d", cursorPosition: 2, anchorPosition: 1 });

  assertEquals(result.text, "((defn [] )");
  assertEquals(result.cursorPosition, 11);
});

Deno.test("Providers: applyAction respects addTrailingSpace false", () => {
  const item = createMockItem("1", "test", "function", 100, { addTrailingSpace: false });

  const result = item.applyAction("SELECT", { text: "te", cursorPosition: 2, anchorPosition: 0 });

  assertEquals(result.text, "test");
  assertEquals(result.cursorPosition, 4);
});

Deno.test("Providers: applyAction preserves text after cursor", () => {
  const item = createMockItem("1", "map", "function", 100, { addTrailingSpace: true });

  const result = item.applyAction("SELECT", { text: "(ma x y)", cursorPosition: 3, anchorPosition: 1 });

  assertEquals(result.text, "(map  x y)");
  assertEquals(result.cursorPosition, 5);
});
