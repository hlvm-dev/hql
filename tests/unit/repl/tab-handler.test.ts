import { assert, assertEquals } from "jsr:@std/assert";
import { shouldTabAcceptSuggestion } from "../../../src/hlvm/cli/repl/tab-logic.ts";
import {
  acceptSuggestion,
  findSuggestion,
} from "../../../src/hlvm/cli/repl/suggester.ts";
import { getWordAtCursor } from "../../../src/hlvm/cli/repl/string-utils.ts";

Deno.test("tab handler: tab never accepts suggestions while the guard conditions fail", () => {
  const suggestion = { full: "(+ 1 2)", ghost: " 2)" };

  assertEquals(shouldTabAcceptSuggestion(suggestion, 4, 4, false), false);
  assertEquals(shouldTabAcceptSuggestion(suggestion, 2, 4, false), false);
  assertEquals(shouldTabAcceptSuggestion(suggestion, 4, 4, true), false);
  assertEquals(shouldTabAcceptSuggestion(null, 4, 4, false), false);
});

Deno.test("tab handler: real suggestions remain non-accepting even when history finds a match", () => {
  const historySuggestion = findSuggestion("(defn", ["(defn foo [x] x)"], new Set());
  const bindingSuggestion = findSuggestion("my-aw", [], new Set(["my-awesome-function"]));

  assert(historySuggestion !== null);
  assert(bindingSuggestion !== null);
  assertEquals(
    shouldTabAcceptSuggestion(historySuggestion, 5, 5, false),
    false,
  );
  assertEquals(acceptSuggestion(bindingSuggestion), "my-awesome-function");
});

Deno.test("tab handler: cursor-word extraction still identifies function-position completions", () => {
  assertEquals(getWordAtCursor("(add3", 5), { word: "add3", start: 1 });
  assertEquals(getWordAtCursor("(add3 ", 6), { word: "", start: 6 });
});
