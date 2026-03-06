import { assert, assertEquals } from "jsr:@std/assert";
import {
  buildContext,
  createCompletionItem,
  extractCommandQuery,
  extractMentionQuery,
  generateItemId,
  getWordAtCursor,
  rankCompletions,
  resetItemIdCounter,
  shouldTriggerCommand,
  shouldTriggerFileMention,
  shouldTriggerSymbol,
} from "../../../../src/hlvm/cli/repl-ink/completion/providers.ts";
import type { CompletionItem, CompletionType } from "../../../../src/hlvm/cli/repl-ink/completion/types.ts";

function makeItem(
  id: string,
  label: string,
  type: CompletionType,
  score: number,
): CompletionItem {
  return {
    id,
    label,
    type,
    score,
    availableActions: ["SELECT"],
    applyAction: (_action, context) => ({
      text: context.text.slice(0, context.anchorPosition) + label + context.text.slice(context.cursorPosition),
      cursorPosition: context.anchorPosition + label.length,
      closeDropdown: true,
    }),
    getRenderSpec: () => ({
      icon: type,
      label,
      truncate: "end",
      maxWidth: 40,
    }),
  };
}

function ctx(text: string, cursorPosition = text.length) {
  return buildContext(text, cursorPosition, new Set(["localFn"]), new Map([["map", ["fn", "coll"]]]));
}

Deno.test("Providers: getWordAtCursor respects token boundaries", () => {
  const cases = [
    ["hello world", 5, { word: "hello", start: 0 }],
    ["hello world", 8, { word: "wo", start: 6 }],
    ["hello world", 6, { word: "", start: 6 }],
    ["(define foo)", 7, { word: "define", start: 1 }],
    ["[1 2 3]", 4, { word: "2", start: 3 }],
  ] as const;

  for (const [text, cursor, expected] of cases) {
    assertEquals(getWordAtCursor(text, cursor), expected, text);
  }
});

Deno.test("Providers: buildContext derives current word, string state, and enclosing form", () => {
  const symbolCtx = ctx("(forget mem", 11);
  assertEquals(symbolCtx.textBeforeCursor, "(forget mem");
  assertEquals(symbolCtx.currentWord, "mem");
  assertEquals(symbolCtx.wordStart, 8);
  assertEquals(symbolCtx.isInsideString, false);
  assertEquals(symbolCtx.enclosingForm, { name: "forget", argIndex: 0 });

  const stringCtx = ctx('(print "hel', 11);
  assertEquals(stringCtx.isInsideString, true);
  assertEquals(stringCtx.enclosingForm, undefined);
});

Deno.test("Providers: rankCompletions uses score, then type priority, then alphabetic order without mutation", () => {
  const items: CompletionItem[] = [
    makeItem("1", "zebra", "function", 100),
    makeItem("2", "apple", "function", 100),
    makeItem("3", "keywordTie", "keyword", 100),
    makeItem("4", "highest", "function", 110),
  ];

  const ranked = rankCompletions(items);

  assertEquals(ranked.map((item) => item.label), ["highest", "keywordTie", "apple", "zebra"]);
  assertEquals(items.map((item) => item.label), ["zebra", "apple", "keywordTie", "highest"]);
});

Deno.test("Providers: item factories generate stable ids and default/custom apply behavior", () => {
  resetItemIdCounter();
  assertEquals(generateItemId("test"), "test-1");
  assertEquals(generateItemId("test"), "test-2");
  resetItemIdCounter();

  const defaultItem = createCompletionItem("map", "function");
  const customItem = createCompletionItem("defn", "keyword", {
    insertText: "(defn [] )",
    addTrailingSpace: false,
    score: 50,
    description: "template",
  });

  assertEquals(
    defaultItem.applyAction("SELECT", { text: "ma", cursorPosition: 2, anchorPosition: 0 }),
    { text: "map ", cursorPosition: 4, closeDropdown: true },
  );
  assertEquals(customItem.score, 50);
  assertEquals(customItem.description, "template");
  assertEquals(
    customItem.applyAction("SELECT", { text: "(d", cursorPosition: 2, anchorPosition: 1 }),
    { text: "((defn [] )", cursorPosition: 11, closeDropdown: true },
  );
});

Deno.test("Providers: file mention trigger and query extraction distinguish paths from email-like text", () => {
  const triggerCases = [
    [ctx("@"), true],
    [ctx("hello @"), true],
    [ctx("(@file)"), true],
    [ctx("t@~/Desktop"), true],
    [ctx("email@domain"), false],
    [ctx("hello"), false],
  ] as const;

  for (const [context, expected] of triggerCases) {
    assertEquals(shouldTriggerFileMention(context), expected, context.text);
  }

  const queryCases = [
    [ctx("@src/file"), "src/file"],
    [ctx("@"), ""],
    [ctx("@/Users/test/My Documents/file.ts"), "/Users/test/My Documents/file.ts"],
    [ctx("(@file)", 7), null],
    [ctx('@file"', 6), null],
    [ctx("@src/file and more", 13), null],
  ] as const;

  for (const [context, expected] of queryCases) {
    assertEquals(extractMentionQuery(context), expected, context.text);
  }
});

Deno.test("Providers: slash commands only trigger at the beginning of trimmed input", () => {
  const cases = [
    [ctx("/help"), true, "help"],
    [ctx("  /clear"), true, "clear"],
    [ctx("hello /cmd"), false, null],
    [ctx("/cmd arg"), false, "cmd arg"],
    [ctx("help"), false, null],
    [ctx("/"), true, ""],
  ] as const;

  for (const [context, shouldTrigger, query] of cases) {
    assertEquals(shouldTriggerCommand(context), shouldTrigger, context.text);
    assertEquals(extractCommandQuery(context), query, context.text);
  }
});

Deno.test("Providers: symbol completion triggers for editable symbol contexts and stays off in command or mention modes", () => {
  const cases = [
    [ctx("(def", 4), true],
    [ctx("", 0), true],
    [ctx("(let x ", 7), true],
    [ctx("(", 1), true],
    [ctx("@file"), false],
    [ctx("/help"), false],
    [ctx('(print "hel', 11), false],
  ] as const;

  for (const [context, expected] of cases) {
    assertEquals(shouldTriggerSymbol(context), expected, context.text);
  }
});
